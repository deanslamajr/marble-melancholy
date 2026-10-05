// Draws the home-screen icons procedurally (no image assets) and writes them as PNGs:
//   npm run icons   →   public/icons/icon-192.png, icon-512.png, apple-touch-icon.png
// The motif (a glass marble on an isometric slab) sits inside the central 70 %, so the same
// full-bleed image also works as a maskable icon.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

type Rgb = [number, number, number];

export const ICONS: ReadonlyArray<{ file: string; size: number }> = [
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
  { file: "apple-touch-icon.png", size: 180 },
];

const SUPERSAMPLE = 4;
const BG_TOP: Rgb = [0x24, 0x2c, 0x5a];
const BG_BOTTOM: Rgb = [0x0b, 0x0d, 0x1a];
const TOP: Rgb = [0xa9, 0xc6, 0xef];
const RIM: Rgb = [0xdd, 0xea, 0xff];
const LEFT: Rgb = [0x6f, 0x8f, 0xc4];
const RIGHT: Rgb = [0x4b, 0x64, 0x9a];
const MARBLE: Rgb = [0x2f, 0x6d, 0xf6];
const GLOW: Rgb = [0x9f, 0xc0, 0xff];

// Geometry in unit coordinates (0..1 across the icon).
const SLAB = { cx: 0.5, cy: 0.6, hw: 0.34, hh: 0.17, depth: 0.11, rim: 0.012 };
const BALL = { cx: 0.5, cy: 0.47, r: 0.16 };
const SHADOW = { cx: 0.53, cy: 0.625, rx: 0.15, ry: 0.06 };
const LIGHT = normalize([-0.45, -0.6, 0.66]);
const HALF = normalize([LIGHT[0], LIGHT[1], LIGHT[2] + 1]);

function normalize(v: Rgb): Rgb {
  const l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Colour of one sample point. */
function shade(u: number, v: number): Rgb {
  let c = mix(BG_TOP, BG_BOTTOM, v);
  const { cx, cy, hw, hh, depth } = SLAB;
  const dx = Math.abs(u - cx);
  const diamond = dx / hw + Math.abs(v - cy) / hh;
  // Side faces: the strip below the two front edges of the top diamond.
  if (dx <= hw) {
    const edge = cy + hh * (1 - dx / hw);
    if (v >= edge && v <= edge + depth)
      c = mix(u < cx ? LEFT : RIGHT, BG_BOTTOM, (v - edge) / depth / 3);
  }
  if (diamond <= 1) {
    c = diamond > 1 - SLAB.rim / hh ? RIM : mix(TOP, RIM, Math.max(0, cy - v) / hh / 3);
    const sx = (u - SHADOW.cx) / SHADOW.rx;
    const sy = (v - SHADOW.cy) / SHADOW.ry;
    const s = sx * sx + sy * sy;
    if (s < 1) c = mix(c, BG_BOTTOM, 0.45 * (1 - s));
  }
  const bx = (u - BALL.cx) / BALL.r;
  const by = (v - BALL.cy) / BALL.r;
  const d2 = bx * bx + by * by;
  if (d2 <= 1) {
    const nz = Math.sqrt(1 - d2);
    const diffuse = Math.max(0, bx * LIGHT[0] + by * LIGHT[1] + nz * LIGHT[2]);
    const spec = Math.max(0, bx * HALF[0] + by * HALF[1] + nz * HALF[2]) ** 60;
    c = MARBLE.map((m) => Math.min(255, m * (0.3 + 0.8 * diffuse))) as Rgb;
    c = mix(c, GLOW, 0.5 * (1 - nz) ** 2);
    c = mix(c, [255, 255, 255], Math.min(1, spec * 1.2));
  }
  return c;
}

/** RGBA pixels, supersampled. */
export function renderIcon(size: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(size * size * 4);
  const n = SUPERSAMPLE;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const c = shade((x + (i + 0.5) / n) / size, (y + (j + 0.5) / n) / size);
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const o = (y * size + x) * 4;
      px[o] = Math.round(r / (n * n));
      px[o + 1] = Math.round(g / (n * n));
      px[o + 2] = Math.round(b / (n * n));
      px[o + 3] = 255;
    }
  }
  return px;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** Minimal PNG encoder: 8-bit RGBA, no filtering. */
export function encodePng(size: number, rgba: Uint8ClampedArray): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    Buffer.from(rgba.buffer, rgba.byteOffset + y * size * 4, size * 4).copy(
      raw,
      y * (size * 4 + 1) + 1,
    );
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const out = join(dirname(fileURLToPath(import.meta.url)), "../../public/icons");
  mkdirSync(out, { recursive: true });
  for (const { file, size } of ICONS) {
    const png = encodePng(size, renderIcon(size));
    writeFileSync(join(out, file), png);
    console.log(`${file}  ${size}×${size}  ${png.length} bytes`);
  }
}
