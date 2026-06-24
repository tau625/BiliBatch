#!/usr/bin/env python3
"""Generate BiliBatch extension icons at multiple sizes."""

from PIL import Image, ImageDraw, ImageFont
import math
import os

SIZES = [16, 32, 48, 128]
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "extension", "icons")

# Brand colors
BILI_PINK = (251, 114, 153)  # #FB7299
BILI_DARK_PINK = (230, 90, 130)  # #E65A82
WHITE = (255, 255, 255)
WHITE_A80 = (255, 255, 255, 204)  # semi-transparent white for subtitle lines


def draw_rounded_rect(draw, xy, radius, fill):
    """Draw a rounded rectangle."""
    x0, y0, x1, y1 = xy
    r = radius
    # Four corners
    draw.pieslice([x0, y0, x0 + 2 * r, y0 + 2 * r], 180, 270, fill=fill)
    draw.pieslice([x1 - 2 * r, y0, x1, y0 + 2 * r], 270, 360, fill=fill)
    draw.pieslice([x0, y1 - 2 * r, x0 + 2 * r, y1], 90, 180, fill=fill)
    draw.pieslice([x1 - 2 * r, y1 - 2 * r, x1, y1], 0, 90, fill=fill)
    # Fill rectangles
    draw.rectangle([x0 + r, y0, x1 - r, y1], fill=fill)
    draw.rectangle([x0, y0 + r, x1, y1 - r], fill=fill)


def draw_b_letter(draw, cx, cy, size, color):
    """Draw a stylized 'B' letter."""
    s = size
    thickness = s * 0.18
    # Vertical bar
    x_bar = cx - s * 0.35
    y_top = cy - s * 0.4
    y_bot = cy + s * 0.4
    draw.rectangle([x_bar, y_top, x_bar + thickness, y_bot], fill=color)

    # Top horizontal bar
    draw.rectangle([x_bar, y_top, x_bar + s * 0.35, y_top + thickness], fill=color)

    # Middle horizontal bar
    y_mid = cy - s * 0.05
    draw.rectangle([x_bar, y_mid, x_bar + s * 0.35, y_mid + thickness * 0.8], fill=color)

    # Bottom horizontal bar
    draw.rectangle([x_bar, y_bot - thickness, x_bar + s * 0.35, y_bot], fill=color)

    # Top bump (right side)
    r_top = s * 0.25
    cx_top = x_bar + s * 0.35
    cy_top = cy - s * 0.2
    draw.pieslice(
        [cx_top - r_top, cy_top - r_top, cx_top + r_top, cy_top + r_top],
        -90, 90, fill=color
    )

    # Bottom bump (slightly larger)
    r_bot = s * 0.3
    cx_bot = x_bar + s * 0.35
    cy_bot = cy + s * 0.18
    draw.pieslice(
        [cx_bot - r_bot, cy_bot - r_bot, cx_bot + r_bot, cy_bot + r_bot],
        -90, 90, fill=color
    )


def draw_subtitle_lines(draw, x, y, width, line_height, gap, color, count=3):
    """Draw horizontal lines representing subtitles."""
    for i in range(count):
        lw = width * (0.9 - i * 0.15)  # decreasing width
        draw.rectangle([x, y + i * (line_height + gap), x + lw, y + i * (line_height + gap) + line_height], fill=color)


def create_icon(size):
    """Create a single icon at the given size."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    pad = max(1, size // 16)
    radius = max(2, size // 5)

    # Pink rounded background
    draw_rounded_rect(draw, [pad, pad, size - pad, size - pad], radius, BILI_PINK)

    # White "B" letter
    draw_b_letter(draw, size * 0.38, size * 0.5, size * 0.8, WHITE)

    # Subtitle lines (right side, representing caption/subtitle)
    if size >= 32:
        lx = size * 0.68
        ly = size * 0.32
        lw = size * 0.25
        lh = max(1, size * 0.045)
        gap = max(1, size * 0.04)
        draw_subtitle_lines(draw, lx, ly, lw, lh, gap, WHITE_A80, count=3)

    return img


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    for s in SIZES:
        icon = create_icon(s)
        path = os.path.join(OUTPUT_DIR, f"icon{s}.png")
        icon.save(path, "PNG")
        print(f"Generated: {path} ({s}x{s})")


if __name__ == "__main__":
    main()
