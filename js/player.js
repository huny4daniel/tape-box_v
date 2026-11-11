// 재생기. 대기열·셔플은 여기서 관리하고, 실제 소리는 엔진이 낸다.
//  - WebEngine: PC 브라우저 (폰에서 파일을 실시간으로 받아 <audio>로 재생)
//  - NativeEngine: 폰 앱 안 (Media3 재생 서비스, 화면이 꺼져도 다음 곡으로 넘어감)
//  - SimEngine: dev.html용 가짜 재생 (소리 없이 시간만 흐름)
(function () {
  "use strict";

  // 한 번 들은 것으로 치는 기준: 30초 또는 곡 길이의 절반 중 짧은 쪽
  const countThreshold = (dur) => Math.min(30000, Math.max(5000, (dur || 0) * 0.5));

  class Emitter {
    constructor() { this._h = {}; }
    on(ev, fn) { (this._h[ev] = this._h[ev] || []).push(fn); return () => this.off(ev, fn); }
    off(ev, fn) { this._h[ev] = (this._h[ev] || []).filter((f) => f !== fn); }
    emit(ev, a) { (this._h[ev] || []).forEach((f) => { try { f(a); } catch (e) { console.error(e); } }); }
  }

  // ───── 브라우저 쪽 엔진의 공통 부분 (대기열 진행, 들은 시간 기록) ─────
  class QueueEngine extends Emitter {
    constructor(getTrack) {
      super();
      this.getTrack = getTrack;
      this.queue = []; this.index = -1; this.repeat = "off";
      this.playing = false; this.pos = 0; this.dur = 0;
      this._lis = null;
    }
    get currentId() { return this.queue[this.index]; }
    load(queue, index, pos, autoplay) {
      this._finishListen();
      this.queue = queue.slice(); this.index = index;
      this._open(pos || 0, autoplay !== false);
    }
    sync(queue, index) { this.queue = queue.slice(); this.index = index; }
    jump(i) { if (i < 0 || i >= this.queue.length) return; this._finishListen(); this.index = i; this._open(0, true); }
    next(auto) {
      if (!this.queue.length) return;
      if (auto && this.repeat === "one") { this._finishListen(); this._open(0, true); return; }
      let i = this.index + 1;
      if (i >= this.queue.length) {
        if (this.repeat === "all") i = 0;
        else { this._finishListen(); this.pause(); this.seek(0); this._state(); return; }
      }
      this.jump(i);
    }
    prev() {
      if (this.pos > 3000 || this.index <= 0) { this.seek(0); return; }
      this.jump(this.index - 1);
    }
    setRepeat(m) { this.repeat = m; }
    _state() { this.emit("state", { index: this.index, playing: this.playing, pos: this.pos, dur: this.dur }); }
    // 재생 중에 흐른 실제 시간만 센다 (탐색은 들은 시간에 넣지 않음)
    _tickListen() {
      const id = this.currentId; if (!id) return;
      const now = performance.now();
      if (!this._lis || this._lis.id !== id) this._lis = { id, ms: 0, counted: false, last: now };
      const L = this._lis;
      if (this.playing) L.ms += Math.min(1500, Math.max(0, now - L.last));
      L.last = now;
      if (!L.counted && L.ms >= countThreshold(this.dur)) {
        L.counted = true;
        API.reportPlay(id, L.ms, true).catch(() => {});
        L.ms = 0;
        this.emit("played", { id });
      }
    }
    _finishListen() {
      const L = this._lis; this._lis = null;
      if (L && L.ms > 1500) API.reportPlay(L.id, L.ms, false).catch(() => {});
      if (L) this.emit("listened", { id: L.id, ms: L.ms });
    }
  }

  class WebEngine extends QueueEngine {
    constructor(getTrack) {
      super(getTrack);
      const a = this.audio = new Audio();
      a.preload = "auto";
      try { a.volume = parseFloat(localStorage.getItem("mc.vol") || "1"); } catch (e) {}
      a.addEventListener("play", () => { this.playing = true; this._lisReset(); this._state(); });
      a.addEventListener("pause", () => { this._tickListen(); this.playing = false; this._state(); });
      a.addEventListener("timeupdate", () => { this.pos = a.currentTime * 1000; this._tickListen(); this.emit("time", { pos: this.pos, dur: this.dur }); });
      a.addEventListener("durationchange", () => { if (isFinite(a.duration)) this.dur = a.duration * 1000; this._state(); });
      a.addEventListener("ended", () => { this._tickListen(); this.next(true); });
      a.addEventListener("error", () => this._recover());
      a.addEventListener("playing", () => { this._fails = 0; this.emit("link", { ok: true }); });
      // 폰 화면이 꺼져 와이파이가 잠들면 오류 없이 멈춰 버릴 때가 있다. 재생 중인데 시간이 안 흐르면 다시 잇는다
      this._want = false; this._fails = 0; this._lastT = -1; this._still = 0;
      setInterval(() => {
        if (!this._want || a.paused || a.ended || !a.src) { this._still = 0; return; }
        if (a.currentTime !== this._lastT) { this._lastT = a.currentTime; this._still = 0; return; }
        if (++this._still >= 8) { this._still = 0; this._recover(); }
      }, 1000);
      this._mediaSession();
    }
    // 끊긴 곡은 건너뛰지 않고 폰이 다시 응답할 때까지 기다렸다가 끊긴 자리부터 잇는다.
    // 폰은 응답하는데 이 곡만 계속 실패하면 그때 다음 곡으로 넘어간다
    async _recover() {
      const id = this.currentId; if (!id || this._recovering) return;
      this._recovering = true;
      const pos = this.pos, want = this._want;
      try {
        for (let tries = 0; this.currentId === id; tries++) {
          let up = false;
          try { await Promise.race([API.status(), new Promise((_, no) => setTimeout(no, 5000))]); up = true; } catch (e) {}
          if (this.currentId !== id) return;
          if (up) {
            if (++this._fails > 3) { this._fails = 0; this.emit("error", { id }); this.next(true); return; }
            this.emit("link", { ok: true });
            this._reopen(pos, want);
            return;
          }
          if (tries === 0) this.emit("link", { ok: false });
          await new Promise((r) => setTimeout(r, Math.min(10000, 2000 + tries * 1000)));
        }
      } finally { this._recovering = false; }
    }
    _reopen(pos, autoplay) {
      const a = this.audio;
      a.src = API.streamUrl(this.currentId) + "?r=" + Date.now();
      if (pos) a.addEventListener("loadedmetadata", () => { a.currentTime = pos / 1000; }, { once: true });
      if (autoplay) a.play().catch(() => {});
    }
    _lisReset() { if (this._lis) this._lis.last = performance.now(); }
    _open(pos, autoplay) {
      const id = this.currentId; const t = id && this.getTrack(id);
      if (!t) return;
      this.dur = t.duration || 0; this.pos = pos; this._want = !!autoplay; this._fails = 0;
      this.audio.src = API.streamUrl(id);
      if (pos) this.audio.addEventListener("loadedmetadata", () => { this.audio.currentTime = pos / 1000; }, { once: true });
      if (autoplay) this.audio.play().catch(() => { this.playing = false; this._state(); });
      this._meta(t);
      this._state();
    }
    play() {
      if (!this.audio.src && this.currentId) return this._open(this.pos, true);
      this._want = true;
      if (this.audio.error) return this._recover();
      this.audio.play().catch(() => {});
    }
    pause() { this._want = false; this.audio.pause(); }
    toggle() { this.audio.paused ? this.play() : this.pause(); }
    seek(ms) { this.pos = ms; if (this.audio.src) this.audio.currentTime = ms / 1000; this.emit("time", { pos: ms, dur: this.dur }); }
    get volume() { return this.audio.volume; }
    set volume(v) { this.audio.volume = v; try { localStorage.setItem("mc.vol", String(v)); } catch (e) {} }
    _meta(t) {
      if (!("mediaSession" in navigator)) return;
      const art = API.artUrl(t.albumKey, 512);
      navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album, artwork: art ? [{ src: art, sizes: "512x512", type: "image/jpeg" }] : [] });
    }
    _mediaSession() {
      if (!("mediaSession" in navigator)) return;
      const ms = navigator.mediaSession;
      ms.setActionHandler("play", () => this.play());
      ms.setActionHandler("pause", () => this.pause());
      ms.setActionHandler("nexttrack", () => this.next());
      ms.setActionHandler("previoustrack", () => this.prev());
      try { ms.setActionHandler("seekto", (e) => this.seek(e.seekTime * 1000)); } catch (e) {}
    }
  }

  class SimEngine extends QueueEngine {
    constructor(getTrack) { super(getTrack); this.volume = 1; setInterval(() => this._tick(), 250); this._last = performance.now(); }
    _open(pos, autoplay) {
      const t = this.getTrack(this.currentId); if (!t) return;
      this.dur = t.duration; this.pos = pos; this.playing = !!autoplay; this._last = performance.now();
      if (this._lis) this._lis.last = this._last;
      this._state();
    }
    _tick() {
      const now = performance.now();
      if (this.playing) {
        this.pos += now - this._last;
        this._tickListen();
        if (this.pos >= this.dur) { this.pos = this.dur; this.next(true); }
        this.emit("time", { pos: this.pos, dur: this.dur });
      }
      this._last = now;
    }
    play() { if (this.currentId) { this.playing = true; this._last = performance.now(); if (this._lis) this._lis.last = this._last; this._state(); } }
    pause() { this._tickListen(); this.playing = false; this._state(); }
    toggle() { this.playing ? this.pause() : this.play(); }
    seek(ms) { this.pos = ms; this.emit("time", { pos: ms, dur: this.dur }); }
  }

  // ───── 폰 앱 엔진: 실제 재생은 안드로이드 쪽 Media3가 한다 ─────
  class NativeEngine extends Emitter {
    constructor() {
      super();
      this.N = window.NativeBridge;
      this.queue = []; this.index = -1; this.playing = false; this.pos = 0; this.dur = 0; this.repeat = "off";
      this._at = performance.now();
      window.__native = (msg) => this._onNative(typeof msg === "string" ? JSON.parse(msg) : msg);
      // 앱 안에서는 브라우저처럼 시간을 보간해 진행 막대를 부드럽게
      setInterval(() => { if (this.playing) this.emit("time", { pos: this.posNow, dur: this.dur }); }, 250);
    }
    get currentId() { return this.queue[this.index]; }
    get posNow() { return this.playing ? Math.min(this.dur || Infinity, this.pos + (performance.now() - this._at)) : this.pos; }
    restore() {
      try {
        const s = JSON.parse(this.N.getState());
        if (s && s.ids && s.ids.length) { this.queue = s.ids; this._apply(s); return s; }
      } catch (e) { console.warn(e); }
      return null;
    }
    _apply(s) {
      if (s.index != null) this.index = s.index;
      if (s.playing != null) this.playing = s.playing;
      if (s.pos != null) { this.pos = s.pos; this._at = performance.now(); }
      if (s.dur != null && s.dur > 0) this.dur = s.dur;
      if (s.repeat) this.repeat = s.repeat;
      if (s.shuffle != null) this.nShuffle = s.shuffle; // 위젯에서 바꾼 셔플도 따라간다
      if (s.orig) this.nOrig = s.orig;
    }
    _onNative(m) {
      if (m.type === "state") { if (m.ids) this.queue = m.ids; this._apply(m); this.emit("state", { index: this.index, playing: this.playing, pos: this.pos, dur: this.dur }); this.emit("time", { pos: this.pos, dur: this.dur }); }
      else if (m.type === "played") this.emit("played", { id: m.id });
      else if (m.type === "listened") this.emit("listened", { id: m.id, ms: m.ms });
      else if (m.type === "error") this.emit("error", m);
      else this.emit("native", m);
    }
    load(queue, index, pos, autoplay) { this.queue = queue.slice(); this.index = index; this.pos = pos || 0; this._at = performance.now(); this.N.setQueue(JSON.stringify(queue), index, Math.round(pos || 0), autoplay !== false); }
    sync(queue, index) { this.queue = queue.slice(); this.index = index; this.N.syncQueue(JSON.stringify(queue), index); }
    jump(i) { this.index = i; this.N.jump(i); }
    play() { this.N.play(); }
    pause() { this.N.pause(); }
    toggle() { this.playing ? this.pause() : this.play(); }
    next() { this.N.next(); }
    prev() { this.N.prev(); }
    seek(ms) { this.pos = ms; this._at = performance.now(); this.N.seek(Math.round(ms)); this.emit("time", { pos: ms, dur: this.dur }); }
    setRepeat(m) { this.repeat = m; this.N.setRepeat(m); }
    get volume() { return 1; }
    set volume(v) {}
  }

  // ───── 화면이 쓰는 재생기 ─────
  class Player extends Emitter {
    constructor(getTrack) {
      super();
      this.getTrack = getTrack;
      this.native = !!window.NativeBridge;
      const E = this.native ? NativeEngine : (window.MOCK_API ? SimEngine : WebEngine);
      this.eng = new E(getTrack);
      this.shuffle = false; this.original = null; this.context = null;
      this.eng.on("state", (s) => { this._adoptShuffle(); this.emit("state", s); this._save(); });
      this.eng.on("time", (t) => this.emit("time", t));
      this.eng.on("played", (p) => this.emit("played", p));
      this.eng.on("listened", (p) => this.emit("listened", p));
      this.eng.on("error", (p) => this.emit("error", p));
      this.eng.on("link", (p) => this.emit("link", p));
      this.eng.on("native", (p) => this.emit("native", p));
      this._restore();
    }
    // 폰: 셔플 상태는 앱(위젯과 공유)이 기억한다. 화면에서 바꿀 땐 대기열을 바꾸기 전에 먼저 알린다
    _tellShuffle() {
      if (!this.native || !this.eng.N.setShuffleState) return;
      try { this.eng.N.setShuffleState(!!this.shuffle, JSON.stringify(this.original || [])); } catch (e) {}
      this.eng.nShuffle = !!this.shuffle; this.eng.nOrig = this.original || [];
    }
    _adoptShuffle() {
      if (!this.native || this.eng.nShuffle == null || this.eng.nShuffle === this.shuffle) return;
      this.shuffle = this.eng.nShuffle;
      this.original = this.shuffle && this.eng.nOrig && this.eng.nOrig.length ? this.eng.nOrig.slice() : null;
    }
    get queue() { return this.eng.queue; }
    get index() { return this.eng.index; }
    get current() { return this.getTrack(this.eng.currentId); }
    get currentId() { return this.eng.currentId; }
    get playing() { return this.eng.playing; }
    get pos() { return this.eng.posNow != null ? this.eng.posNow : this.eng.pos; }
    get dur() { return this.eng.dur || (this.current && this.current.duration) || 0; }
    get repeat() { return this.eng.repeat; }
    get volume() { return this.eng.volume; }
    set volume(v) { this.eng.volume = v; }

    // ids를 처음부터 재생. ctx는 "어디서 재생 중" 표시용 {type, id, name}
    playList(ids, start, ctx, opts) {
      ids = ids.filter((id) => this.getTrack(id));
      if (!ids.length) return;
      start = Math.max(0, Math.min(ids.length - 1, start || 0));
      this.context = ctx || null;
      const wantShuffle = opts && opts.shuffle != null ? opts.shuffle : this.shuffle;
      this.shuffle = wantShuffle;
      if (wantShuffle) {
        this.original = ids.slice();
        const fi = opts && opts.randomStart ? Math.floor(Math.random() * ids.length) : start;
        ids = [ids[fi]].concat(U.shuffle(ids.filter((_, k) => k !== fi)));
        start = 0;
      } else this.original = null;
      this._tellShuffle();
      this.eng.load(ids, start, 0, !(opts && opts.autoplay === false));
      this.emit("queue");
    }
    playOne(id, ctxIds, ctx) {
      if (ctxIds && ctxIds.length) return this.playList(ctxIds, Math.max(0, ctxIds.indexOf(id)), ctx);
      this.playList([id], 0, ctx);
    }
    // 테이프 꺼내기: 멈추고 대기열을 비운다 (재생 화면에서 테이프를 위로 끌어 올렸을 때)
    eject() {
      this.pause();
      this.context = null; this.shuffle = false; this.original = null;
      this._tellShuffle();
      this.eng.load([], 0, 0, false);
      this.emit("queue"); this.emit("state", {});
    }
    toggle() { if (this.index < 0) return; this.eng.toggle(); }
    play() { this.eng.play(); }
    pause() { this.eng.pause(); }
    next() { this.eng.next(); }
    prev() { this.eng.prev(); }
    seek(ms) { this.eng.seek(ms); }
    jump(i) { this.eng.jump(i); }
    cycleRepeat() {
      const m = { off: "all", all: "one", one: "off" }[this.repeat] || "off";
      this.eng.setRepeat(m); this.emit("state", {}); this._save();
      return m;
    }
    toggleShuffle() {
      const q = this.queue, i = this.index, cur = q[i];
      if (!cur) { this.shuffle = !this.shuffle; this._tellShuffle(); this.emit("state", {}); return this.shuffle; }
      if (!this.shuffle) {
        this.original = q.slice();
        const upcoming = U.shuffle(q.filter((_, k) => k !== i));
        this.shuffle = true; this._tellShuffle();
        this.eng.sync([cur].concat(upcoming), 0);
      } else {
        const orig = this.original && this.original.includes(cur) ? this.original : q;
        this.shuffle = false; this.original = null; this._tellShuffle();
        this.eng.sync(orig, orig.indexOf(cur));
      }
      this.emit("queue"); this.emit("state", {}); this._save();
      return this.shuffle;
    }
    playNext(ids) {
      if (this.index < 0) return this.playList(ids, 0, null);
      const q = this.queue.slice(); q.splice(this.index + 1, 0, ...ids);
      if (this.original) { this.original.push(...ids); this._tellShuffle(); }
      this.eng.sync(q, this.index); this.emit("queue"); this._save();
    }
    addToQueue(ids) {
      if (this.index < 0) return this.playList(ids, 0, null);
      const q = this.queue.concat(ids);
      if (this.original) { this.original.push(...ids); this._tellShuffle(); }
      this.eng.sync(q, this.index); this.emit("queue"); this._save();
    }
    removeAt(k) {
      if (k === this.index || k < 0 || k >= this.queue.length) return;
      const q = this.queue.slice(); const [id] = q.splice(k, 1);
      if (this.original) { const j = this.original.indexOf(id); if (j >= 0) this.original.splice(j, 1); this._tellShuffle(); }
      this.eng.sync(q, k < this.index ? this.index - 1 : this.index); this.emit("queue"); this._save();
    }
    move(from, to) {
      if (from === to) return;
      const q = this.queue.slice(); const cur = q[this.index];
      const [x] = q.splice(from, 1); q.splice(to, 0, x);
      this.eng.sync(q, q.indexOf(cur)); this.emit("queue"); this._save();
    }

    // 새로 고침해도 이어 들을 수 있게 (브라우저 쪽만. 폰은 앱이 기억함)
    _save() {
      if (this.native) return;
      try {
        localStorage.setItem("mc.queue", JSON.stringify({ q: this.queue, i: this.index, p: Math.round(this.pos), s: this.shuffle, o: this.original, r: this.repeat, c: this.context }));
      } catch (e) {}
    }
    _restore() {
      if (this.native) {
        const s = this.eng.restore();
        try { const extra = JSON.parse(localStorage.getItem("mc.native.ctx") || "null"); if (extra) { this.context = extra.c; this.shuffle = !!extra.s; this.original = extra.o; } } catch (e) {}
        this._adoptShuffle(); // 앱이 기억하는 셔플(위젯에서 바꿨을 수도 있음)이 우선
        this.on("queue", () => { try { localStorage.setItem("mc.native.ctx", JSON.stringify({ c: this.context, s: this.shuffle, o: this.original })); } catch (e) {} });
        this.on("state", () => { try { localStorage.setItem("mc.native.ctx", JSON.stringify({ c: this.context, s: this.shuffle, o: this.original })); } catch (e) {} });
        return s;
      }
      this._pending = (() => { try { return JSON.parse(localStorage.getItem("mc.queue") || "null"); } catch (e) { return null; } })();
    }
    // 라이브러리를 불러온 뒤에 호출: 이전 대기열을 멈춘 상태로 되살린다
    resume() {
      const s = this._pending; this._pending = null;
      if (!s || !s.q || !s.q.length) return;
      const q = s.q.filter((id) => this.getTrack(id)); if (!q.length) return;
      const cur = s.q[s.i]; const i = Math.max(0, q.indexOf(cur));
      this.shuffle = !!s.s; this.original = s.o; this.context = s.c;
      if (s.r) this.eng.setRepeat(s.r);
      this.eng.load(q, i, s.p || 0, false);
      this.emit("queue");
    }
  }

  window.Player = Player;
})();
