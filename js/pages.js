// 페이지: 홈, 곡 목록, 테이프·상자·앨범 그림, 아끼는 곡·연대, 앨범·아티스트, 곡 상세, 재생목록, 검색, 라이브러리(폰)
"use strict";

// ───────── 페이지: 홈 ─────────
// 홈의 '아직 만나지 못한 곡' 섹션: 지금은 숨김. 다시 보이려면 true로
const SHOW_UNHEARD = false;
pages.home = () => {
  const T = L.tracks;
  if (!T.length) return `<div class="page"><div class="empty"><b>아직 소장한 곡이 없어요</b>폰에 mp3를 넣고 설정에서 라이브러리를 다시 읽어 주세요.</div></div>`;

  // 최근 들은 테이프: 이 기기에서 들은 내 테이프와 시스템 테이프(앨범·가수·시대·장르·곡 목록·상자), 최근에 들은 순
  const tapes = recentTapes(ROW_MAX);

  const recent = T.filter((t) => t.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed || b.n - a.n).slice(0, 14); // 곡 목록 「최근 들은 순」과 같은 순서
  const fresh = T.slice().sort((a, b) => b.n - a.n).slice(0, 14);
  const rnd = U.seeded(Number(new Date().toISOString().slice(0, 10).replace(/-/g, "")));
  const longAgo = U.pick(T.filter((t) => t.plays >= 3 && t.lastPlayed && U.daysAgo(t.lastPlayed) > 90), 14, rnd);
  const unheard = T.filter((t) => !t.plays);
  const top = T.filter((t) => t.plays).sort((a, b) => b.plays - a.plays).slice(0, 10);
  const topArtists = Array.from(L.artists.values()).filter((r) => r.plays).sort((a, b) => b.plays - a.plays || b.tracks.length - a.tracks.length).slice(0, 14);

  // 발매 연대
  const dec = {}; T.forEach((t) => { if (t.year > 1900) { const d = Math.floor(t.year / 10) * 10; (dec[d] = dec[d] || []).push(t); } });
  const decades = Object.keys(dec).map(Number).sort((a, b) => b - a);

  return `<div class="page">
    ${homeNowHtml()}
    ${tapes.length ? section("최근 들은 테이프", null, `<div class="tape-row" data-hscroll>${tapes.map(recentTapeItem).join("")}</div>`, "#/recent-tapes") : ""}

    ${recent.length ? section("최근 들은 곡", null, `<div class="shelf scroll" data-hscroll>${recent.map((t) => trackCard(t, U.ago(t.lastPlayed) + " · " + t.artist)).join("")}</div>`, "#/collection/sort-recent") : ""}
    ${section("새로 들인 곡", "가장 최근에 컬렉션에 들어온 노래들", `<div class="shelf scroll" data-hscroll>${fresh.map((t) => trackCard(t)).join("")}</div>`, "#/collection/sort-new")}
    ${longAgo.length ? section("오랜만이에요", "한때 자주 들었지만 한동안 못 만난 곡", `<div class="shelf scroll" data-hscroll>${longAgo.map((t) => trackCard(t, "마지막 " + U.ago(t.lastPlayed))).join("")}</div>`) : ""}
    ${SHOW_UNHEARD && unheard.length ? section("아직 만나지 못한 곡", `소장했지만 한 번도 듣지 않은 곡이 ${U.num(unheard.length)}곡 있어요`, `<div class="shelf scroll" data-hscroll>${U.pick(unheard, 14, rnd).map((t) => trackCard(t, t.artist)).join("")}</div>`, "#/collection/unheard") : ""}
    ${top.length ? section("가장 많이 들은 곡", null, trackList("home-top", top, "index")) : ""}
    ${topArtists.length ? section("많이 들은 아티스트", null, `<div class="shelf scroll artist-row" data-hscroll>${topArtists.map((r) => artistCard(r, U.num(r.plays) + "번 재생")).join("")}</div>`, "#/artists/sort-plays") : ""}
    ${decades.length ? section("시대별 컬렉션", null, `<div class="shelf scroll" data-hscroll>${decades.map((d) => `<a class="card" href="#/year/${d}">${mosaic(U.pick(dec[d], 40, U.seeded(d)), 300)}<b>${d}년대</b><span>${U.num(dec[d].length)}곡</span></a>`).join("")}</div>`) : ""}
  </div>`;
};
pages.home.after = () => {};

// ───────── 페이지: 곡 목록 ─────────
const colState = { sort: "new", filter: "all" }; // 폰 DB(Prefs)의 값은 시작할 때 덮어쓴다
// ── 카세트 = 재생목록(믹스테이프). 마스킹 테이프에 재생목록 이름, 아래 띠에 지금(마지막) 곡 ──
const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19.5s-7-4.3-8.5-8.8C2.6 7.4 4.6 4.8 7.5 4.8c1.9 0 3.4 1 4.5 2.7 1.1-1.7 2.6-2.7 4.5-2.7 2.9 0 4.9 2.6 4 5.9-1.5 4.5-8.5 8.8-8.5 8.8z"/></svg>';
// 상자 통째 재생: 곡마다 그 곡이 든 테이프를 기억해 두고(tapeOf), 재생 중인 테이프는 지금 곡이 든 테이프로 친다.
// 곡이 다음 테이프로 넘어가면 재생 화면·홈·위젯의 테이프도, '들은 테이프' 기록도 그 테이프로 바뀐다
function boxCtx(b) {
  const tapeOf = {};
  for (const pl of boxTapes(b)) for (const id of pl.items) if (!(id in tapeOf)) tapeOf[id] = pl.id;
  return { type: "box", id: b.id, name: b.name, tapeOf };
}
// 카세트 띠의 곡 번호: 상자 통째 재생이면 그 테이프 안에서 몇 번째인지, 아니면 대기열 순서
const tapeOrder = (t) => { const c = nowCtx(); if (c && c.box) { const i = contextTape().items.indexOf(t.id); if (i >= 0) return i + 1; } return P.index + 1; };
function nowCtx() {
  const c = P && P.context;
  if (c && c.type === "box" && c.tapeOf && P.currentId) {
    const pl = tapeById(c.tapeOf[P.currentId]);
    if (pl) return { type: "playlist", id: pl.id, name: pl.name, box: c.id };
  }
  return c;
}
const isPlayingPl = (pl) => { const c = P && P.current && nowCtx(); return !!(c && c.type === "playlist" && c.id === pl.id); };
// 띠에 적을 곡: 지금 이 테이프를 듣고 있으면 그 곡, 아니면 마지막으로 들은 곡, 그것도 없으면 첫 곡
function bandTrack(pl) {
  if (isPlayingPl(pl) && pl.items.includes(P.currentId)) return P.current;
  let best = null;
  for (const id of pl.items) { const t = L.byId.get(id); if (t && t.lastPlayed && (!best || t.lastPlayed > best.lastPlayed)) best = t; }
  return best || L.byId.get(pl.items.find((id) => L.byId.has(id)));
}
// 재생 화면의 테이프: 지금 듣는 재생목록 (앨범·컬렉션에서 틀었으면 그 이름으로)
// 홈 맨 위: 왼쪽엔 지금 듣는 테이프 이름, 오른쪽엔 그 테이프. 누르면 재생 화면 (아무것도 안 꽂혀 있으면 빈 테이프 → 꽂을 테이프 고르기)
function homeNowHtml() {
  const t = P && P.current;
  if (!t) return `<section class="home-now" id="home-now">
      <div class="home-now-text"><div class="hero-kicker">데크가 비어 있어요</div><h1>테이프를 꽂아 주세요</h1><p>빈 데크를 누르면 꽂을 테이프를 고를 수 있어요</p></div>
      <div class="home-now-tape empty" data-act="home-now" role="button" tabindex="0" title="꽂을 테이프 고르기">${wellHtml()}</div>
    </section>`;
  const pl = contextTape();
  return `<section class="home-now" id="home-now">
      <div class="home-now-text"><div class="hero-kicker">지금 듣고 있는 테이프</div><h1 class="${pl.name.length > 18 ? "long" : ""}">${esc(pl.name)}</h1><p><b>${esc(t.title)}</b> · ${esc(t.artist)}</p></div>
      <div class="home-now-tape" data-act="home-now" role="button" tabindex="0" title="재생 화면 열기">${cassette(pl, t, { now: true, noHeart: true })}</div>
    </section>`;
}
const refreshHomeNow = () => { const el = $("#home-now"); if (el) el.outerHTML = homeNowHtml(); };
function contextTape() {
  const c = nowCtx() || {};
  if (c.type === "playlist") { const p = tapeById(c.id); if (p) return p; }
  return { id: "ctx", name: c.name || "나의 믹스테이프", items: P.queue };
}
// 테이프 길이: 1:31:20 / 42:05
function fmtTotal(ms) {
  const s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}
