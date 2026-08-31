"""
High-speed Synthetic Captcha Generator matching Vietnam Tax Portal (GDT) style.
Image size: 150x38.
Inner character span: x in [22, 132], y in [4, 30].
Includes outer border frame, strike-through lines, and accurate font glyphs.
"""
import os
import random
import math
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import numpy as np

CHARSET = '0123456789abcdefghijklmnopqrstuvwxyz'
WIDTH = 150
HEIGHT = 38
CAPTCHA_LEN = 5

SYSTEM_FONTS = [
    r'C:\Windows\Fonts\arial.ttf',
    r'C:\Windows\Fonts\arialbd.ttf',
    r'C:\Windows\Fonts\tahoma.ttf',
    r'C:\Windows\Fonts\tahomabd.ttf',
    r'C:\Windows\Fonts\verdana.ttf',
    r'C:\Windows\Fonts\verdanab.ttf',
    r'C:\Windows\Fonts\trebuc.ttf',
    r'C:\Windows\Fonts\trebucbd.ttf',
    r'C:\Windows\Fonts\times.ttf',
    r'C:\Windows\Fonts\timesbd.ttf',
]
VALID_FONTS = [f for f in SYSTEM_FONTS if os.path.exists(f)] or ['arial.ttf']

# Build glyph cache for fast rendering
GLYPH_CACHE = {}


def init_glyph_cache():
    global GLYPH_CACHE
    if GLYPH_CACHE:
        return
    for font_path in VALID_FONTS:
        for size in [20, 22, 24, 26]:
            try:
                font = ImageFont.truetype(font_path, size)
            except Exception:
                font = ImageFont.load_default()
            for ch in CHARSET:
                for angle in range(-16, 17, 4):
                    canvas = Image.new('RGBA', (38, 38), (0, 0, 0, 0))
                    d = ImageDraw.Draw(canvas)
                    d.text((6, 2), ch, font=font, fill=(0, 0, 0, 255))
                    rotated = canvas.rotate(angle, resample=Image.BILINEAR)
                    GLYPH_CACHE[(font_path, size, ch, angle)] = rotated


init_glyph_cache()
CACHE_KEYS = list(GLYPH_CACHE.keys())


def generate_fast_captcha():
    """Generates a synthetic captcha image and its label as a numpy array [38, 150] in [-1, 1] range."""
    bg_val = random.randint(190, 245)
    img = Image.new('RGB', (WIDTH, HEIGHT), color=(bg_val, bg_val, bg_val))
    draw = ImageDraw.Draw(img)

    # 1. 1px border frame (characteristic of GDT portal captcha)
    frame_color = random.randint(20, 80)
    draw.rectangle([(0, 0), (WIDTH - 1, HEIGHT - 1)], outline=(frame_color, frame_color, frame_color))

    # 2. Background random dots
    for _ in range(random.randint(20, 50)):
        x = random.randint(1, WIDTH - 2)
        y = random.randint(1, HEIGHT - 2)
        c = random.randint(140, 210)
        draw.point((x, y), fill=(c, c, c))

    # 3. Render 5 characters in span x in [24, 128]
    label_chars = random.choices(CHARSET, k=CAPTCHA_LEN)
    label = ''.join(label_chars)
    span_start = random.randint(20, 30)
    span_width = random.randint(95, 105)
    char_step = span_width / CAPTCHA_LEN

    for i, ch in enumerate(label_chars):
        fpath = random.choice(VALID_FONTS)
        fsize = random.choice([20, 22, 24, 26])
        angle = random.choice(range(-16, 17, 4))
        key = (fpath, fsize, ch, angle)
        glyph = GLYPH_CACHE.get(key)
        if glyph is None:
            glyph = GLYPH_CACHE[CACHE_KEYS[0]]

        # Text color (black to dark charcoal 10-60)
        color_val = random.randint(10, 55)
        r, g, b, a = glyph.split()
        colored_glyph = Image.merge('RGBA', (
            r.point(lambda _: color_val),
            g.point(lambda _: color_val),
            b.point(lambda _: color_val),
            a
        ))

        x_pos = int(span_start + i * char_step + random.uniform(-2.5, 2.5))
        y_pos = int(random.uniform(0, 7))
        img.paste(colored_glyph, (x_pos, y_pos), mask=colored_glyph)

    draw = ImageDraw.Draw(img)

    # 4. 1-2 strike-through lines (straight or wavy)
    for _ in range(random.randint(1, 2)):
        line_color = random.randint(40, 110)
        thickness = random.choice([1, 1, 2])
        if random.random() < 0.5:
            # Straight line across
            x0 = random.randint(1, 20)
            y0 = random.randint(6, HEIGHT - 6)
            x1 = random.randint(WIDTH - 22, WIDTH - 2)
            y1 = random.randint(6, HEIGHT - 6)
            draw.line([(x0, y0), (x1, y1)], fill=(line_color, line_color, line_color), width=thickness)
        else:
            # Sine wave line
            amplitude = random.uniform(2.5, 5.5)
            frequency = random.uniform(0.04, 0.08)
            phase = random.uniform(0, 2 * math.pi)
            base_y = random.uniform(10, HEIGHT - 10)
            pts = []
            for x in range(1, WIDTH - 1, 2):
                y = base_y + amplitude * math.sin(frequency * x + phase)
                pts.append((x, int(y)))
            for p1, p2 in zip(pts[:-1], pts[1:]):
                draw.line([p1, p2], fill=(line_color, line_color, line_color), width=thickness)

    # Convert to grayscale array normalized to [-1, 1]
    gray = img.convert('L')
    arr = (np.array(gray, dtype=np.float32) / 255.0 - 0.5) / 0.5
    return arr, label, img


if __name__ == '__main__':
    os.makedirs('data/synthetic_samples', exist_ok=True)
    for i in range(5):
        _, lbl, im = generate_fast_captcha()
        im.save(f'data/synthetic_samples/v2_{i}_{lbl}.png')
    print("V2 Samples generated successfully.")
