from PIL import Image, ImageDraw
import os

OUT = r"C:\Users\mj497\my-diary\icons"
ACCENT = (53, 197, 207, 255)
WHITE = (255, 255, 255, 255)
SZ = 1024


def pencil_layer(size, scale=1.0):
    """흰색 연필을 그린 투명 레이어(회전 전)"""
    L = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(L)
    cx = size / 2
    w = size * 0.20 * scale          # 연필 폭
    top = size * 0.16
    bot = size * 0.70
    tip = size * 0.84

    # 몸통
    d.rounded_rectangle([cx - w / 2, top, cx + w / 2, bot],
                        radius=size * 0.022, fill=WHITE)
    # 촉
    d.polygon([(cx - w / 2, bot + size * 0.012),
               (cx + w / 2, bot + size * 0.012),
               (cx, tip)], fill=WHITE)
    # 몸통/촉 구분선 (투명하게 파냄)
    d.rectangle([cx - w / 2, bot - size * 0.012, cx + w / 2, bot + size * 0.006],
                fill=(0, 0, 0, 0))
    # 지우개쪽 구분선
    d.rectangle([cx - w / 2, top + size * 0.115, cx + w / 2, top + size * 0.133],
                fill=(0, 0, 0, 0))
    return L


def build(size, maskable=False):
    img = Image.new("RGBA", (SZ, SZ), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        d.rectangle([0, 0, SZ, SZ], fill=ACCENT)      # 전체를 채워 안전영역 확보
        inner = 0.62
    else:
        d.rounded_rectangle([0, 0, SZ, SZ], radius=int(SZ * 0.225), fill=ACCENT)
        inner = 0.80

    p = pencil_layer(SZ).rotate(-45, resample=Image.BICUBIC, expand=False)
    if inner != 1.0:
        n = int(SZ * inner)
        p = p.resize((n, n), Image.LANCZOS)
        off = (SZ - n) // 2
        tmp = Image.new("RGBA", (SZ, SZ), (0, 0, 0, 0))
        tmp.paste(p, (off, off), p)
        p = tmp
    img = Image.alpha_composite(img, p)
    return img.resize((size, size), Image.LANCZOS)


os.makedirs(OUT, exist_ok=True)
for s in (180, 192, 512):
    build(s).save(os.path.join(OUT, f"icon-{s}.png"))
    print("icon-%d.png" % s)
build(512, maskable=True).save(os.path.join(OUT, "icon-maskable-512.png"))
print("icon-maskable-512.png")
