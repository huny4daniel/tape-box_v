// 화면의 바탕: 라이브러리 상태(L), 표시 조각, 라우터, 테이프 기록.
// 화면 코드는 여러 파일로 나뉘어 있고 index.html에 적힌 순서대로 읽힌다:
//   app.js → pages.js → settings.js → nowplaying.js → modals.js → events.js → boot.js
// 파일마다 맨 위에 선언한 것(const·let·function)은 전역 렉시컬 범위를 함께 쓰므로 다른 파일에서 그대로 부른다.
// 읽힐 때 바로 실행되는 코드는 앞 파일의 것만 쓸 수 있다 (함수 안에서 부르는 것은 상관없다).
"use strict";

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = U.esc;
// 가사 속 일본어(가나·한자)는 따로 감싸 메모지 손글씨에서 일본어용 글꼴을 쓰게 한다
const lyrText = (t) => esc(t).replace(/[぀-ヿ㐀-鿿ｦ-ﾟ]+/g, '<span class="ja">$&</span>');

// ───────── 라이브러리 ─────────
const L = { tracks: [], byId: new Map(), albums: new Map(), artists: new Map(), playlists: [], boxes: [], loaded: false };
let P = null; // Player
const lists = {}; // 화면에 그린 목록들: 목록 이름 → 곡 id 배열 (재생 문맥)

// 폰: 좁은 화면, 또는 가로로 눕힌 폰 (높이가 낮은 터치 화면). CSS의 @media와 같은 기준
const isMobile = () => window.matchMedia("(max-width: 820px), (orientation: landscape) and (max-height: 500px) and (pointer: coarse)").matches;
const splitArtists = (s) => String(s || "알 수 없는 아티스트").split(/\s*,\s*/).filter(Boolean);

function indexLibrary(tracks) {
  L.tracks = tracks; L.byId = new Map(); L.albums = new Map(); L.artists = new Map();
  for (const t of tracks) {
    t.title = t.title || "제목 없음"; t.artist = t.artist || "알 수 없는 아티스트"; t.album = t.album || "";
    t.plays = t.plays || 0; t.listenedMs = t.listenedMs || 0;
    t._artists = splitArtists(t.artist);
    t._q = U.norm(t.title + " " + t.artist + " " + t.album);
    t._cho = U.chosung(t._q);
    L.byId.set(t.id, t);
    const ak = t.albumKey || "none:" + t.album;
    let a = L.albums.get(ak);
    if (!a) L.albums.set(ak, a = { key: ak, title: t.album || "앨범 정보 없음", artist: t.albumArtist || t.artist, year: t.year, tracks: [], addedAt: t.addedAt, plays: 0, lastPlayed: 0 });
    a.tracks.push(t); a.plays += t.plays; a.addedAt = Math.min(a.addedAt, t.addedAt); a.lastPlayed = Math.max(a.lastPlayed, t.lastPlayed || 0);
    if (!a.year && t.year) a.year = t.year;
    for (const name of t._artists) {
      let r = L.artists.get(name);
      if (!r) L.artists.set(name, r = { name, tracks: [], albums: new Set(), first: t.addedAt, plays: 0 });
      r.tracks.push(t); r.albums.add(ak); r.first = Math.min(r.first, t.addedAt); r.plays += t.plays;
    }
  }
  for (const a of L.albums.values()) {
    a.tracks.sort((x, y) => (x.disc || 1) - (y.disc || 1) || (x.track || 0) - (y.track || 0) || x.n - y.n);
    a._q = U.norm(a.title + " " + a.artist); a._cho = U.chosung(a._q);
    // 앨범 아티스트가 비어 있으면 가장 많이 나오는 아티스트로
    if (!a.tracks[0].albumArtist) {
      const cnt = {}; a.tracks.forEach((t) => (cnt[t.artist] = (cnt[t.artist] || 0) + 1));
      a.artist = Object.keys(cnt).sort((p, q) => cnt[q] - cnt[p])[0];
    }
  }
  for (const r of L.artists.values()) { r._q = U.norm(r.name); r._cho = U.chosung(r._q); }
  L.loaded = true;
}

