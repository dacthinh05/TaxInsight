import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import { createWorker, type Worker } from 'tesseract.js';

/**
 * Ứng viên OCR: giữ nguyên thông tin theo vị trí để bỏ phiếu đồng thuận.
 * - text: chuỗi chỉ gồm ký tự hợp lệ [0-9a-z] (đã lọc rác)
 * - chars: ký tự theo vị trí (null = không đọc được -> ABSTAIN, không bỏ phiếu)
 * - charConfs: confidence tương ứng từng vị trí (0 với null)
 */
export interface OcrCandidate {
  text: string;
  confidence: number;
  source: string;
  chars: (string | null)[];
  charConfs: number[];
}

export interface CaptchaSolveResult {
  text: string;
  confidence: number;
  accepted: boolean;
  reason: string;
  candidates: OcrCandidate[];
}

const WORD_PSM = '8' as any; // SINGLE_WORD — dùng cho cả cụm và glyph đơn
const CHAR_WHITELIST = '0123456789abcdefghijklmnopqrstuvwxyz';
const FORMAT_LEN = 5; // CAPTCHA Cổng Thuế luôn 5 ký tự

export class CaptchaSolver {
  private static workerPromise: Promise<Worker> | null = null;

  /**
   * Xác định thư mục tessdata hoàn toàn OFFLINE.
   * Ưu tiên thư mục có sẵn; có thể THAY MODEL TÙY CHỈNH bằng cách ghi đè
   * eng.traineddata trong resources/tessdata mà không cần sửa code.
   */
  private static getTessdataDir(): string {
    try {
      if (process.resourcesPath) {
        const p2 = path.join(process.resourcesPath, 'resources', 'tessdata');
        if (fs.existsSync(path.join(p2, 'eng.traineddata'))) return p2;
        const p2b = path.join(process.resourcesPath, 'tessdata');
        if (fs.existsSync(path.join(p2b, 'eng.traineddata'))) return p2b;
      }
      if (typeof app !== 'undefined' && app && app.getAppPath) {
        const p1 = path.join(app.getAppPath(), 'resources', 'tessdata');
        if (fs.existsSync(path.join(p1, 'eng.traineddata'))) return p1;
      }
    } catch {}

    const p3 = path.join(process.cwd(), 'resources', 'tessdata');
    if (fs.existsSync(path.join(p3, 'eng.traineddata'))) return p3;

    const p4 = path.join(__dirname, '..', '..', '..', 'resources', 'tessdata');
    if (fs.existsSync(path.join(p4, 'eng.traineddata'))) return p4;

    return path.join(process.cwd(), 'resources', 'tessdata');
  }

  /**
   * Worker OCR tái sử dụng (Offline 100%).
   * Whitelist chữ thường + số — đúng định dạng CAPTCHA Cổng Thuế.
   */
  private static async getWorker(): Promise<Worker> {
    if (!this.workerPromise) {
      this.workerPromise = (async () => {
        const tessdataDir = this.getTessdataDir();
        console.log('[CaptchaSolver] Khởi tạo Tesseract OCR offline với tessdata:', tessdataDir);
        const worker = await createWorker('eng', 1, {
          langPath: tessdataDir,
          cacheMethod: 'none',
          gzip: false
        });
        await worker.setParameters({
          tessedit_char_whitelist: CHAR_WHITELIST,
          tessedit_pageseg_mode: WORD_PSM
        });
        return worker;
      })().catch(err => {
        this.workerPromise = null;
        throw err;
      });
    }
    return this.workerPromise;
  }

