/**
 * Generates the app's raster icons into `resources/` with no external tooling
 * (docs/ARCHITECTURE.md §2). The tray consumes the small PNGs directly; Windows
 * packaging takes `icon.ico`, which is written here because electron-builder's own
 * PNG→ICO step runs a WASM icon tool and dies on a low-memory machine
 * (`WebAssembly.Memory(): could not allocate memory`). macOS still converts
 * `icon.png` to `.icns` during its build.
 *
 * Usage: npm run icons
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'resources');

const BRAND = { r: 0x0f, g: 0xdc, b: 0x78 };
const WHITE = { r: 0xff, g: 0xff, b: 0xff };
const TRANSPARENT = { r: 0, g: 0, b: 0, a: 0 };

/** Check mark, normalised to the unit square. */
const CHECK = [
  [0.30, 0.52],
  [0.44, 0.66],
  [0.72, 0.35],
];

// --------------------------------------------------------------- png writer

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const payload = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(payload), 0);
  return Buffer.concat([length, payload, crc]);
}

function encodePng(size, pixels) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- geometry

/** Samples per axis; 3 gives 9 samples per pixel, enough for a smooth edge. */
const SUPERSAMPLE = 3;

function render(size, shade) {
  const pixels = Buffer.alloc(size * size * 4);
  const samples = SUPERSAMPLE * SUPERSAMPLE;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const colour = shade(
            (x + (sx + 0.5) / SUPERSAMPLE) / size,
            (y + (sy + 0.5) / SUPERSAMPLE) / size,
          );
          r += colour.r;
          g += colour.g;
          b += colour.b;
          a += colour.a ?? 255;
        }
      }
      const offset = (y * size + x) * 4;
      pixels[offset] = Math.round(r / samples);
      pixels[offset + 1] = Math.round(g / samples);
      pixels[offset + 2] = Math.round(b / samples);
      pixels[offset + 3] = Math.round(a / samples);
    }
  }
  return encodePng(size, pixels);
}

function inCircle(x, y, cx, cy, radius) {
  return Math.hypot(x - cx, y - cy) <= radius;
}

function inRoundedSquare(x, y, radius, inset) {
  const min = inset;
  const max = 1 - inset;
  if (x < min || x > max || y < min || y > max) return false;
  const nearestX = Math.min(Math.max(x, min + radius), max - radius);
  const nearestY = Math.min(Math.max(y, min + radius), max - radius);
  return Math.hypot(x - nearestX, y - nearestY) <= radius;
}

function distanceToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.min(Math.max(((px - ax) * dx + (py - ay) * dy) / lengthSquared, 0), 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function inStroke(x, y, points, width) {
  for (let index = 0; index < points.length - 1; index += 1) {
    if (distanceToSegment(x, y, points[index], points[index + 1]) <= width / 2) return true;
  }
  return false;
}

// ------------------------------------------------------------------ shaders

function appIcon(x, y) {
  if (!inRoundedSquare(x, y, 0.24, 0.05)) return TRANSPARENT;
  if (inStroke(x, y, CHECK, 0.11)) return WHITE;
  return BRAND;
}

function trayColour(x, y) {
  if (!inCircle(x, y, 0.5, 0.5, 0.46)) return TRANSPARENT;
  if (inStroke(x, y, CHECK, 0.16)) return WHITE;
  return BRAND;
}

/** macOS template images are pure black; the check mark is punched out. */
function trayTemplate(x, y) {
  if (!inCircle(x, y, 0.5, 0.5, 0.46)) return TRANSPARENT;
  if (inStroke(x, y, CHECK, 0.16)) return TRANSPARENT;
  return { r: 0, g: 0, b: 0 };
}

mkdirSync(outDir, { recursive: true });

const outputs = [
  ['icon.png', 512, appIcon],
  ['tray.png', 32, trayColour],
  ['tray@2x.png', 64, trayColour],
  ['trayTemplate.png', 32, trayTemplate],
  ['trayTemplate@2x.png', 64, trayTemplate],
];

for (const [file, size, shade] of outputs) {
  writeFileSync(join(outDir, file), render(size, shade));
  console.log(`wrote resources/${file} (${size}×${size})`);
}

// ---------------------------------------------------------------- ico writer

/**
 * A Windows icon is a tiny directory followed by the images themselves. Each entry
 * may hold a PNG verbatim (Vista and later read these), which is what Windows
 * wants: one bitmap per size, so Explorer picks 16px for the list and 256px for
 * the large-icon view instead of downscaling a single 512px image.
 *
 * 256 is written as 0 in the width/height byte — the field is one byte wide.
 */
function encodeIco(images) {
  const headerSize = 6 + 16 * images.length;
  let offset = headerSize;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0; // palette size: true colour
    entry[3] = 0;
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  return Buffer.concat([header, ...entries, ...images.map(({ png }) => png)]);
}

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const ico = encodeIco(ICO_SIZES.map((size) => ({ size, png: render(size, appIcon) })));
writeFileSync(join(outDir, 'icon.ico'), ico);
console.log(`wrote resources/icon.ico (${ICO_SIZES.join('/')} px, ${ico.length} bytes)`);
