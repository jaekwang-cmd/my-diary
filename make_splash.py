"""아이폰 시작화면(apple-touch-startup-image) 생성.
아이폰은 안드로이드와 달리 시작화면을 자동 생성해 주지 않아 기종별로 넣어야 한다."""
from PIL import Image, ImageDraw, ImageFont
import os

OUT = r"C:\Users\mj497\my-diary\icons\splash"
ICON = r"C:\Users\mj497\my-diary\icons\icon-512.png"
os.makedirs(OUT, exist_ok=True)

LIGHT = (255, 255, 255, 255)
DARK = (15, 17, 20, 255)          # css --bg 다크값과 동일
TEXT_LIGHT = (154, 161, 169, 255)
TEXT_DARK = (107, 114, 128, 255)

# (css_width, css_height, dpr)  — SE부터 16 Pro Max까지
DEVICES = [
    (320, 568, 2), (375, 667, 2), (414, 736, 3),
    (375, 812, 3), (414, 896, 2), (414, 896, 3),
    (390, 844, 3), (428, 926, 3), (393, 852, 3),
    (430, 932, 3), (402, 874, 3), (440, 956, 3),
]

FONT_PATH = r"C:\Windows\Fonts\malgun.ttf"
icon_src = Image.open(ICON).convert("RGBA")


def build(cw, ch, dpr, dark):
    W, H = cw * dpr, ch * dpr
    img = Image.new("RGBA", (W, H), DARK if dark else LIGHT)

    # 아이콘: 화면 너비의 26%
    side = int(W * 0.26)
    icon = icon_src.resize((side, side), Image.LANCZOS)
    ix, iy = (W - side) // 2, int(H * 0.5) - side - int(H * 0.02)
    img.paste(icon, (ix, iy), icon)

    label = "추억 일기"
    try:
        font = ImageFont.truetype(FONT_PATH, int(W * 0.045))
        d = ImageDraw.Draw(img)
        bbox = d.textbbox((0, 0), label, font=font)
        tw = bbox[2] - bbox[0]
        d.text(((W - tw) // 2, iy + side + int(H * 0.028)), label,
               font=font, fill=TEXT_DARK if dark else TEXT_LIGHT)
    except OSError:
        pass          # 폰트가 없으면 아이콘만

    return img.convert("RGB")


links = []
for cw, ch, dpr in DEVICES:
    for dark in (False, True):
        name = f"splash-{cw}x{ch}@{dpr}x{'-dark' if dark else ''}.png"
        build(cw, ch, dpr, dark).save(os.path.join(OUT, name), optimize=True)
        media = (f"(device-width: {cw}px) and (device-height: {ch}px) "
                 f"and (-webkit-device-pixel-ratio: {dpr}) "
                 f"and (orientation: portrait)")
        if dark:
            media += " and (prefers-color-scheme: dark)"
        links.append(f'<link rel="apple-touch-startup-image" media="{media}" href="./icons/splash/{name}">')

with open(os.path.join(OUT, "_links.html"), "w", encoding="utf-8") as f:
    f.write("\n".join(links))

total = sum(os.path.getsize(os.path.join(OUT, f))
            for f in os.listdir(OUT) if f.endswith(".png"))
print(f"{len(DEVICES)*2}장 생성 · 합계 {total/1024:.0f} KB")