// ───────── 표시 조각 ─────────
// 많이 들은 앨범일수록 LP 재킷에 손때가 묻는다 (0~5단계)
const WEAR = [100, 50, 20, 5, 1];
const wearOf = (plays) => { const i = WEAR.findIndex((n) => plays >= n); return i < 0 ? 0 : 5 - i; };
const isFresh = (t) => U.daysAgo(t.addedAt) < 14;

function art(t, size, extra) {
  // t: 곡 또는 앨범 {albumKey|key, album|title}
  const key = t.albumKey || t.key || "";
  const name = t.album != null ? t.album : t.title;
  const url = key && !key.startsWith("none:") ? API.artUrl(key, size || 300) : "";
  return `<div class="art ${extra || ""}" style="${U.phStyle(key + name)}" data-ini="${esc(U.initial(name))}">${url ? `<img loading="lazy" decoding="async" alt="" src="${esc(url)}" onerror="this.remove()">` : ""}</div>`;
}
function mosaic(tracks, size) {
  const keys = []; for (const t of tracks) { if (!keys.includes(t.albumKey)) keys.push(t.albumKey); if (keys.length === 4) break; }
  if (!keys.length) return `<div class="mosaic single"><div class="art" style="--ph:linear-gradient(135deg,#3b3227,#1b1712)" data-ini="♪"></div></div>`;
  if (keys.length < 4) return `<div class="mosaic single">${art(L.byId.get(tracks.find((t) => t.albumKey === keys[0]).id), size)}</div>`;
  return `<div class="mosaic">${keys.map((k) => art(tracks.find((t) => t.albumKey === k), Math.round((size || 300) / 2))).join("")}</div>`;
}
const artistLinks = (t) => t._artists.map((a) => `<a href="#/artist/${encodeURIComponent(a)}" data-stop>${esc(a)}</a>`).join(", ");
const albumHref = (t) => "#/album/" + encodeURIComponent(t.albumKey || "none:" + t.album);

// 곡 한 줄. mode: "album"(트랙 번호) | "collection"·"index"(순번) | "plays"(순번, 길이 자리에 들은 횟수) | "edit"(재생목록 편집)
function row(t, i, mode) {
  const now = P && P.currentId === t.id;
  let first;
  if (mode === "album") first = `<span>${t.track || i + 1}</span>`;
  else first = `<span>${i + 1}</span>`;
  const lead = mode === "edit"
    ? `<span class="no pl-row-handle" data-handle title="끌어서 순서 바꾸기"><i class="ic ic-drag"></i></span>`
    : `<span class="no">${first}</span>`;
  const tail = mode === "edit"
    ? `<button class="icon-btn" data-act="pl-remove" title="이 테이프에서 빼기"><i class="ic ic-x"></i></button>`
    : `<button class="icon-btn more" data-act="more" title="더 보기"><i class="ic ic-more"></i></button>`;
  return `<div class="row${now ? " now" + (P.playing ? "" : " paused") : ""}" data-id="${esc(t.id)}" data-i="${i}">
    <span class="ck${mode === "edit" ? " off" : ""}"></span>${lead}
    <div class="t"><span class="t-art">${art(t, 120)}${mode === "edit" ? "" : '<span class="play" title="재생"><i class="ic ic-play"></i></span>'}</span><div><b>${isFresh(t) ? '<span class="new-badge">NEW</span>' : ""}${esc(t.title)}${t.memo ? '<span class="memo-dot" title="메모가 있어요"></span>' : ""}</b><span>${artistLinks(t)}</span></div></div>
    <span class="alb"><a href="${albumHref(t)}" data-stop>${esc(t.album)}</a></span>
    <span class="dur">${mode === "plays" ? `${U.num(t.plays || 0)}회` : U.fmtDur(t.duration)}</span>
    <button class="icon-btn fav${t.fav ? " on" : ""}" data-act="fav" title="${t.fav ? "아끼는 곡에서 빼기" : "아끼는 곡으로"}"><i class="ic ${t.fav ? "ic-heart-fill" : "ic-heart"}"></i></button>
    ${tail}
  </div>`;
}
const tlHead = (mode, tool) => `<div class="tl-head">${mode === "edit" ? '<span class="ck off"></span>' : '<button class="ck" data-act="sel-head" title="모두 선택"></button>'}<span class="r">#</span><span>제목</span><span class="alb">앨범</span><span class="r dur">${mode === "plays" ? "재생" : "길이"}</span><span></span><span class="tl-tool">${tool || ""}</span></div>`;
// tool: 머리줄 오른쪽 끝 칸에 넣을 버튼 (재생목록의 편집 연필)
function trackList(name, tracks, mode, tool) {
  lists[name] = tracks.map((t) => t.id);
  return `<div class="tracklist" data-list="${esc(name)}">${tlHead(mode, tool)}${tracks.map((t, i) => row(t, i, mode)).join("")}</div>`;
}

