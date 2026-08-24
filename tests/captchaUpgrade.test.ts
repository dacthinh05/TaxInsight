import { describe, expect, it } from 'vitest';
import { CaptchaSolver } from '../src/main/scanner/CaptchaSolver';

/**
 * Test nâng cấp nhận diện CAPTCHA:
 *  1. removeStrokeLines — xóa nét gạch xuyên/sóng mà không ăn nhầm glyph
 *  2. dilateBinary — nối nét đứt
 *  3. segmentGlyphs chuẩn hóa số glyph về đúng 5 (tách glyph dính nhau / gộp mảnh rời)
 */

const W = 120;
const H = 40;

function makeWhitePlane(): Uint8Array {
  return new Uint8Array(W * H).fill(255);
}

function drawBar(plane: Uint8Array, x0: number, y0: number, w: number, h: number) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      plane[W * y + x] = 0;
    }
  }
}

function drawHLine(plane: Uint8Array, y: number, thickness = 1) {
  for (let x = 0; x < W; x++) {
    for (let t = 0; t < thickness; t++) plane[W * (y + t) + x] = 0;
  }
}

function countDarkInRect(plane: Uint8Array, x0: number, y0: number, x1: number, y1: number): number {
  let dark = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (plane[W * y + x] === 0) dark++;
    }
  }
  return dark;
}

// 5 vạch "chữ" 9x20 tại x = 15, 35, 55, 75, 95
const BAR_XS = [15, 35, 55, 75, 95];

describe('UPGRADE #1 — removeStrokeLines', () => {
  it('Nét gạch ngang thẳng (không chạm chữ) bị xóa sạch, glyph còn nguyên', () => {
    const plane = makeWhitePlane();
    for (const bx of BAR_XS) drawBar(plane, bx, 10, 9, 20);
    drawHLine(plane, 5); // nét ngang phía trên chữ

    const cleaned = CaptchaSolver.removeStrokeLines(plane, W, H);

    expect(countDarkInRect(cleaned, 0, 4, W - 1, 6)).toBe(0);
    for (const bx of BAR_XS) {
      expect(countDarkInRect(cleaned, bx, 10, bx + 8, 29)).toBe(9 * 20);
    }
  });

  it('Nét sóng chéo thưa (density thấp) bị xóa', () => {
    const plane = makeWhitePlane();
    drawBar(plane, 15, 10, 9, 20);
    // Đường chéo lượn liên tục từ trái sang phải, dày 1px, không chạm vạch chữ
    for (let x = 30; x < W; x++) {
      const y = 8 + Math.round(6 * Math.sin(x / 9));
      plane[W * y + x] = 0;
    }

    const cleaned = CaptchaSolver.removeStrokeLines(plane, W, H);
    // Toàn bộ vùng sóng phải trắng
    let waveDark = 0;
    for (let x = 30; x < W; x++) {
      for (let y = 0; y < H; y++) {
        if (cleaned[W * y + x] === 0) waveDark++;
      }
    }
    expect(waveDark).toBe(0);
    expect(countDarkInRect(cleaned, 15, 10, 23, 29)).toBe(9 * 20);
  });

  it('AN TOÀN NHẤT: nét gạch XUYÊN QUA chữ (dính thành 1 component) KHÔNG được xóa chữ', () => {
    const plane = makeWhitePlane();
    for (const bx of BAR_XS) drawBar(plane, bx, 10, 9, 20);
    drawHLine(plane, 19); // cắt ngang qua tất cả vạch

    const cleaned = CaptchaSolver.removeStrokeLines(plane, W, H);

    // Mỗi vạch phải còn ít nhất 90% mực (component merged -> giữ nguyên)
    for (const bx of BAR_XS) {
      const dark = countDarkInRect(cleaned, bx, 10, bx + 8, 29);
      expect(dark).toBeGreaterThanOrEqual(Math.floor(9 * 20 * 0.9));
    }
  });
});

describe('UPGRADE #2 — dilateBinary', () => {
  it('1 điểm đen lan thành khối 3x3, pixel trắng xa cách không bị ảnh hưởng', () => {
    const plane = makeWhitePlane();
    plane[W * 20 + 60] = 0;

    const dilated = CaptchaSolver.dilateBinary(plane, W, H);

    for (let y = 19; y <= 21; y++) {
      for (let x = 59; x <= 61; x++) {
        expect(dilated[W * y + x]).toBe(0);
      }
    }
    expect(dilated[W * 18 + 60]).toBe(255);
    expect(dilated[W * 22 + 60]).toBe(255);
    expect(dilated[W * 20 + 58]).toBe(255);
  });
});

describe('UPGRADE #3 — segmentGlyphs chuẩn hóa về đúng 5 ký tự', () => {
  it('Glyph DÍNH NHAU qua cầu mảnh: tách tại thung lũng mực -> đủ 5 box', () => {
    const plane = makeWhitePlane();
    // 3 vạch đơn + 1 cặp dính nhau (75-93) nối bằng cầu 2px tại cột 84
    drawBar(plane, 15, 10, 9, 20);
    drawBar(plane, 35, 10, 9, 20);
    drawBar(plane, 55, 10, 9, 20);
    drawBar(plane, 75, 10, 19, 20);
    // Khoét cột 84 chỉ chừa 2px cầu ở giữa -> connected component vẫn liền
    for (let y = 10; y <= 29; y++) {
      if (y !== 19 && y !== 20) {
        plane[W * y + 84] = 255;
      }
    }

    const glyphs = CaptchaSolver.segmentGlyphs(plane, W, H);
    expect(glyphs).toHaveLength(5);

    for (let i = 1; i < glyphs.length; i++) {
      expect(glyphs[i].x0).toBeGreaterThan(glyphs[i - 1].x0);
    }
    // Điểm tách phải nằm quanh cột cầu 84 (nửa trái kết thúc ~84)
    const splitBox = glyphs[3];
    expect(splitBox.x1).toBeGreaterThanOrEqual(82);
    expect(splitBox.x1).toBeLessThanOrEqual(86);
  });

  it('Mảnh vụn RỜI gần glyph: gộp theo khe hẹp nhất -> đủ 5 box', () => {
    const plane = makeWhitePlane();
    for (const bx of BAR_XS) drawBar(plane, bx, 10, 9, 20);
    drawBar(plane, 106, 12, 2, 16); // mảnh vụn cách vạch cuối 2px

    const glyphs = CaptchaSolver.segmentGlyphs(plane, W, H);
    expect(glyphs).toHaveLength(5);

    // Vạch cuối và mảnh vụn đã được gộp chung 1 box (x1 của box cuối = 107)
    expect(glyphs[4].x0).toBeLessThanOrEqual(95);
    expect(glyphs[4].x1).toBeGreaterThanOrEqual(107);
  });

  it('Ảnh đúng 5 glyph sẵn: normalization là no-op (không hồi quy)', () => {
    const plane = makeWhitePlane();
    for (const bx of BAR_XS) drawBar(plane, bx, 10, 9, 20);

    const glyphs = CaptchaSolver.segmentGlyphs(plane, W, H);
    expect(glyphs).toHaveLength(5);
    expect(glyphs.map(g => g.x0)).toEqual(BAR_XS);
  });
});
