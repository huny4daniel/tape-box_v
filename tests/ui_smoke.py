"""화면 시험: 폰 없이 가짜 데이터(tests/fake/mock.js)로 화면을 띄워, 주요 화면과 동작이 스크립트 오류 없이 되는지 본다.

    python tests/ui_smoke.py          (CI: 릴리즈 빌드 전에 돈다)

- 저장소의 index.html을 그대로 쓰되, api.js 뒤에 가짜 데이터를 끼워 넣은 시험용 페이지를 만들어 띄운다
- 소리는 소리 없는 짧은 음원으로 바꿔 재생도 실제처럼 흘러가게 한다
- 화면마다: 내용이 그려졌는지, 스크립트 오류(pageerror)가 없는지. 하나라도 어긋나면 종료 코드 1
"""
import os
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# api.js 뒤에 끼워 넣는다: 가짜 데이터로 API를 바꾸고, 소리는 소리 없는 음원으로
INJECT = """<script src="tests/fake/mock.js"></script>
<script>
(function () {
  // 소리 없는 20초 WAV (8kHz 8bit 모노)
  const sec = 20, rate = 8000, n = sec * rate, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + n, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, "data"); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  const url = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  Object.assign(window.API, window.MOCK_API, { streamUrl: () => url });
})();
</script>
"""


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path.split("?")[0] == "/__test__.html":
            with open(os.path.join(ROOT, "index.html"), encoding="utf-8") as f:
                html = f.read()
            anchor = '<script src="js/api.js"></script>'
            assert anchor in html, "index.html에서 api.js를 찾지 못함"
            body = html.replace(anchor, anchor + "\n" + INJECT, 1).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()


def launch(p):
    args = ["--autoplay-policy=no-user-gesture-required"]
    try:
        return p.chromium.launch(args=args)
    except Exception:  # 로컬에서 playwright 브라우저를 안 받았으면 설치된 크롬으로
        return p.chromium.launch(channel="chrome", args=args)


def main():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}/__test__.html"
    fails = []

    with sync_playwright() as p:
        browser = launch(p)
        for label, vp, mobile in (("PC", {"width": 1280, "height": 800}, False), ("폰", {"width": 390, "height": 844}, True)):
            pg = browser.new_page(viewport=vp, has_touch=mobile)
            errors = []
            pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.goto(base)
            pg.evaluate("localStorage.clear()")
            pg.reload()
            pg.wait_for_selector("#view .page", timeout=15000)

            def check(name, ok, detail=""):
                if errors:
                    fails.append(f"[{label}] {name}: 스크립트 오류 {errors[:2]}")
                    errors.clear()
                elif not ok:
                    fails.append(f"[{label}] {name}: {detail or '기대한 화면이 아님'}")
                else:
                    print(f"  ok  [{label}] {name}")

            ids = pg.evaluate("API.library().then(l => ({ al: l.tracks[0].albumKey, ar: l.tracks[0].artist, t: l.tracks[0].id, yr: Math.floor((l.tracks.find(t => t.year) || {year: 1990}).year / 10) * 10 }))")
            routes = [
                ("홈", "#/"), ("검색", "#/search"), ("곡 목록", "#/collection"), ("나의 테이프", "#/playlists"),
                ("앨범", "#/albums"), ("아티스트", "#/artists"), ("라이브러리", "#/library"), ("설정", "#/settings"),
                ("아끼는 곡", "#/liked"), ("테이프", "#/playlist/p1"), ("상자", "#/box/b1"), ("시스템 상자", "#/box/sys"),
                ("히스토리 상자", "#/box/hist"), ("시스템 테이프", "#/playlist/top"), ("최근 들은 테이프", "#/recent-tapes"),
                ("앨범 상세", "#/album/" + ids["al"]), ("아티스트 상세", "#/artist/" + ids["ar"]), ("아티스트 앨범", "#/artist-albums/" + ids["ar"]),
                ("곡 상세", "#/track/" + ids["t"]), ("시대별", f"#/year/{ids['yr']}"),
            ]
            for name, hsh in routes:
                pg.evaluate("h => { location.hash = h.replace(/^(#\\/[^/]+\\/)(.+)$/, (m, a, b) => a + encodeURIComponent(b)); }", hsh)
                pg.wait_for_timeout(250)
                n = pg.evaluate("document.querySelector('#view .page')?.innerText.trim().length || 0")
                check(name, n > 0, "화면이 비어 있음")

            # 동작: 검색, 테이프 재생 → 재생 화면, 곡 메뉴, 테이프 담기 창, 상자에 넣을 테이프 창
            pg.evaluate("location.hash = '#/search'"); pg.wait_for_timeout(200)
            pg.fill("#q", "비"); pg.wait_for_timeout(400)
            check("검색 결과", pg.locator("#search-res .section").count() > 0, "검색 결과가 없음")
            pg.evaluate("location.hash = '#/playlist/p1'"); pg.wait_for_timeout(300)
            pg.click('.actions [data-act="list-play"]'); pg.wait_for_timeout(800)
            check("재생 → 재생 화면", pg.evaluate("!document.querySelector('#fullplayer').hidden && !!document.querySelector('#fullplayer .np-tape-wrap .tape')"), "재생 화면이 안 열림")
            pg.evaluate("document.querySelector('[data-act=close-full]')?.click()"); pg.wait_for_timeout(200)
            pg.click('.tracklist[data-list="playlist"] .row >> nth=0', button="right"); pg.wait_for_timeout(200)
            check("곡 메뉴", pg.locator("#menu .menu-box button").count() > 3, "메뉴가 안 열림")
            if pg.locator('#menu [data-m="addpl"]').count():
                pg.click('#menu [data-m="addpl"]'); pg.wait_for_timeout(300)
                check("테이프에 담기 창", pg.locator("#modal .pick-tape").count() > 0, "창이 비어 있음")
                pg.evaluate("document.querySelector('#modal [data-close]')?.click()")
            pg.evaluate("location.hash = '#/box/b1'"); pg.wait_for_timeout(300)
            pg.click(".tape-grid .tape-new"); pg.wait_for_timeout(300)
            check("상자에 넣을 테이프 창", pg.locator("#modal .pick-search").count() == 1, "창이 안 열림")
            pg.close()
        browser.close()
    srv.shutdown()

    if fails:
        print("\n화면 시험 실패:")
        for f in fails:
            print("  ✗", f)
        sys.exit(1)
    print("\n화면 시험 통과")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