function cassette(pl, t, o) {
  o = o || {};
  const hsh = U.hash(String(pl.id) + pl.name);
  const tilt = ((hsh >> 4) % 7 - 3) * 0.5; // 마스킹 테이프를 손으로 붙인 듯 살짝 비뚤게
  const url = t && t.albumKey ? API.artUrl(t.albumKey, o.big ? 640 : 300) : "";
  const cls = `tape${o.big ? " big" : ""}${o.now ? " now" + (P.playing ? "" : " paused") : ""}${t ? "" : " blank"}`;
  // 띠 앞: 그 곡의 순서(#3). 띠 끝: 재생 화면이면 진행 시간, 진열된 테이프면 재생목록 전체 길이
  const order = o.order || (t ? pl.items.indexOf(t.id) + 1 : 0);
  const total = pl.items.reduce((s, id) => s + ((L.byId.get(id) || {}).duration || 0), 0);
  const time = o.big ? `<span data-time="pos">${U.fmtDur(P.pos)}</span> / <span data-time="dur">${U.fmtDur(P.dur)}</span>` : esc(fmtTotal(total));
  return `<div class="${cls}" ${o.attrs || ""} style="--tilt:${tilt}deg;--h:${hsh % 360}">
    <div class="tape-shell"></div>
    <div class="tape-label">
      <div class="tape-skin" style="${U.phStyle(t ? t.albumKey + t.album : pl.name)}">${url ? `<img loading="lazy" decoding="async" alt="" src="${esc(url)}" onerror="this.remove()">` : ""}</div>
      <div class="mtape${o.editName ? " editing" : ""}">${o.editName
        ? `<input class="mtape-input" name="name" form="pl-form" maxlength="60" value="${esc(pl.name)}" placeholder="테이프 제목" autocomplete="off" spellcheck="false" required>`
        : `<span>${esc(pl.name)}</span>`}</div>
      ${t && !o.noHeart ? `<button class="tape-heart${t.fav ? " on" : ""}" data-act="fav" data-id="${esc(t.id)}" title="${t.fav ? "아끼는 곡에서 빼기" : "이 곡을 아끼는 곡으로"}">${HEART}</button>` : ""}
      <div class="tape-window"><i class="reel l"></i><i class="tape-mag"></i><i class="reel r"></i></div>
      <div class="tape-band">${t ? `<span class="tb-song">${order > 0 ? `<em class="tb-no">#${order}</em>` : ""}<b>${esc(t.title)}</b><small>${esc(t.artist)}</small></span>` : `<span class="tb-song"><b>빈 테이프</b><small>곡을 담아 주세요</small></span>`}<span class="tb-pos">${time}</span></div>
    </div>
    <div class="tape-foot"><i></i><i></i><i></i><i></i></div>
  </div>`;
}
// 테이프를 마지막으로 튼 때 (폰 DB에 두어 폰·PC가 같이 본다)
const tapePlayedMap = () => Prefs.get("tapePlayed", {});
// 기록 열쇠: 내 테이프는 재생목록 id 그대로(예전 기록과 이어진다), 시스템이 묶어 주는 목록은 종류:id
// (선택한 곡·검색 결과·홈의 곡 줄처럼 그때그때 달라지는 목록은 남기지 않는다)
function tapeKey(c) {
  if (!c || !c.id) return null;
  if (c.type === "playlist") return c.id;
  if (c.type === "album" || c.type === "artist" || c.type === "box") return c.type + ":" + c.id;
  if (c.type === "collection" && /^(year-|genre-|collection$)/.test(c.id)) return c.id;
  return null;
}
const tempPlayed = {}; // 임의 테이프를 들은 때 (메모리에만 — 임의 테이프와 함께 프로그램을 닫으면 사라진다)
function markTapePlayed() {
  const k = tapeKey(nowCtx()); // 상자 통째 재생이면 상자가 아니라 지금 곡이 든 테이프를 기록
  if (!k) { const id = keepTempTape(); if (id) tempPlayed[id] = Date.now(); } // 선택한 곡·홈 곡 줄·검색 결과 등 → 임의 테이프로
  else {
    Prefs.set({ tapePlayed: { [k]: Date.now() } });
    renderSidebar(); // 사이드바 테이프는 최근에 들은 순
  }
  if (route().name === "home") rerender(); // 홈의 「최근 들은 테이프」도 바로
}
// 기록 열쇠 → 다시 틀 수 있는 테이프 { key, pl(이름·곡), ctx, box? }. 지금 없는 것(지운 재생목록 등)은 null
function sysTape(k) {
  const T = (arr) => arr.map((t) => t.id);
  if (isTempTape(k)) { const x = tempTape(k); return x && { key: k, pl: x, ctx: x.ctx, temp: true }; }
  if (k.startsWith("album:")) { const a = L.albums.get(k.slice(6)); return a && { key: k, pl: { id: a.key, name: a.title, items: T(a.tracks) }, ctx: { type: "album", id: a.key, name: a.title } }; }
  if (k.startsWith("artist:")) { const r = L.artists.get(k.slice(7)); return r && { key: k, pl: { id: r.name, name: r.name, items: T(r.tracks.slice().sort((a, b) => a.n - b.n)) }, ctx: { type: "artist", id: r.name, name: r.name } }; }
  if (k.startsWith("box:")) { const b = allBoxes().find((x) => x.id === k.slice(4)); return b && { key: k, box: b, pl: { id: b.id, name: b.name, items: boxTrackIds(b) }, ctx: boxCtx(b) }; }
  if (k.startsWith("year-")) { const d = parseInt(k.slice(5), 10); const ts = L.tracks.filter((t) => t.year >= d && t.year < d + 10).sort((a, b) => (a.year - b.year) || ko.compare(a.artist, b.artist)); return ts.length && { key: k, pl: { id: k, name: d + "년대", items: T(ts) }, ctx: { type: "collection", id: k, name: d + "년대" } }; }
  if (k.startsWith("genre-")) { const g = k.slice(6); const ts = L.tracks.filter((t) => t.genre === g).sort((a, b) => b.n - a.n); return ts.length && { key: k, pl: { id: k, name: g, items: T(ts) }, ctx: { type: "collection", id: k, name: g } }; }
  if (k === "collection") return { key: k, pl: { id: k, name: "곡 목록", items: T(L.tracks.slice().sort((a, b) => b.n - a.n)) }, ctx: { type: "collection", id: k, name: "곡 목록" } };
  const pl = tapeById(k); return pl && { key: k, pl, ctx: { type: "playlist", id: pl.id, name: pl.name }, mine: true };
}
// 최근 들은 테이프 (내 테이프 + 시스템 테이프), 최근에 들은 순
function recentTapes(max) {
  const m = Object.assign(tapePlayedMap(), tempPlayed), seen = new Set(), out = []; // 왼쪽부터 가장 최근에 들은 순
  for (const k of Object.keys(m).sort((a, b) => m[b] - m[a])) {
    // 상자 기록(예전 방식)은 상자 그림 대신 그 안의 테이프들로
    const keys = k.startsWith("box:") ? (() => { const b = allBoxes().find((x) => x.id === k.slice(4)); return b ? b.items : []; })() : [k];
    for (const kk of keys) {
      if (seen.has(kk)) continue; seen.add(kk);
      const x = sysTape(kk); if (x && x.pl.items.length) out.push(x);
    }
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}
const playingKey = () => { if (!P || !P.current) return null; const k = tapeKey(nowCtx()); if (k) return k; const c = P.context; const x = c && tempTapes.find((t) => t.ctxKey === JSON.stringify([c.type, c.id || "", c.name || ""])); return x ? x.id : null; };
function recentTapeItem(x) {
  if (x.mine) return tapeItem(x.pl);
  const now = playingKey() === x.key;
  if (x.box) return tbox(x.box, { attrs: `data-sys="${esc(x.key)}" role="button" tabindex="0" title="「${esc(x.box.name)}」 상자 재생"` });
  return cassette(x.pl, bandTrack(x.pl), { now, noHeart: true, attrs: `data-sys="${esc(x.key)}" title="「${esc(x.pl.name)}」 재생"` });
}
function playSysTape(k) {
  if (playingKey() === k) { if (!P.playing) P.play(); openFull(); return; }
  reshuffleTape(k); // 랜덤 테이프는 새로 틀 때마다 새 30곡
  const x = sysTape(k); if (!x) return;
  P.playList(x.pl.items.filter((id) => L.byId.has(id)), 0, x.ctx);
}
const tapeItem = (pl) => cassette(pl, bandTrack(pl), { now: isPlayingPl(pl), attrs: `data-pl="${esc(pl.id)}" data-plid="${esc(pl.id)}"` });

// ── 상자 = 테이프를 담아 두는 종이 상자. 테이프 하나는 상자 하나에만 들어간다 ──
const boxHref = (b) => "#/box/" + encodeURIComponent(b.id);
// 상자 안 테이프를 차례로 이어 붙인 곡 목록
const boxTrackIds = (b) => { const out = []; for (const pl of boxTapes(b)) for (const id of pl.items) if (L.byId.has(id)) out.push(id); return out; };
function tbox(b, o) {
  o = o || {};
  const T = boxTapes(b);
  const hsh = U.hash(String(b.id) + b.name);
  const tilt = ((hsh >> 4) % 7 - 3) * 0.6;
  // 세로로 세워 꽂은 테이프들: 위로 삐져나온 부분에 제목 앞부분이 보인다. 앞쪽 다섯 개만, 테이프마다 색·높이가 조금씩 다르다
  const spines = T.slice(0, 5).map((pl) => {
    const h = U.hash(String(pl.id) + pl.name);
    return `<i class="tbox-tape${isPlayingPl(pl) ? " up" : ""}" style="--h:${h % 360};--lift:${(h >> 3) % 5}"><span>${esc(pl.name)}</span></i>`;
  }).join("");
  const now = T.some(isPlayingPl);
  return `<div class="tbox${o.big ? " big" : ""}${b.system ? " is-sysbox" : ""}${T.length ? "" : " is-empty"}${now ? " now" : ""}" ${o.attrs || ""} style="--tilt:${tilt}deg;--h:${hsh % 360}">
    <div class="tbox-back"></div>
    <div class="tbox-tapes">${spines}</div>
    <i class="tbox-flap l"></i><i class="tbox-flap r"></i>
    <div class="tbox-front">
      <i class="tbox-hold"></i>
      <div class="tbox-label"><span>${esc(b.name)}</span></div>
      <div class="tbox-stamp">${T.length ? `TAPE × ${T.length}` : "EMPTY"}</div>
    </div>
  </div>`;
}
const boxItem = (b) => tbox(b, { attrs: `data-box="${esc(b.id)}" role="link" tabindex="0" title="「${esc(b.name)}」 상자 열기"` });

// ── LP 진열대: 앨범 하나 = 재킷 한 장. 그 앨범의 곡을 듣는 중이면 레코드가 빠져나와 돈다 ──
const albumKeyOf = (t) => t.albumKey || "none:" + t.album;
function lpAlbum(a, sub) {
  const now = P && P.current && albumKeyOf(P.current) === a.key;
  const lv = wearOf(Math.round(a.plays / Math.max(1, a.tracks.length))); // 곡당 평균 재생으로 손때
  const url = a.key && !a.key.startsWith("none:") ? API.artUrl(a.key, 300) : "";
  const img = url ? `<img loading="lazy" decoding="async" alt="" src="${esc(url)}" onerror="this.remove()">` : "";
  const ph = U.phStyle(a.key + a.title);
  return `<a class="lp wear-${lv}${now ? " now" + (P.playing ? "" : " paused") : ""}" href="#/album/${encodeURIComponent(a.key)}" data-album="${esc(a.key)}">
    <div class="lp-stage">
      <div class="lp-disc"><div class="lp-center" style="${ph}">${img}</div></div>
      <div class="lp-sleeve" style="${ph}" data-ini="${esc(U.initial(a.title))}">${img}</div>
    </div>
    <div class="lp-meta"><b>${esc(a.title)}</b><span>${esc(sub != null ? sub : (a.year ? a.year + " · " : "") + a.artist)}</span></div>
  </a>`;
}
// ── 목록 화면(곡·테이프·앨범·아티스트) 위의 검색창: 제목·이름, 초성으로 걸러 낸다 ──
const listQ = { collection: "", playlists: "", boxes: "", albums: "", artists: "" };
const LIST_PH = { collection: "곡 목록에서 찾기", playlists: "테이프·곡 찾기", boxes: "상자 찾기", albums: "앨범 찾기", artists: "아티스트 찾기" };
// 머리줄 안에 들어가는 작은 검색창 (나의 테이프의 상자·테이프 갈래마다)
const headSearch = (k) => `<label class="search-box head-search"><i class="ic ic-search"></i><input type="search" data-act="list-q" data-k="${k}" placeholder="${LIST_PH[k]}" value="${esc(listQ[k])}" autocomplete="off" spellcheck="false"></label>`;
// lead: 검색창 왼쪽에 붙일 버튼 (곡 목록의 여러 곡 선택 체크상자), tail: 같은 줄 오른쪽 끝 (곡 목록의 정렬)
const listSearch = (k, lead, tail) => `<div class="list-search${lead || tail ? " with-lead" : ""}">${lead || ""}<label class="search-box"><i class="ic ic-search"></i><input type="search" data-act="list-q" data-k="${k}" placeholder="${LIST_PH[k]}" value="${esc(listQ[k])}" autocomplete="off" spellcheck="false"></label>${tail || ""}</div>`;
function qTest(raw) {
  const q = U.norm(raw); if (!q) return null;
  const cho = U.isChoQuery(raw.trim());
  return (o) => (cho ? o._cho : o._q).includes(q);
}
const noHit = (k) => `<div class="empty"><b>「${esc(listQ[k].trim())}」에 맞는 ${{ collection: "곡이", playlists: "테이프가", albums: "앨범이", artists: "아티스트가" }[k]} 없어요</b></div>`;
function tapeTest(raw) {
  const q = U.norm(raw); if (!q) return null;
  const cho = U.isChoQuery(raw.trim());
  return (pl) => { const n = U.norm(pl.name); if ((cho ? U.chosung(n) : n).includes(q)) return true; return pl.items.some((id) => { const t = L.byId.get(id); return t && (cho ? t._cho : t._q).includes(q); }); };
}
const LIST_FILL = {
  collection() {
    const hit = qTest(listQ.collection);
    let T = collectionTracks(colState.filter, colState.sort);
    if (hit) T = T.filter(hit);
    lists.collection = T.map((t) => t.id);
    const box = $("#col-list"); if (!box) return;
    // 3천 곡을 한 번에 그리면 폰에서 버벅이므로 스크롤해서 끝에 가까워질 때만 이어서 그린다
    box.innerHTML = !T.length ? (hit ? noHit("collection") : `<div class="empty"><b>해당하는 곡이 없어요</b></div>`)
      : colState.sort === "year" ? yearGroups(T, (t) => t.year, (t) => trackCard(t), "shelf", "곡")
      : `<div class="shelf">${lazyItems(T, (t) => trackCard(t), 48, 48)}</div>`;
  },
  albums() {
    const hit = qTest(listQ.albums); let A = sortedAlbums(); if (hit) A = A.filter(hit);
    const box = $("#lib-grid"); if (box) box.innerHTML = !A.length ? noHit("albums")
      : libSort.albums === "year" ? yearGroups(A, (a) => a.year, (a) => lpAlbum(a), "lp-grid", "장")
      : `<div class="lp-grid">${lazyItems(A, (a) => lpAlbum(a))}</div>`;
  },
  artists() {
    const hit = qTest(listQ.artists); let R = sortedArtists(); if (hit) R = R.filter(hit);
    const box = $("#lib-grid"); if (box) box.innerHTML = R.length ? `<div class="shelf artist-grid">${lazyItems(R, artistCard, 45, 45)}</div>` : noHit("artists");
  },
  // 나의 테이프 → 테이프: 평소엔 상자 밖 테이프만, 찾을 때는 상자 안 테이프까지
  playlists() {
    const grid = $("#tape-grid"), sub = $("#tape-sub"); if (!grid) return;
    const hit = tapeTest(listQ.playlists);
    const boxed = new Set(); allBoxes().forEach((b) => b.items.forEach((id) => boxed.add(id)));
    const T = tapeSorted(sortedTapes().filter(hit || ((pl) => !boxed.has(pl.id)))); // 찾을 때는 상자 안 테이프까지 (임의 테이프는 넣지 않는다)
    sub.textContent = hit ? `찾은 테이프 ${U.num(T.length)}개 (상자 안 포함)` : boxed.size ? `상자 밖 ${U.num(T.length)}개` : `${U.num(T.length)}개`;
    grid.innerHTML = T.length ? `<div class="tape-grid">${lazyItems(T, tapeItem, 16, 10)}</div>` : hit ? noHit("playlists") : "";
  },
  // 나의 테이프 → 상자: 상자 이름, 또는 안에 든 테이프 이름으로 찾는다 (곡으로 찾기는 테이프 검색에서)
  boxes() {
    const grid = $("#box-grid"), sub = $("#box-sub"); if (!grid) return;
    const raw = listQ.boxes, q = U.norm(raw), cho = U.isChoQuery(raw.trim()), hit = !!q;
    const nameHit = (name) => { const n = U.norm(name); return (cho ? U.chosung(n) : n).includes(q); };
    const AB = allBoxes();
    const B = tapeSorted(hit ? AB.filter((b) => nameHit(b.name) || boxTapes(b).some((pl) => nameHit(pl.name))) : AB, true);
    sub.textContent = hit ? `찾은 상자 ${B.length}개` : AB.length ? `${AB.length}개 · 아래 테이프를 끌어다 상자에 넣을 수 있어요` : "「새 상자」로 만들어 테이프를 나눠 담아 두세요";
    grid.innerHTML = B.length ? `<div class="tape-grid box-grid">${B.map(boxItem).join("")}</div>` : hit ? `<div class="empty" style="padding:24px"><b>찾는 상자가 없어요</b></div>` : "";
  },
};
// 검색어를 바꿀 때는 목록 부분만 다시 그린다 (입력칸 포커스가 그대로 남게)
const refillList = U.debounce((k) => {
  if (!LIST_FILL[k] || !$(`[data-act="list-q"][data-k="${k}"]`, view)) return;
  for (const key in LZ) delete LZ[key];
  LIST_FILL[k](); mountLazy(0);
  if (SEL.on) syncSel();
}, 140);

const FILTERS = [["all", "전체"], ["fav", "아끼는 곡"], ["unheard", "아직 안 들은 곡"], ["memo", "메모 있는 곡"], ["heavy", "단골 이상"]];
const SORTS = [["new", "최근 수집순"], ["old", "처음 수집순"], ["recent", "최근 들은 순"], ["title", "제목순"], ["artist", "아티스트순"], ["plays", "많이 들은 순"], ["year", "발매일순"]];
const ko = new Intl.Collator("ko");
function collectionTracks(filter, sort) {
  let T = L.tracks.slice();
  if (filter === "fav") T = T.filter((t) => t.fav);
  else if (filter === "unheard") T = T.filter((t) => !t.plays);
  else if (filter === "memo") T = T.filter((t) => t.memo);
  else if (filter === "heavy") T = T.filter((t) => t.plays >= 20);
  return T.sort(trackCmp(sort));
}
function trackCmp(sort) {
  return {
    new: (a, b) => b.n - a.n, old: (a, b) => a.n - b.n,
    recent: (a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0) || b.n - a.n, // 한 번도 안 들은 곡은 뒤로 (그 안에선 최근 수집순)
    title: (a, b) => ko.compare(a.title, b.title), artist: (a, b) => ko.compare(a.artist, b.artist) || ko.compare(a.album, b.album) || (a.track || 0) - (b.track || 0),
    plays: (a, b) => b.plays - a.plays || (b.lastPlayed || 0) - (a.lastPlayed || 0), year: (a, b) => (b.year || 0) - (a.year || 0) || b.n - a.n,
  }[sort] || ((a, b) => b.n - a.n);
}
pages.collection = (arg) => {
  // 필터 칩은 없앴다. 주소로 들어온 필터(#/collection/unheard 등)만 쓰고, 그냥 들어오면 전체
  // #/collection/sort-recent 처럼 들어오면 그 정렬로 연다 (홈의 「모두 보기」)
  if (arg && arg.startsWith("sort-") && SORTS.some(([k]) => k === arg.slice(5))) { colState.sort = arg.slice(5); saveCol(); }
  colState.filter = arg && FILTERS.some((f) => f[0] === arg) ? arg : "all";
  $("#topbar-title").textContent = "곡 목록";
  return `<div class="page">
    <div class="hero"><div class="hero-text">
      <h1>곡 목록</h1>
      <div class="hero-meta"><b>${U.num(L.tracks.length)}곡</b><span class="sep"></span><span>${U.fmtLong(L.tracks.reduce((s, t) => s + (t.duration || 0), 0))}</span></div>
    </div></div>
    <div class="actions">
      <button class="play-fab" data-act="list-play" data-list="collection" title="재생"><i class="ic ic-play"></i></button>
      <button class="icon-btn${P.shuffle ? " on" : ""}" data-act="list-shuffle" data-list="collection" title="셔플 재생"><i class="ic ic-shuffle"></i></button>
    </div>
    ${listSearch("collection", selBtn("collection", true), `<label class="select list-tail"><select data-act="col-sort">${SORTS.map(([k, n]) => `<option value="${k}"${k === colState.sort ? " selected" : ""}>${n}</option>`).join("")}</select></label>`)}
    <div data-list="collection" id="col-list"></div>
  </div>`;
};
pages.collection.after = () => LIST_FILL.collection();

// ───────── 페이지: 아끼는 곡 / 연대 ─────────
pages.liked = () => {
  const T = L.tracks.filter((t) => t.fav).sort((a, b) => (b.favAt || b.n) - (a.favAt || a.n));
  $("#topbar-title").textContent = "아끼는 곡";
  setTint("350 40% 30%");
  return `<div class="page">
    <div class="hero">${heroTape(likedPl(), "liked")}<div class="hero-text"><div class="hero-kicker">테이프</div><h1>아끼는 곡</h1><div class="hero-meta"><b>${T.length}곡</b><span class="sep"></span><span>${U.fmtLong(T.reduce((s, t) => s + t.duration, 0))}</span></div></div></div>
    <div class="actions"><button class="play-fab" data-act="list-play" data-list="liked"><i class="ic ic-play"></i></button><button class="icon-btn" data-act="list-shuffle" data-list="liked" title="셔플 재생"><i class="ic ic-shuffle"></i></button>${T.length ? selBtn("liked") : ""}</div>
    ${T.length ? trackList("liked", T, "index") : `<div class="empty"><b>아직 아끼는 곡이 없어요</b>곡 옆의 하트를 눌러 담아 보세요.</div>`}
  </div>`;
};
pages.year = (arg) => {
  const d = parseInt(arg, 10);
  const T = L.tracks.filter((t) => t.year >= d && t.year < d + 10).sort((a, b) => (a.year - b.year) || ko.compare(a.artist, b.artist));
  $("#topbar-title").textContent = d + "년대";
  setTint(U.hue(String(d)) + " 30% 28%");
  return `<div class="page">
    <div class="hero">${collectionTape("year-" + d, d + "년대", T, "year")}<div class="hero-text"><div class="hero-kicker">시대별 컬렉션</div><h1>${d}년대</h1><div class="hero-meta"><b>${T.length}곡</b><span class="sep"></span><span>${d}~${d + 9}년에 나온 테이프 박스 속 곡</span></div></div></div>
    <div class="actions"><button class="play-fab" data-act="list-play" data-list="year"><i class="ic ic-play"></i></button><button class="icon-btn" data-act="list-shuffle" data-list="year"><i class="ic ic-shuffle"></i></button>${selBtn("year")}</div>
    ${trackList("year", T, "collection")}
  </div>`;
};

// ───────── 페이지: 앨범·아티스트 ─────────
const libSort = { albums: "recent", artists: "count", playlists: "recent", boxes: "recent", artistSongs: "old" }; // 폰 DB(Prefs)의 값은 시작할 때 덮어쓴다
const saveLibSort = () => Prefs.set({ libSort: Object.assign({}, libSort) });
function sortedAlbums() {
  const A = Array.from(L.albums.values());
  const s = libSort.albums;
  return A.sort(s === "name" ? (a, b) => ko.compare(a.title, b.title) : s === "artist" ? (a, b) => ko.compare(a.artist, b.artist) || (a.year || 0) - (b.year || 0) : s === "year" ? (a, b) => (b.year || 0) - (a.year || 0) : s === "plays" ? (a, b) => b.plays - a.plays : (a, b) => b.addedAt - a.addedAt);
}
function sortedArtists() {
  const R = Array.from(L.artists.values());
  const s = libSort.artists;
  return R.sort(s === "name" ? (a, b) => ko.compare(a.name, b.name) : s === "plays" ? (a, b) => b.plays - a.plays : s === "first" ? (a, b) => a.first - b.first : (a, b) => b.tracks.length - a.tracks.length);
}
// 나의 테이프 순서: 최근에 틀어 본 테이프부터, 안 틀어 본 건 그 뒤에 (아끼는 곡 먼저) 최근에 고친 순
// 나의 테이프 정렬: 최근 들은 순(기본) · 최근 만든 순 · 이름순. 상자도 같은 기준
const TAPE_SORTS = [["recent", "최근 들은 순"], ["made", "최근 만든 순"], ["name", "이름순"]];
function tapeSorted(list, isBox) {
  if (isBox) return pinSystemBoxes(tapeSortedRaw(list, true));
  return tapeSortedRaw(list, false);
}
function tapeSortedRaw(list, isBox) {
  const k = isBox ? libSort.boxes : libSort.playlists, played = tapePlayedMap(), key = (x) => (isBox ? "box:" : "") + x.id;
  if (k === "name") return list.slice().sort((a, b) => ko.compare(a.name, b.name));
  if (k === "made") return list.slice().sort((a, b) => (b.created || 0) - (a.created || 0)); // 아끼는 곡(만든 날 없음)은 맨 뒤
  return isBox ? list.slice().sort((a, b) => (played[key(b)] || 0) - (played[key(a)] || 0) || (b.updated || 0) - (a.updated || 0)) : list; // 테이프는 sortedTapes()가 이미 최근 들은 순
}
// 상자를 최근에 들은 순으로 (상자 안 테이프 중 가장 최근에 들은 때, 같으면 원래 순서)
function boxesByRecent(list) {
  const played = tapePlayedMap(), at = (b) => Math.max(played["box:" + b.id] || 0, ...b.items.map((id) => played[id] || 0));
  return pinSystemBoxes(list.slice().sort((a, b) => at(b) - at(a)));
}
function sortedTapes() {
  const played = tapePlayedMap();
  return (sysHidden() ? [] : SYS_IDS.map(systemTape)).concat(histHidden() ? [] : histBox().items.map(histTape).filter(Boolean), L.playlists).sort((a, b) => (played[b.id] || 0) - (played[a.id] || 0) || (b.id === "liked") - (a.id === "liked") || (b.updated || 0) - (a.updated || 0));
}
pages.albums = () => {
  const A = sortedAlbums();
  const s = libSort.albums;
  $("#topbar-title").textContent = "앨범";
  return `<div class="page">
    <div class="section-head with-tool" style="margin-top:8px"><div><h2 style="font-size:30px">앨범</h2><p>${U.num(A.length)}장</p></div>
    <div class="head-tools">${headSearch("albums")}<label class="select"><select data-act="lib-sort" data-k="albums">${[["recent", "최근 수집순"], ["name", "이름순"], ["artist", "아티스트순"], ["year", "발매연도순"], ["plays", "많이 들은 순"]].map(([k, n]) => `<option value="${k}"${k === s ? " selected" : ""}>${n}</option>`).join("")}</select></label></div></div>
          <div id="lib-grid"></div></div>`;
};
pages.albums.after = () => LIST_FILL.albums();
pages.artists = (arg) => {
  if (arg === "sort-plays") { libSort.artists = "plays"; saveLibSort(); } // 홈 「많이 들은 아티스트」의 모두 보기
  const R = sortedArtists();
  const s = libSort.artists;
  $("#topbar-title").textContent = "아티스트";
  return `<div class="page">
    <div class="section-head with-tool" style="margin-top:8px"><div><h2 style="font-size:30px">아티스트</h2><p>${U.num(R.length)}명</p></div>
    <div class="head-tools">${headSearch("artists")}<label class="select"><select data-act="lib-sort" data-k="artists">${[["count", "테이프 박스 속 곡 많은 순"], ["name", "이름순"], ["plays", "많이 들은 순"], ["first", "처음 만난 순"]].map(([k, n]) => `<option value="${k}"${k === s ? " selected" : ""}>${n}</option>`).join("")}</select></label></div></div>
          <div id="lib-grid"></div></div>`;
};
pages.artists.after = () => LIST_FILL.artists();
pages.album = (key) => {
  const a = L.albums.get(key);
  if (!a) return notFound();
  const T = a.tracks;
  const plays = T.reduce((s, t) => s + t.plays, 0);
  tintFromArt(a);
  $("#topbar-title").textContent = a.title;
  const more = Array.from(L.albums.values()).filter((x) => x.key !== a.key && x.artist === a.artist).sort((x, y) => (y.year || 0) - (x.year || 0));
  return `<div class="page">
    <div class="hero">${art(a, 600)}<div class="hero-text">
      <div class="hero-kicker">앨범</div><h1 class="${a.title.length > 22 ? "long" : ""}">${esc(a.title)}</h1>
      <div class="hero-meta"><b><a href="#/artist/${encodeURIComponent(splitArtists(a.artist)[0])}">${esc(a.artist)}</a></b>${a.year ? `<span class="sep"></span><span>${a.year}</span>` : ""}<span class="sep"></span><span>소장 ${T.length}곡, ${U.fmtLong(T.reduce((s, t) => s + t.duration, 0))}</span></div>
    </div></div>
    <div class="actions">
      <button class="play-fab" data-act="list-play" data-list="album"><i class="ic ic-play"></i></button>
      <button class="icon-btn" data-act="list-shuffle" data-list="album" title="셔플 재생"><i class="ic ic-shuffle"></i></button>
      ${selBtn("album")}
      <span class="dimmer" style="font-size:13px">모두 ${U.num(plays)}번 재생</span>
    </div>
    ${trackList("album", T, "album")}
    ${more.length ? section(a.artist + "의 다른 앨범", null, `<div class="shelf scroll" data-hscroll>${more.map((x) => albumCard(x, (x.year || "") + " · " + x.tracks.length + "곡")).join("")}</div>`) : ""}
  </div>`;
};
// 아티스트의 앨범 모두 보기: 발매 연도별로 묶어서
pages["artist-albums"] = (name) => {
  const r = L.artists.get(name);
  if (!r) return notFound();
  $("#topbar-title").textContent = r.name + "의 앨범";
  const albums = Array.from(r.albums).map((k) => L.albums.get(k)).sort((a, b) => (b.year || 0) - (a.year || 0) || ko.compare(a.title, b.title));
  return `<div class="page">
    <div class="section-head" style="margin-top:8px"><div><h2 style="font-size:30px"><a href="#/artist/${encodeURIComponent(r.name)}">${esc(r.name)}</a>의 앨범</h2><p>${albums.length}장</p></div></div>
    ${yearGroups(albums, (a) => a.year, (a) => lpAlbum(a, "소장 " + a.tracks.length + "곡"), "lp-grid", "장")}
  </div>`;
};
pages.artist = (name) => {
  const r = L.artists.get(name);
  if (!r) return notFound();
  const top = topAlbumOf(r);
  tintFromArt(top);
  $("#topbar-title").textContent = r.name;
  const T = r.tracks.slice().sort(trackCmp(libSort.artistSongs));
  const hot = r.tracks.filter((t) => t.plays).sort((a, b) => b.plays - a.plays).slice(0, 5);
  const albums = Array.from(r.albums).map((k) => L.albums.get(k)).sort((a, b) => (b.year || 0) - (a.year || 0));
  const firstT = r.tracks.reduce((a, b) => (b.n < a.n ? b : a));
  const songSort = `<label class="select"><select data-act="lib-sort" data-k="artistSongs">${SORTS.filter(([k]) => k !== "artist").map(([k, n]) => `<option value="${k}"${k === libSort.artistSongs ? " selected" : ""}>${n}</option>`).join("")}</select></label>`;
  return `<div class="page">
    <div class="hero round">${art(top, 600)}<div class="hero-text">
      <div class="hero-kicker">아티스트</div><h1>${esc(r.name)}</h1>
      <div class="hero-meta"><b>소장 ${r.tracks.length}곡</b><span class="sep"></span><span>앨범 ${albums.length}장</span><span class="sep"></span><span>${U.num(r.plays)}번 재생</span></div>
    </div></div>
    <div class="actions">
      <button class="play-fab" data-act="list-play" data-list="artist-all"><i class="ic ic-play"></i></button>
      <button class="icon-btn" data-act="list-shuffle" data-list="artist-all" title="셔플 재생"><i class="ic ic-shuffle"></i></button>
      ${selBtn("artist-all")}
      <span class="dimmer" style="font-size:13px">${U.fmtDateKo(r.first)}, 「${esc(firstT.title)}」로 처음 만났어요</span>
    </div>
    ${hot.length ? section("내가 많이 들은 곡", null, trackList("artist-hot", hot, "index")) : ""}
    ${section("앨범", `${albums.length}장`, `<div class="lp-row" data-hscroll>${albums.map((a) => lpAlbum(a, (a.year ? a.year + " · " : "") + "소장 " + a.tracks.length + "곡")).join("")}</div>`, "#/artist-albums/" + encodeURIComponent(r.name))}
    ${section("소장한 모든 곡", `${r.tracks.length}곡`, trackList("artist-all", T, "collection"), null, songSort)}
  </div>`;
};

// ───────── 페이지: 곡 상세보기 ─────────
pages.track = (id) => {
  const t = L.byId.get(id);
  if (!t) return notFound();
  tintFromArt(t);
  $("#topbar-title").textContent = t.title;
  topMore("more", "더 보기", t.id);
  const albumT = (L.albums.get(t.albumKey) || { tracks: [] }).tracks;
  const inLists = L.playlists.filter((p) => p.items.includes(t.id));
  const rank = L.tracks.filter((x) => x.plays > t.plays).length + 1;
  return `<div class="page">
    <div class="hero"><div class="hero-art">${art(t, 600)}<button class="icon-btn hero-fav${t.fav ? " on" : ""}" data-act="fav" data-id="${esc(t.id)}" title="${t.fav ? "아끼는 곡에서 빼기" : "아끼는 곡으로"}"><i class="ic ${t.fav ? "ic-heart-fill" : "ic-heart"}"></i></button></div><div class="hero-text">
      <div class="hero-kicker">곡</div><h1 class="${t.title.length > 22 ? "long" : ""}">${esc(t.title)}</h1>
      <div class="hero-meta"><b>${artistLinks(t)}</b>${t.album ? `<span class="sep"></span><a href="${albumHref(t)}">${esc(t.album)}</a>` : ""}${t.year ? `<span class="sep"></span><span>${t.year}</span>` : ""}<span class="sep"></span><span>${U.fmtDur(t.duration)}</span></div>
    </div></div>
    <div class="actions">
      <button class="play-fab" data-act="track-play" data-id="${esc(t.id)}"><i class="ic ic-play"></i></button>
    </div>
    <div class="plaque">
      <div><span>수집한 날</span><b>${U.fmtDate(t.addedAt)}</b></div>
      <div><span>들은 횟수</span><b>${U.num(t.plays)}<small>회${t.plays ? " · " + U.num(rank) + "위" : ""}</small></b></div>
      <div><span>함께한 시간</span><b>${U.fmtLong(t.listenedMs)}</b></div>
      <div><span>처음 들은 날</span><b>${t.firstPlayed ? U.fmtDate(t.firstPlayed) : "—"}</b></div>
      <div><span>마지막으로 들은 날</span><b>${t.lastPlayed ? U.ago(t.lastPlayed) : "—"}</b></div>
    </div>
    <div class="memo-box"><h3>이 곡에 남기는 메모</h3>
      <textarea data-act="memo" data-id="${esc(t.id)}" placeholder="이 노래를 처음 들은 곳, 떠오르는 사람, 그때의 계절…">${esc(t.memo || "")}</textarea>
      <div class="hint"><span>${inLists.length ? "담긴 테이프: " + inLists.map((p) => `<a href="#/playlist/${encodeURIComponent(p.id)}" style="color:var(--text-2)">${esc(p.name)}</a>`).join(", ") : ""}</span><span id="memo-state"></span></div>
    </div>
    <div class="lyr-box"><h3>가사</h3><pre id="track-lyrics" class="dimmer">불러오는 중…</pre></div>
    ${albumT.length > 1 ? section("테이프 박스 속 같은 앨범 곡", t.album, trackList("track-album", albumT, "album")) : ""}
    <p class="dimmer" style="font-size:12px;margin-top:30px">${t.genre ? esc(t.genre) + " · " : ""}${t.track ? (t.disc > 1 ? t.disc + "-" : "") + t.track + "번 트랙" : ""}</p>
  </div>`;
};
pages.track.after = (id) => {
  getLyrics(id).then((d) => {
    const el = $("#track-lyrics"); if (!el) return;
    const text = d && d.synced ? d.synced.map((l) => l[1]).join("\n") : d && d.plain;
    el.textContent = text ? text.trim() : d && d.failed ? "폰과 연결이 끊겨 가사를 불러오지 못했어요" : "가사가 없어요";
    el.classList.toggle("dimmer", !text);
  });
};

// ───────── 페이지: 재생목록 ─────────
let plEdit = false, boxEdit = false; // 재생목록·상자 편집 중 (다른 화면으로 가면 끝)
function sysTapePage(id) {
  const p = tapeById(id); if (!p) return notFound();
  const T = p.items.map((i) => L.byId.get(i)).filter(Boolean), bx = boxOf(id);
  $("#topbar-title").textContent = p.name;
  if (T[0]) tintFromArt(T[0]); else setTint("30 10% 22%");
  return `<div class="page">
    <div class="hero">${heroTape(p, "playlist")}<div class="hero-text">
      <div class="hero-kicker">${bx ? `<a href="${boxHref(bx)}" class="kicker-box"><i class="ic ic-box"></i>${esc(bx.name)}</a>` : "테이프"}</div><h1 class="${p.name.length > 20 ? "long" : ""}">${esc(p.name)}</h1>
      <p class="hero-desc">${esc(p.desc || "")}</p>
      <div class="hero-meta"><b>${T.length}곡</b><span class="sep"></span><span>${U.fmtLong(T.reduce((s, t) => s + t.duration, 0))}</span></div>
    </div></div>
    <div class="actions">
      <button class="play-fab" data-act="list-play" data-list="playlist"><i class="ic ic-play"></i></button>
      <button class="icon-btn" data-act="list-shuffle" data-list="playlist" title="셔플 재생"><i class="ic ic-shuffle"></i></button>
      ${T.length ? selBtn("playlist") : ""}
    </div>
    ${T.length ? trackList("playlist", T, "index") : `<div class="empty" style="padding:24px"><b>아직 담긴 곡이 없어요</b>기록이 쌓이면 저절로 채워져요.</div>`}
  </div>`;
}
pages.playlist = (id) => {
  if (isSysTape(id) && id !== "liked") return sysTapePage(id); // 시스템·히스토리 테이프는 보기만
  const p = L.playlists.find((x) => x.id === id);
  if (!p) return notFound();
  const T = p.items.map((i) => L.byId.get(i)).filter(Boolean);
  $("#topbar-title").textContent = p.name;
  topMore("pl-more", "테이프 메뉴");
  if (T[0]) tintFromArt(T[0]); else setTint("30 10% 22%");
  return `<div class="page">
    <div class="hero">${heroTape(p, "playlist")}<div class="hero-text">
      <div class="hero-kicker">테이프${boxOf(p.id) ? ` · <a href="${boxHref(boxOf(p.id))}" class="kicker-box"><i class="ic ic-box"></i>${esc(boxOf(p.id).name)}</a>` : ""}</div><h1 class="${p.name.length > 20 ? "long" : ""}">${esc(p.name)}</h1>
      ${p.desc ? `<p class="hero-desc">${esc(p.desc)}</p>` : ""}
      <div class="hero-meta"><b>${T.length}곡</b><span class="sep"></span><span>${U.fmtLong(T.reduce((s, t) => s + t.duration, 0))}</span>${p.created ? `<span class="sep"></span><span>${U.fmtDate(p.created)}에 만듦</span>` : ""}</div>
    </div></div>
    <div class="actions">
      <button class="play-fab" data-act="list-play" data-list="playlist"><i class="ic ic-play"></i></button>
      <button class="icon-btn" data-act="list-shuffle" data-list="playlist" title="셔플 재생"><i class="ic ic-shuffle"></i></button>
      ${T.length && !plEdit ? selBtn("playlist") : ""}
    </div>
    ${T.length ? editBar("pl-edit", plEdit, true) : ""}
    ${T.length ? trackList("playlist", T, plEdit ? "edit" : "index", editTool("pl-edit", plEdit)) : `<div class="empty" style="padding:24px"><b>아직 비어 있어요</b>아래 「곡 추가하기」로 담거나, 곡 메뉴의 「테이프에 담기」를 써 보세요.</div>`}
    ${plEdit || !T.length ? `<div class="tracklist"><button class="row add-row" data-act="pl-add-open"><span class="ck off"></span><span class="no"><i class="ic ic-plus"></i></span><span class="t"><b>곡 추가하기</b></span></button></div>` : ""}
  </div>`;
};
// 상세 화면 맨 위 줄(뒤로 버튼 줄) 오른쪽 끝의 점 세 개 메뉴
const topMore = (act, title, id) => { $("#topbar-extra").innerHTML = `<button class="round-btn" data-act="${act}"${id ? ` data-id="${esc(id)}"` : ""} title="${esc(title)}"><i class="ic ic-more"></i></button>`; };
// 목록 바로 위 오른쪽의 편집 버튼 (편집 중에는 「완료」)
// 표 머리줄 안에 넣는 편집 버튼 (PC). 편집 중에는 체크 표시로 끝낸다
const editTool = (act, on) => `<button class="icon-btn${on ? " on" : ""}" data-act="${act}" title="${on ? "편집 끝내기" : "편집 (순서 바꾸기·빼기·추가)"}"><i class="ic ${on ? "ic-check" : "ic-pen"}"></i></button>`;
// mOnly: 표 머리줄이 없는 폰에서만 보이는 줄 (PC는 editTool)
const editBar = (act, on, mOnly) => `<div class="edit-bar${mOnly ? " m-only" : ""}">${on
  ? `<button class="btn primary" data-act="${act}"><i class="ic ic-check"></i>완료</button>`
  : `<button class="icon-btn" data-act="${act}" title="편집 (순서 바꾸기·빼기·추가)"><i class="ic ic-pen"></i></button>`}</div>`;
pages.playlist.after = (id) => { if (plEdit) enableDrag(id); };

function enableDrag(pid) {
  const box = $('.tracklist[data-list="playlist"]'); if (!box) return;
  let drag = null;
  box.addEventListener("pointerdown", (e) => {
    const h = e.target.closest("[data-handle]"); if (!h) return;
    const rowEl = h.closest(".row"); e.preventDefault();
    drag = { el: rowEl, from: +rowEl.dataset.i, to: +rowEl.dataset.i };
    rowEl.classList.add("dragging"); h.setPointerCapture(e.pointerId);
  });
  box.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const rows = $$(".row", box);
    rows.forEach((r) => r.classList.remove("drop-before", "drop-after"));
    const over = document.elementFromPoint(e.clientX, e.clientY);
    const r = over && over.closest(".row[data-i]"); if (!r || !box.contains(r)) return;
    const rect = r.getBoundingClientRect(); const after = e.clientY > rect.top + rect.height / 2;
    r.classList.add(after ? "drop-after" : "drop-before");
    let to = +r.dataset.i + (after ? 1 : 0); if (to > drag.from) to--;
    drag.to = to;
    // 가장자리에 가면 자동 스크롤
    const vr = view.getBoundingClientRect();
    if (e.clientY < vr.top + 80) view.scrollTop -= 12; else if (e.clientY > vr.bottom - 80) view.scrollTop += 12;
  });
  const end = () => {
    if (!drag) return;
    const { from, to } = drag; drag = null;
    $$(".row", box).forEach((r) => r.classList.remove("drop-before", "drop-after", "dragging"));
    if (from !== to) {
      const p = L.playlists.find((x) => x.id === pid);
      const items = p.items.slice(); const [x] = items.splice(from, 1); items.splice(to, 0, x);
      savePlaylist(p, { items });
    }
  };
  box.addEventListener("pointerup", end); box.addEventListener("pointercancel", end);
}

