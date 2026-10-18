// Copyright 2026 wasm-dolphin contributors
// SPDX-License-Identifier: GPL-2.0-or-later

// Motion-compensated in-between frames for high-refresh displays. The guest
// still produces ~60 frames/s at its own clock; this only synthesizes the
// image shown between two finished frames, so game logic and physics are
// untouched. Costs one compute pass per frame pair and one draw per
// synthesized image.

export const INTERPOLATION_BLOCK = 16;
// Half-motion search radius in pixels: matches movement up to twice this
// between consecutive game frames.
export const INTERPOLATION_RADIUS = 10;
// Per-pixel colour difference above which neither warped frame is trusted
// (occlusion, scene cut) and the nearer real frame is shown instead.
export const INTERPOLATION_FALLBACK_COST = 0.35;

const PARAMS_BYTES = 32;

const COMMON_WGSL = /* wgsl */ `
struct Params {
  size: vec2<u32>,
  blocks: vec2<u32>,
  alpha: f32,
  radius: i32,
  block: i32,
  fallbackCost: f32,
}
@group(0) @binding(0) var frameA: texture_2d<f32>;
@group(0) @binding(1) var frameB: texture_2d<f32>;
@group(0) @binding(3) var<uniform> params: Params;

fn texel(t: texture_2d<f32>, p: vec2<i32>) -> vec3<f32> {
  let q = clamp(p, vec2<i32>(0), vec2<i32>(params.size) - vec2<i32>(1));
  return textureLoad(t, q, 0).rgb;
}
fn luma(t: texture_2d<f32>, p: vec2<i32>) -> f32 {
  return dot(texel(t, p), vec3<f32>(0.299, 0.587, 0.114));
}
`;

// One workgroup per block. Symmetric search: the block centred at p in the
// in-between frame matches A at p - d and B at p + d, so the synthesized frame
// has no holes. Stored motion (A to B) is 2d.
export const INTERPOLATION_FLOW_WGSL = COMMON_WGSL + /* wgsl */ `
@group(0) @binding(2) var<storage, read_write> vectors: array<vec4<f32>>;
var<workgroup> bestKey: atomic<u32>;

@compute @workgroup_size(64)
fn flow(@builtin(workgroup_id) blockId: vec3<u32>,
        @builtin(local_invocation_index) lane: u32) {
  if (lane == 0u) { atomicStore(&bestKey, 0xffffffffu); }
  workgroupBarrier();
  let halfBlock = params.block / 2;
  let center = vec2<i32>(blockId.xy) * params.block + vec2<i32>(halfBlock);
  let side = 2 * params.radius + 1;
  for (var i = i32(lane); i < side * side; i += 64) {
    let d = vec2<i32>(i % side - params.radius, i / side - params.radius);
    var cost = 0.0;
    for (var y = -halfBlock; y < halfBlock; y += 2) {
      for (var x = -halfBlock; x < halfBlock; x += 2) {
        let p = center + vec2<i32>(x, y);
        cost += abs(luma(frameA, p - d) - luma(frameB, p + d));
      }
    }
    // Prefer small motion so flat areas and static HUD stay put.
    cost += 0.04 * f32(abs(d.x) + abs(d.y));
    let key = (u32(min(cost * 256.0, 4194303.0)) << 10u) | u32(i);
    atomicMin(&bestKey, key);
  }
  workgroupBarrier();
  if (lane == 0u) {
    let key = atomicLoad(&bestKey);
    let i = i32(key & 1023u);
    let d = vec2<i32>(i % side - params.radius, i / side - params.radius);
    vectors[blockId.y * params.blocks.x + blockId.x] =
      vec4<f32>(vec2<f32>(d * 2), f32(key >> 10u) / 256.0, 0.0);
  }
}
`;

// Per pixel, choose among the 3x3 neighbouring block vectors and zero motion
// the one whose warped A and B agree best, then blend at the display phase.
export const INTERPOLATION_RENDER_WGSL = COMMON_WGSL + /* wgsl */ `
@group(0) @binding(2) var<storage, read> vectors: array<vec4<f32>>;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  let uv = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4<f32>(uv * 2.0 - 1.0, 0.0, 1.0);
}

fn warpCost(p: vec2<i32>, v: vec2<f32>) -> f32 {
  var cost = 0.0;
  for (var k = -1; k <= 1; k++) {
    let q = p + vec2<i32>(k, 0);
    let pa = q - vec2<i32>(round(v * params.alpha));
    let pb = q + vec2<i32>(round(v * (1.0 - params.alpha)));
    let diff = abs(texel(frameA, pa) - texel(frameB, pb));
    cost += diff.r + diff.g + diff.b;
  }
  return cost / 9.0;
}

@fragment
fn fs(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
  let p = vec2<i32>(position.xy);
  let cell = p / params.block;
  var best = vec2<f32>(0.0);
  var bestCost = warpCost(p, best);
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let b = clamp(cell + vec2<i32>(x, y), vec2<i32>(0), vec2<i32>(params.blocks) - vec2<i32>(1));
      let v = vectors[u32(b.y) * params.blocks.x + u32(b.x)].xy;
      let cost = warpCost(p, v);
      if (cost < bestCost) { bestCost = cost; best = v; }
    }
  }
  if (bestCost > params.fallbackCost) {
    return vec4<f32>(select(texel(frameB, p), texel(frameA, p), params.alpha < 0.5), 1.0);
  }
  let a = texel(frameA, p - vec2<i32>(round(best * params.alpha)));
  let b = texel(frameB, p + vec2<i32>(round(best * (1.0 - params.alpha))));
  return vec4<f32>(mix(a, b, params.alpha), 1.0);
}
`;

