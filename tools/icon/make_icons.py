"""앱 아이콘 만들기: 카세트테이프 한 벌을 여기서 정의하고, 폰 앱(벡터)과 PC 프로그램(.ico)을 함께 뽑는다.

    python tools/icon/make_icons.py

- 폰: res/drawable/ic_launcher_foreground.xml · ic_launcher_background.xml · ic_launcher_monochrome.xml · ic_stat.xml
- PC: pc/assets/tape-box.ico (16~256px. 32px 이하는 잔무늬를 뺀 단순한 그림), 미리보기 tools/icon/preview.png
.ico는 Playwright(크로미움)로 SVG를 그려 Pillow로 묶는다.
모양은 1024×1024 좌표로 정의하고, 같은 경로 문자열을 SVG와 안드로이드 벡터가 함께 쓴다.
"""
import io
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RES = os.path.join(ROOT, "android", "app", "src", "main", "res", "drawable")
PC_ASSETS = os.path.join(ROOT, "pc", "assets")
HERE = os.path.dirname(os.path.abspath(__file__))

TILT = -8  # 살짝 기울여 놓은 테이프

# 앱과 같은 색 (css/style.css의 금빛·잉크·빨강)
INK = "#1F2D4D"       # 라벨 손글씨 (펜 잉크)
GOLD = "#E8B25A"
ORANGE = "#E07B39"
RED = "#D9493A"
SHELL = "#F1E6CF"     # 아이보리 케이스
SHELL_DK = "#DCCBA8"  # 아래 사다리꼴 · 테두리
LABEL = "#FFF9EC"
WINDOW = "#17130F"
TAPE = "#5A3B26"      # 감긴 테이프 (갈색)
HUB = "#F6EEDC"
BG_IN, BG_OUT = "#3A2C20", "#100D0B"  # 폰 아이콘 배경 (가운데가 은은히 밝은 따뜻한 어둠)


def f(v):
    return f"{v:.2f}".rstrip("0").rstrip(".")


def rrect(x, y, w, h, r):
    return (f"M{f(x + r)},{f(y)}H{f(x + w - r)}A{f(r)},{f(r)} 0 0 1 {f(x + w)},{f(y + r)}"
            f"V{f(y + h - r)}A{f(r)},{f(r)} 0 0 1 {f(x + w - r)},{f(y + h)}"
            f"H{f(x + r)}A{f(r)},{f(r)} 0 0 1 {f(x)},{f(y + h - r)}"
            f"V{f(y + r)}A{f(r)},{f(r)} 0 0 1 {f(x + r)},{f(y)}Z")


def circle(cx, cy, r):
    return f"M{f(cx - r)},{f(cy)}A{f(r)},{f(r)} 0 1 0 {f(cx + r)},{f(cy)}A{f(r)},{f(r)} 0 1 0 {f(cx - r)},{f(cy)}Z"


def poly(*pts):
    return "M" + "L".join(f"{f(x)},{f(y)}" for x, y in pts) + "Z"


def scribble(x0, y, letters, amp=22):
    """라벨에 펜으로 휘갈겨 쓴 제목 같은 이어 쓴 글씨 (같은 그림이 나오게 무작위 없이).
    letters: "l"(위로 긴 고리) · "e"(작은 고리) · "n"(둥근 봉우리) · "u"(오목)"""
    d = f"M{f(x0)},{f(y + 6)}"
    x = x0
    for i, ch in enumerate(letters):
        yy = y + 3 * math.sin(i * 1.3)  # 줄이 살짝 출렁인다
        if ch == "l":
            w = 26
            d += (f"C{f(x + w * .9)},{f(yy - amp * .4)} {f(x + w * 1.1)},{f(yy - amp * 2.3)} {f(x + w * .55)},{f(yy - amp * 2.2)}"
                  f"C{f(x + w * .1)},{f(yy - amp * 2.1)} {f(x + w * .3)},{f(yy - amp * .4)} {f(x + w * .45)},{f(yy + 4)}"
                  f"C{f(x + w * .6)},{f(yy + 8)} {f(x + w * .85)},{f(yy + 6)} {f(x + w)},{f(yy)}")
        elif ch == "e":
            w = 22
            d += (f"C{f(x + w * .8)},{f(yy - amp * .2)} {f(x + w * .95)},{f(yy - amp * 1.05)} {f(x + w * .55)},{f(yy - amp)}"
                  f"C{f(x + w * .15)},{f(yy - amp * .95)} {f(x + w * .2)},{f(yy + 6)} {f(x + w * .6)},{f(yy + 6)}"
                  f"C{f(x + w * .8)},{f(yy + 6)} {f(x + w * .9)},{f(yy + 3)} {f(x + w)},{f(yy)}")
        elif ch == "n":
            w = 30
            d += (f"C{f(x + w * .1)},{f(yy - amp * 1.25)} {f(x + w * .45)},{f(yy - amp * 1.25)} {f(x + w * .5)},{f(yy + 4)}"
                  f"C{f(x + w * .55)},{f(yy - amp * 1.25)} {f(x + w * .9)},{f(yy - amp * 1.25)} {f(x + w)},{f(yy + 4)}")
        else:  # u
            w = 26
            d += (f"C{f(x + w * .05)},{f(yy + amp * .6)} {f(x + w * .5)},{f(yy + amp * .6)} {f(x + w * .55)},{f(yy - amp * .9)}"
                  f"C{f(x + w * .6)},{f(yy + amp * .5)} {f(x + w * .9)},{f(yy + amp * .3)} {f(x + w)},{f(yy - 2)}")
        x += w
    return d


