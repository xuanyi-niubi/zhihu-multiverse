# -*- coding: utf-8 -*-
"""
生成品牌资产：favicon（icon.png）+ 社交分享封面（opengraph-image.png）

设计依据：DESIGN-SYSTEM.md「显影厅」
- 深空底 #060B18 → #0A1424
- 极光带 Aurora Band：全站唯一情绪指示器（蓝 → 青 → 银 的 2px 斜向渐变）
- 结构主色 #0052D9，知乎来源色 #0084FF 只给真实来源
- 刘看山立绘取自 public/kanshan/player_idle.gif 的第一帧

输出：
  src/app/icon.png               512x512   favicon
  src/app/opengraph-image.png    1200x630  社交分享卡
  src/app/apple-icon.png         180x180   iOS 主屏图标

用法（需要 Pillow，未加进 package.json —— 它是一次性资产生成，
不该成为日常 dev 依赖；刻意不提供可能跑不通的 npm script）：

  E:\python\python.exe scripts/gen-brand-assets.py

改动标题 / 文案 / 立绘后重跑即可覆盖。立绘取自
public/kanshan/player_idle.gif 的第一帧，换皮肤改 SRC_GIF。
"""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_GIF = os.path.join(ROOT, "public", "kanshan", "player_idle.gif")
OUT_APP = os.path.join(ROOT, "src", "app")

# ---------------------------------------------------------------- 调色板
DEEP = (6, 11, 24)          # 最深处  #060B18
SURFACE = (10, 20, 36)      # 表面    #0A1424
AURORA = [(0, 82, 217), (102, 242, 255), (220, 233, 251)]   # 极光带三停靠点
TEXT_1 = (232, 240, 255)
TEXT_2 = (148, 168, 200)

FONT_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"
FONT_REG = r"C:\Windows\Fonts\msyh.ttc"
FONT_MONO = r"C:\Windows\Fonts\consola.ttf"


def load_font(path, size):
    for candidate in (path, FONT_BOLD, FONT_REG):
        try:
            return ImageFont.truetype(candidate, size)
        except Exception:
            continue
    return ImageFont.load_default()


def deep_space(size, light_center=(0.68, 0.42), light_radius=0.95):
    """深空底：垂直渐变 + 一团极淡的蓝光（观象厅背光）。"""
    w, h = size
    base = Image.new("RGB", (w, h), DEEP)
    px = base.load()
    for y in range(h):
        t = y / max(1, h - 1)
        # 顶部略亮（表面），向下沉入深空
        r = int(SURFACE[0] + (DEEP[0] - SURFACE[0]) * t)
        g = int(SURFACE[1] + (DEEP[1] - SURFACE[1]) * t)
        b = int(SURFACE[2] + (DEEP[2] - SURFACE[2]) * t)
        for x in range(w):
            px[x, y] = (r, g, b)

    # 背光
    glow = Image.new("L", (w, h), 0)
    gd = ImageDraw.Draw(glow)
    cx, cy = int(w * light_center[0]), int(h * light_center[1])
    rad = int(min(w, h) * light_radius)
    gd.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], fill=70)
    glow = glow.filter(ImageFilter.GaussianBlur(rad // 2))
    haze = Image.new("RGB", (w, h), (0, 82, 217))
    base = Image.composite(Image.blend(base, haze, 0.55), base, glow)
    return base.convert("RGBA")


def aurora_band(width, height=3, skew=0.0):
    """极光带：斜向渐变带，全站唯一的情绪指示器。"""
    band = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    px = band.load()
    stops = AURORA
    for x in range(width):
        t = x / max(1, width - 1)
        seg = t * (len(stops) - 1)
        i = min(int(seg), len(stops) - 2)
        f = seg - i
        c0, c1 = stops[i], stops[i + 1]
        col = tuple(int(c0[k] + (c1[k] - c0[k]) * f) for k in range(3))
        for y in range(height):
            # 竖直方向做一点点衰减，避免像一条死板的线
            a = 255 - int(abs(y - (height - 1) / 2) / max(1, (height - 1) / 2) * 40)
            px[x, y] = (col[0], col[1], col[2], a)
    return band


def load_kanshan(size, gif=SRC_GIF):
    """取刘看山 GIF 第一帧，去边距后等比缩放到 size（长边）。"""
    im = Image.open(gif)
    frame = im.convert("RGBA")
    bbox = frame.getbbox()
    if bbox:
        frame = frame.crop(bbox)
    w, h = frame.size
    scale = size / max(w, h)
    return frame.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)


def rounded_mask(size, radius):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius=radius, fill=255)
    return m


