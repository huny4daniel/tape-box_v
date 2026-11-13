// 재생 쪽 화면: 재생 막대, 가사, 오른쪽 패널(PC), 재생 화면(카세트), 테이프 꺼내기·꽂기
"use strict";

// ───────── 재생 막대 ─────────
const bar = $("#playerbar");
function renderBar() {
  const t = P.current;
  document.body.classList.toggle("no-bar", !t); // 고른 곡이 없으면 아래 재생바를 숨기고 그 자리를 화면에 돌려준다
  if (!t) { bar.innerHTML = ""; return; }
  const playIc = P.playing ? "ic-pause" : "ic-play";
  bar.innerHTML = `
    <div class="pb-now" data-act="open-full">${art(t, 120)}<div><b><a href="#/track/${encodeURIComponent(t.id)}" data-stop>${esc(t.title)}</a></b><span>${artistLinks(t)}</span></div>
      <button class="icon-btn fav${t.fav ? " on" : ""}" data-act="fav" data-id="${esc(t.id)}"><i class="ic ${t.fav ? "ic-heart-fill" : "ic-heart"}"></i></button></div>
    <div class="pb-center">
      <div class="pb-ctrl">
        <button class="icon-btn${P.shuffle ? " on" : ""}" data-act="shuffle" title="셔플"><i class="ic ic-shuffle"></i></button>
        <button class="icon-btn" data-act="prev" title="이전"><i class="ic ic-prev"></i></button>
        <button class="pb-play" data-act="toggle" title="재생/일시정지"><i class="ic ${playIc}"></i></button>
        <button class="icon-btn" data-act="next" title="다음"><i class="ic ic-next"></i></button>
        <button class="icon-btn${P.repeat !== "off" ? " on" : ""}" data-act="repeat" title="반복"><i class="ic ${P.repeat === "one" ? "ic-repeat1" : "ic-repeat"}"></i></button>
      </div>
      <div class="pb-seek"><span data-time="pos">${U.fmtDur(P.pos)}</span><div class="range" data-range="seek"><div class="track"><div class="fill"></div></div><div class="knob"></div></div><span data-time="dur">${U.fmtDur(P.dur)}</span></div>
    </div>
    <div class="pb-right">
      ${P.native ? "" : `<i class="ic ic-volume dim"></i><div class="range pb-vol" data-range="vol"><div class="track"><div class="fill"></div></div><div class="knob"></div></div>`}
      <button class="icon-btn pb-full" data-act="open-full" title="재생 화면"><i class="ic ic-expand"></i></button>
    </div>
    <div class="pb-mini">
      <button class="icon-btn" data-act="prev" title="이전"><i class="ic ic-prev"></i></button>
      <button class="icon-btn pb-mini-play" data-act="toggle" title="재생/일시정지"><i class="ic ${playIc}"></i></button>
      <button class="icon-btn" data-act="next" title="다음"><i class="ic ic-next"></i></button>
      <button class="icon-btn" data-act="mini-queue" title="대기열"><i class="ic ic-queue"></i></button>
    </div>
    <div class="pb-mini-prog"><i></i></div>`;
  if (isMobile()) marquee($(".pb-now b", bar));
  bindRange($('[data-range="seek"]', bar), () => (P.dur ? P.pos / P.dur : 0), (f) => P.seek(f * P.dur), (f) => ($('[data-time="pos"]', bar).textContent = U.fmtDur(f * P.dur)));
  const vol = $('[data-range="vol"]', bar);
  if (vol) bindRange(vol, () => P.volume, (f) => (P.volume = f), (f) => (P.volume = f));
  updateTime();
  if (isMobile()) U.tintFrom(API.artUrl(t.albumKey, 64), t.albumKey + t.album).then((c) => { const [h, s] = c.split(" "); bar.style.setProperty("--mini", `${h} ${s} 20%`); });
}
// 칸보다 긴 제목은 천천히 흘려 보여 준다 (양 끝에서 잠깐 멈췄다가 되돌아온다)
function marquee(box) {
  const inner = box && box.firstElementChild; if (!inner) return;
  const over = inner.scrollWidth - box.clientWidth;
  box.classList.toggle("mq-run", over > 2);
  if (over <= 2) return;
  box.style.setProperty("--mq-d", -(over + 8) + "px");
  box.style.setProperty("--mq-t", Math.max(4, (over + 8) / 25 / 0.6).toFixed(1) + "s"); // 초당 약 25px
}
function updateTime() {
  const f = P.dur ? Math.min(1, P.pos / P.dur) : 0;
  $$('[data-range="seek"]').forEach((r) => { if (!r.classList.contains("drag")) setRange(r, f); });
  $$('[data-range="vol"]').forEach((r) => { if (!r.classList.contains("drag")) setRange(r, P.volume); });
  $$('[data-time="pos"]').forEach((e) => { if (!e.closest(".drag-host")) e.textContent = U.fmtDur(P.pos); });
  $$('[data-time="dur"]').forEach((e) => (e.textContent = U.fmtDur(P.dur)));
  const mp = $(".pb-mini-prog i"); if (mp) mp.style.width = f * 100 + "%";
  if (!fp.hidden) $$(".tape.big, .np-side-tape .tape", fp).forEach((bt) => bt.style.setProperty("--p", f.toFixed(4))); // 릴에 감긴 테이프가 옮겨 간다
  syncLyrics();
}
function setRange(r, f) { $(".fill", r).style.width = f * 100 + "%"; $(".knob", r).style.left = f * 100 + "%"; }
function bindRange(r, get, commit, preview) {
  if (!r) return;
  setRange(r, get());
  r.addEventListener("pointerdown", (e) => {
    e.preventDefault(); e.stopPropagation();
    r.setPointerCapture(e.pointerId); r.classList.add("drag");
    const host = r.parentElement; host.classList.add("drag-host");
    const at = (ev) => { const b = r.getBoundingClientRect(); return Math.max(0, Math.min(1, (ev.clientX - b.left) / b.width)); };
    let f = at(e); setRange(r, f); preview && preview(f);
    const mv = (ev) => { f = at(ev); setRange(r, f); preview && preview(f); };
    const up = () => { r.removeEventListener("pointermove", mv); r.removeEventListener("pointerup", up); r.removeEventListener("pointercancel", up); r.classList.remove("drag"); host.classList.remove("drag-host"); commit(f); };
    r.addEventListener("pointermove", mv); r.addEventListener("pointerup", up); r.addEventListener("pointercancel", up);
  });
}

