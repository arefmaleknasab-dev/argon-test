#!/usr/bin/env python3
"""
خراط‌کد — ساخت آیکن نرم‌افزار (ICO چند‌اندازه‌ای + PNG پیش‌نمایش)

آیکن: یک قطعهٔ خراطی‌شده (نیم‌رخ گلدان) روی پنل تیرهٔ نرم‌افزار، با ابزار برش
و برادهٔ نارنجی؛ در اندازه‌های کوچک ساده‌سازی می‌شود تا روی نوار وظیفه ویندوز
۱۰/۱۱ کاملاً خوانا باشد.
"""

from PIL import Image, ImageDraw
import math
import os
import sys

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets")
SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]

BG      = (29, 23, 16, 255)
BG_EDGE = (77, 61, 40, 255)
BRASS   = (227, 169, 78, 255)
BRASS_2 = (243, 194, 107, 255)
COPPER  = (224, 112, 60, 255)
TEAL    = (69, 179, 148, 255)

# کنترل‌های نیم‌رخ گلدان: (y نرمال‌شده از بالا، شعاع نسبی)
PROFILE = [
    (0.155, 0.300),   # لبهٔ بالا
    (0.200, 0.305),
    (0.225, 0.250),   # زیر لبه (گردن)
    (0.290, 0.190),
    (0.360, 0.235),
    (0.470, 0.400),
    (0.575, 0.510),   # شکم
    (0.690, 0.470),
    (0.775, 0.330),
    (0.838, 0.360),
    (0.870, 0.360),   # پایهٔ تخت
    (0.880, 0.300),
]


def smooth_profile(n=140):
    """درون‌یابی نرم (Catmull-Rom) بین نقاط کنترل نیم‌رخ."""
    pts = PROFILE
    ext = [pts[0]] + list(pts) + [pts[-1]]
    out = []
    for i in range(len(ext) - 3):
        p0, p1, p2, p3 = ext[i], ext[i + 1], ext[i + 2], ext[i + 3]
        for k in range(n // (len(ext) - 3) + 1):
            t = k / max(1, (n // (len(ext) - 3)))
            t2, t3 = t * t, t * t * t
            def cr(a, b, c, d):
                return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
            out.append((cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])))
    return out


def vase_polygon(cx, top, bottom, maxr, height_scale=1.0):
    prof = smooth_profile()
    right = [(cx + maxr * r, top + (bottom - top) * y) for y, r in prof]
    left = [(2 * cx - x, y) for x, y in reversed(right)]
    return right + left, right, left


def gradient(size, top_color, bottom_color):
    g = Image.new("RGBA", (1, size))
    for y in range(size):
        t = y / max(1, size - 1)
        g.putpixel((0, y), tuple(int(top_color[i] + (bottom_color[i] - top_color[i]) * t) for i in range(4)))
    return g.resize((size, size), Image.BILINEAR)


def draw_icon(px: int) -> Image.Image:
    small = px <= 24
    ss = 8 if px <= 64 else 4
    s = px * ss
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    pad = s * 0.035
    rad = s * 0.22
    d.rounded_rectangle([pad, pad, s - pad, s - pad], radius=rad, fill=BG,
                        outline=BG_EDGE, width=max(1, int(s * 0.014)))

    # درخشش برنجی ملایم
    glow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([s * 0.30, -s * 0.55, s * 1.40, s * 0.80], fill=(227, 169, 78, 30))
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([pad, pad, s - pad, s - pad], radius=rad, fill=255)
    img.paste(glow, (0, 0), Image.composite(glow.getchannel("A"), mask, mask))

    cx = s * 0.5
    top = s * 0.135
    bottom = s * 0.865
    maxr = s * 0.275

    body, right, left = vase_polygon(cx, top, bottom, maxr)

    # بدنه با گرادیان عمودی برنجی
    body_mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(body_mask).polygon(body, fill=255)
    grad = gradient(s, (250, 205, 120, 255), (206, 128, 52, 255))
    img.paste(grad, (0, 0), body_mask)
    d = ImageDraw.Draw(img)

    # سایهٔ سمت راست + درخشش سمت چپ برای حس حجم
    shadow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.polygon([(cx + maxr * 0.18, y) for x, y in right] + [(cx + maxr * 0.18, bottom), (cx + maxr, bottom)], fill=(90, 45, 10, 110))
    img.alpha_composite(Image.composite(shadow, Image.new("RGBA", (s, s), (0, 0, 0, 0)), body_mask))
    d = ImageDraw.Draw(img)

    # خط نور لبهٔ چپ
    lw = max(1, int(s * (0.030 if small else 0.020)))
    d.line(left[: len(left) - 2], fill=(255, 226, 168, 210), width=lw, joint="curve")

    if not small:
        # شیارهای خراطی
        for yy in (0.30, 0.44, 0.60, 0.76):
            y = top + (bottom - top) * yy
            r = None
            best = 1e9
            for py_, pr in smooth_profile():
                if abs(py_ - yy) < best:
                    best = abs(py_ - yy)
                    r = pr
            half = maxr * (r or 0.4) * 0.90
            d.line([(cx - half, y), (cx + half, y)], fill=(120, 62, 18, 130), width=max(1, int(s * 0.011)))
        # محور چرخش
        axis = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        ImageDraw.Draw(axis).line([(cx, s * 0.075), (cx, s * 0.925)], fill=(69, 179, 148, 105), width=max(1, int(s * 0.008)))
        img.alpha_composite(axis)
        d = ImageDraw.Draw(img)

        # بستر خراطی (خط افقی برنجی زیر قطعه) و یک جرقهٔ کوچک فیروزه‌ای
        d.line([(s * 0.175, s * 0.905), (s * 0.825, s * 0.905)], fill=(154, 167, 180, 190), width=max(1, int(s * 0.016)))
        d.line([(s * 0.245, s * 0.905), (s * 0.755, s * 0.905)], fill=TEAL, width=max(1, int(s * 0.014)))
        d.ellipse([s * 0.735, s * 0.664, s * 0.795, s * 0.724], fill=(224, 112, 60, 90))
        d.ellipse([s * 0.752, s * 0.681, s * 0.778, s * 0.707], fill=(243, 194, 107, 235))
    else:
        # نسخهٔ ساده: فقط بستر خراطی برای خوانایی در ۱۶ پیکسل
        d.line([(s * 0.19, s * 0.905), (s * 0.81, s * 0.905)], fill=TEAL, width=max(1, int(s * 0.048)))

    return img.resize((px, px), Image.LANCZOS)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    images = [draw_icon(n) for n in SIZES]

    ico_path = os.path.abspath(os.path.join(OUT_DIR, "kharraatcode.ico"))
    images[-1].save(ico_path, format="ICO", sizes=[(n, n) for n in SIZES], append_images=images[:-1])
    images[-1].save(os.path.abspath(os.path.join(OUT_DIR, "kharraatcode-256.png")))

    preview = Image.new("RGBA", (960, 420), (16, 13, 9, 255))
    x = 20
    for n in [16, 20, 24, 32, 48, 64, 128, 256]:
        im = draw_icon(n)
        preview.alpha_composite(im, (x, 60))
        x += n + 26
    preview.save(os.path.abspath(os.path.join(OUT_DIR, "preview.png")))
    print("ok:", ico_path, os.path.getsize(ico_path), "bytes")


if __name__ == "__main__":
    sys.exit(main())
