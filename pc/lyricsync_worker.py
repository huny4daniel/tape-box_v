"""싱크 가사 생성기 — PC 프로그램이 설치한 별도 Python 환경에서 돈다.

폰 앱에서 가사는 있지만 시간 정보가 없는 곡을 골라 음원을 받아 오고,
보컬을 분리한 뒤 Whisper로 가사 각 줄의 시작 시각을 맞춰 LRC로 만들어 폰에 저장한다.
가사 텍스트는 파일에 있던 것을 그대로 쓰고 시간만 붙인다. 원본 파일은 바꾸지 않는다.

진행 상황은 한 줄에 JSON 하나씩 표준 출력으로 알린다.
  python lyricsync_worker.py --home DIR --prepare                         # 모델 미리 받기
  python lyricsync_worker.py --home DIR --server URL --token TOKEN        # 생성
"""
import argparse
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import warnings

GAP_BLANK = 4.0      # 줄 사이가 이만큼(초) 비면 간주 표시용 빈 줄을 넣는다
STACK_GAP = 0.2      # 앞 줄과 시작이 이보다 가까우면 한 시점에 몰린 것으로 본다
REFUSED = "폰이 연결을 거부했어요. PC 프로그램에서 PIN으로 다시 연결해 주세요."


def emit(**o):
    print(json.dumps(o, ensure_ascii=False), flush=True)


def setup_env(home):
    # 모델과 캐시를 모두 설치 폴더 안에 둔다 (C 드라이브를 쓰지 않도록)
    os.environ["TORCH_HOME"] = os.path.join(home, "models", "torch")
    os.environ["HF_HOME"] = os.path.join(home, "models", "hf")
    os.environ["XDG_CACHE_HOME"] = os.path.join(home, "models", "cache")
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    # 음원을 읽는 데 ffmpeg가 필요하다. PC에 없어도 되도록 설치 폴더의 것을 먼저 쓴다
    os.environ["PATH"] = os.path.join(home, "bin") + os.pathsep + os.environ.get("PATH", "")


def ensure_ffmpeg(home):
    import shutil
    dest = os.path.join(home, "bin", "ffmpeg.exe")
    if os.path.exists(dest):
        return
    import imageio_ffmpeg
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    shutil.copy2(imageio_ffmpeg.get_ffmpeg_exe(), dest)


def whisper_root(home):
    return os.path.join(home, "models", "whisper")


# ───── 폰 앱과 이야기하기 ─────
class Phone:
    def __init__(self, server, token):
        self.server = server.rstrip("/")
        self.headers = {"Cookie": "mc_token=" + token}

    def _open(self, method, path, body=None, timeout=30):
        data = None
        headers = dict(self.headers)
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(self.server + path, data=data, method=method, headers=headers)
        last = None
        for attempt in range(4):  # 와이파이가 잠깐 끊기는 정도는 기다렸다 다시 한다
            try:
                return urllib.request.urlopen(req, timeout=timeout)
            except urllib.error.HTTPError as e:
                if e.code in (400, 401, 403, 404):
                    raise
                last = e
            except Exception as e:
                last = e
            time.sleep(2 + attempt * 3)
        raise ConnectionError(f"폰에 연결할 수 없어요 ({last})")

    def json(self, method, path, body=None):
        with self._open(method, path, body) as r:
            return json.loads(r.read().decode("utf-8"))

    def download(self, path, dest):
        with self._open("GET", path, timeout=120) as r, open(dest, "wb") as f:
            while True:
                b = r.read(1 << 16)
                if not b:
                    break
                f.write(b)


def q(s):
    return urllib.parse.quote(s, safe="")


