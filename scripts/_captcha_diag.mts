import fs from 'fs';
import path from 'path';
import { createWorker } from 'tesseract.js';

const dir = process.argv[2];

function decodeGray(buf: Buffer) {
  const { PNG } = require('pngjs');
  const p = PNG.sync.read(buf);
  const gray = new Uint8Array(p.width * p.height);
  for (let i = 0; i < p.width * p.height; i++) {
    const idx = i * 4;
    gray[i] = Math.round((p.data[idx] * 299 + p.data[idx + 1] * 587 + p.data[idx + 2] * 114) / 1000);
  }
  return { w: p.width, h: p.height, gray };
}

function clearFrame(g: Uint8Array, w: number, h: number, m = 4) {
  const out = new Uint8Array(w * h).fill(255);
  for (let y = m; y < h - m; y++) for (let x = m; x < w - m; x++) out[w * y + x] = g[w * y + x];
  return out;
}

function otsu(g: Uint8Array): number {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < g.length; i++) hist[g[i]]++;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, bestVar = 0, th = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = g.length - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const v = wB * wF * Math.pow(sumB / wB - (sum - sumB) / wF, 2);
    if (v > bestVar) { bestVar = v; th = t; }
  }
  return th;
}

function despeckle(bin: Uint8Array, w: number, h: number, minArea: number) {
  const visited = new Uint8Array(w * h);
  const result = new Uint8Array(bin);
  for (let i = 0; i < result.length; i++) {
    if (result[i] !== 0 || visited[i]) continue;
    const comp: number[] = [];
    const stack = [i];
    visited[i] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      comp.push(c);
      const cy = Math.floor(c / w), cx = c % w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
          const ni = ny * w + nx;
          if (result[ni] === 0 && !visited[ni]) { visited[ni] = 1; stack.push(ni); }
        }
      }
    }
    if (comp.length < minArea) for (const ci of comp) result[ci] = 255;
  }
  return result;
}

interface Box { x0: number; y0: number; x1: number; y1: number }

function segment(bin: Uint8Array, w: number, h: number): Box[] {
  const visited = new Uint8Array(w * h);
  const boxes: (Box & { area: number })[] = [];
  for (let i = 0; i < bin.length; i++) {
    if (bin[i] !== 0 || visited[i]) continue;
    let minX = w, maxX = 0, minY = h, maxY = 0, count = 0;
    const stack = [i];
    visited[i] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      count++;
      const cy = Math.floor(c / w), cx = c % w;
      if (cx < minX) minX = cx;
      if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy;
      if (cy > maxY) maxY = cy;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
          const ni = ny * w + nx;
          if (bin[ni] === 0 && !visited[ni]) { visited[ni] = 1; stack.push(ni); }
        }
      }
    }
    boxes.push({ x0: minX, y0: minY, x1: maxX, y1: maxY, area: count });
  }
  if (!boxes.length) return [];
  const maxH = Math.max(...boxes.map(b => b.y1 - b.y0 + 1));
  const glyphs = boxes.filter(b => (b.y1 - b.y0 + 1) >= maxH * 0.35 || b.area >= 12);
  glyphs.sort((a, b) => a.x0 - b.x0);
  const merged: Box[] = [];
  for (const box of glyphs) {
    const prev = merged[merged.length - 1];
    const overlapW = prev ? Math.min(prev.x1, box.x1) - Math.max(prev.x0, box.x0) : -1;
    const narrowBox = (box.x1 - box.x0 + 1) <= (box.y1 - box.y0 + 1) * 0.7;
    if (prev && overlapW > 0 && narrowBox) {
      prev.x0 = Math.min(prev.x0, box.x0);
      prev.y0 = Math.min(prev.y0, box.y0);
      prev.x1 = Math.max(prev.x1, box.x1);
      prev.y1 = Math.max(prev.y1, box.y1);
    } else {
      merged.push({ ...box });
    }
  }
  return merged.sort((a, b) => a.x0 - b.x0);
}

// Crop glyph tu mot plane bat ky (binary HOAC grayscale), them pad, scale len
function cropScale(plane: Uint8Array, w: number, h: number, box: Box, padPx: number, targetH: number) {
  const gw = box.x1 - box.x0 + 1, gh = box.y1 - box.y0 + 1;
  const cw = gw + padPx * 2, ch = gh + padPx * 2;
  const cropped = new Uint8Array(cw * ch).fill(255);
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++)
      cropped[(y + padPx) * cw + (x + padPx)] = plane[(box.y0 + y) * w + (box.x0 + x)];
  const s = Math.max(2, Math.round(targetH / ch));
  const nw = cw * s, nh = ch * s;
  const out = new Uint8Array(nw * nh);
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) out[nw * y + x] = cropped[cw * Math.floor(y / s) + Math.floor(x / s)];
  return makeBmp(out, nw, nh);
}

