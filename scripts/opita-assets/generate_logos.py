"""
generate_logos.py — Production-grade logo system for Opita Market.
v2 — fixes text overflow on horizontal logo + OG image; tightens spacing on vertical.
"""
from __future__ import annotations
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

TERRACOTTA = (168, 90, 50)
COFFEE = (107, 58, 28)
CREAM = (248, 241, 227)
ANDEAN_GREEN = (58, 140, 78)
DEEP_NIGHT = (44, 37, 32)
WHITE = (255, 255, 255)

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent
PUBLIC = REPO_ROOT / "apps" / "market-web" / "public"
LOGO_DIR = PUBLIC / "logo"
LOGO_DIR.mkdir(parents=True, exist_ok=True)

FONT_DIR = Path("C:/Windows/Fonts")


def load_font(name: str, size: int) -> ImageFont.FreeTypeFont:
    candidates = {
        "serif-bold": ["georgiab.ttf", "timesbd.ttf"],
        "serif": ["georgia.ttf", "times.ttf"],
        "serif-italic": ["georgiai.ttf", "timesi.ttf"],
        "sans": ["arial.ttf", "tahoma.ttf"],
        "sans-bold": ["arialbd.ttf", "tahomabd.ttf"],
    }
    for fname in candidates.get(name, [name]):
        path = FONT_DIR / fname
        if path.exists():
            try:
                return ImageFont.truetype(str(path), size)
            except Exception:
                continue
    return ImageFont.load_default()


