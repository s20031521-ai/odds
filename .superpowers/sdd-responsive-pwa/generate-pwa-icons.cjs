const fs = require("fs");
const zlib = require("zlib");

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let value = n;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[n] = value >>> 0;
}

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type);
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBytes.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return output;
}

function makeIcon(size, path) {
  const stride = 1 + size * 4;
  const raw = Buffer.alloc(stride * size);
  const background = [17, 24, 43, 255];
  const primary = [124, 131, 200, 255];
  const accent = [156, 226, 207, 255];

  for (let y = 0; y < size; y += 1) {
    raw[y * stride] = 0;
    for (let x = 0; x < size; x += 1) {
      const dx = x - size / 2;
      const dy = y - size / 2;
      let color = dx * dx + dy * dy < (size * 0.31) ** 2 ? primary : background;
      const barWidth = size * 0.065;
      const base = size * 0.64;
      if (y >= base - size * 0.16 && y <= base && x >= size * 0.34 && x <= size * 0.34 + barWidth) color = accent;
      if (y >= base - size * 0.28 && y <= base && x >= size * 0.47 && x <= size * 0.47 + barWidth) color = accent;
      if (y >= base - size * 0.40 && y <= base && x >= size * 0.60 && x <= size * 0.60 + barWidth) color = accent;
      const offset = y * stride + 1 + x * 4;
      for (let channel = 0; channel < 4; channel += 1) raw[offset + channel] = color[channel];
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  fs.writeFileSync(path, png);
}

makeIcon(192, "public/icons/icon-192.png");
makeIcon(512, "public/icons/icon-512.png");
makeIcon(512, "public/icons/icon-maskable-512.png");
makeIcon(180, "public/icons/apple-touch-icon.png");
