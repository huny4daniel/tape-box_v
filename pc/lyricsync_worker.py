"""싱크 가사 생성기 — PC 프로그램이 설치한 별도 Python 환경에서 돈다.

가사는 있지만 시간 정보가 없는 곡의 음원에서 보컬을 분리한 뒤 Whisper로 가사 각 줄의 시작 시각을 맞춰 LRC로 만든다.
가사 텍스트는 파일에 있던 것을 그대로 쓰고 시간만 붙인다. 원본 파일은 바꾸지 않는다.

두 가지 방식이 있다.
  folder: PC 폴더의 음원 파일을 직접 읽는다. 폰이 필요 없고, 만든 LRC는 made/에 모아 두었다가
          PC 프로그램의 「폰에 보내기」(lyricsync.py)가 폰 DB에 넣는다.
  phone:  폰 앱에서 곡을 하나씩 받아 와 만들고 바로 폰에 저장한다.

진행 상황은 한 줄에 JSON 하나씩 표준 출력으로 알린다.
  python lyricsync_worker.py --home DIR --prepare
  python lyricsync_worker.py --home DIR --folder MUSIC_DIR
  python lyricsync_worker.py --home DIR --server URL --token TOKEN
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
FIX_RUN = 3          # 연달아 몰린 줄이 이 이하면 앞뒤 줄 사이로 나눠 넣는다
FIX_STEP = (0.8, 6.0)  # 나눠 넣을 때 한 줄 간격(초)이 이 범위를 벗어나면 고치지 않는다
FIX_RATIO = 0.1      # 고치지 못한 줄이 이 비율을 넘으면 확인 필요
WAIT_PHONE = 30 * 60  # 폰 연결이 끊겼을 때 다시 붙기를 기다리는 최대 시간(초)
AUDIO_EXT = (".mp3", ".flac", ".m4a", ".mp4", ".aac", ".ogg", ".oga", ".opus", ".wav")
MADE = ("done", "check", "kept", "restored")  # 만든 가사가 있는 상태
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


def made_path(home, key):
    return os.path.join(home, "made", hashlib.sha1(key.encode("utf-8")).hexdigest()[:20] + ".lrc")


def track_key(title, artist, album, seconds):
    """폰 앱(Library.keyOf)과 같은 곡 키: 제목·아티스트·앨범·길이(초)"""
    raw = "\u0001".join([title.lower(), artist.lower(), album.lower(), str(int(seconds + 0.5))])
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


# ───── 가사 글 ─────
def is_lrc(text):
    import re
    lines = [l.strip().lstrip("﻿") for l in text.replace("\r", "").split("\n") if l.strip()]
    if not lines:
        return False
    timed = sum(1 for l in lines if re.match(r"^\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]", l))
    return timed > 0 and timed >= len(lines) // 2


def read_file(path):
    """음원 파일의 곡 정보와 가사. 폰(MediaStore)처럼 제목이 없으면 파일 이름, 앨범이 없으면 폴더 이름을 쓴다"""
    import mutagen
    f = mutagen.File(path)
    if f is None or not getattr(f, "info", None) or not getattr(f.info, "length", 0):
        return None
    easy = None
    try:
        easy = mutagen.File(path, easy=True)
    except Exception:
        pass

    def tag(k):
        try:
            v = easy.tags.get(k) if easy is not None and easy.tags is not None else None
        except Exception:
            v = None
        return (v[0] if v else "").strip()

    title = tag("title") or os.path.splitext(os.path.basename(path))[0]
    artist = tag("artist")
    if artist.lower() == "<unknown>":
        artist = ""
    album = tag("album") or os.path.basename(os.path.dirname(path))

    synced, texts = False, []
    tags = f.tags
    if tags is not None:
        try:
            from mutagen.id3 import ID3
            if isinstance(tags, ID3):
                synced = any(fr.text for fr in tags.getall("SYLT"))
                texts = [fr.text for fr in tags.getall("USLT") if fr.text]
            else:
                for k in ("LYRICS", "UNSYNCEDLYRICS", "lyrics", "unsyncedlyrics", "\xa9lyr"):
                    v = tags.get(k)
                    if v:
                        texts += [str(x) for x in (v if isinstance(v, list) else [v])]
        except Exception:
            pass
    if any(is_lrc(t) for t in texts):
        synced = True
    plain = max(texts, key=len) if texts else ""
    return {"title": title, "artist": artist, "album": album, "seconds": f.info.length,
            "synced": synced, "plain": plain}


# ───── 정렬 ─────
def fmt(t):
    t = max(0.0, t)
    m = int(t // 60)
    return f"[{m:02d}:{t - m * 60:05.2f}]"


def song_language(text, default):
    """가사 글자로 곡 언어를 정한다. 한글이 조금이라도 비중 있게 섞이면 기본 언어(한국어)로 둔다"""
    hangul = sum(1 for c in text if "가" <= c <= "힣")
    kana = sum(1 for c in text if "぀" <= c <= "ヿ")
    han = sum(1 for c in text if "一" <= c <= "鿿")
    latin = sum(1 for c in text if c.isascii() and c.isalpha()) / 3  # 영문은 대략 세 글자가 한 음절
    total = hangul + kana + han + latin
    if not total or hangul / total >= 0.2:
        return default
    if kana and (kana + han) >= latin:
        return "ja"
    if han > latin:
        return "zh"
    return "en" if latin else default


def settle(lines):
    """[시작, 끝, 글] 목록에서 앞 줄과 한 시점에 몰린 줄을 고친다.
    몇 줄만 몰렸고 다음 줄까지 간격이 자연스러우면 그 사이에 고르게 나눠 넣고,
    고칠 수 없는 줄 수를 함께 돌려준다"""
    n = len(lines)
    bad, i = 0, 1
    while i < n:
        if lines[i][0] - lines[i - 1][0] >= STACK_GAP:
            i += 1
            continue
        j = i
        while j < n and lines[j][0] - lines[j - 1][0] < STACK_GAP:
            j += 1
        run = j - i
        a = lines[i - 1][0]
        if j < n and run <= FIX_RUN:
            step = (lines[j][0] - a) / (run + 1)
            if FIX_STEP[0] <= step <= FIX_STEP[1]:
                lines[i - 1][1] = min(lines[i - 1][1], a + step)
                for k in range(run):
                    st = a + step * (k + 1)
                    lines[i + k][0], lines[i + k][1] = st, st + step
                i = j
                continue
        bad += run
        i = j
    return bad


def build_lrc(lines):
    out = []
    for i, (st, en, text) in enumerate(lines):
        out.append(fmt(st) + text)
        nxt = lines[i + 1][0] if i + 1 < len(lines) else None
        if nxt is None or nxt - en >= GAP_BLANK:
            out.append(fmt(en + 0.3))
    return "\n".join(out)


def judge(lines, issues):
    bad = settle(lines)
    if bad and bad / len(lines) > FIX_RATIO or bad > FIX_RUN:
        issues.append(f"{bad}줄이 앞 줄과 같은 시점에 몰림")
    return build_lrc(lines), sorted(set(issues))


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
        m = str(w.message)
        # 줄 몇 개가 비어 버린 경고는 아래에서 몰린 줄로 따로 다룬다. 뒤쪽을 통째로 놓친 경우만 문제로 본다
        if m.startswith("Failed to align the last") or m.startswith("Alignment aborted"):
            issues.append("뒷부분을 정렬하지 못함")
    if len(segs) != len(lines):
        issues.append(f"줄 수가 달라짐 ({len(lines)} → {len(segs)})")
    return judge([[s.start, s.end, s.text.strip()] for s in segs], issues)


def rejudge(path):
    """예전에 만든 LRC를 지금 기준으로 다시 판정한다. (LRC, 남은 문제) — 읽을 수 없으면 None"""
    import re
    rows = []
    try:
        with open(path, encoding="utf-8") as f:
            for ln in f:
                m = re.match(r"\[(\d+):(\d+(?:\.\d+)?)\](.*)", ln.strip())
                if m:
                    rows.append((int(m.group(1)) * 60 + float(m.group(2)), m.group(3).strip()))
    except OSError:
        return None
    lines = []
    for k, (st, text) in enumerate(rows):
        if not text:
            continue
        en = rows[k + 1][0] if k + 1 < len(rows) else st
        if k + 1 < len(rows) and not rows[k + 1][1]:
            en -= 0.3  # 빈 줄은 줄 끝 + 0.3초에 넣었다
        lines.append([st, max(st, en), text])
    if not lines:
        return None
    if lines[-1][0] - lines[0][0] < STACK_GAP * len(lines) / 2:
        return build_lrc(lines), ["정렬 결과가 없음"]
    return judge(lines, [])


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


# ───── 결과 기록 ─────
def last_results(path):
    """results.jsonl에서 곡마다 마지막 기록"""
    last = {}
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                try:
                    o = json.loads(line)
                    last[o["id"]] = o
                except Exception:
                    pass
    except FileNotFoundError:
        pass
    return last


class Run:
    """한 번의 실행: 모델은 처음 필요할 때 불러오고, 결과는 results.jsonl에 덧붙인다"""

    def __init__(self, home, model_name, language, mode):
        self.home, self.model_name, self.language, self.mode = home, model_name, language, mode
        os.makedirs(os.path.join(home, "made"), exist_ok=True)
        os.makedirs(os.path.join(home, "tmp"), exist_ok=True)
        self.results_path = os.path.join(home, "results.jsonl")
        self.last = last_results(self.results_path)
        self.model = None

    def record(self, **o):
        o["at"] = int(time.time())
        o["mode"] = self.mode
        with open(self.results_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(o, ensure_ascii=False) + "\n")

    def prev(self, key):
        return (self.last.get(key) or {}).get("status")

    def skip(self, reason, info, quiet=False):
        emit(type="track", status="skip", reason=reason, **info)
        p = self.last.get(info["id"]) or {}
        if not quiet and (p.get("status") != "skip" or p.get("reason") != reason):  # 바뀐 것만 남겨 기록이 불어나지 않게
            self.record(status="skip", reason=reason, **info)

    def make(self, audio, plain, info):
        """정렬해서 made/에 저장. 성공하면 LRC, 실패하면 None"""
        if self.model is None:
            emit(type="step", text="모델을 불러오는 중…")
            self.model, device = load_model(self.home, self.model_name)
            emit(type="ready", device=device)
        emit(type="working", **info)
        started = time.time()
        lang = song_language(plain, self.language)
        info = dict(info, lang=lang)
        lrc, issues = align(self.model, audio, plain, lang)
        if lrc is None:
            emit(type="track", status="fail", reason=", ".join(issues), **info)
            self.record(status="fail", reason=", ".join(issues), **info)
            return None
        with open(made_path(self.home, info["id"]), "w", encoding="utf-8") as f:
            f.write(lrc)
        status = "check" if issues else "done"
        emit(type="track", status=status, reason=", ".join(issues), secs=round(time.time() - started, 1), **info)
        self.record(status=status, reason=", ".join(issues), **info)
        return lrc


    def recheck(self, audio, plain, info):
        """만든 곡(만듦·확인 필요)을 다시 본다. 다른 언어 곡을 한국어로 정렬했던 것이면 다시 정렬하고,
        확인 필요 곡은 만든 LRC를 지금 기준으로 다시 판정해 고칠 수 있으면 고친다.
        직접 지키기로 정한 곡은 여기 오지 않는다"""
        p = self.last.get(info["id"]) or {}
        lang = song_language(plain, self.language)
        if p.get("lang", self.language) != lang:
            return self.make(audio, plain, info)
        if p.get("status") != "check":
            emit(type="track", status="skip", reason="이미 만든 곡", **info)
            return None
        path = made_path(self.home, info["id"])
        got = rejudge(path)
        if got is None:
            return self.make(audio, plain, info)
        lrc, issues = got
        reason = ", ".join(issues)
        info = dict(info, lang=lang)
        if issues:
            emit(type="track", status="skip", reason="이미 만든 곡", **info)
            if reason != p.get("reason"):
                self.record(status="check", reason=reason, **info)
            return None
        with open(path, "w", encoding="utf-8") as f:
            f.write(lrc)
        emit(type="track", status="done", reason="", **info)
        self.record(status="done", reason="", **info)
        return lrc


# ───── PC 폴더 방식 ─────
def run_folder(home, folder, model_name, language):
    run = Run(home, model_name, language, "folder")
    ensure_ffmpeg(home)
    emit(type="step", text="음원 파일을 찾는 중…")
    files = []
    for dp, _, names in os.walk(folder):
        for n in names:
            if n.lower().endswith(AUDIO_EXT):
                files.append(os.path.join(dp, n))
    files.sort()
    if not files:
        emit(type="fatal", text="고른 폴더에서 음원 파일을 찾지 못했어요")
        return 2
    emit(type="start", total=len(files))
    seen = set()
    for i, path in enumerate(files, 1):
        rel = os.path.relpath(path, folder)
        info = dict(i=i, id="", title=os.path.basename(path), artist="", path=rel)
        try:
            meta = read_file(path)
            if meta is None:
                emit(type="track", status="skip", reason="읽을 수 없는 파일", **info)
                continue
            key = track_key(meta["title"], meta["artist"], meta["album"], meta["seconds"])
            info.update(id=key, title=meta["title"], artist=meta["artist"], album=meta["album"],
                        seconds=round(meta["seconds"], 2))
            if key in seen:  # 같은 곡이 두 번 들어 있으면 하나만 (폰도 그렇게 센다)
                emit(type="track", status="skip", reason="같은 곡이 이미 있음", **info)
                continue
            seen.add(key)
            prev = run.prev(key)
            if meta["synced"]:
                run.skip("파일에 이미 시간 가사가 있음", info)
            elif prev == "rejected":  # 결과가 틀려서 되돌린 곡은 다시 만들지 않는다
                emit(type="track", status="skip", reason="되돌린 곡", **info)
            elif prev in ("check", "done") and os.path.exists(made_path(home, key)) and meta["plain"].strip():
                run.recheck(path, meta["plain"], info)
            elif prev in MADE and os.path.exists(made_path(home, key)):
                emit(type="track", status="skip", reason="이미 만든 곡", **info)
            elif not meta["plain"].strip():
                run.skip("가사가 없음", info)
            else:
                run.make(path, meta["plain"], info)
        except Exception as e:
            emit(type="track", status="fail", reason=str(e)[:200], **info)
            if info["id"]:
                run.record(status="fail", reason=str(e)[:200], **info)
    emit(type="end")
    return 0


# ───── 폰 방식 ─────
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
        started, attempt, waiting = time.time(), 0, False
        while True:  # 폰 화면이 꺼지거나 와이파이가 잠깐 끊겨도 다시 붙을 때까지 기다린다
            try:
                r = urllib.request.urlopen(req, timeout=timeout)
                if waiting:
                    emit(type="step", text="")
                return r
            except urllib.error.HTTPError as e:
                if e.code in (400, 401, 403, 404):
                    raise
                last = e
            except Exception as e:
                last = e
            attempt += 1
            if time.time() - started > WAIT_PHONE:
                raise ConnectionError(f"폰에 연결할 수 없어요 ({last})")
            if attempt >= 3 and not waiting:
                waiting = True
                emit(type="step", text="폰 연결이 끊겼어요. 다시 연결되길 기다리는 중… (폰 화면을 켜 두면 빨리 붙어요)")
            time.sleep(min(10, 2 + attempt * 2))

    def json(self, method, path, body=None):
        with self._open(method, path, body) as r:
            return json.loads(r.read().decode("utf-8"))

    def download(self, path, dest):
        """받다가 끊겨 파일이 잘리면 잘린 음원으로 정렬하지 않도록 크기를 확인하고 다시 받는다"""
        for _ in range(5):
            with self._open("GET", path, timeout=120) as r:
                want = int(r.headers.get("Content-Length") or 0)
                got = 0
                try:
                    with open(dest, "wb") as f:
                        while True:
                            b = r.read(1 << 16)
                            if not b:
                                break
                            f.write(b)
                            got += len(b)
                except Exception:
                    got = -1
            if got > 0 and (not want or got == want):
                return
            time.sleep(3)
        raise ConnectionError("음원을 끝까지 받지 못했어요")


def q(s):
    return urllib.parse.quote(s, safe="")


def run_phone(home, server, token, model_name, language):
    run = Run(home, model_name, language, "phone")
    phone = Phone(server, token)
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
    for i, t in enumerate(tracks, 1):
        tid = t["id"]
        info = dict(i=i, id=tid, title=t.get("title") or "", artist=t.get("artist") or "", phoneId=tid)
        saved = made_path(home, tid)
        prev = run.prev(tid)
        try:
            lyr = phone.json("GET", "/api/lyrics/" + q(tid))
            if lyr.get("synced"):
                if lyr.get("source") == "file":
                    run.skip("파일에 이미 시간 가사가 있음", info)
                else:  # 이 생성기가 만든 가사. 기록(만듦·확인 필요 등)은 그대로 둔다
                    emit(type="track", status="skip", reason="이미 만든 곡", **info)
                    if prev is None or prev == "skip":
                        run.record(status="done", reason="", **info)
                continue
            if prev == "rejected":
                emit(type="track", status="skip", reason="되돌린 곡", **info)
                continue
            # 전에 만든 적 있으면 다시 만들지 않고 그대로 보낸다 (폰 앱 데이터가 지워진 경우)
            if os.path.exists(saved):
                with open(saved, encoding="utf-8") as f:
                    phone.json("PUT", "/api/lyrics/" + q(tid), {"lrc": f.read(), "source": "aligned"})
                emit(type="track", status="restored", **info)
                if prev not in MADE:
                    run.record(status="restored", reason="", **info)
                continue
            plain = lyr.get("plain")
            if not plain or not plain.strip():
                run.skip("가사가 없음", info)
                continue
            audio = os.path.join(home, "tmp", "current.audio")
            phone.download("/api/stream/" + q(tid), audio)
            lrc = run.make(audio, plain, info)
            if lrc is not None:
                phone.json("PUT", "/api/lyrics/" + q(tid), {"lrc": lrc, "source": "aligned"})
        except ConnectionError as e:
            emit(type="fatal", text=str(e))
            return 2
        except urllib.error.HTTPError as e:
            if e.code == 401:
                emit(type="fatal", text=REFUSED)
                return 2
            emit(type="track", status="fail", reason=f"폰 응답 {e.code}", **info)
            run.record(status="fail", reason=f"폰 응답 {e.code}", **info)
        except Exception as e:
            emit(type="track", status="fail", reason=str(e)[:200], **info)
            run.record(status="fail", reason=str(e)[:200], **info)
    emit(type="end")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--home", required=True)
    ap.add_argument("--prepare", action="store_true")
    ap.add_argument("--folder")
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
        if a.folder:
            return run_folder(a.home, a.folder, a.model, a.language)
        return run_phone(a.home, a.server, a.token, a.model, a.language)
    except Exception as e:
        emit(type="fatal", text=str(e)[:300])
        return 1


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