// 재생목록(대기열) 줄: 오른쪽 손잡이(가로줄 세 개)를 잡고 끌어 순서를 바꾼다
document.addEventListener("pointerdown", (e) => {
  const h = e.target.closest(".q-grip"); if (!h) return;
  const rowEl = h.closest(".q-row[data-q]"), box = rowEl && rowEl.closest(".queue"); if (!box) return;
  e.preventDefault(); e.stopPropagation();
  const scroller = box.closest(".np-side-body, #panel-body");
  const from = +rowEl.dataset.q; let to = from;
  rowEl.classList.add("dragging");
  try { h.setPointerCapture(e.pointerId); } catch (err) {}
  const clear = () => $$(".q-row", box).forEach((r) => r.classList.remove("drop-before", "drop-after"));
  const mv = (ev) => {
    clear();
    const over = document.elementFromPoint(ev.clientX, ev.clientY);
    const r = over && over.closest(".q-row[data-q]");
    if (r && box.contains(r) && !r.classList.contains("now")) {
      const rect = r.getBoundingClientRect(), after = ev.clientY > rect.top + rect.height / 2;
      r.classList.add(after ? "drop-after" : "drop-before");
      to = +r.dataset.q + (after ? 1 : 0); if (to > from) to--;
    }
    if (scroller) { const sr = scroller.getBoundingClientRect(); if (ev.clientY < sr.top + 50) scroller.scrollTop -= 10; else if (ev.clientY > sr.bottom - 50) scroller.scrollTop += 10; }
  };
  const up = () => {
    window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
    clear(); rowEl.classList.remove("dragging");
    U._suppressClick = Date.now(); // 놓은 자리의 줄이 눌린 것으로 처리되지 않게
    if (to !== from && to > P.index) P.move(from, to);
  };
  window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
}, true);