# ---------------------------------------------------------------- favicon
def build_icon(size=512, path=None, radius_ratio=0.24, padding_ratio=0.10):
    canvas = deep_space((size, size), light_center=(0.5, 0.58), light_radius=0.85)
    # 外轮廓圆角：标签页里比纯方更精致
    canvas.putalpha(rounded_mask((size, size), int(size * radius_ratio)))
    canvas = canvas.convert("RGBA")

    sprite = load_kanshan(int(size * (1 - padding_ratio * 2)))
    sw, sh = sprite.size
    # 略上移，给脚下的极光带让出净空
    canvas.alpha_composite(sprite, ((size - sw) // 2, int((size - sh) / 2 - size * 0.055)))

    # 脚下极光带：一小段，暗示「世界线」
    band = aurora_band(int(size * 0.50), height=max(2, size // 96))
    bx = (size - band.width) // 2
    by = int(size * 0.885)
    canvas.alpha_composite(band, (bx, by))

    canvas.save(path, "PNG", optimize=True)
    return path


# ---------------------------------------------------------------- OG 封面
def build_og(w=1200, h=630, path=None):
    canvas = deep_space((w, h), light_center=(0.72, 0.40), light_radius=0.92)
    d = ImageDraw.Draw(canvas, "RGBA")

    # ---- 看山立绘：先定位，再在它「背后」铺观测轨道（观象厅的同心圆语言）
    sprite = load_kanshan(int(h * 0.75))
    sw, sh = sprite.size
    sx = w - sw - int(w * 0.055)
    sy = int(h * 0.14)
    cx, cy = sx + sw // 2, sy + sh // 2

    for i, (rad, alpha) in enumerate(((0.29, 24), (0.39, 15), (0.49, 9))):
        r = int(h * rad)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(0, 130, 255, alpha), width=1)

    canvas.alpha_composite(sprite, (sx, sy))

    # ---- 左侧文字区
    x0 = int(w * 0.062)
    y = int(h * 0.165)

    f_kicker = load_font(FONT_MONO, 22)
    d.text((x0, y), "ZHIHU  MULTIVERSE", font=f_kicker, fill=(138, 190, 240, 245))
    y += 46

    f_title = load_font(FONT_BOLD, 74)
    d.text((x0, y), "知乎平行宇宙", font=f_title, fill=TEXT_1)
    y += 96

    f_sub = load_font(FONT_BOLD, 30)
    d.text((x0, y), "由真实人生经验驱动的互动人生实验", font=f_sub, fill=(170, 196, 228, 240))
    y += 56

    f_line = load_font(FONT_REG, 24)
    for line in ("说出一个真实困惑，", "我们去找真正走过这些路的人，", "把他们的逐字经历编译成一局属于你的平行世界。"):
        d.text((x0, y), line, font=f_line, fill=TEXT_2)
        y += 37

    # ---- 极光带：下三分之一的分割线，斜向贯穿（全站唯一情绪指示器）
    band_y = int(h * 0.855)
    band = aurora_band(int(w * 0.58), height=3)
    band = band.rotate(-5, expand=True, resample=Image.BICUBIC)
    canvas.alpha_composite(band, (x0, band_y))

    # ---- 赛道标识：放在极光带「下方」，左对齐，不再被压住
    f_tag = load_font(FONT_REG, 21)
    d.text((x0, band_y + 34), "AI 场景创新赛 · 游戏赛道", font=f_tag, fill=(122, 152, 194, 230))

    canvas.convert("RGB").save(path, "PNG", optimize=True)
    return path


if __name__ == "__main__":
    os.makedirs(OUT_APP, exist_ok=True)
    results = []
    results.append(build_icon(512, os.path.join(OUT_APP, "icon.png"), padding_ratio=0.13))
    results.append(build_icon(180, os.path.join(OUT_APP, "apple-icon.png"), radius_ratio=0.22, padding_ratio=0.15))
    results.append(build_og(path=os.path.join(OUT_APP, "opengraph-image.png")))
    for r in results:
        print("OK", r, os.path.getsize(r), "bytes")