function trackCard(t, sub) {
  return `<a class="card" href="#/track/${encodeURIComponent(t.id)}" data-id="${esc(t.id)}" data-card="track">
    ${art(t, 300)}
    <button class="play-fab fab" data-act="card-play"><i class="ic ic-play"></i></button>
    <b>${esc(t.title)}</b><span>${esc(sub != null ? sub : t.artist)}</span></a>`;
}
function albumCard(a, sub) {
  return `<a class="card" href="#/album/${encodeURIComponent(a.key)}" data-album="${esc(a.key)}">${art(a, 300)}
    <button class="play-fab fab" data-act="album-play"><i class="ic ic-play"></i></button>
    <b>${esc(a.title)}</b><span>${esc(sub != null ? sub : (a.year ? a.year + " · " : "") + a.artist)}</span></a>`;
}
// sub: 이름 아래 줄 (없으면 소장 곡 수). .map(artistCard)로 부를 때 들어오는 순번은 무시
function artistCard(r, sub) {
  const top = topAlbumOf(r);
  return `<a class="card round" href="#/artist/${encodeURIComponent(r.name)}">${art(top, 300)}<b>${esc(r.name)}</b><span>${typeof sub === "string" ? esc(sub) : `소장 ${r.tracks.length}곡`}</span></a>`;
}
const topAlbumOf = (r) => { let best = null; for (const k of r.albums) { const a = L.albums.get(k); if (!best || a.plays > best.plays || (a.plays === best.plays && a.tracks.length > best.tracks.length)) best = a; } return best; };
// tool: 머리줄 오른쪽에 넣을 것 (정렬 선택 등)
const section = (title, sub, body, more, tool) => `<section class="section"><div class="section-head${tool ? " with-tool" : ""}"><div><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ""}</div>${tool || ""}${more ? `<a href="${more}">모두 보기</a>` : ""}</div>${body}</section>`;