function savePlaylist(p, patch, quiet) {
  Object.assign(p, patch, { updated: Date.now() });
  renderSidebar();
  if (route().name === "playlist" && route().arg === p.id) rerender();
  return API.updatePlaylist(p.id, patch).catch((e) => toast("저장하지 못했어요: " + e.message));
}

// ───────── 페이지: 검색 ─────────
let lastQuery = "";
function search(q) {
  q = U.norm(q); if (!q) return null;
  const cho = U.isChoQuery(q);
  const hit = (o) => cho ? o._cho.includes(q) : o._q.includes(q);
  const score = (s, name) => { const n = U.norm(name); return n === q ? 0 : n.startsWith(q) ? 1 : 2; };
  const tracks = L.tracks.filter(hit).sort((a, b) => score(0, a.title) - score(0, b.title) || b.plays - a.plays).slice(0, 50);
  const artists = Array.from(L.artists.values()).filter(hit).sort((a, b) => score(0, a.name) - score(0, b.name) || b.tracks.length - a.tracks.length).slice(0, 50);
  const albums = Array.from(L.albums.values()).filter(hit).sort((a, b) => score(0, a.title) - score(0, b.title) || b.plays - a.plays).slice(0, 50);
  // 테이프(재생목록)는 이름과 설명으로 찾는다. 목록이 자주 바뀌어 미리 만들어 둔 색인 없이 그때그때 본다
  const nameHit = (pl) => { const n = U.norm(pl.name + " " + (pl.desc || "")); return cho ? U.chosung(n).includes(q) : n.includes(q); };
  const tapes = sortedTapes().filter(nameHit) // 임의 테이프는 검색에 넣지 않는다
    .sort((a, b) => score(0, a.name) - score(0, b.name)).slice(0, 50);
  // 테이프 상자는 이름으로 찾는다 (검색 결과의 「테이프」 갈래에 테이프보다 앞에)
  const boxes = pinSystemBoxes(allBoxes().filter((b) => { const n = U.norm(b.name); return cho ? U.chosung(n).includes(q) : n.includes(q); }))
    .sort((a, b) => score(0, a.name) - score(0, b.name));
  return { tracks, artists, albums, tapes, boxes };
}
pages.search = () => {
  $("#topbar-title").textContent = "검색";
  const genres = {}; L.tracks.forEach((t) => { if (t.genre) (genres[t.genre] = genres[t.genre] || []).push(t); });
  const G = Object.keys(genres).sort((a, b) => genres[b].length - genres[a].length).slice(0, 16);
  return `<div class="page">
    <div class="search-box" style="width:min(480px,100%)"><i class="ic ic-search"></i><input id="q" type="search" placeholder="무엇을 듣고 싶으세요? (초성도 돼요)" value="${esc(lastQuery)}" autocomplete="off"></div>
    <div id="search-res"></div>
    <div id="search-browse">${G.length ? section("장르로 둘러보기", null, `<div class="genre-grid">${G.map((g) => `<a class="genre" href="#/genre/${encodeURIComponent(g)}" style="--g:hsl(${U.hue(g)} 45% 36%)">${esc(g)}${art(genres[g][0], 120)}</a>`).join("")}</div>`) : ""}</div>
  </div>`;
};
pages.search.after = () => {
  const inp = $("#q");
  // 갈래마다 5개까지만 보이고 "모두 보기"로 펼친다. 검색어가 바뀌면 다시 접는다
  const SHOW = 5;
  let opened = new Set();
  const part = (kind, title, items, body) => {
    const open = opened.has(kind), list = open ? items : items.slice(0, SHOW);
    const more = items.length > SHOW && !open ? `<a href="#/search" data-search-all="${kind}">모두 보기</a>` : "";
    return section(title, null, body(list, open)).replace("</h2></div></div>", `</h2></div>${more}</div>`);
  };
  const run = (keep) => {
    if (keep !== true) opened = new Set();
    lastQuery = inp.value;
    const r = search(inp.value);
    $("#search-browse").hidden = !!r;
    const box = $("#search-res");
    if (!r) { box.innerHTML = ""; return; }
    if (!r.tracks.length && !r.artists.length && !r.albums.length && !r.tapes.length && !r.boxes.length) { box.innerHTML = `<div class="empty"><b>테이프 박스에 「${esc(inp.value)}」에 맞는 곡이 없어요</b>철자를 확인하거나 다른 말로 찾아보세요.</div>`; return; }
    // 곡 → 테이프 → 앨범 → 아티스트 순. 검색어가 아티스트 이름과 딱 맞으면 아티스트를 맨 위로
    const parts = [
      r.tracks.length ? part("tracks", "곡", r.tracks, (l) => trackList("search", l, "collection")) : "",
      r.tapes.length || r.boxes.length ? part("tapes", "테이프", [...r.boxes, ...r.tapes], (l) => `<div class="tape-row" data-hscroll>${l.map((x) => (r.boxes.includes(x) ? boxItem(x) : tapeItem(x))).join("")}</div>`) : "",
      r.albums.length ? part("albums", "앨범", r.albums, (l, open) => `<div class="shelf${open ? "" : " scroll"}"${open ? "" : " data-hscroll"}>${l.map((a) => albumCard(a)).join("")}</div>`) : "",
      r.artists.length ? part("artists", "아티스트", r.artists, (l, open) => `<div class="shelf${open ? "" : " scroll"}"${open ? "" : " data-hscroll"}>${l.map(artistCard).join("")}</div>`) : "",
    ];
    const nq = U.norm(inp.value);
    if (r.artists.some((a) => U.norm(a.name) === nq)) parts.unshift(parts.splice(3, 1)[0]);
    box.innerHTML = `<div style="margin-top:26px">${parts.join("")}</div>`;
    box.querySelectorAll("[data-search-all]").forEach((a) => a.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation(); opened.add(a.dataset.searchAll); run(true);
    }));
    if (SEL.on) syncSel();
  };
  inp.addEventListener("input", U.debounce(() => run(), 120));
  if (lastQuery) run();
  if (!isMobile() || !lastQuery) setTimeout(() => inp.focus(), 50);
};
pages.genre = (g) => {
  const T = L.tracks.filter((t) => t.genre === g).sort((a, b) => b.n - a.n);
  $("#topbar-title").textContent = g;
  setTint(U.hue(g) + " 40% 30%");
  return `<div class="page"><div class="hero">${collectionTape("genre-" + g, g, T, "genre")}<div class="hero-text"><div class="hero-kicker">장르</div><h1>${esc(g)}</h1><div class="hero-meta"><b>${T.length}곡</b></div></div></div>
    <div class="actions"><button class="play-fab" data-act="list-play" data-list="genre"><i class="ic ic-play"></i></button><button class="icon-btn" data-act="list-shuffle" data-list="genre"><i class="ic ic-shuffle"></i></button>${selBtn("genre")}</div>
    ${trackList("genre", T, "collection")}</div>`;
};