export function interpolationBlocks(width, height, block = INTERPOLATION_BLOCK) {
  return [Math.ceil(width / block), Math.ceil(height / block)];
}

export function createWgpuFrameInterpolator(device, format) {
  const usage = globalThis.GPUBufferUsage;
  const bindGroupLayout = device.createBindGroupLayout({
    label: "frame-interp-layout",
    entries: [
      { binding: 0, visibility: 0x2 | 0x4, texture: { sampleType: "float" } },
      { binding: 1, visibility: 0x2 | 0x4, texture: { sampleType: "float" } },
      { binding: 2, visibility: 0x4, buffer: { type: "storage" } },
      { binding: 3, visibility: 0x2 | 0x4, buffer: { type: "uniform" } },
    ],
  });
  const renderLayout = device.createBindGroupLayout({
    label: "frame-interp-render-layout",
    entries: [
      { binding: 0, visibility: 0x2, texture: { sampleType: "float" } },
      { binding: 1, visibility: 0x2, texture: { sampleType: "float" } },
      { binding: 2, visibility: 0x2, buffer: { type: "read-only-storage" } },
      { binding: 3, visibility: 0x2, buffer: { type: "uniform" } },
    ],
  });
  const flowPipeline = device.createComputePipeline({
    label: "frame-interp-flow",
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    compute: {
      module: device.createShaderModule({ label: "frame-interp-flow", code: INTERPOLATION_FLOW_WGSL }),
      entryPoint: "flow",
    },
  });
  const renderModule = device.createShaderModule({
    label: "frame-interp-render",
    code: INTERPOLATION_RENDER_WGSL,
  });
  const renderPipeline = device.createRenderPipeline({
    label: "frame-interp-render",
    layout: device.createPipelineLayout({ bindGroupLayouts: [renderLayout] }),
    vertex: { module: renderModule, entryPoint: "vs" },
    fragment: { module: renderModule, entryPoint: "fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });
  const paramsBuffer = device.createBuffer({
    label: "frame-interp-params",
    size: PARAMS_BYTES,
    usage: usage.UNIFORM | usage.COPY_DST,
  });
  let vectors = null, vectorCount = 0, flowKey = null;

  function writeParams(width, height, alpha) {
    const [bx, by] = interpolationBlocks(width, height);
    const data = new ArrayBuffer(PARAMS_BYTES);
    const u32 = new Uint32Array(data), f32 = new Float32Array(data), i32 = new Int32Array(data);
    u32[0] = width; u32[1] = height; u32[2] = bx; u32[3] = by;
    f32[4] = alpha; i32[5] = INTERPOLATION_RADIUS; i32[6] = INTERPOLATION_BLOCK;
    f32[7] = INTERPOLATION_FALLBACK_COST;
    device.queue.writeBuffer(paramsBuffer, 0, data);
    return [bx, by];
  }

  return {
    // Encodes a synthesized frame between textures a and b at phase alpha
    // (0 = a, 1 = b). pairKey identifies the pair so motion is estimated once.
    encode(encoder, { a, b, pairKey, target, width, height, alpha }) {
      const [bx, by] = writeParams(width, height, alpha);
      if (!vectors || vectorCount < bx * by) {
        vectors?.destroy();
        vectorCount = bx * by;
        vectors = device.createBuffer({
          label: "frame-interp-vectors",
          size: vectorCount * 16,
          usage: usage.STORAGE,
        });
        flowKey = null;
      }
      const viewA = a.createView(), viewB = b.createView();
      if (flowKey !== pairKey) {
        const pass = encoder.beginComputePass({ label: "frame-interp-flow" });
        pass.setPipeline(flowPipeline);
        pass.setBindGroup(0, device.createBindGroup({
          layout: bindGroupLayout,
          entries: [
            { binding: 0, resource: viewA },
            { binding: 1, resource: viewB },
            { binding: 2, resource: { buffer: vectors } },
            { binding: 3, resource: { buffer: paramsBuffer } },
          ],
        }));
        pass.dispatchWorkgroups(bx, by);
        pass.end();
        flowKey = pairKey;
      }
      const pass = encoder.beginRenderPass({
        label: "frame-interp-render",
        colorAttachments: [{ view: target.createView(), loadOp: "clear", storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
      });
      pass.setPipeline(renderPipeline);
      pass.setViewport(0, 0, width, height, 0, 1);
      pass.setBindGroup(0, device.createBindGroup({
        layout: renderLayout,
        entries: [
          { binding: 0, resource: viewA },
          { binding: 1, resource: viewB },
          { binding: 2, resource: { buffer: vectors } },
          { binding: 3, resource: { buffer: paramsBuffer } },
        ],
      }));
      pass.draw(3);
      pass.end();
    },
    destroy() {
      vectors?.destroy();
      paramsBuffer.destroy();
    },
  };
}