# ───── 모양 (1024 좌표, 기울이기 전) ─────
BODY = (92, 232, 840, 560, 60)
LBL = (140, 278, 744, 352, 28)
WIN = (300, 404, 424, 140)
REEL_L, REEL_R, REEL_Y = 404, 620, 474
TRAP = [(262, 792), (304, 684), (720, 684), (762, 792)]


def hub(cx, cy, r, detail):
    """릴 가운데 흰 바퀴: 테두리 원 + 톱니 구멍 6개 + 가운데 구멍 (evenOdd로 뚫는다)"""
    d = circle(cx, cy, r)
    if detail:
        for i in range(6):
            a = math.radians(i * 60 + 30)
            d += circle(cx + math.cos(a) * r * .62, cy + math.sin(a) * r * .62, r * .17)
    d += circle(cx, cy, r * .3)
    return d


def shapes(detail=True):
    """[(경로, 채움색, 추가 속성)] 아래에서 위 순서"""
    x, y, w, h, r = BODY
    out = [
        (rrect(x, y, w, h, r), SHELL, {}),
        (poly(*TRAP), SHELL_DK, {}),
        (rrect(*LBL), LABEL, {}),
    ]
    lx, ly, lw, lh, _ = LBL
    # 라벨 아래쪽 세 줄 띠 (창 뒤로 지나간다)
    band = [(GOLD, 0), (ORANGE, 1), (RED, 2)]
    for color, i in band:
        out.append((rrect(lx, 446 + i * 24, lw, 24, 0), color, {}))
    if detail:
        out.append((scribble(198, 360, "lenleu"), None, {"stroke": INK, "width": 10}))
        out.append((scribble(400, 362, "nelul", amp=20), None, {"stroke": INK, "width": 10}))
        # 제목 밑에 그은 짧은 밑줄
        out.append(("M200,392C300,384 420,386 520,380", None, {"stroke": RED, "width": 7}))
    wx, wy, ww, wh = WIN
    out.append((rrect(wx, wy, ww, wh, wh / 2), WINDOW, {}))
    # 감긴 테이프: 왼쪽은 많이, 오른쪽은 조금 (재생 중인 테이프)
    out.append((circle(REEL_L, REEL_Y, 62), TAPE, {}))
    out.append((circle(REEL_R, REEL_Y, 40), TAPE, {}))
    out.append((hub(REEL_L, REEL_Y, 30, detail), HUB, {"evenodd": True}))
    out.append((hub(REEL_R, REEL_Y, 30, detail), HUB, {"evenodd": True}))
    if detail:
        # 나사 넷과 아래 구멍
        for sx, sy in [(124, 262), (900, 262), (124, 762), (900, 762)]:
            out.append((circle(sx, sy, 13), SHELL_DK, {}))
        for hx in (366, 658):
            out.append((circle(hx, 742, 17), WINDOW, {}))
        for hx in (458, 566):
            out.append((rrect(hx - 11, 731, 22, 22, 5), WINDOW, {}))
    return out


def silhouette():
    """한 색 그림 (테마 아이콘·알림 아이콘): 케이스에 창을 뚫고 그 안에 두 바퀴"""
    x, y, w, h, r = BODY
    wx, wy, ww, wh = WIN
    body = rrect(x, y, w, h, r) + rrect(wx, wy, ww, wh, wh / 2)
    for hx in (366, 658):
        body += circle(hx, 742, 20)
    hubs = circle(REEL_L, REEL_Y, 34) + circle(REEL_L, REEL_Y, 12) + circle(REEL_R, REEL_Y, 34) + circle(REEL_R, REEL_Y, 12)
    return body, hubs


