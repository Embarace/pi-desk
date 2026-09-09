"use strict";

// 纯 Node 生成 Pi Desk 应用图标（PNG 256 + ICO），无第三方依赖。
// 绘制：深色圆角渐变底 + 发光 π 字形（胶囊矩形）+ 底部光标点。

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SIZE = 256;
const SS = 4; // 每轴超采样

// ---------- 形状 ----------
// 胶囊（沿轴向的圆角矩形），返回距离场 < 0 表示在内部
function capsuleSDF(px, py, x1, y1, x2, y2, r) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy) - r;
}

function roundRectSDF(px, py, x, y, w, h, r) {
  const qx = Math.abs(px - (x + w / 2)) - (w / 2 - r);
  const qy = Math.abs(py - (y + h / 2)) - (h / 2 - r);
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// 距离场 → 覆盖度（带 1px 抗锯齿）
function coverage(d) {
  return clamp01(0.5 - d);
}

const ACCENT_TOP = [109, 141, 255];
const ACCENT_BOT = [138, 92, 255];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function buildPng(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const scale = size / SIZE;

  // π 字形参数（256 设计坐标系）
  const barT = 34 * scale; // 粗细
  const bar = { y1: 78 * scale, y2: 112 * scale, x1: 84 * scale, x2: 172 * scale };
  const legL = { x1: 90 * scale, x2: 124 * scale, y1: 76 * scale, y2: 156 * scale };
  const legR = { x1: 132 * scale, x2: 166 * scale, y1: 76 * scale, y2: 156 * scale };
  const dot = { cx: 128 * scale, cy: 192 * scale, r: 10 * scale };

  const glowR = 26 * scale;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;

          // 背景圆角矩形
          const bgD = roundRectSDF(px, py, 12 * scale, 12 * scale, 232 * scale, 232 * scale, 58 * scale);
          const bgCov = coverage(bgD);
          if (bgCov <= 0) continue;

          const t = clamp01(py / size);
          const bgR = lerp(18, 10, t), bgG = lerp(22, 12, t), bgB = lerp(44, 26, t);

          // 顶部高光
          const hl = Math.max(0, 1 - Math.abs(py - 60 * scale) / (130 * scale)) * 0.06;

          let cr = bgR + hl * 255, cg = bgG + hl * 255, cb = bgB + hl * 255;

          // π 字形
          const dBar = capsuleSDF(px, py, bar.x1, (bar.y1 + bar.y2) / 2, bar.x2, (bar.y1 + bar.y2) / 2, barT / 2);
          const dL = capsuleSDF(px, py, (legL.x1 + legL.x2) / 2, legL.y1, (legL.x1 + legL.x2) / 2, legL.y2, barT / 2);
          const dR = capsuleSDF(px, py, (legR.x1 + legR.x2) / 2, legR.y1, (legR.x1 + legR.x2) / 2, legR.y2, barT / 2);
          const dGlyph = Math.min(dBar, dL, dR);

          // 白色渐变字形（从上到下 白 → 淡紫）
          const glyphCov = coverage(dGlyph);
          if (glyphCov > 0) {
            const gt = clamp01(py / size);
            const gr = lerp(255, 226, gt), gg = lerp(255, 234, gt), gb = lerp(255, 255, gt);
            cr = lerp(cr, gr, glyphCov);
            cg = lerp(cg, gg, glyphCov);
            cb = lerp(cb, gb, glyphCov);
          }

          // 光晕（字形外侧渐变辉光）
          const glow = clamp01(1 - Math.max(0, dGlyph) / glowR) * 0.55;
          cr += ACCENT_TOP[0] * glow; cg += ACCENT_TOP[1] * glow; cb += ACCENT_TOP[2] * glow;

          // 底部光标点
          const dDot = Math.hypot(px - dot.cx, py - dot.cy) - dot.r;
          const dotCov = coverage(dDot);
          if (dotCov > 0) {
            cr = lerp(cr, ACCENT_BOT[0], dotCov * 0.9);
            cg = lerp(cg, ACCENT_BOT[1], dotCov * 0.9);
            cb = lerp(cb, ACCENT_BOT[2], dotCov * 0.9);
          }

          r += cr; g += cg; b += cb; a += bgCov;
        }
      }

      const n = SS * SS;
      const i = (y * size + x) * 4;
      const alpha = a / n;
      pixels[i] = alpha > 0 ? Math.round((r / n) / (alpha || 1)) : 0;
      pixels[i + 1] = alpha > 0 ? Math.round((g / n) / (alpha || 1)) : 0;
      pixels[i + 2] = alpha > 0 ? Math.round((b / n) / (alpha || 1)) : 0;
      pixels[i + 3] = Math.round(alpha * 255);
    }
  }

  return pixels;
}

// ---------- PNG 编码 ----------
function crc32(buf) {
  let c, table = crc32.table || (crc32.table = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(pixels, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // compression / filter / interlace = 0
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function buildIco(pngBuf, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // count
  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size; // width
  entry[1] = size >= 256 ? 0 : size; // height
  entry[2] = 0; // palette
  entry[3] = 0; // reserved
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bpp
  entry.writeUInt32LE(pngBuf.length, 8);
  entry.writeUInt32LE(22, 12); // offset
  return Buffer.concat([header, entry, pngBuf]);
}

const outDir = path.join(__dirname, "..", "build");
fs.mkdirSync(outDir, { recursive: true });
const pixels = buildPng(SIZE);
const png = encodePng(pixels, SIZE);
fs.writeFileSync(path.join(outDir, "icon.png"), png);
fs.writeFileSync(path.join(outDir, "icon.ico"), buildIco(png, SIZE));
console.log("Generated build/icon.png and build/icon.ico (256x256)");