const ROW_MAX = 20; // 가로 줄에 보여 줄 개수
const LZ = {}; let lzSeq = 0, lzObs = null;
function lazyItems(items, fn, first = 40, chunk = 40) {
  if (items.length <= first) return items.map(fn).join("");
  const key = "lz" + ++lzSeq;
  LZ[key] = { items, fn, i: first, chunk };
  return items.slice(0, first).map(fn).join("") + `<div class="lazy-more" data-lazy="${key}"></div>`;
}
// 발매순 정렬일 때: 같은 해끼리 묶어 연도 머리줄을 붙인다 (정렬된 순서 그대로, 연도 없는 것은 「연도 미상」). 묶음 단위로 이어 그린다
function yearGroups(items, yearOf, fn, wrapCls, unit) {
  const G = [];
  for (const x of items) { const y = yearOf(x) || 0; const g = G[G.length - 1]; if (g && g.y === y) g.items.push(x); else G.push({ y, items: [x] }); }
  const nil = G.filter((g) => !g.y); const sorted = G.filter((g) => g.y).concat(nil.length ? [{ y: 0, items: nil.flatMap((g) => g.items) }] : []);
  return `<div class="year-groups">${lazyItems(sorted, (g) => `<div class="era-head"><h3>${g.y ? g.y + "년" : "연도 미상"}<small>${U.num(g.items.length)}${unit}</small></h3></div><div class="${wrapCls}">${g.items.map(fn).join("")}</div>`, 6, 4)}</div>`;
}
function lazyStep(el, n) {
  const st = LZ[el.dataset.lazy]; if (!st) { el.remove(); return false; }
  const next = st.items.slice(st.i, st.i + (n || st.chunk)); st.i += next.length;
  el.insertAdjacentHTML("beforebegin", next.map(st.fn).join(""));
  if (SEL.on) markPicked();
  if (st.i >= st.items.length) { if (lzObs) lzObs.unobserve(el); el.remove(); delete LZ[el.dataset.lazy]; return false; }
  return true;
}
function mountLazy(wantScroll) {
  if (lzObs) lzObs.disconnect();
  const els = $$("[data-lazy]", view); if (!els.length) return;
  // 돌아왔을 때 예전 스크롤 위치까지는 미리 그려 둔다
  for (const el of els) while (view.scrollHeight < wantScroll + view.clientHeight * 2 && lazyStep(el));
  lzObs = new IntersectionObserver((ents) => ents.forEach((en) => {
    if (!en.isIntersecting) return;
    if (lazyStep(en.target)) { lzObs.unobserve(en.target); lzObs.observe(en.target); } // 아직 보이면 한 번 더
  }), { root: view, rootMargin: "1200px 0px" });
  $$("[data-lazy]", view).forEach((el) => lzObs.observe(el));
  // 손을 놓고 있는 동안 조금씩 미리 그려 둔다 (스크롤할 때 한꺼번에 그리느라 끊기지 않게). 너무 길면 앞부분만
  const idle = window.requestIdleCallback || ((f) => setTimeout(() => f({ timeRemaining: () => 8 }), 60));
  const fill = (dl) => {
    const el = $("[data-lazy]", view); if (!el) return;
    const st = LZ[el.dataset.lazy]; if (!st || st.i >= 240) return;
    while (dl.timeRemaining() > 4 && lazyStep(el, 4) && st.i < 240);
    if (el.isConnected && st.i < st.items.length) idle(fill);
  };
  idle(fill);
}

