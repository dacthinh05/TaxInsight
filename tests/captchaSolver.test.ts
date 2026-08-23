import { describe, expect, it } from 'vitest';
import { CaptchaSolver, type OcrCandidate } from '../src/main/scanner/CaptchaSolver';
import { PNG } from 'pngjs';

/**
 * Vẽ một glyph "đậm" hình chữ nhật lên ảnh mock (mô phỏng nét chữ dày của GDT)
 */
function drawBar(png: PNG, x0: number, y0: number, w: number, h: number) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const idx = (png.width * y + x) * 4;
      png.data[idx] = 20;
      png.data[idx + 1] = 20;
      png.data[idx + 2] = 20;
      png.data[idx + 3] = 255;
    }
  }
}

function makeCaptchaPng(): PNG {
  // Ảnh mock 120x40: viền đen 2px + nền xám sáng + 5 vạch "chữ" đậm cách nhau
  const png = new PNG({ width: 120, height: 40 });
  for (let y = 0; y < 40; y++) {
    for (let x = 0; x < 120; x++) {
      const idx = (120 * y + x) * 4;
      const isFrame = x <= 1 || x >= 118 || y <= 1 || y >= 38;
      png.data[idx] = isFrame ? 0 : 235;
      png.data[idx + 1] = isFrame ? 0 : 235;
      png.data[idx + 2] = isFrame ? 0 : 235;
      png.data[idx + 3] = 255;
    }
  }
  for (let i = 0; i < 5; i++) {
    drawBar(png, 15 + i * 20, 10, 9, 20);
  }
  return png;
}

function toGray(png: PNG): Uint8Array {
  const gray = new Uint8Array(png.width * png.height);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = png.data[i * 4];
  }
  return gray;
}

const cand = (
  chars: (string | null)[],
  confs: number[],
  source: string
): OcrCandidate => ({
  text: chars.filter((c): c is string => c !== null).join(''),
  confidence: confs.reduce((a, c) => a + c, 0) / Math.max(1, confs.length),
  source,
  chars,
  charConfs: confs
});

