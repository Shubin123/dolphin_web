// Original synthetic GameCube program and apploader. No Nintendo/game code.
// The guest increments a word in RAM forever; there is no graphics payload.
export function makeHomebrewDisc() {
  const disc = Buffer.alloc(16 * 1024 * 1024);
  const word = (offset, value) => disc.writeUInt32BE(value >>> 0, offset);
  const code = (offset, values) => values.forEach((value, index) => word(offset + index * 4, value));
  disc.write('THBE01', 0); word(0x1c, 0xc2339f3d); disc.write('Dolphin browser CPU test', 0x20);
  word(0x420, 0x10000); word(0x424, 0x20000); word(0x428, 12); word(0x42c, 12); word(0x458, 1);
  // One text section at 0x80003100. The apploader loads its bytes from 0x10100.
  word(0x10000, 0x100); word(0x10048, 0x80003100); word(0x10090, 24); word(0x100e0, 0x80003100);
  word(0x20000, 0x01000000); word(0x20004, 0); word(0x20008, 1);
  disc.write('2026/10/08', 0x2440); word(0x2450, 0x81200000); word(0x2454, 0xc0); word(0x2458, 0);
  const app = 0x2460;
  // entry(r3=&init,r4=&main,r5=&close): publish callback addresses.
  code(app, [0x3cc08120,0x60c60040,0x90c30000,0x3cc08120,0x60c60050,0x90c40000,0x3cc08120,0x60c600a0,0x90c50000,0x4e800020]);
  code(app + 0x40, [0x4e800020]); // init: return.
  // main: report one copy request, then return zero on the second invocation.
  code(app + 0x50, [
    0x3cc08120,0x80e600b0,0x2c070000,0x40820034,
    0x3d008000,0x61083100,0x91030000,0x39000018,0x91040000,
    0x3d000001,0x61080100,0x91050000,0x38e00001,0x90e600b0,
    0x38600001,0x4e800020,0x38600000,0x4e800020,
  ]);
  code(app + 0xa0, [0x3c608000,0x60633100,0x4e800020]); // close: entry address.
  code(0x10100, [0x3c608000,0x60634000,0x38800000,0x38840001,0x90830000,0x4bfffff8]);
  return disc;
}
