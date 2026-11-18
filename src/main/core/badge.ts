import { deflateSync } from "node:zlib";

const DIGITS: Record<string, string[]> = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "001", "001", "001"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  "+": ["000", "010", "111", "010", "000"],
};

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A 16x16 red dot with the unread count drawn in white (1 to 9, "+" above 9), as PNG bytes. */
export function badgePng(count: number): Buffer {
  const size = 16;
  const glyph = DIGITS[count > 9 ? "+" : String(Math.max(count, 0))] ?? DIGITS["0"]!;
  const pixels = Buffer.alloc(size * size * 4);
  const set = (x: number, y: number, rgba: [number, number, number, number]): void => {
    pixels.set(rgba, (y * size + x) * 4);
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - 7.5;
      const dy = y - 7.5;
      if (dx * dx + dy * dy <= 7.5 * 7.5) set(x, y, [207, 74, 74, 255]);
    }
  }
  // Each glyph cell is drawn 2x2 pixels, centred: 6 wide and 10 tall.
  glyph.forEach((row, gy) => {
    [...row].forEach((cell, gx) => {
      if (cell !== "1") return;
      for (let py = 0; py < 2; py++) {
        for (let px = 0; px < 2; px++) set(5 + gx * 2 + px, 3 + gy * 2 + py, [255, 255, 255, 255]);
      }
    });
  });
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
