// Renders the PWA icons into public/ (node scripts/icons.mjs). Pure Node, no image deps.
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const BG = [13, 14, 16];
const ACCENT = [29, 155, 240];
const INK = [13, 14, 16];

function crc32(buf) {
  let c, crc = ~0;
  for (const b of buf) {
    c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, color) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) raw.set(color(x, y), y * (size * 4 + 1) + 1 + x * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Shape in unit coordinates (0..1): bookmark with three sort bars.
function shade(u, v, scale) {
  const c = (t) => 0.5 + (t - 0.5) / scale;
  const x = c(u), y = c(v);
  const left = 0.27, right = 0.73, top = 0.16, bottom = 0.86, notch = 0.68;
  const inX = x >= left && x <= right && y >= top && y <= bottom;
  const halfW = (right - left) / 2;
  const notchY = notch + ((bottom - notch) * Math.abs(x - 0.5)) / halfW;
  if (!inX || y > notchY) return null;
  const bar = (y0, x1) => y >= y0 && y <= y0 + 0.045 && x >= 0.36 && x <= x1;
  if (bar(0.3, 0.64) || bar(0.41, 0.58) || bar(0.52, 0.5)) return INK;
  return ACCENT;
}

function render(size, { scale = 1, rounded = true } = {}) {
  const ss = 4;
  const radius = rounded ? 0.22 : 0;
  return png(size, (px, py) => {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < ss; sy++)
      for (let sx = 0; sx < ss; sx++) {
        const u = (px + (sx + 0.5) / ss) / size;
        const v = (py + (sy + 0.5) / ss) / size;
        const dx = Math.max(radius - u, u - (1 - radius), 0);
        const dy = Math.max(radius - v, v - (1 - radius), 0);
        if (radius && dx * dx + dy * dy > radius * radius) continue;
        const col = shade(u, v, scale) ?? BG;
        r += col[0]; g += col[1]; b += col[2]; a += 255;
      }
    const n = ss * ss;
    const alpha = a / n;
    const k = a ? n / (a / 255) : 1;
    return [Math.round((r / n) * k), Math.round((g / n) * k), Math.round((b / n) * k), Math.round(alpha)];
  });
}

writeFileSync("public/icon-192.png", render(192));
writeFileSync("public/icon-512.png", render(512));
writeFileSync("public/icon-maskable-512.png", render(512, { scale: 0.8, rounded: false }));
writeFileSync("public/apple-touch-icon.png", render(180, { rounded: false }));