def draw_mark(canvas: Image.Image, size: int, bg_color=None) -> Image.Image:
    d = ImageDraw.Draw(canvas)
    s = size
    cx, cy = s // 2, s // 2

    if bg_color is not None:
        d.rectangle([(0, 0), (s, s)], fill=bg_color)

    circle_r = int(s * 0.42)
    d.ellipse([(cx - circle_r, cy - circle_r), (cx + circle_r, cy + circle_r)], fill=COFFEE)
    inner_r = int(circle_r * 0.82)
    d.ellipse([(cx - inner_r, cy - inner_r), (cx + inner_r, cy + inner_r)], fill=CREAM)

    # Awning — simpler, no center support that pokes into circle
    awning_h = int(s * 0.18)
    awning_top = cy - circle_r - int(s * 0.01)
    awning_bot = cy - int(circle_r * 0.50)
    awning_w = int(circle_r * 1.55)
    awning_left = cx - awning_w // 2
    awning_right = cx + awning_w // 2
    stripe_w = (awning_right - awning_left) // 4
    for i in range(4):
        sx = awning_left + i * stripe_w
        ex = sx + stripe_w
        color = TERRACOTTA if i % 2 == 0 else CREAM
        d.rectangle([(sx, awning_top), (ex, awning_bot)], fill=color)
    # Top bar
    d.rectangle(
        [(awning_left - int(s * 0.005), awning_top - int(s * 0.014)),
         (awning_right + int(s * 0.005), awning_top + int(s * 0.014))],
        fill=TERRACOTTA,
    )

    # Inner "O"
    o_w = int(s * 0.30)
    o_h = int(s * 0.36)
    o_left = cx - o_w // 2
    o_top = cy - o_h // 2 + int(s * 0.03)
    outer_w = int(o_w * 0.28)
    d.ellipse([(o_left, o_top), (cx + o_w // 2, o_top + o_h)], fill=COFFEE)
    in_left = o_left + outer_w
    in_top = o_top + outer_w
    in_right = cx + o_w // 2 - outer_w
    in_bot = o_top + o_h - outer_w
    d.ellipse([(in_left, in_top), (in_right, in_bot)], fill=CREAM)

    return canvas


def make_mark_png(path: Path, size: int, bg_color=None):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0) if bg_color is None else bg_color + (255,))
    draw_mark(img, size, bg_color=bg_color)
    img.save(path, "PNG", optimize=True)
    print(f"  {path.name}: {size}x{size} bg={'transparent' if bg_color is None else 'cream'}")


def measure_text(d, text, font):
    bbox = d.textbbox((0, 0), text, font=font)
    return bbox[2] - bbox[0], bbox[3] - bbox[1]


def make_horizontal_logo(path: Path):
    # v2: wider canvas (640) + mark on left + tighter text fit
    mark_size = 112
    f_opita = load_font("serif-bold", 60)
    f_market = load_font("serif-italic", 30)

    # Measure widths
    tmp = Image.new("RGB", (1, 1))
    dtmp = ImageDraw.Draw(tmp)
    w_opita, h_opita = measure_text(dtmp, "opita", f_opita)
    w_market, h_market = measure_text(dtmp, "Market", f_market)
    text_w = max(w_opita, w_market)

    gap = 24
    padding = 16
    w = mark_size + gap + text_w + padding * 2
    h = max(mark_size, h_opita + h_market + 20) + padding * 2

    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # Mark on left
    mark_img = Image.new("RGBA", (mark_size, mark_size), (0, 0, 0, 0))
    draw_mark(mark_img, mark_size, bg_color=None)
    img.paste(mark_img, (padding, (h - mark_size) // 2), mark_img)
    # Wordmark on right
    text_x = padding + mark_size + gap
    # Vertical center: align "opita" middle with mark center
    text_y_opita = (h - h_opita - h_market - 8) // 2 - 4
    d.text((text_x, text_y_opita), "opita", font=f_opita, fill=COFFEE)
    d.text((text_x, text_y_opita + h_opita + 4), "Market", font=f_market, fill=TERRACOTTA)
    img.save(path, "PNG", optimize=True)
    print(f"  {path.name}: {w}x{h}")


def make_vertical_logo(path: Path, size: int = 256):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    mark_size = int(size * 0.62)
    mark_img = Image.new("RGBA", (mark_size, mark_size), (0, 0, 0, 0))
    draw_mark(mark_img, mark_size, bg_color=None)
    img.paste(mark_img, ((size - mark_size) // 2, int(size * 0.06)), mark_img)

    f_opita = load_font("serif-bold", int(size * 0.14))
    f_market = load_font("serif-italic", int(size * 0.075))
    bbox = d.textbbox((0, 0), "opita", font=f_opita)
    text_w = bbox[2] - bbox[0]
    d.text(((size - text_w) // 2, int(size * 0.74)), "opita", font=f_opita, fill=COFFEE)
    bbox = d.textbbox((0, 0), "Market", font=f_market)
    text_w = bbox[2] - bbox[0]
    d.text(((size - text_w) // 2, int(size * 0.88)), "Market", font=f_market, fill=TERRACOTTA)

    img.save(path, "PNG", optimize=True)
    print(f"  {path.name}: {size}x{size}")


def make_favicon_ico(path: Path):
    sizes = [16, 32, 48]
    imgs = []
    for s in sizes:
        img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        draw_mark(img, s, bg_color=None)
        imgs.append(img)
    imgs[0].save(
        path, format="ICO", sizes=[(i.width, i.height) for i in imgs],
        append_images=imgs[1:],
    )
    print(f"  {path.name}: multi-size {sizes}")


def make_apple_touch_icon(path: Path, size: int = 180):
    img = Image.new("RGBA", (size, size), CREAM + (255,))
    draw_mark(img, size, bg_color=CREAM)
    img.save(path, "PNG", optimize=True)
    print(f"  {path.name}: {size}x{size}")


def make_og_image(path: Path):
    """Open Graph — 1200x630, logo left, text right, warm gradient bg."""
    w, h = 1200, 630
    img = Image.new("RGB", (w, h), CREAM)
    d = ImageDraw.Draw(img)

    # Subtle warm gradient
    for y in range(h):
        ratio = y / h
        r = int(CREAM[0] * (1 - ratio) + TERRACOTTA[0] * ratio * 0.20)
        g = int(CREAM[1] * (1 - ratio) + TERRACOTTA[1] * ratio * 0.20)
        b = int(CREAM[2] * (1 - ratio) + TERRACOTTA[2] * ratio * 0.20)
        d.line([(0, y), (w, y)], fill=(r, g, b))

    # Left: logo mark
    mark_size = 420
    mark_img = Image.new("RGBA", (mark_size, mark_size), (0, 0, 0, 0))
    draw_mark(mark_img, mark_size, bg_color=None)
    mark_x = 80
    img.paste(mark_img, (mark_x, (h - mark_size) // 2), mark_img)

    # Right: text block — measure widths to avoid overflow
    text_x = mark_x + mark_size + 50
    text_x_max = w - 40  # right margin
    text_w_max = text_x_max - text_x

    f_opita = load_font("serif-bold", 100)
    f_market = load_font("serif-italic", 56)
    f_tagline = load_font("sans-bold", 30)
    f_subline = load_font("sans", 22)

    # Draw "opita" + "Market" stacked
    d.text((text_x, 110), "opita", font=f_opita, fill=COFFEE)
    d.text((text_x, 220), "Market", font=f_market, fill=TERRACOTTA)

    # Tagline — single line that fits
    tagline = "La infraestructura para el SMB colombiano"
    # Shrink if needed
    tag_size = 30
    while measure_text(d, tagline, f_tagline)[0] > text_w_max and tag_size > 14:
        tag_size -= 2
        f_tagline = load_font("sans-bold", tag_size)
    d.text((text_x, 340), tagline, font=f_tagline, fill=DEEP_NIGHT)

    # Subline (smaller)
    d.text((text_x, 395), "Marketplace + videos + pagos sin tarjeta",
           font=f_subline, fill=COFFEE)
    d.text((text_x, 430), "Huila, Colombia  ·  market.opitacode.com",
           font=f_subline, fill=COFFEE)

    # Bottom: tiny brand tag
    f_tiny = load_font("sans", 16)
    d.text((w - 220, h - 30), "staging.opita-market-dev.pages.dev",
           font=f_tiny, fill=COFFEE)

    img.save(path, "PNG", optimize=True, quality=92)
    print(f"  {path.name}: {w}x{h}")


def make_webmanifest(path: Path):
    manifest = {
        "name": "Opita Market",
        "short_name": "Opita",
        "description": "La infraestructura para el SMB colombiano",
        "start_url": "/",
        "display": "standalone",
        "background_color": "#f8f1e3",
        "theme_color": "#a85a32",
        "icons": [
            {"src": "/logo/mark-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable"},
            {"src": "/logo/mark-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"},
            {"src": "/apple-touch-icon.png", "sizes": "180x180", "type": "image/png"},
        ],
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    print(f"  {path.name}: manifest written")


def make_robots_txt(path: Path):
    content = """# robots.txt — Opita Market
User-agent: *
Allow: /
Allow: /demo
Allow: /legal/aviso
Disallow: /admin/
Disallow: /api/

Sitemap: https://market.opitacode.com/sitemap.xml
"""
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"  {path.name}: written")


def main():
    print("=== Generating Opita Market logo system (v2) ===\n")

    print("Logo PNGs:")
    make_mark_png(LOGO_DIR / "mark-512.png", 512)
    make_mark_png(LOGO_DIR / "mark-192.png", 192)
    make_mark_png(LOGO_DIR / "mark-32.png", 32)
    make_horizontal_logo(LOGO_DIR / "horizontal-512x128.png")
    make_vertical_logo(LOGO_DIR / "vertical-256x256.png", 256)

    print("\nFavicon:")
    make_favicon_ico(PUBLIC / "favicon.ico")

    print("\nApple touch icon:")
    make_apple_touch_icon(PUBLIC / "apple-touch-icon.png", 180)

    print("\nOpen Graph image:")
    make_og_image(PUBLIC / "og-image.png")

    print("\nPWA manifest + robots.txt:")
    make_webmanifest(PUBLIC / "site.webmanifest")
    make_robots_txt(PUBLIC / "robots.txt")

    print("\n=== Done ===")


if __name__ == "__main__":
    main()