describe('CaptchaSolver & Image Preprocessing Pipeline', () => {
  it('tạo đủ 6 pipeline OCR từ raw image buffer', () => {
    const buffer = PNG.sync.write(makeCaptchaPng());
    const pipelines = CaptchaSolver.generatePipelines(buffer);

    expect(pipelines).toHaveLength(6);
    expect(pipelines.map(p => p.name)).toEqual([
      'otsu_clean',
      'high_contrast',
      'low_threshold',
      'otsu_raw',
      'sauvola_adaptive',
      'grayscale_stretched'
    ]);

    for (const p of pipelines) {
      expect(p.buffer.subarray(0, 2).toString('ascii')).toBe('BM');
      expect(p.buffer.length).toBeGreaterThan(54);
    }

    // Ảnh phóng đại bilinear 3x + viền trắng 12px mỗi phía
    const otsu = pipelines.find(p => p.name === 'otsu_clean')!;
    expect(otsu.buffer.readInt32LE(18)).toBe(120 * 3 + 24);
    expect(otsu.buffer.readInt32LE(22)).toBe(40 * 3 + 24);
  });

  it('clearFrame phát hiện và xóa khung viền theo mật độ điểm đen', () => {
    const png = makeCaptchaPng();
    const cleaned = CaptchaSolver.clearFrame(toGray(png), png.width, png.height);

    // Toàn bộ vành ngoài sau khi clear phải trắng tinh (viền 2px + 1px đệm)
    for (let x = 0; x < png.width; x++) {
      expect(cleaned[png.width * 0 + x]).toBe(255);
      expect(cleaned[png.width * 2 + x]).toBe(255);
    }
    // Nền xám phía trong không bị xóa nhầm
    expect(cleaned[png.width * 5 + 60]).toBe(235);
    // Vạch "chữ" giữa ảnh phải còn nguyên (không bị ăn)
    let darkAtBar = 0;
    for (let x = 15; x < 24; x++) {
      if (cleaned[png.width * 20 + x] < 128) darkAtBar++;
    }
    expect(darkAtBar).toBeGreaterThan(5);
  });

  it('segmentGlyphs tách đúng 5 glyph trái -> phải', () => {
    const png = makeCaptchaPng();
    const cleaned = CaptchaSolver.clearFrame(toGray(png), png.width, png.height);
    const binary = new Uint8Array(png.width * png.height);
    for (let i = 0; i < binary.length; i++) binary[i] = cleaned[i] < 128 ? 0 : 255;

    const glyphs = CaptchaSolver.segmentGlyphs(binary, png.width, png.height);
    expect(glyphs).toHaveLength(5);
    for (let i = 1; i < glyphs.length; i++) {
      expect(glyphs[i].x0).toBeGreaterThan(glyphs[i - 1].x0);
    }
  });

  it('buildConsensus bỏ phiếu trọng số theo vị trí, vị trí thiếu phiếu bị ABSTAIN', () => {
    const candidates: OcrCandidate[] = [
      cand(['a', 'b', 'c', 'd', 'e'], [90, 90, 90, 90, 90], 'p1'),
      cand(['a', 'b', 'x', 'd', 'e'], [80, 80, 80, 80, 80], 'p2'),
      cand(['a', 'b', 'c', null, 'e'], [70, 70, 70, 0, 70], 'charseg')
    ];
    const consensus = CaptchaSolver.buildConsensus(candidates, 5);
    expect(consensus).not.toBeNull();
    expect(consensus!.text).toBe('abcde');
    // Vị trí 4 chỉ có 2 cử tri (d từ p1/p2)
    expect(consensus!.voterCounts[3]).toBe(2);
  });

  it('buildConsensus: ký tự có tổng trọng số conf cao thắng dù ít phiếu hơn', () => {
    const candidates: OcrCandidate[] = [
      cand(['z', 'b', 'c', 'd', 'e'], [99, 90, 90, 90, 90], 'p1'),
      cand(['2', 'b', 'c', 'd', 'e'], [98, 90, 90, 90, 90], 'p2'),
      cand(['z', 'b', 'c', 'd', 'e'], [40, 90, 90, 90, 90], 'p3')
    ];
    const consensus = CaptchaSolver.buildConsensus(candidates, 5);
    // z: 0.99+0.40 = 1.39 > 2: 0.98
    expect(consensus!.text[0]).toBe('z');
  });

  it('evaluateCandidates: >=3 nguồn đọc giống hệt nhau -> chấp nhận', () => {
    const candidates: OcrCandidate[] = [
      cand(['f', 'd', 'z', 'c', '6'], [96, 96, 95, 96, 99], 'charseg_gray'),
      cand(['f', 'd', 'z', 'c', '6'], [94, 91, 93, 94, 98], 'charseg_bin'),
      cand(['f', 'd', 'z', 'c', '6'], [77, 89, 95, 98, 72], 'low_threshold')
    ];
    const result = CaptchaSolver.evaluateCandidates(candidates);
    expect(result.accepted).toBe(true);
    expect(result.text).toBe('fdzc6');
    expect(result.reason).toContain('sources_identical');
  });

  it('evaluateCandidates: một vị trí bị chia đôi phiếu (không ai đề xuất chữ đúng) -> từ chối', () => {
    // Vị trí 0: '7' vs 'a' sít sao (support ~0.51), chữ thật không có mặt -> uncertain
    const candidates: OcrCandidate[] = [
      cand(['7', 'b', 'q', '7', 'k'], [92, 97, 98, 97, 95], 'charseg_gray'),
      cand(['a', 'b', 'q', '7', 'k'], [89, 80, 89, 98, 98], 'charseg_bin')
    ];
    const result = CaptchaSolver.evaluateCandidates(candidates);
    expect(result.accepted).toBe(false);
    expect(result.text).toBe('');
    expect(result.reason).toContain('weak_evidence');
  });

  it('evaluateCandidates: hai nguồn xung đột tại một vị trí -> từ chối dù có nguồn conf cao', () => {
    // Vị trí 0: 'c' vs 'e' sít sao, không bên nào áp đảo -> uncertain -> nhập tay
    const candidates: OcrCandidate[] = [
      cand(['y', 'c', '4', 'h', 'r'], [96, 95, 97, 96, 94], 'otsu_clean'),
      cand(['y', 'e', 'g', 'h', 'r'], [80, 98, 90, 98, 82], 'grayscale_stretched')
    ];
    const result = CaptchaSolver.evaluateCandidates(candidates);
    expect(result.accepted).toBe(false);
    expect(result.text).toBe('');
  });

  it('evaluateCandidates: đồng thuận chắc chắn + nguồn đơn lẻ trùng chuỗi & conf cao -> chấp nhận', () => {
    const candidates: OcrCandidate[] = [
      cand(['y', 'c', '4', 'h', 'r'], [97, 96, 98, 97, 95], 'charseg_gray'),
      cand(['y', 'c', '4', 'h', 'r'], [60, 58, 62, 59, 61], 'low_threshold')
    ];
    const result = CaptchaSolver.evaluateCandidates(candidates);
    expect(result.accepted).toBe(true);
    expect(result.text).toBe('yc4hr');
  });

  it('evaluateCandidates: bằng chứng yếu -> từ chối trả rỗng để chuyển nhập tay', () => {
    const candidates: OcrCandidate[] = [
      cand(['a', 'b', 'c', 'd', 'e'], [55, 50, 48, 52, 49], 'otsu_clean'),
      cand(['x', 'y', 'z', 'w', 'v'], [53, 51, 47, 54, 50], 'low_threshold')
    ];
    const result = CaptchaSolver.evaluateCandidates(candidates);
    expect(result.accepted).toBe(false);
    expect(result.text).toBe('');
  });

  it('cropGlyph trả BMP hợp lệ với kích thước phóng đại', () => {
    const png = makeCaptchaPng();
    const box = { x0: 15, y0: 10, x1: 23, y1: 29 };
    const bmp = CaptchaSolver.cropGlyph(toGray(png), png.width, png.height, box);
    expect(bmp.subarray(0, 2).toString('ascii')).toBe('BM');
    // glyph 9x20 + pad 8*2 = 25x36, scale ~ round(64/36)=2
    expect(bmp.readInt32LE(18)).toBe(25 * 2);
    expect(bmp.readInt32LE(22)).toBe(36 * 2);
  });

  it('scaleBilinear giữ nguyên kích thước và giá trị biên', () => {
    const data = new Uint8Array([255, 255, 255, 255, 0, 0, 0, 0, 255, 255, 255, 255]);
    const scaled = CaptchaSolver.scaleBilinear(data, 3, 4, 2);
    expect(scaled.width).toBe(6);
    expect(scaled.height).toBe(8);
  });

  it('xử lý chuỗi rỗng / base64 hỏng an toàn mà không bị crash', async () => {
    const res1 = await CaptchaSolver.solve('');
    expect(res1).toBe('');

    const res2 = await CaptchaSolver.solve('data:image/png;base64,invalid');
    expect(res2).toBe('');

    const detail = await CaptchaSolver.solveDetailed('');
    expect(detail.accepted).toBe(false);
    expect(detail.reason).toBe('invalid_input');
  });
});
