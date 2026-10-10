// Keep automatic selection distinct from an explicit renderer choice.
export function automaticVideoRequested(search = globalThis.location?.search ?? "") {
  const video = new URLSearchParams(search).get("video");
  return !video || video === "auto";
}

export function requestedVideoBackend(search = globalThis.location?.search ?? "") {
  const video = new URLSearchParams(search).get("video");
  if (!video || video === "auto" || ["wgpu", "webgpu-real", "webgpu2"].includes(video)) {
    return "WebGPU-Real";
  }
  if (video === "ogl") return "OGL";
  if (video === "null") return "Null";
  if (video === "webgpu") return "WebGPU";
  return "Software Renderer";
}

export const WGPU_INIT_FAILURE = "WebGPU renderer initialization failed: ";

export function softwareFallbackAllowed({ automatic, videoBackend, error }) {
  return Boolean(automatic && videoBackend === "WebGPU-Real" &&
    String(error?.message ?? error).startsWith(WGPU_INIT_FAILURE));
}
