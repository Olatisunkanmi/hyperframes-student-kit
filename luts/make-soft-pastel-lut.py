#!/usr/bin/env python3
"""Generate the Soft Pastel Cinematic 3D LUT (.cube, 33^3, Rec.709 display-referred in/out).

Usage: python3 luts/make-soft-pastel-lut.py   (writes both strengths next to this file)

The grade, in order:
  1. gentle S-curve for clean mid-contrast
  2. saturation pulled down ~12%, less so on skin/orange hues (protects faces)
  3. pastel lift: bright saturated colors drift toward white a touch
  4. matte: blacks lifted to ~0.035, whites rolled off to ~0.975
  5. split tone: faint lavender in shadows, faint peach in highlights
`strength` blends the result with the identity LUT (1.0 = full, 0.6 = subtle).
"""
import colorsys
import os

SIZE = 33
HERE = os.path.dirname(os.path.abspath(__file__))


def clamp(x):
    return 0.0 if x < 0 else 1.0 if x > 1 else x


def grade(r, g, b):
    # 1. S-curve (per channel, mild)
    def s(x):
        return x + 0.22 * (x * x * (3 - 2 * x) - x)
    r, g, b = s(r), s(g), s(b)

    # 2. saturation, protecting skin hues (~5-50 degrees)
    h, l, sat = colorsys.rgb_to_hls(clamp(r), clamp(g), clamp(b))
    hd = h * 360
    skin = max(0.0, 1 - min(abs(hd - 25), 45) / 45)  # 1 at orange, 0 far away
    sat *= 0.86 + 0.09 * skin
    # 3. pastel: lift lightness of saturated colors
    l = l + 0.05 * sat * (1 - l)
    r, g, b = colorsys.hls_to_rgb(h, clamp(l), clamp(sat))

    # 4. matte blacks, soft whites
    r, g, b = (0.035 + c * (0.975 - 0.035) for c in (r, g, b))

    # 5. split tone
    y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    sh, hi = (1 - y) ** 2, y ** 2
    r += 0.004 * sh + 0.013 * hi
    g += 0.002 * sh + 0.006 * hi
    b += 0.012 * sh - 0.005 * hi
    return clamp(r), clamp(g), clamp(b)


def write(path, title, strength):
    with open(path, "w") as f:
        f.write(f'TITLE "{title}"\nLUT_3D_SIZE {SIZE}\nDOMAIN_MIN 0.0 0.0 0.0\nDOMAIN_MAX 1.0 1.0 1.0\n')
        for bi in range(SIZE):
            for gi in range(SIZE):
                for ri in range(SIZE):  # red varies fastest, per the .cube spec
                    r0, g0, b0 = ri / (SIZE - 1), gi / (SIZE - 1), bi / (SIZE - 1)
                    r1, g1, b1 = grade(r0, g0, b0)
                    out = (r0 + (r1 - r0) * strength, g0 + (g1 - g0) * strength, b0 + (b1 - b0) * strength)
                    f.write("%.6f %.6f %.6f\n" % out)


if __name__ == "__main__":
    write(os.path.join(HERE, "soft-pastel-cinematic.cube"), "Soft Pastel Cinematic", 1.0)
    write(os.path.join(HERE, "soft-pastel-cinematic-subtle.cube"), "Soft Pastel Cinematic Subtle", 0.6)
    print("wrote 2 LUTs in", HERE)