// ───────── 라우터 ─────────
const view = $("#view");
const scrolls = {};
let curRoute = "";
function route() {
  const h = location.hash.replace(/^#/, "") || "/";
  const [, name = "", arg = ""] = h.match(/^\/([^/]*)\/?(.*)$/) || [];
  return { name: name || "home", arg: decodeURIComponent(arg), hash: h };
}
const pages = {};
// 뒤로 버튼: 사이드바(폰은 아래 탭) 메뉴로 여는 첫 화면들이 기준점. 그 안에서 들어간 길을 되짚어 결국 그 화면으로,
// 그 화면에서 한 번 더 누르면 홈으로. 홈에는 뒤로 버튼이 없다. 주소로 바로 들어왔으면 그 화면이 속한 첫 화면으로
const NAV_ROOTS = ["home", "search", "collection", "playlists", "albums", "artists", "library", "settings"];
const NAV_PARENT = { album: "/albums", artist: "/artists", "artist-albums": "/artists", playlist: "/playlists", liked: "/playlists", box: "/playlists", track: "/collection", year: "/", genre: "/search", "recent-tapes": "/" };
let navStack = [], navBack = false;
function trackNav(r) {
  if (NAV_ROOTS.includes(r.name)) { navStack = [r.hash]; navBack = false; return; }
  if (navBack) { navBack = false; return; }
  const i = navStack.lastIndexOf(r.hash);
  if (i >= 0) navStack = navStack.slice(0, i + 1); // 브라우저 뒤로 등으로 지나온 화면에 다시 온 경우
  else navStack.push(r.hash);
}
function goBack() {
  const r = route();
  if (r.name === "home") return;
  // 폰: 나의 테이프·앨범·아티스트는 아래 「라이브러리」 탭에서 들어가므로 라이브러리를 거쳐 홈으로
  if (isMobile() && ["playlists", "albums", "artists"].includes(r.name)) { location.hash = "#/library"; return; }
  if (NAV_ROOTS.includes(r.name)) { location.hash = "#/"; return; }
  if (navStack.length >= 2) { navStack.pop(); navBack = true; location.hash = "#" + navStack[navStack.length - 1]; return; }
  location.hash = "#" + (NAV_PARENT[r.name] || "/");
}
function render(keepScroll) {
  if (!L.loaded) return;
  const r = route();
  if (curRoute && curRoute !== r.hash) { scrolls[curRoute] = view.scrollTop; if (SEL.on) selEnd(); plEdit = boxEdit = false; }
  const ae = document.activeElement, focusQ = ae && ae.dataset && ae.dataset.act === "list-q" ? ae.dataset.k : null;
  const st = keepScroll ? view.scrollTop : scrolls[r.hash] || 0;
  if (r.hash !== curRoute) trackNav(r);
  curRoute = r.hash;
  closeMenu();
  $("#topbar .topbar-nav").style.visibility = r.name === "home" ? "hidden" : ""; // 홈에는 뒤로 버튼이 없다
  const fn = pages[r.name] || pages.home;
  setTint(null);
  $("#topbar-title").textContent = "";
  // 홈(대시보드) 오른쪽 위에 설정 버튼
  $("#topbar-extra").innerHTML = fn === pages.home ? '<a class="round-btn" href="#/settings" title="설정 · 연결"><i class="ic ic-gear"></i></a>' : "";
  for (const k in LZ) delete LZ[k];
  view.innerHTML = fn(r.arg) || "";
  const navName = { "recent-tapes": "home", album: "albums", artist: "artists", "artist-albums": "artists", playlist: "playlists", liked: "playlists", box: "playlists" }[r.name] || r.name;
  $$("[data-nav]").forEach((a) => a.classList.toggle("on", a.dataset.nav === r.name || (a.closest("#sidebar") && a.dataset.nav === navName) || (r.name === "home" && a.dataset.nav === "home") || (["albums", "artists", "playlist", "playlists", "liked", "box"].includes(r.name) && a.dataset.nav === "library" )));
  markSideOn();
  if (pages[r.name] && pages[r.name].after) pages[r.name].after(r.arg);
  mountLazy(st);
  view.scrollTop = st;
  onScroll();
  if (SEL.on) markPicked();
  if (focusQ) { const f = $(`[data-act="list-q"][data-k="${focusQ}"]`, view); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } }
}
const rerender = () => render(true);
window.addEventListener("hashchange", () => render());

