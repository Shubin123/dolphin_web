// Modern file layout from the pinned Dolphin State.h / State.cpp (version 189).
// This checks the envelope; the native deserializer validates the payload.
export function validateDolphinStateFile(bytes, gameId) {
  if (bytes.byteLength < 32) throw new Error('truncated save-state header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (new TextDecoder().decode(bytes.subarray(0, 6)) !== gameId) throw new Error('save state belongs to a different game');
  if (view.getUint32(8, true) !== 0 || view.getUint32(24, true) !== (0xBAADBABE + 189) >>> 0) {
    throw new Error('incompatible save-state version');
  }
  const extended = 32 + view.getUint32(28, true);
  if (extended + 16 > bytes.byteLength) throw new Error('truncated save-state version or extended header');
  if (view.getUint16(extended, true) !== 1) throw new Error('invalid save-state extended header');
  const compression = view.getUint16(extended + 2, true);
  const size = view.getBigUint64(extended + 8, true);
  if (size === 0n || size > 0x80000000n) throw new Error('invalid save-state payload size');
  if (compression === 0) {
    const start = extended + 16 + view.getUint32(extended + 4, true);
    if (BigInt(bytes.byteLength - start) !== size) throw new Error('truncated save-state payload');
  } else if (compression === 1) {
    let cursor = extended + 16;
    let chunks = 0;
    while (cursor < bytes.byteLength) {
      if (cursor + 4 > bytes.byteLength) throw new Error('truncated compressed save-state chunk');
      const length = view.getInt32(cursor, true);
      cursor += 4;
      if (length <= 0 || length > bytes.byteLength - cursor) throw new Error('invalid compressed save-state chunk');
      cursor += length;
      chunks++;
    }
    if (!chunks) throw new Error('empty compressed save-state payload');
  } else throw new Error('unsupported save-state compression');
}