// ───────── 가사 ─────────
const lyrCache = new Map();
function getLyrics(id) {
  if (lyrCache.has(id)) return lyrCache.get(id);
  // 연결이 잠깐 끊겨 실패한 결과는 기억하지 않는다 (다음에 다시 불러오게)
  const p = API.lyrics(id).catch(() => { lyrCache.delete(id); return { failed: true }; });
  lyrCache.set(id, p); return p;
}
let lyrState = null; // {id, data, boxes:[el]}
function lyricsHtml(d) {
  if (d && d.failed) return `<div class="lyrics plain"><p class="note" style="font-size:16px;margin-top:20px">폰과 연결이 끊겨 가사를 불러오지 못했어요.</p><p class="note"><button class="btn ghost" data-act="lyr-retry">다시 불러오기</button></p></div>`;
  if (!d || (!d.synced && !d.plain)) return `<div class="lyrics plain"><p class="note" style="font-size:16px;margin-top:20px">이 곡에는 가사가 없어요.</p></div>`;
  if (d.synced) return `<div class="lyrics">${d.synced.map(([ms, text], i) => `<p class="ln${text.trim() ? "" : " blank"}" data-ms="${ms}" data-k="${i}"><span>${lyrText(text) || "♪"}</span></p>`).join("")}</div>`;
  return `<div class="lyrics plain">${d.plain.split(/\r?\n/).map((l) => `<p class="ln">${lyrText(l) || "&nbsp;"}</p>`).join("")}</div>`;
}
function mountLyrics(box) {
  const t = P.current;
  if (!t) { box.innerHTML = `<div class="lyrics plain"><p class="note">재생 중인 곡이 없어요</p></div>`; return; }
  box.innerHTML = `<div class="lyrics plain"><p class="note">가사를 불러오는 중…</p></div>`;
  box.dataset.lyr = t.id;
  lyrRevertBtn(box, null);
  getLyrics(t.id).then((d) => {
    if (box.dataset.lyr !== t.id) return;
    box.innerHTML = lyricsHtml(d);
    box._lyr = { data: d, cur: -1 };
    lyrRevertBtn(box, d && d.synced && d.check && d.source !== "file" ? t.id : null); // 확인 필요로 만든 싱크 가사일 때만
    syncLyrics(true);
  });
}
// 확인 필요 싱크 가사 되돌리기 버튼: 가사 영역 밖 오른쪽 아래 (메모지 아래, PC 오른쪽 패널·옆 패널의 모서리)
function lyrRevertHost(box) { return box.closest(".np-memo:not(.panel-memo)") || box.closest("#panel") || box.closest(".np-side"); }
function lyrRevertBtn(box, id) {
  const host = lyrRevertHost(box); if (!host) return;
  const old = $(":scope > .lyr-revert", host); if (old) old.remove();
  if (!id) return;
  host.insertAdjacentHTML("beforeend", `<button class="lyr-revert" data-act="lyr-revert" data-id="${esc(id)}" title="확인 필요 싱크 가사 되돌리기" aria-label="확인 필요 싱크 가사 되돌리기"><i class="ic ic-undo"></i></button>`);
}
function revertLyricsModal(id) {
  const t = L.byId.get(id); if (!t) return;
  openModal(`<h3>싱크 가사를 되돌릴까요?</h3><p class="dim" style="margin:0">「${esc(t.title)}」의 만든 싱크 가사를 지우고 원래 가사로 돌려요. 이 곡은 다시 만들지 않아요.</p>
    <div class="row-btns"><button class="btn ghost" data-close>취소</button><button class="btn primary" id="lyr-revert-ok">되돌리기</button></div>`);
  $("#lyr-revert-ok").addEventListener("click", (e) => {
    e.currentTarget.disabled = true;
    API.revertLyrics(id).then(() => {
      closeModal();
      lyrCache.delete(id);
      $$("[data-lyr]").forEach((b) => { if (b.dataset.lyr === id) mountLyrics(b); });
      toast("원래 가사로 되돌렸어요");
      lsSync(); // PC 창이면 생성기 기록에도 바로 반영
    }, (err) => { closeModal(); toast("되돌리지 못했어요: " + err.message); });
  });
}
function syncLyrics(force) {
  $$("[data-lyr]").forEach((box) => {
    const st = box._lyr; if (!st || !st.data || !st.data.synced || box.dataset.lyr !== P.currentId) return;
    const pos = P.pos + 250; const L2 = st.data.synced;
    let k = -1; for (let i = 0; i < L2.length; i++) { if (L2[i][0] <= pos) k = i; else break; }
    if (k === st.cur && !force) return;
    st.cur = k;
    const lines = box.querySelectorAll(".ln");
    lines.forEach((el, i) => { el.classList.toggle("cur", i === k); el.classList.toggle("past", i < k); });
    const el = lines[Math.max(0, k)];
    const scroller = box.closest("#panel-body, .np-side-body, .np-memo-page");
    if (el && scroller && !box._userScroll) {
      const top = el.offsetTop - scroller.clientHeight * 0.32;
      scroller.scrollTo({ top, behavior: force ? "auto" : "smooth" });
    }
  });
}
document.addEventListener("click", (e) => {
  const ln = e.target.closest(".lyrics .ln[data-ms]"); if (!ln) return;
  P.seek(+ln.dataset.ms); if (!P.playing) P.play();
});