function setTint(hsl) { $("#main").style.setProperty("--tint", hsl || "30 8% 17%"); }
function tintFromArt(item) {
  const key = item.albumKey || item.key;
  U.tintFrom(key ? API.artUrl(key, 64) : "", key + (item.album || item.title)).then((c) => { if (route().hash === curRoute) setTint(c); });
}
function onScroll() {
  const solid = view.scrollTop > 180;
  $("#topbar").classList.toggle("solid", solid);
}
view.addEventListener("scroll", onScroll, { passive: true });
// 가로 줄(data-hscroll): PC 마우스 휠을 가로 스크롤로. 끝에 닿으면 페이지가 그대로 내려간다
// (홈·나의 테이프·검색의 테이프 줄, 재생 화면의 테이프 선반 등 화면 어디든)
// 가로 줄(data-hscroll): 휠·끌기로 옆으로 넘기지 않고, 양옆의 반투명 화살표로 넘긴다 (폰은 손가락으로 밀어 넘기기도 된다).
// 화살표는 한 줄을 통째로가 아니라 보이는 폭의 60%쯤씩. 맨 앞·맨 끝이면 그쪽 화살표는 숨긴다.
// 줄을 그리는 곳이 여러 군데라, 화면에 새로 생기는 가로 줄을 지켜보다가 화살표를 붙인다
function hsDecorate(row) {
  if (row.__hs) return; row.__hs = true;
  const wrap = document.createElement("div"); wrap.className = "hs-wrap";
  row.parentNode.insertBefore(wrap, row); wrap.appendChild(row);
  const mk = (dir) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "hs-btn " + dir; b.hidden = true;
    b.setAttribute("aria-label", dir === "l" ? "앞으로 넘기기" : "뒤로 넘기기"); b.innerHTML = '<i class="ic ic-left"></i>';
    b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); hScroll(row, (dir === "l" ? -1 : 1) * Math.max(160, Math.round(row.clientWidth * 0.6))); });
    wrap.appendChild(b); return b;
  };
  const L = mk("l"), R = mk("r");
  const update = () => {
    const max = row.scrollWidth - row.clientWidth, on = max > 4 && row.offsetWidth > 0;
    const st = HS.get(row), x = st && st.raf ? st.target : row.scrollLeft; // 넘어가는 중이면 도착할 자리 기준
    L.hidden = !on || x <= 2; R.hidden = !on || x >= max - 2;
    if (!on) return;
    const top = row.offsetTop + row.offsetHeight / 2;
    L.style.top = R.style.top = top + "px";
    L.style.left = row.offsetLeft + 10 + "px"; R.style.left = row.offsetLeft + row.offsetWidth - 10 - 38 + "px";
  };
  row.__hsUpdate = update;
  row.addEventListener("scroll", update, { passive: true });
  if (window.ResizeObserver) new ResizeObserver(update).observe(row);
  new MutationObserver(update).observe(row, { childList: true });
  update();
}
const hsScan = () => $$("[data-hscroll]").forEach(hsDecorate);
new MutationObserver(() => { if (!hsScan.raf) hsScan.raf = requestAnimationFrame(() => { hsScan.raf = 0; hsScan(); }); }).observe(document.body, { childList: true, subtree: true });
// 휠 한 칸에 뚝 끊어 옮기지 않고, 목표 위치를 향해 미끄러지듯 따라간다 (연달아 굴리면 목표가 쌓인다)
const HS = new WeakMap();
function hScroll(row, dx) {
  let st = HS.get(row);
  if (!st) HS.set(row, (st = { raf: 0, pos: 0, target: 0 }));
  if (!st.raf) st.pos = st.target = row.scrollLeft;
  const max = row.scrollWidth - row.clientWidth;
  st.target = Math.max(0, Math.min(max, st.target + dx));
  if (row.__hsUpdate) row.__hsUpdate();
  if (st.raf) return;
  const step = () => {
    const d = st.target - st.pos;
    if (Math.abs(d) < 0.5) { row.scrollLeft = st.pos = st.target; st.raf = 0; return; }
    st.pos += d * 0.16; row.scrollLeft = st.pos;
    st.raf = requestAnimationFrame(step);
  };
  st.raf = requestAnimationFrame(step);
}

// 테이프·상자 규칙은 js/tapes.js 한곳에 있다
const { reshuffleTape, isTempTape, isSystemBox, canBox, canBoxInto, canEditTape, tapeHref, likedPl, SYS_BOX, SYS_TAPES, SYS_IDS, isHistTape, isSysTape, boxHidden, setBoxHidden, sysHidden, histHidden, thisMonth, histTape, histBox, systemTape, sysBox, allBoxes, tapeById, boxOf, boxTapes, pinSystemBoxes } = TapeModel(L, U);
