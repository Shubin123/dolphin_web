// Dolphin's explicit pixel depths use GX depth (near=0, far=1). The browser
// renderer uses reverse Z for geometry, clears and comparisons. Convert only
// explicit fragment outputs; interpolated raster depth already uses reverse Z.
export function reverseFragmentDepth(source) {
  if (!source.includes("@builtin(frag_depth)")) return source;
  // Naga emits a named output structure and returns its constructor from the
  // fragment entry point. Match the declared depth field rather than assuming
  // that depth is the first constructor argument or has a particular name.
  const structures = new Map();
  for (const match of source.matchAll(/struct\s+(\w+)\s*\{([^}]+)\}/g)) {
    const field = /@builtin\(frag_depth\)\s+(\w+)\s*:\s*f32\b/.exec(match[2]);
    if (field) structures.set(match[1], field[1]);
  }
  const entry = /@fragment\s+fn\s+\w+\s*\([^]*?\)\s*->\s*(\w+)\s*\{/.exec(source);
  const field = entry && structures.get(entry[1]);
  if (!field) throw new Error("Unsupported WGSL fragment depth interface");
  const begin = entry.index + entry[0].length;
  let end = begin, braces = 1;
  for (; end < source.length && braces; end++) {
    if (source[end] === "{") braces++;
    else if (source[end] === "}") braces--;
  }
  if (braces) throw new Error("Unterminated WGSL fragment entry point");
  let returns = 0;
  const body = source.slice(begin, end - 1).replace(/\breturn\s+([^;]+);/g, (_, value) => {
    returns++;
    return `{ var dolphin_reverse_depth_output = ${value}; ` +
      `dolphin_reverse_depth_output.${field} = 1.0 - dolphin_reverse_depth_output.${field}; ` +
      "return dolphin_reverse_depth_output; }";
  });
  if (!returns) throw new Error("Missing WGSL fragment depth return");
  return source.slice(0, begin) + body + source.slice(end - 1);
}