# ───── SVG (PC .ico와 미리보기) ─────
def svg(detail=True, size=1024, shadow=True):
    els = []
    for d, fill, o in shapes(detail):
        if o.get("stroke"):
            els.append(f'<path d="{d}" fill="none" stroke="{o["stroke"]}" stroke-width="{o["width"]}" stroke-linecap="round" stroke-linejoin="round"/>')
        else:
            rule = ' fill-rule="evenodd"' if o.get("evenodd") else ""
            els.append(f'<path d="{d}" fill="{fill}"{rule}/>')
    x, y, w, h, r = BODY
    shade = (f'<path d="{rrect(x, y, w, h, r)}" fill="url(#gloss)"/>'
             f'<path d="{rrect(x + 3, y + 3, w - 6, h - 6, r - 3)}" fill="none" stroke="#C9B48C" stroke-width="6"/>')
    drop = (f'<g filter="url(#blur)" opacity=".55"><path d="{rrect(x + 16, y + 34, w - 32, h - 10, r)}" fill="#000"/></g>'
            if shadow else "")
    # 그림자 넣을 자리를 남기려고 테이프를 조금 줄여 가운데 둔다
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 1024 1024">
<defs>
<linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#7a5a2a" stop-opacity=".18"/></linearGradient>
<filter id="blur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="22"/></filter>
</defs>
<g transform="translate(512 512) scale({1.0 if detail else 1.08}) translate(-512 -512) rotate({TILT} 512 512)">
{drop}
{els[0]}{shade}{"".join(els[1:])}
</g>
</svg>'''


# ───── 안드로이드 벡터 ─────
def vector(paths, size_dp, viewport, scale, group_extra=""):
    t = viewport / 2 - 512 * scale
    body = []
    for d, fill, o in paths:
        if o.get("stroke"):
            body.append(f'            <path android:pathData="{d}" android:strokeColor="{o["stroke"]}" android:strokeWidth="{o["width"]}" android:strokeLineCap="round" android:strokeLineJoin="round" />')
        else:
            rule = ' android:fillType="evenOdd"' if o.get("evenodd") else ""
            body.append(f'            <path android:pathData="{d}" android:fillColor="{fill}"{rule} />')
    return f'''<?xml version="1.0" encoding="utf-8"?>
<!-- tools/icon/make_icons.py 가 만든 파일. 직접 고치지 말고 그 스크립트를 고쳐 다시 만든다 -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="{size_dp}dp" android:height="{size_dp}dp" android:viewportWidth="{viewport}" android:viewportHeight="{viewport}">
    <group android:translateX="{f(t)}" android:translateY="{f(t)}" android:scaleX="{scale}" android:scaleY="{scale}">
        <group android:rotation="{TILT}" android:pivotX="512" android:pivotY="512"{group_extra}>
{chr(10).join(body)}
        </group>
    </group>
</vector>
'''


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)


def android():
    # 적응형 아이콘: 108dp 중 가운데 66dp가 안전 영역 → 케이스 폭을 약 60dp로
    s = 0.068
    write(os.path.join(RES, "ic_launcher_foreground.xml"), vector(shapes(True), 108, 108, s))
    body, hubs = silhouette()
    mono = [(body, "#FFFFFFFF", {"evenodd": True}), (hubs, "#FFFFFFFF", {"evenodd": True})]
    write(os.path.join(RES, "ic_launcher_monochrome.xml"), vector(mono, 108, 108, s))
    write(os.path.join(RES, "ic_stat.xml"), vector(mono, 24, 24, 0.0235))
    write(os.path.join(RES, "ic_launcher_background.xml"), f'''<?xml version="1.0" encoding="utf-8"?>
<!-- tools/icon/make_icons.py 가 만든 파일 -->
<vector xmlns:android="http://schemas.android.com/apk/res/android" xmlns:aapt="http://schemas.android.com/aapt"
    android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">
    <path android:pathData="M0,0h108v108h-108z">
        <aapt:attr name="android:fillColor">
            <gradient android:type="radial" android:centerX="54" android:centerY="46" android:gradientRadius="76"
                android:startColor="{BG_IN}" android:endColor="{BG_OUT}" />
        </aapt:attr>
    </path>
</vector>
''')


def pc():
    from PIL import Image
    from playwright.sync_api import sync_playwright
    write(os.path.join(PC_ASSETS, "icon.svg"), svg(True))
    imgs = {}
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(device_scale_factor=1)
        for size in (256, 128, 64, 48, 40, 32, 24, 20, 16):
            detail = size > 32
            pg.set_viewport_size({"width": size, "height": size})
            pg.set_content(f'<html><body style="margin:0;background:transparent">{svg(detail, size, shadow=size >= 48)}</body></html>')
            imgs[size] = Image.open(io.BytesIO(pg.screenshot(omit_background=True))).convert("RGBA")
        pg.set_viewport_size({"width": 512, "height": 512})
        pg.set_content(f'<html><body style="margin:0;background:#0d0c0b">{svg(True, 512)}</body></html>')
        pg.screenshot(path=os.path.join(HERE, "preview.png"))
        b.close()
    order = sorted(imgs, reverse=True)
    imgs[order[0]].save(os.path.join(PC_ASSETS, "tape-box.ico"), format="ICO",
                        sizes=[(s, s) for s in order], append_images=[imgs[s] for s in order[1:]])


if __name__ == "__main__":
    android()
    pc()
    print("아이콘을 만들었어요")
