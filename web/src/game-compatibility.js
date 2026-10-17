// SB4J01 was observed waiting indefinitely in GXDrawDone with
// dual-core WebGPU scheduling. Single-core passed the fresh-boot prologue.
// Keep explicit CPU selections available for diagnosis and other games intact.
export function gameCpuThread({ gameId, videoBackend, requested, explicit = false }) {
  if (!explicit && gameId === "SB4J01" && videoBackend === "WebGPU-Real") return false;
  return Boolean(requested);
}

// ISO/GCM headers and WBFS disc headers are uncompressed. Other container
// formats stay on their requested settings; DiscIO remains the format validator.
export async function readDiscGameId(file) {
  const header = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  let discHeader = header;
  if (header[0] === 0x57 && header[1] === 0x42 && header[2] === 0x46 && header[3] === 0x53) {
    const sectorShift = header[8];
    if (sectorShift < 9 || sectorShift > 24) return "";
    const slot = header.subarray(12).find(value => value !== 0);
    if (!slot) return "";
    const offset = slot * 2 ** sectorShift;
    discHeader = new Uint8Array(await file.slice(offset, offset + 32).arrayBuffer());
  }
  if (discHeader.length < 32) return "";
  const view = new DataView(discHeader.buffer, discHeader.byteOffset, discHeader.byteLength);
  if (view.getUint32(0x18) !== 0x5d1c9ea3 && view.getUint32(0x1c) !== 0xc2339f3d) return "";
  return String.fromCharCode(...discHeader.subarray(0, 6));
}