// ───────── 오른쪽 패널 (PC) ─────────
// 재생 막대의 가사·대기열 버튼을 없앴다: 가사·재생목록은 재생 화면 옆 패널에서 바꿔 본다. 다시 쓰려면 버튼과 함께 되살린다
let panelOpen = false;
let panelTab = "lyrics";
function renderPanel() {
  $("#app").classList.toggle("panel-open", panelOpen && !!P.current);
  $$(".panel-tabs [data-panel]").forEach((b) => b.classList.toggle("on", b.dataset.panel === panelTab));
  const oldBtn = $("#panel > .lyr-revert"); if (oldBtn) oldBtn.remove();
  if (!panelOpen) return;
  const body = $("#panel-body");
  if (panelTab === "lyrics") {
    // PC 오른쪽 가사도 재생 화면과 같은 줄 메모지에
    body.innerHTML = `<div class="np-memo paper panel-memo"><div class="np-memo-page"><div data-lyr></div></div></div>`;
    mountLyrics($("[data-lyr]", body));
  } else body.innerHTML = queueHtml();
}
function queueHtml() {
  const q = P.queue, i = P.index;
  if (i < 0) return `<div class="queue"><p class="dimmer" style="padding:16px">대기열이 비어 있어요</p></div>`;
  const cur = L.byId.get(q[i]);
  const up = q.slice(i + 1, i + 101);
  const qrow = (id, k, now) => { const t = L.byId.get(id); if (!t) return ""; return `<div class="q-row${now ? " now" : ""}" data-q="${k}">${art(t, 100)}<div><b>${esc(t.title)}</b><span>${esc(t.artist)}</span></div>${now ? "" : `<button class="icon-btn" data-act="q-remove" title="대기열에서 빼기"><i class="ic ic-x"></i></button><span class="q-grip" title="끌어서 순서 바꾸기"><i class="ic ic-drag"></i></span>`}</div>`; };
  const ctx = P.context;
  return `<div class="queue">
    <h4>지금 재생 중</h4>${qrow(cur.id, i, true)}
    ${up.length ? `<h4>다음 곡${ctx && ctx.name ? ` · <span class="dim" style="font-weight:600">${esc(ctx.name)}</span>` : ""}</h4>${up.map((id, k) => qrow(id, i + 1 + k)).join("")}` : `<p class="dimmer" style="padding:8px 8px 0;font-size:13px">다음 곡이 없어요</p>`}
    ${q.length - i - 1 > 100 ? `<p class="dimmer" style="padding:8px;font-size:12px">외 ${q.length - i - 101}곡</p>` : ""}
  </div>`;
}