// ───────── 페이지: 라이브러리 (폰) ─────────
pages.library = () => {
  $("#topbar-title").textContent = "라이브러리";
  const tapes = sortedTapes(), albums = sortedAlbums(), artists = sortedArtists();
  return `<div class="page">
    <div class="section-head" style="margin-top:4px"><h2 style="font-size:26px">라이브러리</h2><button class="icon-btn" data-act="new-playlist" title="새 테이프"><i class="ic ic-plus"></i></button></div>
    ${section("나의 테이프", `${U.num(tapes.length)}개`, `<div class="tape-row" data-hscroll>${tapes.slice(0, ROW_MAX).map(tapeItem).join("")}<button class="tape-new" data-act="new-playlist"><i class="ic ic-plus"></i><span>새 테이프 만들기</span></button></div>`, "#/playlists")}
    ${section("앨범", `${U.num(albums.length)}장`, `<div class="lp-row" data-hscroll>${albums.slice(0, ROW_MAX).map((a) => lpAlbum(a)).join("")}</div>`, "#/albums")}
    ${section("아티스트", `${U.num(artists.length)}명`, `<div class="shelf scroll artist-row" data-hscroll>${artists.slice(0, ROW_MAX).map(artistCard).join("")}</div>`, "#/artists")}
  </div>`;
};
// 최근 들은 테이프 전용 화면 (홈 「최근 들은 테이프」의 모두 보기): 들은 테이프만, 가장 최근이 맨 앞. 누르면 바로 재생
pages["recent-tapes"] = () => {
  $("#topbar-title").textContent = "최근 들은 테이프";
  const T = recentTapes(500);
  return `<div class="page">
    <div class="section-head" style="margin-top:8px"><div><h2 style="font-size:30px">최근 들은 테이프</h2><p>${T.length ? `${T.length}개 · 가장 최근에 들은 테이프부터` : "아직 들은 테이프가 없어요"}</p></div></div>
    ${T.length ? `<div class="tape-grid recent-grid">${T.map(recentTapeItem).join("")}</div>` : `<div class="empty"><b>아직 들은 테이프가 없어요</b>테이프를 10초쯤 들으면 여기에 쌓여요.</div>`}
  </div>`;
};
// 나의 테이프 (재생목록 모음)
pages.playlists = () => {
  $("#topbar-title").textContent = "나의 테이프";
  return `<div class="page">
    <div class="section-head" style="margin-top:8px"><div><h2 style="font-size:30px">나의 테이프</h2><p>테이프 ${sortedTapes().length}개${L.boxes.length ? ` · 상자 ${L.boxes.length}개` : ""}</p></div></div>
    <div class="section-head grid-head"><div><h2>상자</h2><p id="box-sub"></p></div><div class="head-tools"><button class="btn head-new" data-act="new-box"><i class="ic ic-box"></i>새 상자</button>${headSearch("boxes")}${tapeSortSel("boxes")}</div></div>
    <div id="box-grid"></div>
    <div class="section-head grid-head"><div><h2>테이프</h2><p id="tape-sub"></p></div><div class="head-tools"><button class="btn head-new" data-act="new-playlist"><i class="ic ic-plus"></i>새 테이프</button>${headSearch("playlists")}${tapeSortSel("playlists")}</div></div>
    <div id="tape-grid"></div>
  </div>`;
};
const tapeSortSel = (k) => `<label class="select"><select data-act="lib-sort" data-k="${k}">${TAPE_SORTS.map(([v, n]) => `<option value="${v}"${v === libSort[k] ? " selected" : ""}>${n}</option>`).join("")}</select></label>`;
pages.playlists.after = () => { LIST_FILL.boxes(); LIST_FILL.playlists(); };
// 상자 하나: 안에 든 테이프들. 상자를 누르면 테이프를 차례로 이어서 재생
pages.box = (id) => {
  const b = allBoxes().find((x) => x.id === id);
  if (!b) return notFound();
  const T = boxTapes(b), ids = boxTrackIds(b);
  lists.box = ids;
  $("#topbar-title").textContent = b.name;
  topMore("box-more", "상자 메뉴");
  setTint("32 30% 22%");
  const dur = ids.reduce((s, i) => s + (L.byId.get(i).duration || 0), 0);
  return `<div class="page">
    <div class="hero"><div class="hero-tape"${b.system ? "" : ` data-unbox="${esc(b.id)}"`}>${tbox(b, { big: true, attrs: `data-act="list-play" data-list="box" title="상자 통째로 재생"` })}</div><div class="hero-text">
      <div class="hero-kicker">${b.history ? "히스토리 상자 · 달마다 가장 많이 들은 30곡" : b.system ? "시스템 상자 · 기록으로 저절로 채워져요" : "테이프 상자"}</div><h1 class="${b.name.length > 20 ? "long" : ""}">${esc(b.name)}</h1>
      <div class="hero-meta"><b>테이프 ${T.length}개</b><span class="sep"></span><span>${U.num(ids.length)}곡</span>${dur ? `<span class="sep"></span><span>${U.fmtLong(dur)}</span>` : ""}</div>
    </div></div>
    <div class="actions">
      <button class="play-fab" data-act="list-play" data-list="box" title="상자 통째로 재생"><i class="ic ic-play"></i></button>
      <button class="icon-btn" data-act="list-shuffle" data-list="box" title="셔플 재생"><i class="ic ic-shuffle"></i></button>
    </div>
    ${T.length && !b.system ? editBar("box-edit", boxEdit) : ""}
    ${b.system ? (T.length ? `<div class="tape-grid">${T.map(tapeItem).join("")}</div>` : `<div class="empty" style="padding:24px"><b>아직 기록이 없어요</b>${b.history ? "이번 달부터 곡을 들을 때마다 기록해서, 그 달에 가장 많이 들은 30곡을 테이프로 남겨요." : ""}</div>`)
      : !T.length ? `<div class="empty" style="padding:24px"><b>아직 빈 상자예요</b>아래 「테이프 추가하기」로 골라 넣거나, 테이프를 꾹 눌러(오른쪽 클릭) 「상자에 넣기」를 써 보세요.</div>
      <div class="tape-grid"><button class="tape-new" data-act="box-add-open"><i class="ic ic-plus"></i><span>테이프 추가하기</span></button></div>`
      : boxEdit ? `<div class="tape-grid editing" data-box-edit="${esc(b.id)}">${T.map((pl, i) => `<div class="tape-edit" data-i="${i}" data-pl-edit="${esc(pl.id)}">${tapeItem(pl)}<span class="tape-grip" data-handle title="끌어서 순서 바꾸기"><i class="ic ic-drag"></i></span><button class="tape-x" data-act="box-remove" data-pl="${esc(pl.id)}" title="상자에서 빼기"><i class="ic ic-x"></i></button></div>`).join("")}<button class="tape-new" data-act="box-add-open"><i class="ic ic-plus"></i><span>테이프 추가하기</span></button></div>`
      : `<div class="tape-grid">${T.map(tapeItem).join("")}<button class="tape-new" data-act="box-add-open"><i class="ic ic-plus"></i><span>테이프 추가하기</span></button></div>`}
  </div>`;
};
pages.box.after = (id) => { if (boxEdit) enableBoxDrag(id); };
// 상자 편집: 오른쪽 위 손잡이를 잡고 끌어 테이프 순서를 바꾼다 (상자 재생 순서)
function enableBoxDrag(bid) {
  const grid = $(".tape-grid.editing", view); if (!grid) return;
  let drag = null;
  const clear = () => $$(".tape-edit", grid).forEach((c) => c.classList.remove("drop-before", "drop-after"));
  grid.addEventListener("pointerdown", (e) => {
    const h = e.target.closest("[data-handle]"); if (!h) return;
    const cell = h.closest(".tape-edit"); e.preventDefault(); e.stopPropagation();
    drag = { el: cell, from: +cell.dataset.i, to: +cell.dataset.i };
    cell.classList.add("dragging"); try { h.setPointerCapture(e.pointerId); } catch (err) {}
  });
  grid.addEventListener("pointermove", (e) => {
    if (!drag) return;
    clear();
    const over = document.elementFromPoint(e.clientX, e.clientY);
    const c = over && over.closest(".tape-edit"); if (!c || !grid.contains(c)) return;
    const rect = c.getBoundingClientRect(), after = e.clientX > rect.left + rect.width / 2;
    c.classList.add(after ? "drop-after" : "drop-before");
    let to = +c.dataset.i + (after ? 1 : 0); if (to > drag.from) to--;
    drag.to = to;
    const vr = view.getBoundingClientRect();
    if (e.clientY < vr.top + 80) view.scrollTop -= 12; else if (e.clientY > vr.bottom - 80) view.scrollTop += 12;
  });
  const end = () => {
    if (!drag) return;
    const { el, from, to } = drag; drag = null;
    clear(); el.classList.remove("dragging");
    U._suppressClick = Date.now();
    if (from !== to) {
      const b = L.boxes.find((x) => x.id === bid); if (!b) return;
      // 화면에 보이는 테이프(지워진 재생목록 제외) 기준으로 옮긴다
      const shown = boxTapes(b).map((pl) => pl.id); const [x] = shown.splice(from, 1); shown.splice(to, 0, x);
      saveBox(b, { items: shown });
    }
  };
  grid.addEventListener("pointerup", end); grid.addEventListener("pointercancel", end);
}
// 모음(시대별·장르) 상세 위쪽: 앨범아트 합성 대신 그 모음을 담은 카세트. 누르면 처음부터 재생
function collectionTape(id, name, T, listName) {
  const pl = { id, name, items: T.map((t) => t.id) };
  const t = T.find((x) => x.id === P.currentId) || T.find((x) => x.albumKey) || T[0];
  const now = !!P.current && T.some((x) => x.id === P.currentId);
  return `<div class="hero-tape">${cassette(pl, t, { now, noHeart: true, attrs: `data-act="list-play" data-list="${listName}" title="이 테이프 재생"` })}</div>`;
}
function heroTape(pl, listName) {
  return `<div class="hero-tape">${cassette(pl, bandTrack(pl), { now: isPlayingPl(pl), attrs: `data-act="pl-tape-play" data-list="${listName}" data-plid="${esc(pl.id)}" title="이 테이프 재생"` })}</div>`;
}
// 사이드바: 작은 카세트 + 오른쪽에 재생목록 이름
const plItem = (pl) => `<a class="side-pl side-tape" href="${tapeHref(pl)}">${cassette(pl, bandTrack(pl), { now: isPlayingPl(pl), noHeart: true, attrs: `data-plid="${esc(pl.id)}"` })}<div><b>${esc(pl.name)}</b><small>테이프 · ${pl.items.length}곡</small></div></a>`;
// 사이드바 상자: 누르면 사이드바 안에서 그 상자의 테이프로 (화면은 그대로)
const sideBoxItem = (b) => `<div class="side-pl side-box" role="button" tabindex="0" data-act="side-box" data-bx="${esc(b.id)}" title="「${esc(b.name)}」 상자 열기">${tbox(b)}<div><b>${esc(b.name)}</b><small>상자 · 테이프 ${boxTapes(b).length}개</small></div></div>`;
let sideBox = null; // 사이드바에서 열어 본 상자 (null이면 맨 바깥: 상자들 + 상자 밖 테이프)
// 사이드바에서 지금 화면에 해당하는 줄 표시 (테이프는 주소, 상자는 상자 화면일 때)
function markSideOn() {
  $$(".side-pl").forEach((a) => a.classList.toggle("on", a.getAttribute("href") === "#" + curRoute || (!!a.dataset.bx && "/box/" + encodeURIComponent(a.dataset.bx) === curRoute)));
}
function renderSidebar() {
  const bx = sideBox && allBoxes().find((b) => b.id === sideBox);
  if (!bx) sideBox = null;
  const head = $("#side-lib-head"), list = $("#side-playlists");
  if (bx) {
    head.innerHTML = `<span class="side-lib-title">${esc(bx.name)}</span><button class="icon-btn" data-act="side-out" title="라이브러리로"><i class="ic ic-left"></i></button>`;
    const T = boxTapes(bx);
    list.innerHTML = T.length ? T.map(plItem).join("") : `<p class="side-empty">빈 상자예요</p>`;
  } else {
    head.innerHTML = `<span>라이브러리</span>`;
    const boxed = new Set(); allBoxes().forEach((b) => b.items.forEach((id) => boxed.add(id)));
    list.innerHTML = boxesByRecent(allBoxes()).map(sideBoxItem).join("") + sortedTapes().filter((p) => !boxed.has(p.id)).map(plItem).join(""); // 테이프는 최근에 들은 순
  }
  markSideOn();
}