function stretchGray(g: Uint8Array) {
  let mn = 255, mx = 0;
  for (let i = 0; i < g.length; i++) { if (g[i] < mn) mn = g[i]; if (g[i] > mx) mx = g[i]; }
  const range = mx - mn || 1;
  const out = new Uint8Array(g.length);
  for (let i = 0; i < g.length; i++) out[i] = Math.round(((g[i] - mn) / range) * 255);
  return out;
}

function makeBmp(data: Uint8Array, width: number, height: number): Buffer {
  const rowSize = Math.floor((24 * width + 31) / 32) * 4;
  const bmp = Buffer.alloc(54 + rowSize * height);
  bmp.write('BM', 0);
  bmp.writeUInt32LE(bmp.length, 2);
  bmp.writeUInt32LE(54, 10);
  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(width, 18);
  bmp.writeInt32LE(height, 22);
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(24, 28);
  for (let y = 0; y < height; y++) {
    const srcY = height - 1 - y;
    const off = 54 + y * rowSize;
    for (let x = 0; x < width; x++) {
      const v = data[width * srcY + x];
      bmp[off + x * 3] = v; bmp[off + x * 3 + 1] = v; bmp[off + x * 3 + 2] = v;
    }
  }
  return bmp;
}

async function main() {
  const worker = await createWorker('eng', 1, {
    langPath: path.join(process.cwd(), 'resources', 'tessdata'),
    cacheMethod: 'none',
    gzip: false
  });
  await worker.setParameters({ tessedit_char_whitelist: '0123456789abcdefghijklmnopqrstuvwxyz' });

  const files = fs.readdirSync(dir).filter(f => /\.(png|jpe?g|bmp)$/i.test(f)).sort();
  const configs = [
    { name: 'binary_pad3_h48_psm10', src: 'binary', pad: 3, th: 48, psm: '10' },
    { name: 'gray_pad6_h56_psm10', src: 'gray', pad: 6, th: 56, psm: '10' },
    { name: 'gray_pad8_h64_psm10', src: 'gray', pad: 8, th: 64, psm: '10' },
    { name: 'gray_pad8_h64_psm8', src: 'gray', pad: 8, th: 64, psm: '8' },
    { name: 'gray_pad12_h80_psm10', src: 'gray', pad: 12, th: 80, psm: '10' }
  ];

  for (const file of files) {
    const label = (file.replace(/\.(png|jpe?g|bmp)$/i, '').split(/[_\-]/).pop() || '').toLowerCase();
    const dec = decodeGray(fs.readFileSync(path.join(dir, file)));
    const cleaned = clearFrame(dec.gray, dec.w, dec.h, 4);
    const th = otsu(cleaned);
    const bin = despeckle(
      (() => { const b = new Uint8Array(cleaned.length); for (let i = 0; i < cleaned.length; i++) b[i] = cleaned[i] < th ? 0 : 255; return b; })(),
      dec.w, dec.h, 10
    );
    const stretched = stretchGray(cleaned);
    const glyphs = segment(bin, dec.w, dec.h);

    console.log(`\n=== ${file} label=${label} glyphs=${glyphs.length} ===`);
    for (const cfg of configs) {
      await worker.setParameters({ tessedit_pageseg_mode: cfg.psm });
      let text = '';
      let confSum = 0;
      const parts: string[] = [];
      for (const g of glyphs) {
        const bmp = cropScale(cfg.src === 'binary' ? bin : stretched, dec.w, dec.h, g, cfg.pad, cfg.th);
        const ret = await worker.recognize(bmp, {}, { text: true, blocks: true });
        const syms: any[] = [];
        const lines = ret.data?.blocks?.[0]?.paragraphs?.[0]?.lines || [];
        for (const line of lines) for (const wd of line.words || []) for (const s of wd.symbols || []) syms.push(s);
        const good = syms.filter((s: any) => /[0-9a-z]/.test(s.text || ''));
        const ch = good.map((s: any) => s.text.toLowerCase()).join('') || '?';
        const c = good.length ? good.reduce((a: number, s: any) => a + (s.confidence || 0), 0) / good.length : 0;
        text += ch[0] || '_';
        confSum += c;
        parts.push(`${ch[0]}:${Math.round(c)}`);
      }
      const mark = text === label ? 'OK ' : 'FAIL';
      console.log(`  [${mark}] ${cfg.name.padEnd(22)} "${text}" avg=${Math.round(confSum / Math.max(1, glyphs.length))} [${parts.join(' ')}]`);
    }
  }

  await worker.terminate();
}

main().catch(e => { console.error(e); process.exit(1); });