// ───────── 재생 화면 (PC·폰 공통 전체 화면): 돌아가는 카세트 + 조작 + 재생목록 ─────────
const fp = $("#fullplayer");
let npSide = "queue"; // 옆(폰은 아래) 패널: queue | lyrics
let npId = null;
let npMemo = false; // 폰: 카세트 대신 가사 메모지를 펼쳐 둔 상태
// 폰 가사 모양: paper(줄 메모지에 손글씨) | plain(일반 가사)
// 지금은 메모지만 쓴다. 일반 가사 모양과 오른쪽 위 전환 버튼은 코드·CSS(.np-memo.plain)에 그대로 남겨 두었으니
// 다시 고를 수 있게 하려면 LYR_THEME_TOGGLE 를 true 로 바꾸면 된다.
const LYR_THEME_TOGGLE = false;
let memoTheme = LYR_THEME_TOGGLE ? (() => { try { return localStorage.getItem("mc.lyrTheme") === "plain" ? "plain" : "paper"; } catch (e) { return "paper"; } })() : "paper";
const memoThemeBtn = () => !LYR_THEME_TOGGLE ? "" : `<button class="icon-btn memo-theme" data-act="memo-theme" title="${memoTheme === "paper" ? "일반 가사로" : "메모지로"}"><i class="ic ${memoTheme === "paper" ? "ic-lyrics" : "ic-pen"}"></i></button>`;
let npEjected = false;   // 폰: 테이프를 꺼낸 빈 데크 화면
let npInsert = false;    // 방금 테이프를 꽂았다 (꽂히는 움직임)
let lastTapeId = null;   // 꺼낸 테이프 (선반에서 그 자리부터 보여 준다)
let lastBoxId = null;    // 상자 통째로 재생하다 꺼냈으면 그 상자
let shelfBox = null;     // 선반에서 열어 본 상자 (null이면 맨 바깥: 상자들 + 상자 밖 테이프)
function openFull() { if (!P.current && !npEjected) return; fp.hidden = false; npId = null; renderFull(); }
function closeFull() { fp.classList.remove("q-open"); fp.hidden = true; fp.innerHTML = ""; npId = null; npEjected = false; }
function renderFull() {
  if (fp.hidden) return;
  if (npEjected) return renderEjected();
  const t = P.current; if (!t) return closeFull();
  // 같은 곡이면 버튼 상태만 바꾼다 (카세트 애니메이션이 끊기지 않게)
  if (npId === t.id) { syncFullControls(); return; }
  npId = t.id;
  const bg = t.albumKey ? API.artUrl(t.albumKey, 96) : "";
  fp.innerHTML = `
    <div class="np-bg" style="${U.phStyle(t.albumKey + t.album)}">${bg ? `<img alt="" src="${esc(bg)}" onerror="this.remove()">` : ""}</div>
    <div class="np-top">
      <button class="icon-btn" data-act="close-full" title="닫기"><i class="ic ic-down"></i></button>
      <div class="ctx"></div>
      <button class="icon-btn" data-act="more" data-id="${esc(t.id)}" title="더 보기"><i class="ic ic-more"></i></button>
    </div>
    <div class="np-main">
      <section class="np-deck">
        <div class="np-tape-wrap${npMemo ? " memo" : ""}">${wellHtml("under")}${cassette(contextTape(), t, { big: true, now: true, order: tapeOrder(t), attrs: 'data-act="toggle" title="재생/일시정지"' })}
          <div class="np-memo ${memoTheme}" data-act="memo-close">${memoThemeBtn()}<div class="np-memo-page"><div data-lyr></div></div></div></div>
        <div class="np-gap"></div>
        <div class="np-meta">
          <div><b>${esc(t.title)}</b><span>${artistLinks(t)}</span></div>
          ${P.native ? "" : `<div class="np-vol" title="음량"><i class="ic ic-volume dim"></i><div class="range" data-range="vol"><div class="track"><div class="fill"></div></div><div class="knob"></div></div></div>`}
          <button class="icon-btn np-q-btn" data-act="mini-queue" title="대기열"><i class="ic ic-queue"></i></button>
        </div>
        <div class="np-seek"><div class="range" data-range="seek"><div class="track"><div class="fill"></div></div><div class="knob"></div></div>
          <div class="times"><span data-time="pos">${U.fmtDur(P.pos)}</span><span data-time="dur">${U.fmtDur(P.dur)}</span></div></div>
        <div class="np-ctrl">
          <button class="icon-btn" data-act="shuffle" data-np="shuffle" title="셔플"><i class="ic ic-shuffle"></i></button>
          <button class="icon-btn" data-act="prev" title="이전"><i class="ic ic-prev"></i></button>
          <button class="np-play" data-act="toggle" title="재생/일시정지"><i class="ic"></i></button>
          <button class="icon-btn" data-act="next" title="다음"><i class="ic ic-next"></i></button>
          <button class="icon-btn" data-act="repeat" data-np="repeat" title="반복"><i class="ic"></i></button>
        </div>
      </section>
      <div class="np-sheet-bg" data-act="q-close"></div>
      <aside class="np-side">
        <div class="np-side-tape">${cassette(contextTape(), t, { now: true, order: tapeOrder(t), noHeart: true })}</div>
        <div class="np-tabs"><button data-act="np-side" data-v="queue">대기열</button><button data-act="np-side" data-v="lyrics">가사</button></div>
        <div class="np-side-body"></div>
      </aside>
    </div>`;
  U.tintFrom(API.artUrl(t.albumKey, 64), t.albumKey + t.album).then((c) => fp.style.setProperty("--fp", c));
  bindRange($('[data-range="seek"]', fp), () => (P.dur ? P.pos / P.dur : 0), (f) => P.seek(f * P.dur), (f) => ($('[data-time="pos"]', fp).textContent = U.fmtDur(f * P.dur)));
  const vol = $('[data-range="vol"]', fp);
  if (vol) bindRange(vol, () => P.volume, (f) => (P.volume = f), (f) => (P.volume = f));
  syncFullControls();
  renderNpSide();
  if (npInsert) {
    npInsert = false;
    // 꽂히는 움직임은 한 번만. 클래스가 남아 있으면 가사 메모지를 닫고 테이프가 다시 보일 때 또 재생된다
    const w = $(".np-tape-wrap", fp); w.classList.add("inserting");
    $(":scope > .tape", w).addEventListener("animationend", () => w.classList.remove("inserting"), { once: true });
  }
  if (npMemo && !isMobile()) setMemo(false); // PC 재생 화면에는 메모지 가사를 띄우지 않는다
  if (npMemo) mountLyrics($(".np-memo [data-lyr]", fp));
  updateTime();
}
// ───────── 테이프 꺼내기 / 꽂기 (폰) ─────────
// 테이프 고르기: 재생목록 테이프들이 가로로 늘어서고, 누르거나 아래로 끌어 내리면 꽂힌다 (재생은 직접 누를 때)
// 테이프를 꽂는 데크 (재생 중에는 테이프 뒤에 숨어 있다가 꺼낼 때 드러난다)
const wellHtml = (cls) => `<div class="np-well${cls ? " " + cls : ""}"><i class="spindle l"></i><i class="spindle r"></i><div class="np-well-heads"><i></i><i></i><i></i><i></i></div></div>`;
function renderEjected() {
  if (npId === "__eject") return;
  npId = "__eject";
  const playable = (pl) => pl && pl.items.some((id) => L.byId.has(id));
  const tapes = sortedTapes().filter(playable); // 최근에 들은 순
  const boxes = boxesByRecent(allBoxes().filter((b) => boxTapes(b).some(playable)));
  // 방금까지 재생하던 테이프가 상자 안에 있으면 그 상자를 고른 채로 시작
  const lastBox = (lastTapeId && boxOf(lastTapeId)) || (lastBoxId && allBoxes().find((b) => b.id === lastBoxId));
  shelfBox = lastBox && boxes.includes(lastBox) ? lastBox.id : null;
  fp.innerHTML = `
    <div class="np-bg"></div>
    <div class="np-top">
      <button class="icon-btn" data-act="close-full" title="닫기"><i class="ic ic-down"></i></button>
      <div class="ctx"></div><span class="np-top-gap"></span>
    </div>
    <div class="np-main">
      <section class="np-deck np-eject">
        ${tapes.length ? `<label class="np-shelf-search"><i class="ic ic-search"></i><input type="search" placeholder="테이프 이름이나 곡으로 찾기" autocomplete="off" spellcheck="false"></label>
        <p class="np-eject-hint"></p>
        ${boxes.length ? `<div class="np-shelf np-box-row" data-hscroll>${boxes.map((b) => `<div class="np-shelf-box" role="button" tabindex="0" data-act="shelf-box" data-bx="${esc(b.id)}" title="「${esc(b.name)}」 상자">${tbox(b)}</div>`).join("")}</div>` : ""}
        <div class="np-shelf np-tape-row" data-hscroll></div>`
        : `<p class="np-eject-hint">꽂을 테이프가 없어요. 라이브러리에서 테이프를 만들어 주세요</p>`}
      </section>
    </div>`;
  if (!tapes.length) return;
  const shelf = $(".np-tape-row", fp), boxRow = $(".np-box-row", fp), hint = $(".np-eject-hint", fp), input = $(".np-shelf-search input", fp);
  const tapeCell = (pl) => `<div class="np-shelf-tape" data-act="insert-tape" data-pl="${esc(pl.id)}">${cassette(pl, bandTrack(pl), { noHeart: true })}</div>`;
  const center = (row, el) => { if (row) row.scrollLeft = el ? el.offsetLeft - (row.clientWidth - el.offsetWidth) / 2 : 0; };
  const boxed = new Set(); boxes.forEach((b) => b.items.forEach((id) => boxed.add(id)));
  // 윗줄: 상자 (고른 상자는 들어 올려 표시) / 아랫줄: 고른 상자의 테이프, 아무 상자도 안 골랐으면 상자 밖 테이프
  const draw = (focusId) => {
    const bx = shelfBox && allBoxes().find((b) => b.id === shelfBox);
    if (boxRow) $$(".np-shelf-box", boxRow).forEach((el) => el.classList.toggle("on", !!bx && el.dataset.bx === bx.id));
    const T = bx ? boxTapes(bx).filter(playable) : tapes.filter((pl) => !boxed.has(pl.id));
    if (!bx) for (const x of tempTapes.filter(playable)) T.splice(Math.min(T.length, Math.floor(x.slot * (T.length + 1))), 0, x);
    shelf.innerHTML = T.map(tapeCell).join("") || `<p class="np-shelf-empty">${bx ? "이 상자엔 꽂을 테이프가 없어요" : "상자 밖에 둔 테이프가 없어요. 위에서 상자를 골라 주세요"}</p>`;
    hint.textContent = bx ? `「${bx.name}」에서 꽂을 테이프를 골라 주세요` : boxes.length ? "상자를 고르거나, 상자 밖 테이프를 골라 주세요" : "꽂을 테이프를 골라 주세요";
    center(shelf, focusId && $(`.np-shelf-tape[data-pl="${CSS.escape(focusId)}"]`, shelf));
  };
  shelfDraw = draw;
  draw(lastTapeId);
  if (shelfBox) center(boxRow, $(`.np-shelf-box[data-bx="${CSS.escape(shelfBox)}"]`, boxRow));
  // 검색: 상자와 상관없이 모든 테이프에서 — 테이프 이름이 맞는 것 먼저, 그다음 담긴 곡의 제목·가수가 맞는 것 (초성 검색도)
  const all = tapes; // 검색은 진짜 테이프만 (임의 테이프는 선반에만 꽂혀 있고 검색에는 나오지 않는다)
  const idx = new Map(all.map((pl) => { const q = U.norm(pl.name); return [pl.id, { q, cho: U.chosung(q) }]; }));
  input.addEventListener("input", () => {
    const raw = input.value.trim(), q = U.norm(raw), cho = U.isChoQuery(raw);
    if (boxRow) boxRow.hidden = !!q; // 찾는 동안엔 상자 줄을 접는다
    if (!q) { draw(); return; }
    const byName = [], bySong = [];
    all.forEach((pl) => {
      const x = idx.get(pl.id);
      if (cho ? x.cho.includes(q) : x.q.includes(q)) byName.push(pl);
      else if (pl.items.some((id) => { const t = L.byId.get(id); return t && (cho ? t._cho.includes(q) : t._q.includes(q)); })) bySong.push(pl);
    });
    const found = byName.concat(bySong);
    shelf.innerHTML = found.map(tapeCell).join(""); shelf.scrollLeft = 0;
    hint.textContent = found.length ? "꽂을 테이프를 골라 주세요" : "찾는 테이프가 없어요";
  });
}
let shelfDraw = null;
// 재생 화면에서만 테이프였던 목록(앨범·가수·곡 목록·선택한 곡 등)을 꺼내면 선반의 테이프들 사이 아무 데나 꽂아 둔다.
// 메모리에만 두므로 프로그램을 닫았다 열면 사라진다. 같은 목록을 또 꺼내면 새로 만들지 않고 그 자리를 그대로 쓴다
const tempTapes = []; let tempSeq = 0;
function keepTempTape() {
  const c = P.context; if (!c || !P.queue.length) return null;
  const ctxKey = JSON.stringify([c.type, c.id || "", c.name || ""]);
  let x = tempTapes.find((t) => t.ctxKey === ctxKey);
  if (!x) { x = { id: "tmp-" + ++tempSeq, ctxKey, slot: Math.random() }; tempTapes.push(x); }
  Object.assign(x, { name: contextTape().name, items: P.queue.slice(), ctx: c });
  return x.id;
}
const tempTape = (id) => tempTapes.find((t) => t.id === id);
function ejectTape(tp) {
  const c = nowCtx(); lastTapeId = c && c.type === "playlist" ? c.id : null; lastBoxId = c && (c.box || (c.type === "box" ? c.id : null)) || null;
  if (!lastTapeId && !lastBoxId) lastTapeId = keepTempTape(); // 진짜 테이프가 아니면 임의 테이프로 선반에
  // 왼쪽이 먼저 들리고, 기운 채로 위로 빠져나간다
  // 손을 뗀 자리에서 그대로 이어서 위로만 움직인다 (되돌아 내려오지 않게)
  const ty = +tp.dataset.ty || 0, rot = +tp.dataset.rot || 0, tilt = Math.max(rot, 12);
  const a = tp.animate([
    { transform: `translateY(${ty}px) rotate(${rot}deg)` },
    { transform: `translateY(${ty - 50}px) rotate(${tilt}deg)`, offset: .25 },
    { transform: `translateY(-125vh) rotate(${tilt + 8}deg)` },
  ], { duration: 520, easing: "cubic-bezier(.4,0,.8,.5)", fill: "forwards" });
  a.onfinish = () => { npEjected = true; npMemo = false; npId = null; P.eject(); renderFull(); };
}
function insertTape(plId) {
  const tmp = tempTape(plId);
  const pl = tmp || tapeById(plId);
  if (!pl) return;
  const ids = pl.items.filter((id) => L.byId.has(id)); if (!ids.length) return;
  npEjected = false; npId = null; npInsert = true;
  // 꽂기만 하고 재생은 사용자가 누를 때. 늘 첫 곡부터 (임의 테이프는 원래 목록 그대로 다시)
  P.playList(ids, 0, tmp ? tmp.ctx : { type: "playlist", id: pl.id, name: pl.name }, { autoplay: false });
  renderFull();
}
// 빈 데크: 선반의 테이프를 아래(데크 쪽)로 끌어 내려도 꽂힌다. 옆으로 미는 건 선반 넘기기
fp.addEventListener("pointerdown", (e) => {
  if (!npEjected) return;
  const st = e.target.closest(".np-shelf-tape[data-pl]"); if (!st) return;
  const tp = $(".tape", st);
  const sx = e.clientX, sy = e.clientY; let dy = 0, drag = false, done = false, ghost = null;
  const mv = (ev) => {
    const rx = ev.clientX - sx, ry = ev.clientY - sy;
    if (!drag && !done) {
      if (Math.abs(rx) > 10 && Math.abs(rx) > Math.abs(ry)) { done = true; return; } // 선반 넘기기
      if (ry > 10 && ry > Math.abs(rx)) {
        drag = true;
        try { st.setPointerCapture(e.pointerId); } catch (err) {}
        // 선반은 옆으로 스크롤되는 상자라 밖으로 끌면 잘린다 → 같은 자리에 띄운 복사본을 움직인다
        const r = tp.getBoundingClientRect();
        ghost = tp.cloneNode(true); ghost.classList.add("tape-ghost");
        Object.assign(ghost.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px" });
        fp.appendChild(ghost); tp.style.visibility = "hidden";
      }
    }
    if (!drag) return;
    dy = Math.max(0, ry);
    ghost.style.transform = `translateY(${dy}px) rotate(${Math.min(8, dy / 30)}deg)`;
  };
  const up = () => {
    window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
    if (!drag) return;
    U._suppressClick = Date.now();
    if (dy > 80) { ghost.remove(); insertTape(st.dataset.pl); return; }
    ghost.style.transition = "transform .22s"; ghost.style.transform = "";
    setTimeout(() => { ghost.remove(); tp.style.visibility = ""; }, 230);
  };
  window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
});
// 재생 중인 테이프를 위로 끌어 올리면 꺼낸다
fp.addEventListener("pointerdown", (e) => {
  if (npEjected) return;
  const tp = e.target.closest(".np-tape-wrap > .tape");
  if (!tp || e.target.closest(".tape-heart")) return;
  const sx = e.clientX, sy = e.clientY; let dy = 0, drag = false, wasPlaying = false;
  const mv = (ev) => {
    const ry = ev.clientY - sy;
    if (!drag && Math.abs(ry) > 6 && Math.abs(ry) > Math.abs(ev.clientX - sx)) {
      drag = true; tp.classList.add("dragging"); try { tp.setPointerCapture(e.pointerId); } catch (err) {}
      // 테이프를 건드리는 순간 멈춘다 (놓으면 이어서, 끝까지 올리면 꺼내기)
      wasPlaying = P.playing; if (wasPlaying) P.pause();
    }
    if (!drag) return;
    dy = Math.min(0, ry) + Math.max(0, ry) * .15; // 아래로는 살짝만 따라온다
    const rot = Math.min(11, -Math.min(0, dy) / 14); // 끌어 올릴수록 왼쪽이 들린다 (오른쪽 아래 모서리를 축으로)
    tp.style.transform = `translateY(${dy * .7}px) rotate(${rot}deg)`;
    tp.dataset.ty = dy * .7; tp.dataset.rot = rot;
  };
  const up = () => {
    window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
    if (!drag) return;
    U._suppressClick = Date.now(); // 끌기가 끝난 자리에서 '누름'으로 처리되지 않게
    tp.classList.remove("dragging");
    if (dy < -90) ejectTape(tp);
    else {
      if (wasPlaying) P.play();
      tp.style.transition = "transform .25s"; tp.style.transform = ""; setTimeout(() => (tp.style.transition = ""), 260); }
  };
  window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
});

function setMemo(on) {
  npMemo = on;
  const w = $(".np-tape-wrap", fp); if (!w) return;
  w.classList.toggle("memo", on);
  if (on) mountLyrics($(".np-memo [data-lyr]", w));
}
function syncFullControls() {
  if (fp.hidden) return;
  const pi = $(".np-play .ic", fp); if (pi) pi.className = "ic " + (P.playing ? "ic-pause" : "ic-play");
  const sh = $('[data-np="shuffle"]', fp); if (sh) sh.classList.toggle("on", P.shuffle);
  const rp = $('[data-np="repeat"]', fp);
  if (rp) { rp.classList.toggle("on", P.repeat !== "off"); rp.firstElementChild.className = "ic " + (P.repeat === "one" ? "ic-repeat1" : "ic-repeat"); }
  $$(".tape.big, .np-side-tape .tape", fp).forEach((tp) => { tp.classList.add("now"); tp.classList.toggle("paused", !P.playing); });
  const fv = $(".tape.big .tape-heart", fp), t = P.current;
  if (fv && t) fv.classList.toggle("on", !!t.fav);
}
function renderNpSide() {
  if (fp.hidden) return;
  const body = $(".np-side-body", fp); if (!body) return;
  const oldBtn = $(".np-side > .lyr-revert", fp); if (oldBtn) oldBtn.remove();
  if (isMobile()) npSide = "queue"; // 폰: 가사는 카세트 자리의 메모지로 본다. PC: 옆 패널에서 재생목록·가사를 바꿔 본다
  $$(".np-tabs [data-v]", fp).forEach((b) => b.classList.toggle("on", b.dataset.v === npSide));
  body.classList.toggle("lyr", npSide === "lyrics");
  if (npSide === "lyrics") { body.innerHTML = `<div class="np-memo paper panel-memo"><div class="np-memo-page"><div data-lyr></div></div></div>`; mountLyrics($("[data-lyr]", body)); }
  else {
    body.innerHTML = queueHtml();
    const nowRow = $(".q-row.now", body); if (nowRow) body.scrollTop = Math.max(0, nowRow.offsetTop - 40);
  }
}