  /** Giải mã PNG/JPEG sang grayscale (REC.601 luma) */
  private static decodeToGrayscale(buffer: Buffer): { width: number; height: number; gray: Uint8Array } | null {
    try {
      let width = 0;
      let height = 0;
      let data: Uint8Array | Buffer;

      try {
        const png = PNG.sync.read(buffer);
        width = png.width;
        height = png.height;
        data = png.data;
      } catch {
        const raw = jpeg.decode(buffer, { useTArray: true });
        width = raw.width;
        height = raw.height;
        data = raw.data;
      }

      if (!width || !height || !data) return null;

      const gray = new Uint8Array(width * height);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (width * y + x) * 4;
          gray[width * y + x] = Math.round(
            (data[idx] * 299 + data[idx + 1] * 587 + data[idx + 2] * 114) / 1000
          );
        }
      }
      return { width, height, gray };
    } catch {
      return null;
    }
  }

  /**
   * Phát hiện & xóa khung viền theo mật độ điểm đen thực tế (Frame Detection).
   * Quét từng hàng/cột từ mép vào: >40% pixel tối là nét khung -> xóa,
   * tối đa 6px mỗi phía, cộng thêm 1px đệm để loại mép bóng còn sót.
   */
  public static clearFrame(gray: Uint8Array, width: number, height: number): Uint8Array {
    const cleaned = new Uint8Array(gray);
    const DARK_RATIO = 0.4;
    const MAX_FRAME = 6;

    const darkRatioRow = (y: number) => {
      let dark = 0;
      for (let x = 0; x < width; x++) if (cleaned[width * y + x] < 128) dark++;
      return dark / width;
    };
    const darkRatioCol = (x: number) => {
      let dark = 0;
      for (let y = 0; y < height; y++) if (cleaned[width * y + x] < 128) dark++;
      return dark / height;
    };

    let top = 0;
    while (top < MAX_FRAME && darkRatioRow(top) > DARK_RATIO) top++;
    let bottom = 0;
    while (bottom < MAX_FRAME && darkRatioRow(height - 1 - bottom) > DARK_RATIO) bottom++;
    let left = 0;
    while (left < MAX_FRAME && darkRatioCol(left) > DARK_RATIO) left++;
    let right = 0;
    while (right < MAX_FRAME && darkRatioCol(width - 1 - right) > DARK_RATIO) right++;

    top = Math.min(top + 1, height >> 1);
    bottom = Math.min(bottom + 1, height >> 1);
    left = Math.min(left + 1, width >> 1);
    right = Math.min(right + 1, width >> 1);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (x < left || x >= width - right || y < top || y >= height - bottom) {
          cleaned[width * y + x] = 255;
        }
      }
    }
    return cleaned;
  }

  /** Ngưỡng Otsu toàn cục (giới hạn 105–180 như bản gốc) */
  public static calculateOtsuThreshold(gray: Uint8Array, width: number, height: number): number {
    const histogram = new Array(256).fill(0);
    let validPixels = 0;
    for (let y = 2; y < height - 2; y++) {
      for (let x = 2; x < width - 2; x++) {
        histogram[gray[width * y + x]]++;
        validPixels++;
      }
    }
    if (validPixels === 0) return 145;

    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * histogram[i];

    let sumB = 0;
    let wB = 0;
    let threshold = 145;
    let varMax = 0;

    for (let t = 0; t < 256; t++) {
      wB += histogram[t];
      if (wB === 0) continue;
      const wF = validPixels - wB;
      if (wF === 0) break;
      sumB += t * histogram[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const varBetween = wB * wF * (mB - mF) * (mB - mF);
      if (varBetween > varMax) {
        varMax = varBetween;
        threshold = t;
      }
    }
    return Math.min(Math.max(threshold, 105), 180);
  }

  /**
   * Phân ngưỡng thích nghi Sauvola — xử lý nền gradient mà Otsu thất bại.
   */
  public static sauvolaThreshold(gray: Uint8Array, width: number, height: number, windowSize = 15, k = 0.22): Uint8Array {
    const out = new Uint8Array(width * height);
    const r = windowSize >> 1;
    const R = 128;

    const iw = width + 1;
    const integral = new Float64Array(iw * (height + 1));
    const integralSq = new Float64Array(iw * (height + 1));
    for (let y = 0; y < height; y++) {
      let rowSum = 0;
      let rowSumSq = 0;
      for (let x = 0; x < width; x++) {
        const v = gray[width * y + x];
        rowSum += v;
        rowSumSq += v * v;
        integral[(y + 1) * iw + (x + 1)] = integral[y * iw + (x + 1)] + rowSum;
        integralSq[(y + 1) * iw + (x + 1)] = integralSq[y * iw + (x + 1)] + rowSumSq;
      }
    }

    for (let y = 0; y < height; y++) {
      const y0 = Math.max(0, y - r);
      const y1 = Math.min(height - 1, y + r);
      for (let x = 0; x < width; x++) {
        const x0 = Math.max(0, x - r);
        const x1 = Math.min(width - 1, x + r);
        const area = (x1 - x0 + 1) * (y1 - y0 + 1);
        const sum =
          integral[(y1 + 1) * iw + (x1 + 1)] - integral[y0 * iw + (x1 + 1)] -
          integral[(y1 + 1) * iw + x0] + integral[y0 * iw + x0];
        const sumSq =
          integralSq[(y1 + 1) * iw + (x1 + 1)] - integralSq[y0 * iw + (x1 + 1)] -
          integralSq[(y1 + 1) * iw + x0] + integralSq[y0 * iw + x0];

        const mean = sum / area;
        const std = Math.sqrt(Math.max(0, sumSq / area - mean * mean));
        out[width * y + x] = gray[width * y + x] < mean * (1 + k * (std / R - 1)) ? 0 : 255;
      }
    }
    return out;
  }

  /** Khử nhiễu connected component < minArea px */
  public static removeSmallSpeckles(binary: Uint8Array, width: number, height: number, minArea = 12): Uint8Array {
    const visited = new Uint8Array(width * height);
    const result = new Uint8Array(binary);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = width * y + x;
        if (result[idx] === 0 && !visited[idx]) {
          const componentIndices: number[] = [];
          const queue = [idx];
          visited[idx] = 1;

          while (queue.length > 0) {
            const curr = queue.pop()!;
            componentIndices.push(curr);
            const cy = Math.floor(curr / width);
            const cx = curr % width;
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                const nx = cx + dx;
                const ny = cy + dy;
                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                  const nIdx = width * ny + nx;
                  if (result[nIdx] === 0 && !visited[nIdx]) {
                    visited[nIdx] = 1;
                    queue.push(nIdx);
                  }
                }
              }
            }
          }

          if (componentIndices.length < minArea) {
            for (const cIdx of componentIndices) result[cIdx] = 255;
          }
        }
      }
    }
    return result;
  }

  /** Nội suy bilinear phóng đại — mượt hơn nearest-neighbor đáng kể cho LSTM */
  public static scaleBilinear(
    data: Uint8Array,
    width: number,
    height: number,
    scale: number
  ): { data: Uint8Array; width: number; height: number } {
    const nw = Math.round(width * scale);
    const nh = Math.round(height * scale);
    const out = new Uint8Array(nw * nh);
    for (let y = 0; y < nh; y++) {
      const sy = y / scale;
      const y0 = Math.floor(sy);
      const y1 = Math.min(height - 1, y0 + 1);
      const fy = sy - y0;
      for (let x = 0; x < nw; x++) {
        const sx = x / scale;
        const x0 = Math.floor(sx);
        const x1 = Math.min(width - 1, x0 + 1);
        const fx = sx - x0;
        out[nw * y + x] = Math.round(
          data[y0 * width + x0] * (1 - fx) * (1 - fy) +
          data[y0 * width + x1] * fx * (1 - fy) +
          data[y1 * width + x0] * (1 - fx) * fy +
          data[y1 * width + x1] * fx * fy
        );
      }
    }
    return { data: out, width: nw, height: nh };
  }

  /** Thêm viền trắng quanh ảnh — Tesseract cần margin để xác định baseline */
  public static padWhite(data: Uint8Array, width: number, height: number, margin: number) {
    const nw = width + margin * 2;
    const nh = height + margin * 2;
    const out = new Uint8Array(nw * nh).fill(255);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        out[nw * (y + margin) + (x + margin)] = data[width * y + x];
      }
    }
    return { data: out, width: nw, height: nh };
  }

  /** Ghi BMP 24-bit grayscale (scale=1, dữ liệu đã phóng đại trước đó) */
  public static createBmp(data: Uint8Array, width: number, height: number): Buffer {
    const rowSize = Math.floor((24 * width + 31) / 32) * 4;
    const fileSize = 54 + rowSize * height;
    const bmp = Buffer.alloc(fileSize);

    bmp.write('BM', 0);
    bmp.writeUInt32LE(fileSize, 2);
    bmp.writeUInt32LE(54, 10);
    bmp.writeUInt32LE(40, 14);
    bmp.writeInt32LE(width, 18);
    bmp.writeInt32LE(height, 22);
    bmp.writeUInt16LE(1, 26);
    bmp.writeUInt16LE(24, 28);
    bmp.writeUInt32LE(0, 30);
    bmp.writeUInt32LE(rowSize * height, 34);

    for (let y = 0; y < height; y++) {
      const srcY = height - 1 - y;
      const rowOffset = 54 + y * rowSize;
      for (let x = 0; x < width; x++) {
        const val = data[width * srcY + x];
        const pxOffset = rowOffset + x * 3;
        bmp[pxOffset] = val;
        bmp[pxOffset + 1] = val;
        bmp[pxOffset + 2] = val;
      }
    }
    return bmp;
  }

  /** BMP 24-bit với nearest-neighbor scale (dùng cho glyph nhỏ) */
  public static createScaledBmp(data: Uint8Array, width: number, height: number, scale: number): Buffer {
    const scaled = this.scaleBilinear(data, width, height, scale);
    return this.createBmp(scaled.data, scaled.width, scaled.height);
  }

  /** Kéo giãn tương phản grayscale toàn khung */
  private static stretchContrast(gray: Uint8Array): Uint8Array {
    let minG = 255;
    let maxG = 0;
    for (let i = 0; i < gray.length; i++) {
      if (gray[i] < minG) minG = gray[i];
      if (gray[i] > maxG) maxG = gray[i];
    }
    const range = maxG - minG || 1;
    const out = new Uint8Array(gray.length);
    for (let i = 0; i < gray.length; i++) {
      out[i] = Math.round(((gray[i] - minG) / range) * 255);
    }
    return out;
  }

  /**
   * Tiền xử lý đa luồng (Multi-Pipeline Preprocessing) — 6 mặt phẳng:
   * 4 biến thể ngưỡng toàn cục + Sauvola thích nghi + grayscale kéo giãn.
   */
  public static generatePipelines(rawBuffer: Buffer): { name: string; buffer: Buffer }[] {
    const decoded = this.decodeToGrayscale(rawBuffer);
    if (!decoded) return [];

    const { width, height, gray } = decoded;
    const cleanedGray = this.clearFrame(gray, width, height);
    const otsuTh = this.calculateOtsuThreshold(cleanedGray, width, height);

    const binarize = (th: number) => {
      const binary = new Uint8Array(width * height);
      for (let i = 0; i < binary.length; i++) binary[i] = cleanedGray[i] < th ? 0 : 255;
      return binary;
    };

    const planes: Record<string, Uint8Array> = {
      otsu_clean: this.removeSmallSpeckles(binarize(otsuTh), width, height, 10),
      high_contrast: this.removeSmallSpeckles(binarize(Math.min(otsuTh + 18, 178)), width, height, 8),
      low_threshold: this.removeSmallSpeckles(binarize(Math.max(otsuTh - 16, 100)), width, height, 6),
      otsu_raw: binarize(otsuTh),
      sauvola_adaptive: this.removeSmallSpeckles(this.sauvolaThreshold(cleanedGray, width, height), width, height, 5),
      grayscale_stretched: this.stretchContrast(cleanedGray)
    };

    const out: { name: string; buffer: Buffer }[] = [];
    for (const [name, plane] of Object.entries(planes)) {
      const scaled = this.scaleBilinear(plane, width, height, 3);
      const padded = this.padWhite(scaled.data, scaled.width, scaled.height, 12);
      out.push({ name, buffer: this.createBmp(padded.data, padded.width, padded.height) });
    }
    return out;
  }

  /**
   * Tách glyph khỏi mặt phẳng nhị phân: connected components -> lọc đốm ->
   * gộp hộp chồng lấn trục X (dấu chấm i/j, nét đứt) -> sắp trái -> phải.
   */
  public static segmentGlyphs(
    binary: Uint8Array,
    width: number,
    height: number
  ): { x0: number; y0: number; x1: number; y1: number }[] {
    const visited = new Uint8Array(width * height);
    const boxes: { x0: number; y0: number; x1: number; y1: number; area: number }[] = [];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = width * y + x;
        if (binary[idx] !== 0 || visited[idx]) continue;

        let minX = x, maxX = x, minY = y, maxY = y, count = 0;
        const queue = [idx];
        visited[idx] = 1;

        while (queue.length > 0) {
          const curr = queue.pop()!;
          count++;
          const cy = Math.floor(curr / width);
          const cx = curr % width;
          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;

          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = cx + dx;
              const ny = cy + dy;
              if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                const nIdx = width * ny + nx;
                if (binary[nIdx] === 0 && !visited[nIdx]) {
                  visited[nIdx] = 1;
                  queue.push(nIdx);
                }
              }
            }
          }
        }
        boxes.push({ x0: minX, y0: minY, x1: maxX, y1: maxY, area: count });
      }
    }

    if (boxes.length === 0) return [];

    const maxH = Math.max(...boxes.map(b => b.y1 - b.y0 + 1));
    const glyphs = boxes.filter(b => (b.y1 - b.y0 + 1) >= maxH * 0.35 || b.area >= 12);

    glyphs.sort((a, b) => a.x0 - b.x0);
    const merged: { x0: number; y0: number; x1: number; y1: number; area: number }[] = [];
    for (const box of glyphs) {
      const prev = merged[merged.length - 1];
      const overlapW = prev ? Math.min(prev.x1, box.x1) - Math.max(prev.x0, box.x0) : -1;
      const narrowBox = (box.x1 - box.x0 + 1) <= (box.y1 - box.y0 + 1) * 0.7;
      if (prev && overlapW > 0 && narrowBox) {
        prev.x0 = Math.min(prev.x0, box.x0);
        prev.y0 = Math.min(prev.y0, box.y0);
        prev.x1 = Math.max(prev.x1, box.x1);
        prev.y1 = Math.max(prev.y1, box.y1);
        prev.area += box.area;
      } else {
        merged.push({ ...box });
      }
    }

    return merged.sort((a, b) => a.x0 - b.x0).map(({ x0, y0, x1, y1 }) => ({ x0, y0, x1, y1 }));
  }

  /**
   * Crop glyph từ một mặt phẳng bất kỳ (binary HOẶC grayscale), thêm viền trắng
   * và phóng đại về chiều cao chuẩn. Grayscale crop cho độ chính xác cao hơn hẳn
   * vì LSTM thấy được gradient nét chứ không chỉ đen/trắng.
   */
  public static cropGlyph(
    plane: Uint8Array,
    width: number,
    height: number,
    box: { x0: number; y0: number; x1: number; y1: number },
    padPx = 8,
    targetH = 64
  ): Buffer {
    const gw = box.x1 - box.x0 + 1;
    const gh = box.y1 - box.y0 + 1;
    const cw = gw + padPx * 2;
    const ch = gh + padPx * 2;
    const cropped = new Uint8Array(cw * ch).fill(255);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        cropped[(y + padPx) * cw + (x + padPx)] = plane[width * (box.y0 + y) + (box.x0 + x)];
      }
    }
    const scale = Math.max(2, Math.round(targetH / ch));
    return this.createScaledBmp(cropped, cw, ch, scale);
  }

  /**
   * Trích xuất ký tự + confidence cấp SYMBOL từ kết quả Tesseract.
   * data.confidence của tesseract.js v7 không đáng tin (thường = 0 do rác
   * kéo trung bình xuống); symbol confidence mới là con số dùng được.
   */
  private static extractSymbols(ret: any): { chars: string[]; confs: number[] } {
    const chars: string[] = [];
    const confs: number[] = [];
    const lines = ret?.data?.blocks?.[0]?.paragraphs?.[0]?.lines || [];
    for (const line of lines) {
      for (const word of line.words || []) {
        for (const s of word.symbols || []) {
          const ch = (s.text || '').toLowerCase();
          if (/^[0-9a-z]$/.test(ch)) {
            chars.push(ch);
            confs.push(s.confidence || 0);
          }
        }
      }
    }
    return { chars, confs };
  }

  /** OCR word-level một ảnh BMP, trả ứng viên có thông tin theo vị trí */
  private static async recognizeWord(worker: Worker, buffer: Buffer, source: string): Promise<OcrCandidate | null> {
    await worker.setParameters({ tessedit_pageseg_mode: WORD_PSM });
    const ret = await worker.recognize(buffer, {}, { text: true, blocks: true });
    const { chars, confs } = this.extractSymbols(ret);
    if (chars.length === 0) return null;
    return {
      text: chars.join(''),
      confidence: confs.reduce((a, c) => a + c, 0) / confs.length,
      source,
      chars: [...chars],
      charConfs: [...confs]
    };
  }

  /**
   * Đường tách-ký-tự-riêng-lẻ (Character Segmentation):
   * tách glyph từ mặt phẳng nhị phân, crop từng glyph từ mặt phẳng nguồn
   * (ưu tiên GRAYSCALE), OCR từng miếng bằng PSM 8 rồi ghép lại.
   * Glyph không đọc được -> null (ABSTAIN) nhưng vẫn GIỮ VỊ TRÍ để bỏ phiếu.
   */
  private static async solveBySegmentation(
    worker: Worker,
    sourceTag: string,
    segPlane: Uint8Array,
    width: number,
    height: number,
    cropPlane: Uint8Array
  ): Promise<OcrCandidate | null> {
    try {
      const glyphs = this.segmentGlyphs(segPlane, width, height);
      if (glyphs.length < 4 || glyphs.length > 6) return null;

      await worker.setParameters({ tessedit_pageseg_mode: WORD_PSM });
      const chars: (string | null)[] = [];
      const charConfs: number[] = [];
      let confSum = 0;
      let okCount = 0;

      for (const glyph of glyphs) {
        const glyphBmp = this.cropGlyph(cropPlane, width, height, glyph);
        const ret = await worker.recognize(glyphBmp, {}, { text: true, blocks: true });
        const { chars: syms, confs } = this.extractSymbols(ret);
        if (syms.length > 0) {
          chars.push(syms[0]);
          charConfs.push(confs[0]);
          confSum += confs[0];
          okCount++;
        } else {
          chars.push(null);
          charConfs.push(0);
        }
      }

      if (okCount === 0) return null;
      return {
        text: chars.filter((c): c is string => c !== null).join(''),
        confidence: confSum / okCount,
        source: sourceTag,
        chars,
        charConfs
      };
    } catch {
      return null;
    }
  }

  /**
   * Bỏ phiếu đồng thuận theo vị trí (Position-wise Consensus Voting) với trọng số
   * là symbol-confidence. Trả chuỗi đồng thuận + hỗ trợ từng vị trí + số cử tri.
   * Đây là hàm thuần để unit test không cần WASM.
   */
  public static buildConsensus(candidates: OcrCandidate[], length: number) {
    const eligible = candidates.filter(c => c.chars.length === length);
    if (eligible.length < 2) return null;

    let text = '';
    const supports: number[] = [];
    const voterCounts: number[] = [];

    for (let pos = 0; pos < length; pos++) {
      const tally = new Map<string, { weight: number; confSum: number }>();
      let totalWeight = 0;
      for (const c of eligible) {
        const ch = c.chars[pos];
        if (ch === null) continue; // ABSTAIN
        const conf = c.charConfs[pos] / 100;
        const entry = tally.get(ch) || { weight: 0, confSum: 0 };
        entry.weight += conf;
        entry.confSum += c.charConfs[pos];
        tally.set(ch, entry);
        totalWeight += conf;
      }
      if (tally.size === 0) {
        text += '';
        supports.push(0);
        voterCounts.push(0);
        continue;
      }
      let bestCh = '';
      let bestWeight = -1;
      for (const [ch, e] of tally.entries()) {
        if (e.weight > bestWeight) {
          bestCh = ch;
          bestWeight = e.weight;
        }
      }
      text += bestCh;
      supports.push(totalWeight > 0 ? bestWeight / totalWeight : 0);
      voterCounts.push(eligible.filter(c => c.chars[pos] !== null).length);
    }

    // Confidence trung bình của các phiếu trúng tuyển mỗi vị trí
    const winConfs = supports.map((_, pos) => {
      const winners = eligible.filter(c => c.chars[pos] === text[pos]);
      if (winners.length === 0) return 0;
      return winners.reduce((a, c) => a + c.charConfs[pos], 0) / winners.length;
    });

    const votedPositions = supports.filter((_, i) => voterCounts[i] > 0);
    const overall =
      votedPositions.length === 0
        ? 0
        : supports.reduce((a, s, i) => a + s * Math.min(voterCounts[i], 3), 0) /
          votedPositions.reduce((a, _, i) => a + Math.min(voterCounts[i], 3), 0);

    return {
      text,
      support: overall,
      supports,
      voterCounts,
      winConfs,
      meanConf: winConfs.reduce((a, c, i) => (voterCounts[i] > 0 ? a + c : a), 0) /
        Math.max(1, votedPositions.length)
    };
  }

  /**
   * Chấm điểm & cổng chất lượng (pure function).
   * Chấp nhận CHỈ khi bằng chứng đủ mạnh; ngược lại trả rỗng -> modal nhập tay.
   */
  public static evaluateCandidates(candidates: OcrCandidate[]): CaptchaSolveResult {
    if (candidates.length === 0) {
      return { text: '', confidence: 0, accepted: false, reason: 'no_candidates', candidates };
    }

    // Nhóm chuỗi giống hệt nhau (đếm số nguồn độc lập cùng đọc một đáp án)
    const exactVotes = new Map<string, number>();
    for (const c of candidates) {
      if (c.chars.length === FORMAT_LEN) {
        exactVotes.set(c.text, (exactVotes.get(c.text) || 0) + 1);
      }
    }

    const consensus = this.buildConsensus(candidates, FORMAT_LEN);

    // Phân tầng cử tri: charseg (tách ký tự riêng lẻ) chính xác vượt trội so với
    // word-level trên captcha GDT — word-level chỉ là cử tri tham khảo/bù đắp.
    const segPool = candidates.filter(c => c.chars.length === FORMAT_LEN && c.source.startsWith('charseg'));
    const wordPool = candidates.filter(c => c.chars.length === FORMAT_LEN && !c.source.startsWith('charseg'));

    // Ứng viên charseg đơn lẻ mạnh nhất (không vị trí nào ABSTAIN) — phương án cứu hộ
    const soloSeg = segPool
      .filter(c => !c.chars.includes(null))
      .sort((a, b) => b.confidence - a.confidence)[0];
    const soloAny = candidates
      .filter(c => c.chars.length === FORMAT_LEN && !c.chars.includes(null))
      .sort((a, b) => b.confidence - a.confidence)[0];

    let bestText = '';
    let bestReason = '';
    let bestConf = 0;

    const evaluateWith = (
      consensusResult: ReturnType<typeof CaptchaSolver.buildConsensus>,
      exactPool: OcrCandidate[],
      solo: OcrCandidate | undefined
    ): { text: string; reason: string } => {
      if (!consensusResult || consensusResult.text.length !== FORMAT_LEN) return { text: '', reason: '' };
      const votedPositions = consensusResult.voterCounts.filter(v => v > 0).length;
      const hasUncertain =
        votedPositions < FORMAT_LEN ||
        consensusResult.supports.some((s, i) => consensusResult.voterCounts[i] > 0 && consensusResult.voterCounts[i] < 3 && s < 0.85);
      const votes = exactPool.filter(c => c.text === consensusResult.text).length;

      if (votes >= 2 && consensusResult.meanConf >= 45) {
        return { text: consensusResult.text, reason: `${votes}_sources_identical` };
      }
      if (consensusResult.support >= 0.62 && !hasUncertain && consensusResult.meanConf >= 52) {
        return {
          text: consensusResult.text,
          reason: `weighted_consensus_${Math.round(consensusResult.support * 100)}pct`
        };
      }
      if (
        solo &&
        !hasUncertain &&
        solo.text === consensusResult.text &&
        solo.confidence >= 90
      ) {
        // Đồng thuận chắc chắn về chuỗi nhưng meanConf hơi thấp — nguồn đơn lẻ
        // rất tự tin và đọc TRÙNG chuỗi đồng thuận -> tin được
        return { text: solo.text, reason: 'high_confidence_single' };
      }
      return { text: '', reason: `weak_evidence_support_${Math.round(consensusResult.support * 100)}pct` };
    };

    if (segPool.length >= 2) {
      // Tầng chính: chỉ các ứng viên charseg bỏ phiếu
      const verdict = evaluateWith(this.buildConsensus(segPool, FORMAT_LEN), segPool, soloSeg);
      bestText = verdict.text;
      bestReason = verdict.reason ? `${verdict.reason}` : 'no_verdict';
      if (!bestReason || bestReason === 'no_verdict') bestReason = 'weak_evidence';
      if (verdict.text) {
        const winners = segPool.filter(c => c.text === verdict.text);
        bestConf =
          Math.round(
            (winners.reduce((a, c) => a + c.confidence, 0) / Math.max(1, winners.length)) * 10
          ) / 10;
      } else {
        const cons = this.buildConsensus(segPool, FORMAT_LEN);
        bestConf = cons ? Math.round(cons.meanConf * 10) / 10 : 0;
      }
    } else if (segPool.length === 1 && soloSeg) {
      // Một mình charseg: cần word-level đối chiếu chéo ít nhất 60% vị trí khớp
      let matchCount = 0;
      let votedCount = 0;
      for (const w of wordPool) {
        if (w.chars.includes(null)) continue;
        let thisMatch = 0;
        for (let i = 0; i < FORMAT_LEN; i++) {
          if (w.chars[i] === soloSeg.chars[i]) thisMatch++;
        }
        matchCount += thisMatch;
        votedCount += FORMAT_LEN;
      }
      const corroboration = votedCount > 0 ? matchCount / votedCount : 0;
      if (soloSeg.confidence >= 88 && corroboration >= 0.6) {
        bestText = soloSeg.text;
        bestConf = Math.round(soloSeg.confidence * 10) / 10;
        bestReason = `single_charseg_corroborated_${Math.round(corroboration * 100)}pct`;
      } else {
        bestReason = `insufficient_evidence_conf_${Math.round(soloSeg.confidence)}_corr_${Math.round(corroboration * 100)}pct`;
      }
    } else if (soloAny && soloAny.confidence >= 97) {
      // Không có charseg khả dụng: chỉ chấp nhận khi nguồn đơn lẻ gần như tuyệt đối tự tin
      bestText = soloAny.text;
      bestConf = Math.round(soloAny.confidence * 10) / 10;
      bestReason = 'high_confidence_single';
    } else {
      // Fallback hiếm gặp: bỏ phiếu toàn bộ như kiến trúc cũ nhưng cổng khắt khe
      const verdict = evaluateWith(consensus, [...segPool, ...wordPool], soloAny);
      bestText = verdict.text;
      bestReason = verdict.text ? verdict.reason : 'insufficient_voters';
      if (consensus) bestConf = Math.round(consensus.meanConf * 10) / 10;
    }

    if (!bestText && !bestReason) bestReason = 'no_candidates';

    return {
      text: bestText,
      confidence: bestConf,
      accepted: bestText.length === FORMAT_LEN,
      reason: bestReason,
      candidates
    };
  }

  /** Giải chi tiết: đầy đủ ứng viên + quyết định + lý do (backtest/log/debug) */
  public static async solveDetailed(base64Image: string): Promise<CaptchaSolveResult> {
    if (!base64Image || typeof base64Image !== 'string') {
      return { text: '', confidence: 0, accepted: false, reason: 'invalid_input', candidates: [] };
    }

    try {
      const cleanBase64 = base64Image.replace(/^data:image\/\w+;base64,/, '').trim();
      const rawBuffer = Buffer.from(cleanBase64, 'base64');

      const decoded = this.decodeToGrayscale(rawBuffer);
      if (!decoded) {
        return { text: '', confidence: 0, accepted: false, reason: 'decode_failed', candidates: [] };
      }
      const { width, height, gray } = decoded;
      const cleanedGray = this.clearFrame(gray, width, height);
      const otsuTh = this.calculateOtsuThreshold(cleanedGray, width, height);

      const binarize = (th: number) => {
        const b = new Uint8Array(width * height);
        for (let i = 0; i < b.length; i++) b[i] = cleanedGray[i] < th ? 0 : 255;
        return b;
      };

      const planeOtsuClean = this.removeSmallSpeckles(binarize(otsuTh), width, height, 10);
      const planeHigh = this.removeSmallSpeckles(binarize(Math.min(otsuTh + 18, 178)), width, height, 8);
      const planeLow = this.removeSmallSpeckles(binarize(Math.max(otsuTh - 16, 100)), width, height, 6);
      const planeOtsuRaw = binarize(otsuTh);
      const planeSauvola = this.removeSmallSpeckles(this.sauvolaThreshold(cleanedGray, width, height), width, height, 5);
      const planeStretched = this.stretchContrast(cleanedGray);

      const debugDir = this.prepareDebugDir();

      const wordTargets: { name: string; plane: Uint8Array }[] = [
        { name: 'otsu_clean', plane: planeOtsuClean },
        { name: 'high_contrast', plane: planeHigh },
        { name: 'low_threshold', plane: planeLow },
        { name: 'otsu_raw', plane: planeOtsuRaw },
        { name: 'sauvola_adaptive', plane: planeSauvola },
        { name: 'grayscale_stretched', plane: planeStretched }
      ];

      const candidates: OcrCandidate[] = [];
      let worker: Worker;
      try {
        worker = await this.getWorker();
      } catch (err: any) {
        console.warn('[CaptchaSolver] Không khởi tạo được worker OCR:', err.message);
        return { text: '', confidence: 0, accepted: false, reason: 'worker_failed', candidates: [] };
      }

      for (const target of wordTargets) {
        const scaled = this.scaleBilinear(target.plane, width, height, 3);
        const padded = this.padWhite(scaled.data, scaled.width, scaled.height, 12);
        const bmp = this.createBmp(padded.data, padded.width, padded.height);
        try {
          const cand = await this.recognizeWord(worker, bmp, target.name);
          if (cand) {
            candidates.push(cand);
            if (debugDir) this.appendDebugLog(debugDir, `${target.name}\t${Math.round(cand.confidence)}\t${cand.text}`);

            // Fast path: hai pipeline đầu đọc chuẩn 5 ký tự với độ tin cậy rất cao
            if (
              candidates.length <= 2 &&
              cand.chars.length === FORMAT_LEN &&
              cand.confidence >= 95 &&
              !cand.chars.includes(null)
            ) {
              return {
                text: cand.text,
                confidence: Math.round(cand.confidence * 10) / 10,
                accepted: true,
                reason: `early_exit_${target.name}`,
                candidates
              };
            }
          }
        } catch {
          // bỏ qua lỗi pipeline đơn lẻ
        }
      }

      // ---- Character Segmentation: crop grayscale + binary, PSM 8 ----
      const segAttempts: { tag: string; seg: Uint8Array; crop: Uint8Array }[] = [
        { tag: 'charseg_gray', seg: planeOtsuClean, crop: planeStretched },
        { tag: 'charseg_bin', seg: planeOtsuClean, crop: planeOtsuClean },
        { tag: 'charseg_lowthr_gray', seg: planeLow, crop: planeStretched }
      ];
      for (const attempt of segAttempts) {
        const cand = await this.solveBySegmentation(worker, attempt.tag, attempt.seg, width, height, attempt.crop);
        if (cand) {
          candidates.push(cand);
          if (debugDir) this.appendDebugLog(debugDir, debugLogLine(attempt.tag, cand));
        }
      }

      const finalResult = this.evaluateCandidates(candidates);
      if (debugDir) {
        this.appendDebugLog(debugDir, `FINAL\t${finalResult.confidence}\t${finalResult.text || '(rejected)'}\t${finalResult.reason}`);
      }
      return finalResult;
    } catch (err: any) {
      console.warn('[CaptchaSolver] Lỗi khi nhận diện CAPTCHA tự động:', err.message);
      // Hủy worker lỗi thay vì chỉ bỏ tham chiếu — tránh rò rỉ WASM worker
      const stalePromise = this.workerPromise;
      this.workerPromise = null;
      if (stalePromise) {
        stalePromise.then(w => w.terminate()).catch(() => {});
      }
      return { text: '', confidence: 0, accepted: false, reason: `error:${err.message}`, candidates: [] };
    }
  }

  /** Giải nhanh — API cũ: chuỗi nếu đạt cổng chất lượng, ngược lại rỗng */
  public static async solve(base64Image: string): Promise<string> {
    const result = await this.solveDetailed(base64Image);
    return result.accepted ? result.text : '';
  }

  // ---------- Debug dump (TAXRECORD_CAPTCHA_DEBUG=1) ----------
  private static prepareDebugDir(): string | null {
    if (process.env.TAXRECORD_CAPTCHA_DEBUG !== '1') return null;
    try {
      const dir = path.join(
        process.env.TEMP || process.env.TMP || process.cwd(),
        'taxrecord_captcha_debug',
        String(Date.now())
      );
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    } catch {
      return null;
    }
  }

  private static appendDebugLog(dir: string, line: string) {
    try {
      fs.appendFileSync(path.join(dir, 'ocr.log'), line + '\n');
    } catch {}
  }

  /** Dọn dẹp worker khi tắt app */
  public static async terminate(): Promise<void> {
    if (this.workerPromise) {
      try {
        const worker = await this.workerPromise;
        await worker.terminate();
      } catch {}
      this.workerPromise = null;
    }
  }
}

function debugLogLine(tag: string, cand: OcrCandidate): string {
  const pattern = cand.chars.map(c => c ?? '_').join('');
  return `${tag}\t${Math.round(cand.confidence)}\t${cand.text}\t[pattern=${pattern}]`;
}
