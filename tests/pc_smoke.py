"""PC 프로그램 시작 시험: 창 띄우기(pywebview)만 가짜로 바꿔 main()을 끝까지 돌린다.
창을 실제로 열 수 없는 CI에서도, 시작하자마자 죽는 오류(정의되지 않은 이름 등)를 잡는다.

    python tests/pc_smoke.py
"""
import importlib
import importlib.util
import os
import sys
import types

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pc"))

calls = []


class FakeWindow:
    def load_url(self, url): calls.append(("load_url", url))
    def evaluate_js(self, *a, **k): pass


wv = types.ModuleType("webview")
wv.create_window = lambda *a, **k: (calls.append(("create_window", a[0] if a else k.get("title"))), FakeWindow())[1]
wv.start = lambda *a, **k: calls.append(("start", sorted(k)))
sys.modules["webview"] = wv
if importlib.util.find_spec("psutil") is None:  # 네트워크 주소를 읽는 데만 쓴다. 없으면 빈 값으로
    ps = types.ModuleType("psutil")
    ps.net_if_addrs = lambda: {}
    ps.net_if_stats = lambda: {}
    sys.modules["psutil"] = ps


def run(args):
    sys.argv = ["tape_player.py"] + args
    sys.modules.pop("tape_player", None)
    calls.clear()
    tp = importlib.import_module("tape_player")
    tp.main()
    names = [c[0] for c in calls]
    assert "create_window" in names and "start" in names, f"창을 만들지 않았음: {calls}"
    print(f"  ok  {' '.join(args) or '(기본)'} → 창 제목 「{calls[0][1]}」")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    os.environ.setdefault("APPDATA", os.path.join(ROOT, ".pc_smoke_data"))  # CI(리눅스)에서 설정 폴더 자리
    run([])
    run(["--debug"])
    print("PC 프로그램 시작 시험 통과")
