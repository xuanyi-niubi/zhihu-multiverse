"""从刘看山官方本体 GIF 抽首帧为 PNG，供设计画布使用。"""
import os
from PIL import Image

SRC = r"C:\Users\xuanyi\Desktop\知乎黑客松\public\kanshan"
OUT = r"C:\Users\xuanyi\Desktop\知乎黑客松\.workbuddy\tmp\kanshan_png"
os.makedirs(OUT, exist_ok=True)

# 官方本体：无皮肤前缀
TARGETS = ["idle.gif", "wave.gif", "sway.gif", "doze.gif", "computer.gif", "dribble.gif"]

for name in TARGETS:
    p = os.path.join(SRC, name)
    if not os.path.exists(p):
        print("MISS", name)
        continue
    im = Image.open(p)
    im.seek(0)
    im = im.convert("RGBA")
    im.thumbnail((420, 420), Image.LANCZOS)
    out = os.path.join(OUT, name.replace(".gif", ".png"))
    im.save(out)
    print("OK", out, im.size)