# ───── 정렬 ─────
def fmt(t):
    t = max(0.0, t)
    m = int(t // 60)
    return f"[{m:02d}:{t - m * 60:05.2f}]"


def align(model, audio, text, language):
    lines = [l.strip() for l in text.replace("\r\n", "\n").replace("\r", "\n").split("\n") if l.strip()]
    if not lines:
        return None, ["가사가 비어 있음"]
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        result = model.align(audio, "\n".join(lines), language=language, original_split=True,
                             denoiser="demucs", vad=True, verbose=None)
    segs = [s for s in result.segments if s.text.strip()]
    if not segs:
        return None, ["정렬 결과가 없음"]

    issues = []
    for w in caught:
        msg = str(w.message)
        if "failed to align" in msg:
            issues.append("정렬하지 못한 줄이 있음")
    if len(segs) != len(lines):
        issues.append(f"줄 수가 달라짐 ({len(lines)} → {len(segs)})")
    stacked = sum(1 for a, b in zip(segs, segs[1:]) if b.start - a.start < STACK_GAP)
    if stacked:
        issues.append(f"{stacked}줄이 앞 줄과 같은 시점에 몰림")

    out = []
    for i, s in enumerate(segs):
        out.append(fmt(s.start) + s.text.strip())
        nxt = segs[i + 1].start if i + 1 < len(segs) else None
        if nxt is None or nxt - s.end >= GAP_BLANK:
            out.append(fmt(s.end + 0.3))
    return "\n".join(out), sorted(set(issues))


def load_model(home, name):
    import stable_whisper
    import torch
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = stable_whisper.load_model(name, device=device, download_root=whisper_root(home))
    return model, device


def prepare(home, model_name):
    ensure_ffmpeg(home)
    emit(type="step", text="음성 인식 모델을 받는 중… (1.5GB 정도)")
    model, device = load_model(home, model_name)
    del model
    emit(type="step", text="보컬 분리 모델을 받는 중…")
    from demucs.pretrained import get_model
    get_model("htdemucs")
    emit(type="step", text="음성 구간 감지 모델을 받는 중…")
    import torch
    torch.hub.load(repo_or_dir="snakers4/silero-vad", model="silero_vad", trust_repo=True, verbose=False)
    emit(type="prepared", device=device)


# ───── 생성 ─────
def run(home, server, token, model_name, language):
    phone = Phone(server, token)
    made_dir = os.path.join(home, "made")
    tmp_dir = os.path.join(home, "tmp")
    os.makedirs(made_dir, exist_ok=True)
    os.makedirs(tmp_dir, exist_ok=True)
    results_path = os.path.join(home, "results.jsonl")

    def record(**o):
        o["at"] = int(time.time())
        with open(results_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(o, ensure_ascii=False) + "\n")

    ensure_ffmpeg(home)
    try:
        lib = phone.json("GET", "/api/library")
    except urllib.error.HTTPError as e:
        emit(type="fatal", text=REFUSED if e.code == 401 else f"폰에서 곡 목록을 받지 못했어요 (응답 {e.code})")
        return 2
    except ConnectionError as e:
        emit(type="fatal", text=str(e))
        return 2
    tracks = lib.get("tracks", [])
    emit(type="start", total=len(tracks))

    model = device = None
    for i, t in enumerate(tracks, 1):
        tid = t["id"]
        info = dict(i=i, id=tid, title=t.get("title") or "", artist=t.get("artist") or "")
        saved = os.path.join(made_dir, hashlib.sha1(tid.encode("utf-8")).hexdigest()[:20] + ".lrc")
        try:
            lyr = phone.json("GET", "/api/lyrics/" + q(tid))
            if lyr.get("synced"):
                emit(type="track", status="skip", reason="이미 시간 가사가 있음", **info)
                continue
            # 전에 만든 적 있으면 다시 만들지 않고 그대로 보낸다 (폰 앱 데이터가 지워진 경우)
            if os.path.exists(saved):
                with open(saved, encoding="utf-8") as f:
                    phone.json("PUT", "/api/lyrics/" + q(tid), {"lrc": f.read(), "source": "aligned"})
                emit(type="track", status="restored", **info)
                continue
            plain = lyr.get("plain")
            if not plain or not plain.strip():
                emit(type="track", status="skip", reason="가사가 없음", **info)
                continue

            if model is None:
                emit(type="step", text="모델을 불러오는 중…")
                model, device = load_model(home, model_name)
                emit(type="ready", device=device)
            emit(type="working", **info)
            audio = os.path.join(tmp_dir, "current.audio")
            phone.download("/api/stream/" + q(tid), audio)
            started = time.time()
            lrc, issues = align(model, audio, plain, language)
            if lrc is None:
                emit(type="track", status="fail", reason=", ".join(issues), **info)
                record(status="fail", reason=", ".join(issues), **info)
                continue
            with open(saved, "w", encoding="utf-8") as f:
                f.write(lrc)
            phone.json("PUT", "/api/lyrics/" + q(tid), {"lrc": lrc, "source": "aligned"})
            status = "check" if issues else "done"
            emit(type="track", status=status, reason=", ".join(issues), secs=round(time.time() - started, 1), **info)
            record(status=status, reason=", ".join(issues), **info)
        except ConnectionError as e:
            emit(type="fatal", text=str(e))
            return 2
        except urllib.error.HTTPError as e:
            if e.code == 401:
                emit(type="fatal", text=REFUSED)
                return 2
            emit(type="track", status="fail", reason=f"폰 응답 {e.code}", **info)
            record(status="fail", reason=f"폰 응답 {e.code}", **info)
        except Exception as e:
            emit(type="track", status="fail", reason=str(e)[:200], **info)
            record(status="fail", reason=str(e)[:200], **info)
    emit(type="end")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--home", required=True)
    ap.add_argument("--prepare", action="store_true")
    ap.add_argument("--server")
    ap.add_argument("--token")
    ap.add_argument("--model", default="medium")
    ap.add_argument("--language", default="ko")
    a = ap.parse_args()
    setup_env(a.home)
    try:
        if a.prepare:
            prepare(a.home, a.model)
            return 0
        return run(a.home, a.server, a.token, a.model, a.language)
    except Exception as e:
        emit(type="fatal", text=str(e)[:300])
        return 1


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
