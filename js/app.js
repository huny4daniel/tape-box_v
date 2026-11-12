// 화면 전체: 라우팅, 각 페이지, 재생 막대, 가사·대기열, 메뉴
(function () {
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

  const isMobile = () => window.matchMedia("(max-width: 820px)").matches;
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

  // 곡 한 줄. mode: "album"(트랙 번호) | "collection"·"index"(순번) | "edit"(재생목록 편집)
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
      <span class="dur">${U.fmtDur(t.duration)}</span>
      <button class="icon-btn fav${t.fav ? " on" : ""}" data-act="fav" title="${t.fav ? "아끼는 곡에서 빼기" : "아끼는 곡으로"}"><i class="ic ${t.fav ? "ic-heart-fill" : "ic-heart"}"></i></button>
      ${tail}
    </div>`;
  }
  const tlHead = (mode, tool) => `<div class="tl-head">${mode === "edit" ? '<span class="ck off"></span>' : '<button class="ck" data-act="sel-head" title="모두 선택"></button>'}<span class="r">#</span><span>제목</span><span>앨범</span><span class="r dur">길이</span><span></span><span class="tl-tool">${tool || ""}</span></div>`;
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
  const NAV_PARENT = { album: "/albums", artist: "/artists", "artist-albums": "/artists", playlist: "/playlists", liked: "/playlists", box: "/playlists", track: "/collection", year: "/", genre: "/search" };
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
    const navName = { album: "albums", artist: "artists", "artist-albums": "artists", playlist: "playlists", liked: "playlists", box: "playlists" }[r.name] || r.name;
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
      ${tapes.length ? section("최근 들은 테이프", null, `<div class="tape-row" data-hscroll>${tapes.map(recentTapeItem).join("")}</div>`, "#/playlists") : ""}

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
  const colState = (() => { try { return Object.assign({ sort: "new", filter: "all" }, JSON.parse(localStorage.getItem("mc.col") || "{}")); } catch (e) { return { sort: "new", filter: "all" }; } })();
  // ── 카세트 = 재생목록(믹스테이프). 마스킹 테이프에 재생목록 이름, 아래 띠에 지금(마지막) 곡 ──
  const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19.5s-7-4.3-8.5-8.8C2.6 7.4 4.6 4.8 7.5 4.8c1.9 0 3.4 1 4.5 2.7 1.1-1.7 2.6-2.7 4.5-2.7 2.9 0 4.9 2.6 4 5.9-1.5 4.5-8.5 8.8-8.5 8.8z"/></svg>';
  const likedPl = () => ({ id: "liked", name: "아끼는 곡", items: L.tracks.filter((t) => t.fav).sort((a, b) => (b.favAt || b.n) - (a.favAt || a.n)).map((t) => t.id) });
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
    if (c.type === "playlist") { if (c.id === "liked") return likedPl(); const p = L.playlists.find((x) => x.id === c.id); if (p) return p; }
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
  // 테이프를 마지막으로 튼 때 (이 기기 기준)
  function tapePlayedMap() { try { return JSON.parse(localStorage.getItem("mc.tapePlayed") || "{}") || {}; } catch (e) { return {}; } }
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
      const m = tapePlayedMap(); m[k] = Date.now();
      try { localStorage.setItem("mc.tapePlayed", JSON.stringify(m)); } catch (e) {}
      renderSidebar(); // 사이드바 테이프는 최근에 들은 순
    }
    if (route().name === "home") rerender(); // 홈의 「최근 들은 테이프」도 바로
  }
  // 기록 열쇠 → 다시 틀 수 있는 테이프 { key, pl(이름·곡), ctx, box? }. 지금 없는 것(지운 재생목록 등)은 null
  function sysTape(k) {
    const T = (arr) => arr.map((t) => t.id);
    if (k.startsWith("tmp-")) { const x = tempTape(k); return x && { key: k, pl: x, ctx: x.ctx, temp: true }; }
    if (k.startsWith("album:")) { const a = L.albums.get(k.slice(6)); return a && { key: k, pl: { id: a.key, name: a.title, items: T(a.tracks) }, ctx: { type: "album", id: a.key, name: a.title } }; }
    if (k.startsWith("artist:")) { const r = L.artists.get(k.slice(7)); return r && { key: k, pl: { id: r.name, name: r.name, items: T(r.tracks.slice().sort((a, b) => a.n - b.n)) }, ctx: { type: "artist", id: r.name, name: r.name } }; }
    if (k.startsWith("box:")) { const b = L.boxes.find((x) => x.id === k.slice(4)); return b && { key: k, box: b, pl: { id: b.id, name: b.name, items: boxTrackIds(b) }, ctx: boxCtx(b) }; }
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
      const keys = k.startsWith("box:") ? (() => { const b = L.boxes.find((x) => x.id === k.slice(4)); return b ? b.items : []; })() : [k];
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
    const x = sysTape(k); if (!x) return;
    if (playingKey() === k) { if (!P.playing) P.play(); openFull(); return; }
    P.playList(x.pl.items.filter((id) => L.byId.has(id)), 0, x.ctx);
  }
  const tapeHref = (pl) => pl.id === "liked" ? "#/liked" : "#/playlist/" + encodeURIComponent(pl.id);
  const tapeItem = (pl) => cassette(pl, bandTrack(pl), { now: isPlayingPl(pl), attrs: `data-pl="${esc(pl.id)}" data-plid="${esc(pl.id)}"` });

  // ── 상자 = 테이프를 담아 두는 종이 상자. 테이프 하나는 상자 하나에만 들어간다 ──
  const tapeById = (id) => id === "liked" ? likedPl() : L.playlists.find((p) => p.id === id);
  const boxOf = (plId) => L.boxes.find((b) => b.items.includes(plId));
  const boxTapes = (b) => b.items.map(tapeById).filter(Boolean);
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
    return `<div class="tbox${o.big ? " big" : ""}${T.length ? "" : " is-empty"}${now ? " now" : ""}" ${o.attrs || ""} style="--tilt:${tilt}deg;--h:${hsh % 360}">
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
      const boxed = new Set(); L.boxes.forEach((b) => b.items.forEach((id) => boxed.add(id)));
      const T = tapeSorted(sortedTapes().filter(hit || ((pl) => !boxed.has(pl.id)))); // 찾을 때는 상자 안 테이프까지 (임의 테이프는 넣지 않는다)
      sub.textContent = hit ? `찾은 테이프 ${U.num(T.length)}개 (상자 안 포함)` : boxed.size ? `상자 밖 ${U.num(T.length)}개` : `${U.num(T.length)}개`;
      grid.innerHTML = T.length ? `<div class="tape-grid">${lazyItems(T, tapeItem, 16, 10)}</div>` : hit ? noHit("playlists") : "";
    },
    // 나의 테이프 → 상자: 상자 이름, 또는 안에 든 테이프 이름으로 찾는다 (곡으로 찾기는 테이프 검색에서)
    boxes() {
      const grid = $("#box-grid"), sub = $("#box-sub"); if (!grid) return;
      const raw = listQ.boxes, q = U.norm(raw), cho = U.isChoQuery(raw.trim()), hit = !!q;
      const nameHit = (name) => { const n = U.norm(name); return (cho ? U.chosung(n) : n).includes(q); };
      const B = tapeSorted(hit ? L.boxes.filter((b) => nameHit(b.name) || boxTapes(b).some((pl) => nameHit(pl.name))) : L.boxes, true);
      sub.textContent = hit ? `찾은 상자 ${B.length}개` : L.boxes.length ? `${L.boxes.length}개 · 아래 테이프를 끌어다 상자에 넣을 수 있어요` : "「새 상자」로 만들어 테이프를 나눠 담아 두세요";
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
  const libSort = (() => { try { return Object.assign({ albums: "recent", artists: "count", playlists: "recent", boxes: "recent", artistSongs: "old" }, JSON.parse(localStorage.getItem("mc.libsort") || "{}")); } catch (e) { return { albums: "recent", artists: "count", playlists: "recent", boxes: "recent", artistSongs: "old" }; } })();
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
    const k = isBox ? libSort.boxes : libSort.playlists, played = tapePlayedMap(), key = (x) => (isBox ? "box:" : "") + x.id;
    if (k === "name") return list.slice().sort((a, b) => ko.compare(a.name, b.name));
    if (k === "made") return list.slice().sort((a, b) => (b.created || 0) - (a.created || 0)); // 아끼는 곡(만든 날 없음)은 맨 뒤
    return isBox ? list.slice().sort((a, b) => (played[key(b)] || 0) - (played[key(a)] || 0) || (b.updated || 0) - (a.updated || 0)) : list; // 테이프는 sortedTapes()가 이미 최근 들은 순
  }
  // 상자를 최근에 들은 순으로 (상자 안 테이프 중 가장 최근에 들은 때, 같으면 원래 순서)
  function boxesByRecent(list) {
    const played = tapePlayedMap(), at = (b) => Math.max(played["box:" + b.id] || 0, ...b.items.map((id) => played[id] || 0));
    return list.slice().sort((a, b) => at(b) - at(a));
  }
  function sortedTapes() {
    const played = tapePlayedMap();
    return [likedPl()].concat(L.playlists).sort((a, b) => (played[b.id] || 0) - (played[a.id] || 0) || (b.id === "liked") - (a.id === "liked") || (b.updated || 0) - (a.updated || 0));
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
    if (arg === "sort-plays") { libSort.artists = "plays"; try { localStorage.setItem("mc.libsort", JSON.stringify(libSort)); } catch (e) {} } // 홈 「많이 들은 아티스트」의 모두 보기
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
  pages.playlist = (id) => {
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
    const boxes = L.boxes.filter((b) => { const n = U.norm(b.name); return cho ? U.chosung(n).includes(q) : n.includes(q); })
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
  // 나의 테이프 (재생목록 모음)
  pages.playlists = () => {
    $("#topbar-title").textContent = "나의 테이프";
    return `<div class="page">
      <div class="section-head" style="margin-top:8px"><div><h2 style="font-size:30px">나의 테이프</h2><p>테이프 ${L.playlists.length + 1}개${L.boxes.length ? ` · 상자 ${L.boxes.length}개` : ""}</p></div></div>
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
    const b = L.boxes.find((x) => x.id === id);
    if (!b) return notFound();
    const T = boxTapes(b), ids = boxTrackIds(b);
    lists.box = ids;
    $("#topbar-title").textContent = b.name;
    topMore("box-more", "상자 메뉴");
    setTint("32 30% 22%");
    const dur = ids.reduce((s, i) => s + (L.byId.get(i).duration || 0), 0);
    return `<div class="page">
      <div class="hero"><div class="hero-tape" data-unbox="${esc(b.id)}">${tbox(b, { big: true, attrs: `data-act="list-play" data-list="box" title="상자 통째로 재생"` })}</div><div class="hero-text">
        <div class="hero-kicker">테이프 상자</div><h1 class="${b.name.length > 20 ? "long" : ""}">${esc(b.name)}</h1>
        <div class="hero-meta"><b>테이프 ${T.length}개</b><span class="sep"></span><span>${U.num(ids.length)}곡</span>${dur ? `<span class="sep"></span><span>${U.fmtLong(dur)}</span>` : ""}</div>
      </div></div>
      <div class="actions">
        <button class="play-fab" data-act="list-play" data-list="box" title="상자 통째로 재생"><i class="ic ic-play"></i></button>
        <button class="icon-btn" data-act="list-shuffle" data-list="box" title="셔플 재생"><i class="ic ic-shuffle"></i></button>
      </div>
      ${T.length ? editBar("box-edit", boxEdit) : ""}
      ${!T.length ? `<div class="empty" style="padding:24px"><b>아직 빈 상자예요</b>아래 「테이프 추가하기」로 골라 넣거나, 테이프를 꾹 눌러(오른쪽 클릭) 「상자에 넣기」를 써 보세요.</div>
        <div class="tape-grid"><button class="tape-new" data-act="box-add-open"><i class="ic ic-plus"></i><span>테이프 추가하기</span></button></div>`
        : boxEdit ? `<div class="tape-grid editing" data-box-edit="${esc(b.id)}">${T.map((pl, i) => `<div class="tape-edit" data-i="${i}" data-pl-edit="${esc(pl.id)}">${tapeItem(pl)}<span class="tape-grip" data-handle title="끌어서 순서 바꾸기"><i class="ic ic-drag"></i></span><button class="tape-x" data-act="box-remove" data-pl="${esc(pl.id)}" title="상자에서 빼기"><i class="ic ic-x"></i></button></div>`).join("")}<button class="tape-new" data-act="box-add-open"><i class="ic ic-plus"></i><span>테이프 추가하기</span></button></div>`
        : `<div class="tape-grid">${T.map(tapeItem).join("")}<button class="tape-new" data-act="new-playlist" data-into="${esc(b.id)}"><i class="ic ic-plus"></i><span>새 테이프 만들어 넣기</span></button></div>`}
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
    const bx = sideBox && L.boxes.find((b) => b.id === sideBox);
    if (!bx) sideBox = null;
    const head = $("#side-lib-head"), list = $("#side-playlists");
    if (bx) {
      head.innerHTML = `<span class="side-lib-title">${esc(bx.name)}</span><button class="icon-btn" data-act="side-out" title="라이브러리로"><i class="ic ic-left"></i></button>`;
      const T = boxTapes(bx);
      list.innerHTML = T.length ? T.map(plItem).join("") : `<p class="side-empty">빈 상자예요</p>`;
    } else {
      head.innerHTML = `<span>라이브러리</span>`;
      const boxed = new Set(); L.boxes.forEach((b) => b.items.forEach((id) => boxed.add(id)));
      list.innerHTML = boxesByRecent(L.boxes).map(sideBoxItem).join("") + sortedTapes().filter((p) => !boxed.has(p.id)).map(plItem).join(""); // 테이프는 최근에 들은 순
    }
    markSideOn();
  }

  // ───────── 페이지: 설정·연결 ─────────
  pages.settings = () => {
    $("#topbar-title").textContent = "설정 · 연결";
    const N = window.NativeBridge;
    let conn;
    if (N) {
      let info = {}; try { info = JSON.parse(N.getServerInfo()); } catch (e) {}
      conn = `<div class="set-card"><div class="set-row"><div><h3>PC에서 접속</h3><p>같은 Wi-Fi에 있는 컴퓨터의 브라우저에서 이 폰의 컬렉션을 듣고 테이프를 편집할 수 있어요.</p></div><button class="switch${info.enabled ? " on" : ""}" data-act="server-toggle" aria-label="PC 접속"></button></div>
        ${info.enabled ? `<div class="addr">${(info.urls || []).map((u) => `<div><span>주소</span><b>${esc(u)}</b></div>`).join("") || `<div><span>주소</span><b>Wi-Fi에 연결되어 있지 않아요</b></div>`}<div><span>PIN</span><b class="pin-code">${esc(info.pin || "")}</b></div></div>
          <p style="margin-top:10px">PC 프로그램 「테이프 박스」를 실행하면 폰을 알아서 찾아요(브라우저 주소창에 위 주소를 넣어도 돼요). 처음 한 번 PIN을 넣으면 돼요. 켜 둔 동안 알림이 표시돼요.</p>` : ""}</div>`;
    } else {
      conn = `<div class="set-card"><h3>폰에 연결됨</h3><p>지금 이 화면은 폰에 저장된 컬렉션을 실시간으로 불러오고 있어요. 테이프·메모·아끼는 곡은 폰에 바로 저장돼요.</p></div>`;
    }
    return `<div class="page"><h2 style="font-size:30px;margin:8px 0 0">설정 · 연결</h2>
      ${conn}
      ${L.debug ? `<div class="set-card"><div class="set-row"><div><h3>개발용 · 원래 앱 데이터 가져오기</h3><p>이 폰에 깔린 원래 테이프 박스 앱의 수집 번호·재생 기록·아끼는 곡·메모·테이프를 이 디버그 앱으로 그대로 복사해요. 디버그 앱의 지금 기록은 덮어써요. 원래 앱은 건드리지 않아요.</p></div><button class="btn" data-act="dev-import">가져오기</button></div></div>` : ""}
      <div class="set-card"><div class="set-row"><div><h3>기록 초기화</h3><p>들은 횟수, 아끼는 곡 표시, 최근 들은 기록 중 고른 것을 지워요. 수집 번호·메모·테이프·상자는 그대로 남아요.</p></div><button class="btn" data-act="reset-records">초기화…</button></div></div>
      <div class="set-card"><div class="set-row"><div><h3>라이브러리 다시 읽기</h3><p>폰에 새 곡을 넣었는데 안 보이면 눌러 주세요. 수집 번호와 기록은 그대로 남아요.</p></div><button class="btn" data-act="rescan">다시 읽기</button></div></div>
      ${N ? playlistDirCard(N) : ""}
      <div class="set-card" id="folder-card">${folderCard()}</div>
      ${N ? "" : lsSlot()}
      <div class="set-card"><h3>컬렉션</h3><p>${U.num(L.tracks.length)}곡 · ${U.num(L.albums.size)}장의 앨범 · ${U.num(L.artists.size)}명의 아티스트 · 테이프 ${L.playlists.length}개</p></div>
    </div>`;
  };

  // 다른 앱(삼성뮤직 등)이 내보낸 재생목록 파일 폴더 (폰에서만 고를 수 있다)
  function playlistDirCard(N) {
    let dir = ""; try { dir = N.getPlaylistDir ? N.getPlaylistDir() : ""; } catch (e) {}
    return `<div class="set-card"><div class="set-row"><div><h3>다른 앱 재생목록을 테이프로 가져오기</h3><p>삼성뮤직에서 내보낸 .smpl, 다른 앱의 .m3u 파일이 있는 폴더를 고르면 라이브러리를 읽을 때마다 가져와요. 이 앱에서 고친 테이프는 그대로 둬요.</p></div>
      <button class="btn" data-act="pldir-pick">${dir ? "바꾸기" : "폴더 고르기"}</button></div>
      ${dir ? `<div class="addr"><div><span>폴더</span><b style="font-size:15px">${esc(dir)}</b></div></div><div style="margin-top:10px;text-align:right"><button class="btn ghost" data-act="pldir-clear">해제</button></div>` : ""}</div>`;
  }

  // 라이브러리 폴더: 끈 폴더의 음악은 컬렉션에 넣지 않는다 (폰 서버가 걸러 준다)
  let FD = null; // { folders:[{path,count}], off:Set, autoNew, open:Set, dirty, saving }
  function loadFolders() {
    API.folders().then((r) => {
      FD = { folders: r.folders || [], off: new Set(r.off || []), autoNew: r.autoNew !== false, open: new Set(), dirty: false, saving: false };
      renderFolderCard();
    }).catch(() => { const c = $("#folder-card"); if (c) c.innerHTML = `<h3>라이브러리 폴더</h3><p>폴더 목록을 불러오지 못했어요. 폰 앱을 최신 버전으로 업데이트해 주세요.</p>`; });
  }
  function renderFolderCard() { const c = $("#folder-card"); if (c) c.innerHTML = folderCard(); }
  const fdUnder = (path) => FD.folders.map((f) => f.path).filter((p) => p === path || (path !== "/" && p.startsWith(path)));
  function folderTree() {
    const root = { kids: new Map() };
    for (const f of FD.folders) {
      const segs = f.path === "/" ? ["(저장공간 최상위)"] : f.path.split("/").filter(Boolean);
      let n = root, acc = "";
      for (const s of segs) {
        acc = f.path === "/" ? "/" : acc + s + "/";
        if (!n.kids.has(s)) n.kids.set(s, { name: s, path: acc, kids: new Map(), count: 0 });
        n = n.kids.get(s); n.count += f.count;
      }
    }
    return root;
  }
  function folderRows(n, depth) {
    return [...n.kids.values()].sort((a, b) => a.name.localeCompare(b.name, "ko")).map((k) => {
      const ps = fdUnder(k.path), offN = ps.filter((p) => FD.off.has(p)).length;
      const st = offN === 0 ? "on" : offN === ps.length ? "off" : "part";
      const kids = k.kids.size > 0, open = FD.open.has(k.path);
      return `<div class="fd-row" style="--d:${depth}"><button class="fd-caret" data-act="fd-open" data-path="${esc(k.path)}"${kids ? "" : " disabled"}>${kids ? `<span class="chev${open ? " open" : ""}"></span>` : ""}</button>
        <button class="fd-check ${st}" data-act="fd-check" data-path="${esc(k.path)}"><span class="box"></span><b>${esc(k.name)}</b><small>${U.num(k.count)}곡</small></button></div>${kids && open ? folderRows(k, depth + 1) : ""}`;
    }).join("");
  }
  function folderCard() {
    if (!FD) { setTimeout(loadFolders); return `<h3>라이브러리 폴더</h3><p>폴더 목록을 불러오는 중…</p>`; }
    const total = FD.folders.reduce((s, f) => s + f.count, 0);
    const inN = FD.folders.reduce((s, f) => s + (FD.off.has(f.path) ? 0 : f.count), 0);
    return `<h3>라이브러리 폴더</h3><p>체크를 끈 폴더의 음악은 컬렉션에 넣지 않아요. 수집 번호와 기록은 지워지지 않아서 다시 켜면 그대로 돌아와요.</p>
      <div class="fd-tree">${FD.folders.length ? folderRows(folderTree(), 0) : `<p>음악이 든 폴더가 없어요</p>`}</div>
      <div class="set-row" style="margin-top:16px"><div><h3 style="font-size:15px">새로 생긴 폴더도 자동으로 넣기</h3><p>끄면 지금 켜 둔 폴더만 읽어요. 이미 있는 폴더 안에 새로 생긴 폴더는 그 폴더 설정을 따라요.</p></div><button class="switch${FD.autoNew ? " on" : ""}" data-act="fd-auto" aria-label="새 폴더 자동으로 넣기"></button></div>
      <div class="fd-foot"><span>${U.num(total)}곡 중 <b>${U.num(inN)}곡</b>을 넣어요</span><button class="btn" data-act="fd-apply"${FD.dirty && !FD.saving ? "" : " disabled"}>${FD.saving ? "적용하는 중…" : "적용"}</button></div>`;
  }

  // 싱크 가사 생성기: PC 프로그램 창(pywebview)에서만 보인다. 설치와 실행은 PC 쪽(pc/lyricsync.py)이 맡는다
  const PWA = () => (window.pywebview && window.pywebview.api && window.pywebview.api.ls_state ? window.pywebview.api : null);
  const LS_TABS = [["made", "만든 곡"], ["check", "확인 필요"], ["fail", "실패"], ["skip", "건너뛴 곡"], ["rejected", "되돌린 곡"], ["notfound", "폰에서 못 찾음"]];
  const LS_STATUS = { done: "만듦", kept: "괜찮음", restored: "사본으로 되살림", check: "확인 필요", fail: "실패", skip: "건너뜀", rejected: "되돌림" };
  const LS_MAX = 300; // 목록에 한 번에 그리는 수 (더 많으면 검색으로 좁힌다)
  let LS = null, lsTimer = 0, lsHtml = "", lsHeadHtml = "";
  let LSR = { tab: null, items: null, q: "", loading: false }; // 펼친 결과 목록
  function lsSlot() {
    lsHtml = lsHeadHtml = ""; LSR.items = null; setTimeout(() => { lsPoll(); lsSync().then((r) => { if (r && r.count) lsPoll(); }); });
    return `<div class="set-card" id="ls-card" hidden><div id="ls-main"></div><div id="ls-results"><div id="ls-results-head"></div><div id="ls-filter"></div><div id="ls-rows"></div></div></div>`;
  }
  window.addEventListener("pywebviewready", () => lsPoll());
  function lsPoll() {
    clearTimeout(lsTimer);
    const pw = PWA();
    if (!$("#ls-card") || !pw) return;
    pw.ls_state().then((st) => { LS = st; renderLsCard(); }).catch(() => {})
      .then(() => { if ($("#ls-card")) lsTimer = setTimeout(lsPoll, LS && LS.phase !== "idle" ? 1000 : 5000); });
  }
  function renderLsCard() {
    const c = $("#ls-card"); if (!c || !LS) return;
    c.hidden = false;
    const html = lsCard(LS);
    if (html !== lsHtml) { $("#ls-main").innerHTML = html; lsHtml = html; }
    const head = lsResultsHead(LS);
    if (head !== lsHeadHtml) { $("#ls-results-head").innerHTML = head; lsHeadHtml = head; }
    // 펼친 목록의 곡 수가 바뀌면(생성 중이거나 정리했을 때) 다시 불러온다
    const n = LSR.tab ? (LS.counts || {})[LSR.tab] || 0 : 0;
    if (LSR.tab && !LSR.loading && (!LSR.items || LSR.items.length !== n)) lsLoadList();
  }
  function lsCard(st) {
    const r = st.run, sd = st.send, c = st.counts || {};
    const rows = [`<div><span>생성 도구 위치</span><b style="font-size:14px">${st.home ? esc(st.home) : "아직 고르지 않았어요"}</b></div>`];
    if (st.parent && st.freeGb != null) rows.push(`<div><span>남은 공간</span><b style="font-size:14px">${st.freeGb}GB</b></div>`);
    if (st.installed) rows.push(`<div><span>계산 장치</span><b style="font-size:14px">${st.device === "cuda" ? esc(st.gpu || "NVIDIA GPU") : "CPU (GPU보다 많이 느려요)"}</b></div>`);
    let body = "", btns = "";
    const idle = st.phase === "idle";
    if (st.phase === "installing" || st.phase === "removing") {
      body = `<p class="ls-step">${esc(st.step)}</p>${st.log.length ? `<pre class="ls-log">${esc(st.log.slice(-3).join("\n"))}</pre>` : ""}`;
      btns = st.phase === "installing" ? `<button class="btn ghost" data-act="ls-stop">멈춤</button>` : "";
    } else if (st.outdated) {
      body = `<p class="ls-note">새 버전에 맞게 생성 도구를 업데이트해야 해요. 이미 받은 것은 그대로 두고 필요한 것만 받아서 금방 끝나요.</p>`;
      btns = `<button class="btn" data-act="ls-install">생성 도구 업데이트</button>`;
    } else if (!st.installed) {
      body = `<p class="ls-note">싱크 가사를 만드는 생성 도구(실행 환경과 음성 모델)를 처음 한 번 이 PC에 설치해요. 고른 폴더 안에만 설치되고, 설치하는 동안 ${st.needGb}GB, 끝나면 7GB 정도를 써요. NVIDIA 그래픽카드가 있으면 곡당 20초 안팎, 없으면 몇 분씩 걸려요.</p>`;
      btns = `<button class="btn ghost" data-act="ls-pick">${st.parent ? "도구 위치 바꾸기" : "도구 설치 위치 고르기"}</button><button class="btn" data-act="ls-install"${st.parent ? "" : " disabled"}>생성 도구 설치</button>`;
    } else if (st.phase === "running") {
      const pct = r && r.total ? Math.round((r.i / r.total) * 100) : 0;
      const avg = r && r.secs.length ? Math.round(r.secs.reduce((a, b) => a + b, 0) / r.secs.length) : 0;
      body = `<div class="ls-bar"><i style="width:${pct}%"></i></div>
        <p class="ls-step">${r && r.total ? `${U.num(r.i)} / ${U.num(r.total)}곡 살펴봄` : esc(st.step || "준비하는 중…")}${avg ? ` · 곡당 약 ${avg}초` : ""}</p>
        ${r && r.current ? `<p class="ls-note">만드는 중: ${esc(r.current.title)}${r.current.artist ? " — " + esc(r.current.artist) : ""}</p>` : st.step && r && r.total ? `<p class="ls-note">${esc(st.step)}</p>` : ""}
        ${lsCounts(r)}`;
      btns = `<button class="btn ghost" data-act="ls-stop">멈춤</button>`;
    } else if (st.phase === "sending") {
      const pct = sd && sd.total ? Math.round((sd.i / sd.total) * 100) : 0;
      body = `<div class="ls-bar"><i style="width:${pct}%"></i></div><p class="ls-step">${sd && sd.total ? `폰에 보내는 중 · ${U.num(sd.i)} / ${U.num(sd.total)}곡` : esc(st.step || "준비하는 중…")}</p>`;
      btns = `<button class="btn ghost" data-act="ls-stop">멈춤</button>`;
    } else {
      // 만드는 방식
      const folder = st.source !== "phone";
      body = `<div class="ls-source"><button class="ls-tab${folder ? " on" : ""}" data-act="ls-source" data-v="folder">PC에 복사한 음원 폴더로</button><button class="ls-tab${folder ? "" : " on"}" data-act="ls-source" data-v="phone">폰에서 바로 받아서</button></div>
        <p class="ls-note">${folder
          ? "폰의 음악 폴더를 이 PC로 복사해 두고 그 폴더로 만들어요. 만드는 동안 폰이 필요 없어서 끊기지 않아요. 다 만든 뒤 「폰에 보내기」를 누르면 폰에 저장돼요."
          : "폰에서 곡을 하나씩 받아 만들고 바로 폰에 저장해요. 몇 곡만 새로 넣었을 때 편해요. 만드는 동안 폰과 연결돼 있어야 하고, 끊기면 다시 연결되길 기다려요."}</p>
        ${folder ? `<div class="addr"><div><span>음원 폴더</span><b style="font-size:14px">${st.musicDir ? esc(st.musicDir) + (st.musicOk ? "" : " (찾을 수 없음)") : "아직 고르지 않았어요"}</b></div></div>` : ""}
        ${r && r.finished ? `<p class="ls-step">${r.stopped ? "멈췄어요" : "다 살펴봤어요"}</p>${lsCounts(r)}` : ""}
        ${folder && c.pending ? `<p class="ls-step">폰에 보낼 곡 ${U.num(c.pending)}곡</p><p class="ls-note">폰 앱을 켜고 PC와 연결된 상태에서 「폰에 보내기」를 눌러 주세요. 금방 끝나요.</p>` : ""}`;
      btns = `<button class="btn ghost" data-act="ls-remove">생성 도구 지우기</button>`
        + (folder ? `<button class="btn ghost" data-act="ls-pick-music">${st.musicDir ? "음원 폴더 바꾸기" : "음원 폴더 고르기"}</button>` : "")
        + (folder && c.pending ? `<button class="btn" data-act="ls-send">폰에 보내기</button>` : "")
        + `<button class="btn" data-act="ls-start"${folder && !st.musicOk ? " disabled" : ""}>${r ? "다시 시작" : "시작"}</button>`;
    }
    return `<h3>싱크 가사 만들기</h3><p>가사는 있는데 시간 정보가 없는 곡을, 이 PC가 음원에 맞춰 시간 가사로 만들어 폰에 저장해요. 가사 글은 파일에 있던 그대로 쓰고, 원본 파일은 바꾸지 않아요.</p><p style="margin-top:6px">만든 싱크 가사는 폰에 저장되고, 아래 생성 도구 폴더에는 다시 보내거나 되살릴 사본이 남아요.</p>
      <div class="addr">${rows.join("")}</div>${body}
      ${st.error ? `<p class="ls-err">${esc(st.error)}</p>` : st.notice && idle ? `<p class="ls-step">${esc(st.notice)}</p>` : ""}
      <div class="ls-btns">${btns}</div>`;
  }
  function lsCounts(r) {
    if (!r) return "";
    const parts = [["이번에 만듦", r.done + r.check], ["확인 필요", r.check], ["실패", r.fail], ["사본으로 되살림", r.restored], ["건너뜀", r.skip]].filter(([, n]) => n > 0);
    return parts.length ? `<p class="ls-note">${parts.map(([k, n]) => `${k} <b>${U.num(n)}</b>`).join(" · ")}</p>` : "";
  }
  // ── 결과 목록: 지난 실행까지 합친 곡별 마지막 결과 ──
  function lsResultsHead(st) {
    const c = st.counts || {};
    if (!LS_TABS.some(([k]) => c[k])) return "";
    return `<div class="ls-tabs"><span>결과 목록</span>${LS_TABS.filter(([k]) => k !== "notfound" || c[k]).map(([k, label]) => `<button class="ls-tab${LSR.tab === k ? " on" : ""}" data-act="ls-tab" data-v="${k}">${label} <b>${U.num(c[k] || 0)}</b></button>`).join("")}
      ${st.phase === "idle" ? `<button class="ls-reset" data-act="ls-reset">결과 기록 지우기</button>` : ""}</div>`;
  }
  const LS_TAB_NOTE = {
    made: "싱크 가사를 만들어 폰에 저장한 곡이에요. 정규 음원이 아니거나 틀린 곡은 「되돌리기」로 원래 가사로 돌릴 수 있어요.",
    check: "만들어서 저장은 했지만 어긋났을 수 있는 곡이에요. 재생해 보고 괜찮으면 「괜찮아요」, 틀렸으면 「되돌리기」를 눌러 주세요.",
    fail: "만들지 못한 곡이에요. 다음에 시작하면 다시 시도해요.",
    skip: "만들 필요가 없거나 만들 수 없어서 지나간 곡이에요. 이 도구는 파일에 있는 가사 글에 시간만 붙이므로, 가사가 없는 곡은 만들 수 없어요.",
    rejected: "되돌려서 원래 가사로 돌아간 곡이에요. 다음에 시작해도 다시 만들지 않아요. 「다시 만들기」를 누르면 다음 실행 때 다시 만들어요.",
    notfound: "만들었지만 폰 곡 목록에서 같은 곡을 찾지 못해 보내지 못한 곡이에요. 폰에 없는 곡이거나, PC 파일과 폰 파일의 제목·길이가 달라요.",
  };
  // 폰의 가사 화면에서 되돌린 곡을 PC 결과 기록에 반영한다
  function lsSync() {
    const pw = PWA(); if (!pw || !pw.ls_sync) return Promise.resolve(null);
    return lsToken().then((tok) => (tok ? pw.ls_sync(location.origin, tok) : null)).catch(() => null);
  }
  function lsLoadList() {
    const pw = PWA(), tab = LSR.tab; if (!pw || !tab) return;
    LSR.loading = true;
    lsSync().then(() => pw.ls_results(tab)).then((items) => { if (LSR.tab === tab) { LSR.items = items || []; renderLsRows(); } })
      .catch(() => {}).then(() => { LSR.loading = false; });
  }
  function renderLsFilter() {
    const f = $("#ls-filter"); if (!f) return;
    f.innerHTML = LSR.tab ? `<p class="ls-note">${LS_TAB_NOTE[LSR.tab]}</p><input class="ls-search" data-ls-filter placeholder="곡·아티스트·이유로 찾기" value="${esc(LSR.q)}">` : "";
  }
  function renderLsRows() {
    const box = $("#ls-rows"); if (!box) return;
    if (!LSR.tab) { box.innerHTML = ""; return; }
    if (!LSR.items) { box.innerHTML = `<p class="ls-note">불러오는 중…</p>`; return; }
    const q = LSR.q.trim().toLowerCase();
    const all = q ? LSR.items.filter((o) => `${o.title || ""} ${o.artist || ""} ${o.reason || ""}`.toLowerCase().includes(q)) : LSR.items;
    const shown = all.slice(0, LS_MAX);
    let top = "";
    if (LSR.tab === "skip" && !q) { // 이유별로 몇 곡인지
      const by = new Map(); LSR.items.forEach((o) => by.set(o.reason || "", (by.get(o.reason || "") || 0) + 1));
      top = `<p class="ls-note">${[...by].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${esc(k || "기타")} <b>${U.num(n)}</b>`).join(" · ")}</p>`;
    }
    if (LSR.tab === "check" && LSR.items.length) top += `<div class="ls-btns" style="margin-top:10px"><button class="btn ghost" data-act="ls-revert-all">확인 필요 곡 모두 되돌리기</button></div>`;
    box.innerHTML = top + (shown.length ? shown.map(lsRow).join("") : `<p class="ls-note">${q ? "찾는 곡이 없어요" : "아직 없어요"}</p>`)
      + (all.length > shown.length ? `<p class="ls-note">외 ${U.num(all.length - shown.length)}곡 — 검색으로 좁혀 보세요</p>` : "");
  }
  function lsRow(o) {
    const id = esc(o.id), st = o.status;
    const b = (act, label) => `<button class="btn ghost" data-act="${act}" data-id="${id}">${label}</button>`;
    const btns = st === "check" ? b("ls-keep", "괜찮아요") + b("ls-revert", "되돌리기")
      : st === "done" || st === "kept" || st === "restored" ? b("ls-revert", "되돌리기")
      : st === "rejected" ? b("ls-retry", "다시 만들기") : "";
    const pid = o.phoneId && L.byId.has(o.phoneId) ? o.phoneId : null; // 폰에 있는 곡이면 곡 화면으로
    const name = esc(o.title || o.path || o.id);
    return `<div class="ls-check">${pid ? `<a href="#/track/${encodeURIComponent(pid)}">${name}</a>` : `<b class="ls-name">${name}</b>`}<small>${esc(o.artist || "")}</small>
      <em class="${st}">${LS_STATUS[st] || st}${o.reason ? " · " + esc(o.reason) : ""}${o.path ? ` · <span class="ls-path">${esc(o.path)}</span>` : ""}</em>${btns ? `<span class="ls-check-btns">${btns}</span>` : ""}</div>`;
  }
  document.addEventListener("input", (e) => {
    if (!e.target.matches || !e.target.matches("[data-ls-filter]")) return;
    LSR.q = e.target.value; renderLsRows();
  });
  // 폰 연결이 필요 없는 작업은 토큰 없이 (PC 폴더 방식은 폰이 꺼져 있어도 만든다)
  const lsToken = () => API.token().then((t) => t.token).catch(() => "");
  function lsAct(act, el) {
    const pw = PWA(); if (!pw) return;
    const done = (res) => { if (res && res.ok === false && !res.cancel) toast(res.error || "실패했어요"); lsHtml = ""; lsPoll(); };
    const fail = (err) => { toast("실패: " + ((err && err.message) || err)); lsPoll(); };
    const reloadList = () => { LSR.items = null; renderLsRows(); lsLoadList(); };
    if (act === "ls-tab") {
      const v = el.dataset.v;
      LSR = { tab: LSR.tab === v ? null : v, items: null, q: "", loading: false };
      lsHeadHtml = ""; renderLsCard(); renderLsFilter(); renderLsRows();
      if (LSR.tab) lsLoadList();
      return;
    }
    if (act === "ls-revert" || act === "ls-keep" || act === "ls-retry" || act === "ls-revert-all") {
      const ids = act === "ls-revert-all" ? (LSR.items || []).filter((o) => o.status === "check").map((o) => o.id) : [el.dataset.id];
      if (!ids.length) return;
      if (act === "ls-revert-all" && !confirm(`확인 필요 곡 ${ids.length}곡의 만든 가사를 지우고 원래 가사로 되돌릴까요?\n되돌린 곡은 다시 만들지 않아요.`)) return;
      const action = act === "ls-keep" ? "keep" : act === "ls-retry" ? "retry" : "revert";
      el.disabled = true;
      (action === "retry" ? Promise.resolve("") : lsToken()) // 괜찮음 표시도 폰의 되돌리기 버튼을 떼려고 폰에 알린다
        .then((tok) => pw.ls_review(location.origin, tok, ids, action))
        .then((res) => {
          if (res && res.ok) toast(action === "revert" ? `${U.num(res.count)}곡을 원래 가사로 되돌렸어요` : action === "retry" ? "다음에 시작하면 다시 만들어요" : "괜찮은 곡으로 옮겼어요");
          if (action === "revert") lyrCache.clear(); // 가사 화면이 새로 불러오게
          reloadList(); done(res);
        }, fail);
      return;
    }
    if (act === "ls-reset") {
      if (!confirm("결과 기록을 모두 지우고 처음부터 다시 할까요?\n\n· 결과 목록과 PC에 남긴 가사 사본을 지워요\n· 폰에 저장된 만든 싱크 가사도 모두 지워요 (파일에 원래 있던 가사는 그대로예요)\n· 생성 도구와 음원 파일은 지우지 않아요")) return;
      lsToken().then((tok) => pw.ls_reset(location.origin, tok)).then((res) => {
        if (res && res.ok) toast(res.phone ? "결과 기록과 폰의 만든 싱크 가사를 지웠어요" : "결과 기록을 지웠어요. 폰에 연결되지 않아 폰의 만든 싱크 가사는 지우지 못했어요");
        lyrCache.clear(); LSR = { tab: null, items: null, q: "", loading: false }; lsHeadHtml = ""; renderLsFilter(); renderLsRows(); done(res);
      }, fail);
      return;
    }
    if (act === "ls-source") pw.ls_set_source(el.dataset.v).then(done, fail);
    else if (act === "ls-pick") pw.ls_pick_dir().then(done, fail);
    else if (act === "ls-pick-music") pw.ls_pick_music().then(done, fail);
    else if (act === "ls-install") pw.ls_install().then(done, fail);
    else if (act === "ls-stop") pw.ls_stop().then(done, fail);
    else if (act === "ls-remove") { if (confirm("생성 도구(실행 환경과 모델)를 지울까요?\n폰에 저장된 싱크 가사와 PC에 남긴 사본은 지우지 않아요.")) pw.ls_remove().then(done, fail); }
    else if (act === "ls-start") lsToken().then((tok) => pw.ls_start(location.origin, tok)).then(done, fail);
    else if (act === "ls-send") lsToken().then((tok) => pw.ls_send(location.origin, tok)).then((res) => { lyrCache.clear(); done(res); }, fail);
  }

  const notFound = () => `<div class="page"><div class="empty"><b>찾을 수 없어요</b>컬렉션에서 빠진 항목일 수 있어요.</div></div>`;

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
    const boxes = boxesByRecent(L.boxes.filter((b) => boxTapes(b).some(playable)));
    // 방금까지 재생하던 테이프가 상자 안에 있으면 그 상자를 고른 채로 시작
    const lastBox = (lastTapeId && boxOf(lastTapeId)) || (lastBoxId && L.boxes.find((b) => b.id === lastBoxId));
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
      const bx = shelfBox && L.boxes.find((b) => b.id === shelfBox);
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
    const pl = tmp || (plId === "liked" ? likedPl() : L.playlists.find((p) => p.id === plId));
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

  // ───────── 메뉴·모달·토스트 ─────────
  const menu = $("#menu");
  function openMenu(x, y, html) {
    menu.innerHTML = `<div class="menu-box">${html}</div>`;
    menu.hidden = false;
    const box = menu.firstChild; const w = box.offsetWidth, h = box.offsetHeight;
    box.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + "px";
    box.style.top = Math.max(8, Math.min(y, innerHeight - h - 8)) + "px";
  }
  function closeMenu() { menu.hidden = true; menu.innerHTML = ""; }
  menu.addEventListener("click", (e) => { if (e.target === menu) closeMenu(); });
  function trackMenu(id, x, y, ctx) {
    const t = L.byId.get(id); if (!t) return;
    const inPl = ctx && ctx.list === "playlist";
    openMenu(x, y, `
      <div class="mh">${art(t, 100)}<div><b>${esc(t.title)}</b><span>${esc(t.artist)}</span></div></div>
      <button data-m="next" data-id="${esc(id)}"><i class="ic ic-queue"></i>다음에 재생</button>
      <button data-m="queue" data-id="${esc(id)}"><i class="ic ic-plus"></i>대기열 맨 뒤에 추가</button>
      <button data-m="addpl" data-id="${esc(id)}"><i class="ic ic-stack"></i>테이프에 담기…</button>
      <button data-m="fav" data-id="${esc(id)}"><i class="ic ${t.fav ? "ic-heart-fill" : "ic-heart"}"></i>${t.fav ? "아끼는 곡에서 빼기" : "아끼는 곡으로"}</button>
      ${inPl ? `<button data-m="plremove" data-id="${esc(id)}" data-i="${ctx.i}" class="danger"><i class="ic ic-x"></i>이 테이프에서 빼기</button>` : ""}
      <hr>
      <button data-m="go" data-href="#/track/${encodeURIComponent(id)}"><i class="ic ic-shelf"></i>곡 상세보기</button>
      ${t.album ? `<button data-m="go" data-href="${albumHref(t)}"><i class="ic ic-stack"></i>앨범으로 이동</button>` : ""}
      ${t._artists.map((a) => `<button data-m="go" data-href="#/artist/${encodeURIComponent(a)}"><i class="ic ic-home"></i>${esc(a)}</button>`).join("")}`);
  }
  menu.addEventListener("click", (e) => {
    const b = e.target.closest("[data-m]"); if (!b) return;
    const id = b.dataset.id; closeMenu();
    switch (b.dataset.m) {
      case "next": P.playNext([id]); toast("다음에 재생해요"); break;
      case "queue": P.addToQueue([id]); toast("대기열에 추가했어요"); break;
      case "addpl": addToPlaylistModal([id]); break;
      case "fav": toggleFav(id); break;
      case "plremove": { const p = curPlaylist(); if (p) { const items = p.items.slice(); items.splice(+b.dataset.i, 1); savePlaylist(p, { items }); } break; }
      case "go": closeFull(); location.hash = b.dataset.href; break;
      case "pl-rename": playlistModal(curPlaylist()); break;
      case "pl-delete": deletePlaylist(curPlaylist()); break;
      case "pl-queue": { const p = curPlaylist(); if (p) { P.addToQueue(p.items.filter((i) => L.byId.has(i))); toast("대기열에 추가했어요"); } break; }
      case "tape-open": location.hash = tapeHref({ id: b.dataset.pl }); break;
      case "tape-play": playTape(b.dataset.pl); break;
      case "sys-play": playSysTape(b.dataset.k); break;
      case "album-play": case "album-shuffle": { const al = L.albums.get(b.dataset.album); if (al) P.playList(al.tracks.map((t) => t.id), 0, { type: "album", id: al.key, name: al.title }, { shuffle: b.dataset.m === "album-shuffle", randomStart: b.dataset.m === "album-shuffle" }); break; }
      case "album-queue": { const al = L.albums.get(b.dataset.album); if (al) { P.addToQueue(al.tracks.map((t) => t.id)); toast("대기열에 추가했어요"); } break; }
      case "tape-box": pickBoxModal(b.dataset.pl); break;
      case "tape-unbox": { const pl = tapeById(b.dataset.pl), bx = boxOf(b.dataset.pl); moveTapes([b.dataset.pl], null); if (pl && bx) toast(`「${pl.name}」을(를) 「${bx.name}」 상자에서 꺼냈어요`); break; }
      case "box-rename": boxModal(curBox()); break;
      case "box-delete": deleteBox(curBox()); break;
      case "box-queue": { const bx = curBox(); if (bx) { P.addToQueue(boxTrackIds(bx)); toast("대기열에 추가했어요"); } break; }
    }
  });
  const curPlaylist = () => { const r = route(); return r.name === "playlist" ? L.playlists.find((p) => p.id === r.arg) : null; };
  const curBox = () => { const r = route(); return r.name === "box" ? L.boxes.find((b) => b.id === r.arg) : null; };
  // 테이프 메뉴 (꾹 누르기·오른쪽 클릭): 열기, 상자에 넣기·옮기기·꺼내기
  function tapeMenu(plId, x, y) {
    const pl = tapeById(plId); if (!pl) return;
    const bx = boxOf(plId);
    openMenu(x, y, `<div class="mh"><div><b>${esc(pl.name)}</b><span>${bx ? `「${esc(bx.name)}」 상자 안` : "상자 밖"} · ${pl.items.length}곡</span></div></div>
      <button data-m="tape-play" data-pl="${esc(plId)}"><i class="ic ic-play"></i>재생하기</button>
      <button data-m="tape-open" data-pl="${esc(plId)}"><i class="ic ic-tape"></i>테이프 열기</button>
      <button data-m="tape-box" data-pl="${esc(plId)}"><i class="ic ic-box"></i>${bx ? "다른 상자로 옮기기…" : "상자에 넣기…"}</button>
      ${bx ? `<button data-m="tape-unbox" data-pl="${esc(plId)}"><i class="ic ic-x"></i>상자에서 꺼내기</button>` : ""}`);
  }

  // 시스템 테이프(앨범·가수·시대·장르·곡 목록·상자) 메뉴: 재생하기 · 열기
  function sysTapeMenu(k, x, y) {
    const t = sysTape(k); if (!t) return;
    const id = k.replace(/^(album|artist|box):/, "");
    if (t.temp) { openMenu(x, y, `<div class="mh"><div><b>${esc(t.pl.name)}</b><span>${U.num(t.pl.items.length)}곡 · 이번에만 있는 테이프</span></div></div><button data-m="sys-play" data-k="${esc(k)}"><i class="ic ic-play"></i>재생하기</button>`); return; }
    const href = k.startsWith("album:") ? "#/album/" + encodeURIComponent(id) : k.startsWith("artist:") ? "#/artist/" + encodeURIComponent(id) : k.startsWith("box:") ? "#/box/" + encodeURIComponent(id)
      : k.startsWith("year-") ? "#/year/" + k.slice(5) : k.startsWith("genre-") ? "#/genre/" + encodeURIComponent(k.slice(6)) : "#/collection";
    openMenu(x, y, `<div class="mh"><div><b>${esc(t.pl.name)}</b><span>${U.num(t.pl.items.length)}곡</span></div></div>
      <button data-m="sys-play" data-k="${esc(k)}"><i class="ic ic-play"></i>재생하기</button>
      <button data-m="go" data-href="${href}"><i class="ic ic-tape"></i>열기</button>`);
  }
  // 앨범 메뉴: 재생하기 · 셔플 재생 · 대기열에 추가 · 앨범 열기 · 아티스트
  function albumMenu(key, x, y) {
    const a = L.albums.get(key); if (!a) return;
    openMenu(x, y, `<div class="mh">${art(a, 100)}<div><b>${esc(a.title)}</b><span>${esc(a.artist)} · ${a.tracks.length}곡</span></div></div>
      <button data-m="album-play" data-album="${esc(key)}"><i class="ic ic-play"></i>재생하기</button>
      <button data-m="album-shuffle" data-album="${esc(key)}"><i class="ic ic-shuffle"></i>셔플 재생</button>
      <button data-m="album-queue" data-album="${esc(key)}"><i class="ic ic-plus"></i>대기열 맨 뒤에 추가</button>
      <hr>
      <button data-m="go" data-href="#/album/${encodeURIComponent(key)}"><i class="ic ic-stack"></i>앨범 열기</button>
      ${splitArtists(a.artist).map((n) => `<button data-m="go" data-href="#/artist/${encodeURIComponent(n)}"><i class="ic ic-person"></i>${esc(n)}</button>`).join("")}`);
  }

  const modal = $("#modal");
  function openModal(html, cls) {
    modal.innerHTML = `<div class="modal-box${cls ? " " + cls : ""}">${html}</div>`; modal.hidden = false;
    const f = $("input,textarea", modal);
    if (f) setTimeout(() => { f.focus(); if (f.setSelectionRange && /^(text|search|url|tel|password|)$/.test(f.type || "")) f.setSelectionRange(f.value.length, f.value.length); }, 30); // 체크상자 등은 글자 선택이 없다
  }
  function closeModal() { modal.hidden = true; modal.innerHTML = ""; }
  modal.addEventListener("click", (e) => { if (e.target === modal || e.target.closest("[data-close]")) closeModal(); });

  function playlistModal(p, thenAdd, intoBox) {
    // 빈 테이프를 꺼내 놓고 마스킹 테이프에 바로 제목을 적는다
    const pl = p || { id: "new", name: "", items: thenAdd || [] };
    const band = p ? bandTrack(p) : thenAdd && thenAdd.length ? L.byId.get(thenAdd[0]) : null;
    openModal(`<h3>${p ? "테이프 고치기" : "새 테이프"}</h3>
      <p class="dimmer" style="margin:-8px 0 14px;font-size:13px">마스킹 테이프에 제목을 적어 주세요</p>
      <div class="tape-edit-wrap">${cassette(pl, band, { editName: true, noHeart: true })}</div>
      <form id="pl-form"><textarea class="field" name="desc" maxlength="300" placeholder="이 테이프에 대한 메모 (선택)">${esc(p ? p.desc || "" : "")}</textarea>
      <div class="row-btns"><button type="button" class="btn ghost" data-close>취소</button><button class="btn primary">${p ? "저장" : "만들기"}</button></div></form>`, "wide");
    $("#pl-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target); const name = String(fd.get("name")).trim(); const desc = String(fd.get("desc")).trim();
      if (!name) return;
      closeModal();
      if (p) { savePlaylist(p, { name, desc }); return; }
      try {
        const np = await API.createPlaylist(name, thenAdd || []);
        np.desc = desc; if (desc) API.updatePlaylist(np.id, { desc }).catch(() => {});
        L.playlists.push(np); renderSidebar();
        const bx = intoBox && L.boxes.find((x) => x.id === intoBox);
        if (bx) { moveTapes([np.id], bx, true); toast(`「${bx.name}」 상자에 새 테이프를 넣었어요`); }
        else if (thenAdd && thenAdd.length) toast(`「${name}」에 담았어요`);
        closeFull(); location.hash = "#/playlist/" + encodeURIComponent(np.id); // 어디서 만들든 새 테이프 화면으로 바로
      } catch (err) { toast("만들지 못했어요: " + err.message); }
    });
  }
  // 테이프 고르기 팝업 위 검색창: 테이프 이름이 맞는 것 먼저, 그다음 담긴 곡의 제목·가수가 맞는 것 (초성도). tail은 검색어가 없을 때만 끝에 붙인다
  function bindPickSearch(input, grid, list, cell, tail) {
    const draw = () => {
      const raw = input.value.trim(), q = U.norm(raw), cho = U.isChoQuery(raw);
      if (!q) { grid.innerHTML = list.map(cell).join("") + (tail || ""); return; }
      const byName = [], bySong = [];
      list.forEach((pl) => {
        const n = U.norm(pl.name);
        if (cho ? U.chosung(n).includes(q) : n.includes(q)) byName.push(pl);
        else if (pl.items.some((id) => { const t = L.byId.get(id); return t && (cho ? t._cho.includes(q) : t._q.includes(q)); })) bySong.push(pl);
      });
      const found = byName.concat(bySong);
      grid.innerHTML = found.length ? found.map(cell).join("") : '<p class="dimmer pick-empty">찾는 테이프가 없어요</p>';
    };
    input.addEventListener("input", draw);
    return draw;
  }
  // 곡을 테이프에 담기 (곡 메뉴·여러 곡 선택): 상자의 「테이프 추가하기」와 같은 화면. 누르면 바로 담긴다
  function addToPlaylistModal(ids) {
    const one = ids.length === 1;
    const T = sortedTapes().filter((p) => p.id !== "liked"); // 최근에 들은 순 (아끼는 곡은 하트로 담는다)
    const cell = (p) => `<div class="pick-tape" role="button" tabindex="0" data-pl="${esc(p.id)}" title="「${esc(p.name)}」에 담기">${cassette(p, bandTrack(p), { noHeart: true })}${one && p.items.includes(ids[0]) ? '<span class="already">담겨 있음</span>' : ""}</div>`;
    const tail = `<button class="tape-new" data-pl="__new"><i class="ic ic-plus"></i><span>새 테이프 만들기</span></button>`;
    openModal(`<h3>테이프에 담기</h3><p class="dimmer" style="margin:-8px 0 12px;font-size:13px">${one ? "" : `${ids.length}곡을 `}담을 테이프를 눌러 주세요</p>
      <label class="search-box pick-search"><i class="ic ic-search"></i><input type="search" placeholder="테이프 이름이나 곡으로 찾기" autocomplete="off" spellcheck="false"></label>
      <div class="pick-tapes">${T.map(cell).join("")}${tail}</div>
      <div class="row-btns"><button class="btn ghost" data-close>닫기</button></div>`, "wide");
    const grid = $(".pick-tapes", modal);
    bindPickSearch($(".pick-search input", modal), grid, T, cell, tail);
    grid.addEventListener("keydown", (e) => { const b = e.target.closest(".pick-tape"); if (b && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); e.stopPropagation(); b.click(); } });
    grid.addEventListener("click", (e) => {
      const b = e.target.closest("[data-pl]"); if (!b) return;
      if (b.dataset.pl === "__new") { playlistModal(null, ids); return; }
      const p = L.playlists.find((x) => x.id === b.dataset.pl);
      const add = ids.filter((i) => !p.items.includes(i));
      closeModal();
      if (!add.length) { toast("이미 담겨 있어요"); return; }
      savePlaylist(p, { items: p.items.concat(add) });
      toast(`「${p.name}」에 담았어요`);
    });
  }
  // 설정 → 기록 초기화: 고른 것만 지운다. 되돌릴 수 없으니 한 번 더 묻는다
  function resetRecordsModal() {
    const opt = (k, title, desc) => `<label class="reset-opt"><input type="checkbox" name="${k}"><span><b>${title}</b><small>${desc}</small></span></label>`;
    openModal(`<h3>어떤 기록을 지울까요?</h3><form id="reset-form">
      ${opt("plays", "들은 횟수", "곡마다 들은 횟수와 함께한 시간")}
      ${opt("favs", "아끼는 곡 표시", "하트를 누른 곡이 모두 풀려요 (곡은 그대로)")}
      ${opt("history", "최근 들은 기록", "처음·마지막으로 들은 날, 최근 들은 테이프")}
      <p class="dimmer" style="font-size:12.5px;margin:12px 0 0">지운 기록은 되돌릴 수 없어요.</p>
      <div class="row-btns"><button type="button" class="btn ghost" data-close>취소</button><button class="btn primary" id="reset-ok" disabled style="background:#e06464;color:#fff">초기화하기</button></div></form>`);
    const form = $("#reset-form"), ok = $("#reset-ok");
    form.addEventListener("change", () => { ok.disabled = !$$("input:checked", form).length; });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const what = { plays: form.plays.checked, favs: form.favs.checked, history: form.history.checked };
      if (!what.plays && !what.favs && !what.history) return;
      closeModal();
      API.resetRecords(what).then(() => {
        if (what.history) { try { localStorage.removeItem("mc.tapePlayed"); } catch (err) {} for (const k in tempPlayed) delete tempPlayed[k]; }
        toast("기록을 초기화했어요");
        return reloadLibrary().then(() => renderSidebar());
      }).catch((err) => toast("초기화하지 못했어요: " + err.message));
    });
  }
  function deletePlaylist(p) {
    if (!p) return;
    openModal(`<h3>테이프를 삭제할까요?</h3><p class="dim" style="margin:0">「${esc(p.name)}」을(를) 삭제해요. 곡 자체는 컬렉션에 그대로 남아요.</p>
      <div class="row-btns"><button class="btn ghost" data-close>취소</button><button class="btn primary" id="pl-del-ok" style="background:#e06464;color:#fff">삭제하기</button></div>`);
    $("#pl-del-ok").addEventListener("click", () => {
      closeModal();
      L.playlists = L.playlists.filter((x) => x !== p); renderSidebar();
      if (boxOf(p.id)) moveTapes([p.id], null, true);
      API.deletePlaylist(p.id).catch((e) => toast("삭제하지 못했어요: " + e.message));
      location.hash = "#/";
    });
  }

  // ── 상자 고치기 ──
  function saveBox(b, patch, quiet) {
    Object.assign(b, patch, { updated: Date.now() });
    if (!quiet) rerender();
    return API.updateBox(b.id, patch).catch((e) => toast("저장하지 못했어요: " + e.message));
  }
  // 테이프들을 target 상자로 옮긴다 (null이면 상자에서 꺼내기). 다른 상자에 있던 건 거기서 빠진다
  function moveTapes(ids, target, quiet) {
    for (const b of L.boxes) {
      if (b === target) continue;
      const items = b.items.filter((id) => !ids.includes(id));
      if (items.length !== b.items.length) saveBox(b, { items }, true);
    }
    if (target) { const add = ids.filter((id) => !target.items.includes(id)); if (add.length) saveBox(target, { items: target.items.concat(add) }, true); }
    if (!quiet) rerender();
  }
  function boxModal(b, thenPut) {
    openModal(`<h3>${b ? "상자 이름 고치기" : "새 상자"}</h3>
      <p class="dimmer" style="margin:-8px 0 14px;font-size:13px">상자 앞에 붙일 이름을 적어 주세요</p>
      <form id="box-form"><input class="field" name="name" maxlength="40" value="${esc(b ? b.name : "")}" placeholder="예: 여름에 듣는 테이프" autocomplete="off" spellcheck="false" required>
      <div class="row-btns"><button type="button" class="btn ghost" data-close>취소</button><button class="btn primary">${b ? "저장" : "만들기"}</button></div></form>`);
    $("#box-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = String(new FormData(e.target).get("name")).trim(); if (!name) return;
      closeModal();
      if (b) { saveBox(b, { name }); return; }
      try {
        const nb = await API.createBox(name, []);
        L.boxes.push(nb);
        if (thenPut && thenPut.length) { moveTapes(thenPut, nb); const pl = tapeById(thenPut[0]); toast(`「${pl ? pl.name : "테이프"}」을(를) 「${name}」 상자에 넣었어요`); }
        else location.hash = boxHref(nb);
      } catch (err) { toast("만들지 못했어요: " + err.message); }
    });
  }
  // 테이프 하나를 넣을 상자 고르기
  function pickBoxModal(plId) {
    const pl = tapeById(plId); if (!pl) return;
    const cur = boxOf(plId);
    openModal(`<h3>「${esc(pl.name)}」을(를) 어느 상자에?</h3><div class="pick-tapes">
      ${L.boxes.map((b) => `<div class="pick-tape" role="button" tabindex="0" data-bx="${esc(b.id)}" title="「${esc(b.name)}」에 넣기">${tbox(b)}${b === cur ? '<span class="already">들어 있음</span>' : ""}</div>`).join("")}
      <button class="tape-new" data-bx="__new"><i class="ic ic-box"></i><span>새 상자 만들어 넣기</span></button>
    </div><div class="row-btns"><button class="btn ghost" data-close>닫기</button></div>`, "wide");
    const grid = $(".pick-tapes", modal);
    grid.addEventListener("keydown", (e) => { const t = e.target.closest(".pick-tape"); if (t && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); e.stopPropagation(); t.click(); } });
    grid.addEventListener("click", (e) => {
      const t = e.target.closest("[data-bx]"); if (!t) return;
      if (t.dataset.bx === "__new") { boxModal(null, [plId]); return; }
      const b = L.boxes.find((x) => x.id === t.dataset.bx);
      closeModal();
      if (b === cur) { toast("이미 들어 있어요"); return; }
      moveTapes([plId], b);
      toast(`「${pl.name}」을(를) 「${b.name}」 상자에 넣었어요`);
    });
  }
  // 재생목록 편집 → 「곡 추가하기」: 검색해서 하나씩 담는다 (담은 곡은 목록 맨 뒤에)
  function addTracksModal(p) {
    openModal(`<h3>「${esc(p.name)}」에 곡 추가</h3>
      <div class="search-box"><i class="ic ic-search"></i><input type="search" id="add-q" placeholder="제목·아티스트·앨범, 초성으로도" autocomplete="off"></div>
      <div class="add-finder" id="add-res"><p class="dimmer">찾을 곡을 입력해 주세요</p></div>
      <div class="row-btns"><button class="btn primary" data-close>완료</button></div>`, "wide add-modal");
    const inp = $("#add-q", modal), res = $("#add-res", modal);
    const draw = () => {
      const r = search(inp.value);
      if (!r) { res.innerHTML = '<p class="dimmer">찾을 곡을 입력해 주세요</p>'; return; }
      res.innerHTML = r.tracks.length ? `<div class="tracklist">${r.tracks.slice(0, 40).map((t) => `<div class="row" data-id="${esc(t.id)}"><div class="t">${art(t, 120)}<div><b>${esc(t.title)}</b><span>${esc(t.artist)}</span></div></div><span class="alb">${esc(t.album)}</span>${p.items.includes(t.id) ? '<span class="added"><i class="ic ic-check"></i>담음</span>' : `<button class="btn" data-act="pl-add" data-id="${esc(t.id)}">담기</button>`}</div>`).join("")}</div>` : '<p class="dimmer">찾는 곡이 없어요</p>';
    };
    inp.addEventListener("input", U.debounce(draw, 150));
  }
  // 상자 편집 → 「테이프 추가하기」: 이 상자에 없는 테이프를 골라 넣는다. 다른 상자의 테이프는 이 상자로 옮겨 온다
  function addTapesModal(b) {
    const pick = new Set();
    const T = sortedTapes().filter((pl) => !b.items.includes(pl.id));
    if (!T.length) { toast("더 넣을 테이프가 없어요"); return; }
    const badge = (pl) => { if (pick.has(pl.id)) return '<span class="already">고름</span>'; const o = boxOf(pl.id); return o ? `<span class="already other">${esc(o.name)}</span>` : ""; };
    const cell = (pl) => `<div class="pick-tape${pick.has(pl.id) ? " on" : ""}" role="button" tabindex="0" data-pl="${esc(pl.id)}">${cassette(pl, bandTrack(pl), { noHeart: true })}${badge(pl)}</div>`;
    openModal(`<h3>「${esc(b.name)}」에 넣을 테이프</h3><p class="dimmer" style="margin:-8px 0 12px;font-size:13px">눌러서 고르고 「넣기」. 다른 상자의 테이프를 고르면 이 상자로 옮겨 와요</p>
      <label class="search-box pick-search"><i class="ic ic-search"></i><input type="search" placeholder="테이프 이름이나 곡으로 찾기" autocomplete="off" spellcheck="false"></label>
      <div class="pick-tapes">${T.map(cell).join("")}</div>
      <div class="row-btns"><button class="btn ghost" data-close>취소</button><button class="btn primary" id="box-add-ok">넣기</button></div>`, "wide");
    const grid = $(".pick-tapes", modal);
    bindPickSearch($(".pick-search input", modal), grid, T, cell); // 찾는 동안에도 고른 것은 그대로 남는다
    grid.addEventListener("keydown", (e) => { const t = e.target.closest(".pick-tape"); if (t && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); e.stopPropagation(); t.click(); } });
    grid.addEventListener("click", (e) => {
      const t = e.target.closest(".pick-tape[data-pl]"); if (!t) return;
      const id = t.dataset.pl; pick.has(id) ? pick.delete(id) : pick.add(id);
      t.outerHTML = cell(tapeById(id));
      const nt = $(`.pick-tape[data-pl="${CSS.escape(id)}"]`, grid); if (nt) nt.focus({ preventScroll: true });
    });
    $("#box-add-ok").addEventListener("click", () => {
      closeModal();
      const add = T.map((pl) => pl.id).filter((id) => pick.has(id));
      if (add.length) { moveTapes(add, b); toast(`테이프 ${add.length}개를 넣었어요`); }
    });
  }
  function deleteBox(b) {
    if (!b) return;
    openModal(`<h3>상자를 삭제할까요?</h3><p class="dim" style="margin:0">「${esc(b.name)}」 상자만 삭제해요. 안에 있던 테이프 ${b.items.length}개는 나의 테이프에 그대로 남아요.</p>
      <div class="row-btns"><button class="btn ghost" data-close>취소</button><button class="btn primary" id="box-del-ok" style="background:#e06464;color:#fff">삭제하기</button></div>`);
    $("#box-del-ok").addEventListener("click", () => {
      closeModal();
      L.boxes = L.boxes.filter((x) => x !== b);
      API.deleteBox(b.id).catch((e) => toast("삭제하지 못했어요: " + e.message));
      location.hash = "#/playlists";
    });
  }

  let toastT;
  function toast(msg) { const el = $("#toast"); el.textContent = msg; el.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("show"), 2200); }

  function toggleFav(id) {
    const t = L.byId.get(id); if (!t) return;
    t.fav = !t.fav; t.favAt = t.fav ? Date.now() : 0;
    API.setTrack(id, { fav: t.fav }).catch(() => { t.fav = !t.fav; toast("저장하지 못했어요"); refreshAfterChange(id); });
    toast(t.fav ? "아끼는 곡에 담았어요" : "아끼는 곡에서 뺐어요");
    refreshAfterChange(id);
  }
  function refreshAfterChange(id) {
    renderSidebar(); renderBar(); renderFull();
    if (["liked", "home", "playlists", "library", "box"].includes(route().name)) return rerender();
    const t = L.byId.get(id); if (!t) return;
    $$('[data-act="fav"]').forEach((b) => {
      const bid = b.dataset.id || (b.closest("[data-id]") && b.closest("[data-id]").dataset.id);
      if (bid !== id) return;
      b.classList.toggle("on", !!t.fav);
      if (!b.classList.contains("tape-heart")) b.innerHTML = `<i class="ic ${t.fav ? "ic-heart-fill" : "ic-heart"}"></i>`;
    });
  }

  // ───────── 클릭 처리 (위임) ─────────
  document.addEventListener("click", (e) => {
    if (U.clickSuppressed()) { e.preventDefault(); e.stopPropagation(); return; }
    // 여러 곡 선택: 선택 중에는 곡 줄·카드를 누르면 고르기만 한다. PC는 Ctrl/Shift+클릭으로 바로 시작
    const pickEl = e.target.closest("#view .row[data-id], #view .card[data-id]");
    if (pickEl && !pickEl.closest(".add-finder") && !e.target.closest('[data-act="fav"], [data-handle]') && (SEL.on || e.target.closest(".row .ck:not(.off)") || (!isMobile() && (e.ctrlKey || e.metaKey || e.shiftKey)))) {
      e.preventDefault(); e.stopPropagation();
      if (!SEL.on) { SEL.on = true; $$(".row.sel").forEach((r) => r.classList.remove("sel")); }
      selPick(pickEl, e.shiftKey);
      return;
    }
    const a = e.target.closest("[data-act]");
    const rowEl = e.target.closest(".row[data-id]");
    // 재생 화면 볼륨: 바깥을 누르면 접는다
    // 폰 재생 막대: 오른쪽 버튼들 말고는 어디를 눌러도 재생 화면으로
    if (isMobile() && e.target.closest("#playerbar") && !e.target.closest(".pb-mini")) { e.preventDefault(); openFull(); return; }
    if (e.target.closest("[data-stop]")) {
      if (isMobile() && e.target.closest("#playerbar")) { e.preventDefault(); openFull(); return; }
      if (!fp.hidden) closeFull();
      return; // 링크는 그대로
    }
    if (a) {
      const act = a.dataset.act;
      const id = a.dataset.id || (a.closest("[data-id]") && a.closest("[data-id]").dataset.id);
      switch (act) {
        case "back": goBack(); return;
        case "toggle":
          if (a.closest(".np-tape-wrap") && isMobile()) { setMemo(true); return; } // 폰: 카세트를 누르면 가사 메모지 (PC는 옆 패널의 가사 탭)
          P.toggle(); return;
        case "insert-tape": insertTape(a.dataset.pl); return;
        case "reset-records": resetRecordsModal(); return;
        case "home-now": if (!P.current) { npEjected = true; lastTapeId = lastBoxId = null; } openFull(); return; // 비어 있으면 꽂을 테이프 고르기
        case "side-box": sideBox = a.dataset.bx; renderSidebar(); $("#side-playlists").scrollTop = 0; return;
        case "side-out": sideBox = null; renderSidebar(); return;
        case "shelf-box": shelfBox = shelfBox === a.dataset.bx ? null : a.dataset.bx; if (shelfDraw) shelfDraw(); return; // 같은 상자를 다시 누르면 나오기, 다른 상자는 바로 그 상자로
        case "memo-close": if (!e.target.closest(".ln[data-ms]")) setMemo(false); return;
        case "memo-theme": {
          memoTheme = memoTheme === "paper" ? "plain" : "paper";
          try { localStorage.setItem("mc.lyrTheme", memoTheme); } catch (err) {}
          const m = a.closest(".np-memo"); m.classList.remove("paper", "plain"); m.classList.add(memoTheme);
          a.outerHTML = memoThemeBtn();
          syncLyrics(true); return;
        }
        case "next": P.next(); return;
        case "prev": P.prev(); return;
        case "shuffle": toast(P.toggleShuffle() ? "셔플을 켰어요" : "셔플을 껐어요"); return;
        case "repeat": { const m = P.cycleRepeat(); toast({ off: "반복을 껐어요", all: "전체 반복", one: "한 곡 반복" }[m]); renderBar(); renderFull(); return; }
        case "fav": e.preventDefault(); toggleFav(id); return;
        case "more": { e.preventDefault(); e.stopPropagation(); const r = a.getBoundingClientRect(); const lst = a.closest("[data-list]"); trackMenu(id, r.left - 200, r.bottom + 4, { list: lst ? lst.dataset.list : "", i: rowEl ? +rowEl.dataset.i : -1, sel: !!(rowEl && rowEl.closest("#view") && !rowEl.closest(".add-finder")) }); return; }
        case "open-full": openFull(); return;
        case "mini-queue": // 재생 화면을 열고 재생목록을 아래에서 끌어올린다 (폰)
          npSide = "queue"; if (fp.hidden) openFull(); else renderNpSide();
          if (isMobile()) fp.classList.add("q-open");
          return;
        case "q-close": fp.classList.remove("q-open"); return;
        case "close-full": closeFull(); return;
        case "np-side": npSide = a.dataset.v; renderNpSide(); return;
        case "panel": { const v = a.dataset.v; if (panelOpen && panelTab === v) panelOpen = false; else { panelOpen = true; panelTab = v; } try { localStorage.setItem("mc.panel", panelOpen ? "1" : "0"); } catch (err) {} renderPanel(); renderBar(); return; }
        case "close-panel": panelOpen = false; try { localStorage.setItem("mc.panel", "0"); } catch (err) {} renderPanel(); renderBar(); return;
        case "q-remove": { e.stopPropagation(); P.removeAt(+a.closest("[data-q]").dataset.q); return; }
        case "list-play": case "list-shuffle": {
          const name = a.dataset.list; const ids = lists[name] || [];
          if (!ids.length) { toast(name === "box" ? "빈 상자예요" : "곡이 없어요"); return; }
          P.playList(ids, 0, ctxFor(name), { shuffle: act === "list-shuffle", randomStart: act === "list-shuffle" });
          return;
        }
        case "track-play": e.preventDefault(); e.stopPropagation(); playTrackHere(id); return;
        case "card-play": {
          e.preventDefault(); e.stopPropagation();
          const lst = a.closest("[data-list]"), ids = lst && lists[lst.dataset.list];
          if (ids) P.playList(ids, ids.indexOf(id), ctxFor(lst.dataset.list), { shuffle: false });
          else playTrackHere(id, a.closest(".shelf"));
          return;
        }
        case "album-play": { e.preventDefault(); e.stopPropagation(); const al = L.albums.get(a.closest("[data-album]").dataset.album); P.playList(al.tracks.map((t) => t.id), 0, { type: "album", id: al.key, name: al.title }); return; }
        case "col-filter": colState.filter = a.dataset.v; saveCol(); if (route().arg) location.hash = "#/collection"; else rerender(); return;
        case "new-playlist": playlistModal(null, null, a.dataset.into); return;
        case "pl-tape-play": { e.preventDefault(); const name = a.dataset.list; const ctx = ctxFor(name); const pl = name === "liked" ? likedPl() : curPlaylist(); if (P.current && nowCtx() && nowCtx().id === ctx.id) P.toggle(); else if (pl && pl.items.length) P.playList(pl.items, 0, ctx); return; }
        case "pl-edit": plEdit = !plEdit; if (SEL.on) selEnd(); rerender(); return;
        case "sel-start": selStart(null, a.dataset.list); return;
        case "sel-head": selHead(a); return;
        case "sel-cancel": selEnd(); return;
        case "sel-all": selAll(); return;
        case "sel-play": case "sel-shuffle": {
          const ids = SEL.ids.slice(); if (!ids.length) { toast("곡을 골라 주세요"); return; }
          selEnd();
          P.playList(ids, 0, { type: "collection", name: "선택한 곡" }, { shuffle: act === "sel-shuffle", randomStart: act === "sel-shuffle" });
          return;
        }
        case "sel-next": { const ids = SEL.ids.slice(); if (!ids.length) return; selEnd(); P.playNext(ids); toast(`${ids.length}곡을 다음에 재생해요`); return; }
        case "sel-addpl": { const ids = SEL.ids.slice(); if (!ids.length) return; selEnd(); addToPlaylistModal(ids); return; }
        case "pl-more": { const r = a.getBoundingClientRect(); const p = curPlaylist(), bx = p && boxOf(p.id); openMenu(r.right - 240, r.bottom + 6, `<button data-m="pl-rename"><i class="ic ic-pen"></i>이름·설명 고치기</button><button data-m="pl-queue"><i class="ic ic-queue"></i>대기열에 추가</button>${p ? `<button data-m="tape-box" data-pl="${esc(p.id)}"><i class="ic ic-box"></i>${bx ? "다른 상자로 옮기기…" : "상자에 넣기…"}</button>` : ""}${bx ? `<button data-m="tape-unbox" data-pl="${esc(p.id)}"><i class="ic ic-x"></i>상자에서 꺼내기</button>` : ""}<hr><button data-m="pl-delete" class="danger"><i class="ic ic-trash"></i>테이프 삭제하기</button>`); return; }
        case "box-more": { const r = a.getBoundingClientRect(); openMenu(r.right - 240, r.bottom + 6, `<button data-m="box-rename"><i class="ic ic-pen"></i>상자 이름 고치기</button><button data-m="box-queue"><i class="ic ic-queue"></i>대기열에 추가</button><hr><button data-m="box-delete" class="danger"><i class="ic ic-trash"></i>상자 삭제하기</button>`); return; }
        case "box-edit": boxEdit = !boxEdit; rerender(); return;
        case "box-remove": { e.stopPropagation(); const bx = curBox(), pl = tapeById(a.dataset.pl); if (bx) { saveBox(bx, { items: bx.items.filter((x) => x !== a.dataset.pl) }); if (pl) toast(`「${pl.name}」을(를) 상자에서 뺐어요`); } return; }
        case "box-add-open": { const bx = curBox(); if (bx) addTapesModal(bx); return; }
        case "pl-add-open": { const p = curPlaylist(); if (p) addTracksModal(p); return; }
        case "new-box": boxModal(null); return;
        case "pl-remove": { const p = curPlaylist(); if (p && rowEl) { const items = p.items.slice(); items.splice(+rowEl.dataset.i, 1); savePlaylist(p, { items }); } return; }
        case "pl-add": {
          const p = curPlaylist(); if (!p) return;
          if (!p.items.includes(id)) savePlaylist(p, { items: p.items.concat([id]) });
          a.outerHTML = '<span class="added"><i class="ic ic-check"></i>담음</span>';
          return;
        }
        case "pldir-pick": try { window.NativeBridge.pickPlaylistDir(); } catch (err) {} return;
        case "pldir-clear": try { window.NativeBridge.clearPlaylistDir(); } catch (err) {} toast("가져오기 폴더를 해제했어요. 이미 가져온 테이프는 남아 있어요"); rerender(); return;
        case "fd-open": { const p = a.dataset.path; FD.open.has(p) ? FD.open.delete(p) : FD.open.add(p); renderFolderCard(); return; }
        case "fd-check": { const ps = fdUnder(a.dataset.path), turnOff = ps.some((p) => !FD.off.has(p)); ps.forEach((p) => (turnOff ? FD.off.add(p) : FD.off.delete(p))); FD.dirty = true; renderFolderCard(); return; }
        case "fd-auto": FD.autoNew = !FD.autoNew; FD.dirty = true; renderFolderCard(); return;
        case "fd-apply": {
          if (!FD || FD.saving) return;
          FD.saving = true; renderFolderCard();
          API.setFolders([...FD.off], FD.autoNew).then(() => { FD = null; toast("라이브러리 폴더를 바꿨어요"); return reloadLibrary(); })
            .catch((err) => { if (FD) { FD.saving = false; renderFolderCard(); } toast("실패: " + err.message); });
          return;
        }
        case "ls-pick": case "ls-install": case "ls-stop": case "ls-remove": case "ls-start": case "ls-tab": case "ls-revert": case "ls-keep": case "ls-retry": case "ls-revert-all": case "ls-reset": case "ls-source": case "ls-pick-music": case "ls-send": lsAct(act, a); return;
        case "lyr-retry": $$("[data-lyr]").forEach((b) => mountLyrics(b)); return;
        case "lyr-revert": revertLyricsModal(a.dataset.id); return;
        case "server-toggle": { const on = !a.classList.contains("on"); try { window.NativeBridge.setServerEnabled(on); } catch (err) {} setTimeout(rerender, 400); return; }
        case "dev-import": {
          openModal(`<h3>원래 앱 데이터로 덮어쓸까요?</h3><p class="dim" style="margin:0">디버그 앱의 기록·테이프를 원래 앱 것으로 바꿔요. 상자는 그대로 남아요.</p>
            <div class="row-btns"><button class="btn ghost" data-close>취소</button><button class="btn primary" id="dev-import-ok">가져오기</button></div>`);
          $("#dev-import-ok").addEventListener("click", () => {
            closeModal(); toast("원래 앱에서 가져오는 중…");
            API.devImport().then((r) => { toast(`${U.num(r.tracks)}곡의 기록과 테이프 ${r.playlists}개를 가져왔어요`); setTimeout(reloadLibrary, 600); })
              .catch((err) => toast("실패: " + err.message));
          });
          return;
        }
        case "rescan": { toast("라이브러리를 다시 읽는 중…"); (window.NativeBridge ? Promise.resolve(window.NativeBridge.rescan()) : API.rescan()).then(() => setTimeout(reloadLibrary, 300)).catch((err) => toast("실패: " + err.message)); return; }
      }
    }
    // 대기열 줄을 누르면 그 곡으로
    const qr = e.target.closest(".q-row[data-q]");
    if (qr) { P.jump(+qr.dataset.q); return; }
    // 카드
    const card = e.target.closest('.card[data-card="track"]');
    if (card && isMobile()) { /* 폰에서는 카드도 링크로 동작 */ return; }
    // 홈(대시보드)의 테이프 줄: 누르면 바로 재생 (꾹 누르면 상세 — 아래 onContext)
    const sysEl = e.target.closest(".tape-row [data-sys]");
    if (sysEl) { playSysTape(sysEl.dataset.sys); return; }
    const rowTape = e.target.closest(".tape-row .tape[data-pl]");
    if (rowTape) { playTape(rowTape.dataset.pl); return; }
    // 상자는 그 상자 안으로
    const bxEl = e.target.closest(".tbox[data-box]");
    if (bxEl) { location.hash = "#/box/" + encodeURIComponent(bxEl.dataset.box); return; }
    // 테이프는 그 재생목록으로 (LP 앨범은 링크)
    const tp = e.target.closest(".tape[data-pl]");
    if (tp && tp.closest(".tape-grid.editing")) return;
    if (tp) { const id = tp.dataset.pl; if (tempTape(id)) { playSysTape(id); return; } location.hash = id === "liked" ? "#/liked" : "#/playlist/" + encodeURIComponent(id); return; }
    // 곡 줄: 폰은 한 번 누르면 재생, PC는 선택(두 번 누르면 재생)
    if (rowEl) {
      if (e.target.closest(".t-art .play")) { playRow(rowEl); return; }
      if (rowEl.closest(".add-finder")) return;
      if (isMobile()) { playRow(rowEl); return; }
      $$(".row.sel").forEach((r) => r.classList.remove("sel")); rowEl.classList.add("sel");
    }
  });
  document.addEventListener("dblclick", (e) => {
    if (SEL.on) return;
    const rowEl = e.target.closest(".row[data-id]");
    if (rowEl && !e.target.closest("button,a") && !rowEl.closest(".add-finder")) playRow(rowEl);
  });
  document.addEventListener("change", (e) => {
    const a = e.target.closest("[data-act]"); if (!a) return;
    if (a.dataset.act === "col-sort") { colState.sort = a.value; saveCol(); rerender(); }
    if (a.dataset.act === "lib-sort") { libSort[a.dataset.k] = a.value; try { localStorage.setItem("mc.libsort", JSON.stringify(libSort)); } catch (err) {} rerender(); }
  });
  const saveMemo = U.debounce((id, val) => {
    API.setTrack(id, { memo: val }).then(() => { const s = $("#memo-state"); if (s) s.textContent = "저장됨"; }).catch(() => { const s = $("#memo-state"); if (s) s.textContent = "저장하지 못했어요"; });
  }, 700);
  document.addEventListener("input", (e) => {
    const a = e.target.closest("[data-act]"); if (!a) return;
    if (a.dataset.act === "memo") { const t = L.byId.get(a.dataset.id); t.memo = a.value; const s = $("#memo-state"); if (s) s.textContent = "저장 중…"; saveMemo(t.id, a.value); }
    if (a.dataset.act === "list-q") { listQ[a.dataset.k] = a.value; refillList(a.dataset.k); }
  });

  const saveCol = () => { try { localStorage.setItem("mc.col", JSON.stringify(colState)); } catch (e) {} };
  function ctxFor(name) {
    const r = route();
    if (name === "album") { const a = L.albums.get(r.arg); return { type: "album", id: r.arg, name: a && a.title }; }
    if (name.startsWith("artist")) return { type: "artist", id: r.arg, name: r.arg };
    if (name === "playlist") { const p = curPlaylist(); return { type: "playlist", id: r.arg, name: p && p.name }; }
    if (name === "liked") return { type: "playlist", id: "liked", name: "아끼는 곡" };
    if (name === "box") { const b = curBox(); return b ? boxCtx(b) : { type: "box", id: r.arg }; }
    if (name === "collection") return { type: "collection", id: "collection", name: "곡 목록" };
    if (name === "year") return { type: "collection", id: "year-" + parseInt(r.arg, 10), name: r.arg + "년대" };
    if (name === "genre") return { type: "collection", id: "genre-" + r.arg, name: r.arg };
    return { type: "collection", name: "" };
  }
  function playRow(rowEl) {
    const box = rowEl.closest("[data-list]"); const name = box && box.dataset.list;
    const id = rowEl.dataset.id;
    if (P.currentId === id && name && P.context && JSON.stringify(P.context) === JSON.stringify(ctxFor(name))) { P.toggle(); return; }
    const ids = name ? lists[name] : [id];
    P.playList(ids, ids.indexOf(id), ctxFor(name || ""), { shuffle: false });
  }
  function playTrackHere(id, shelf) {
    if (shelf) { const ids = $$('.card[data-id]', shelf).map((c) => c.dataset.id); P.playList(ids, ids.indexOf(id), { type: "collection", name: "" }, { shuffle: false }); }
    else P.playList([id], 0, { type: "collection", name: "" }, { shuffle: false });
  }

  // 테이프 재생: 이미 그 테이프를 재생 중이면 처음부터 다시 틀지 않고 재생 화면만 연다
  function playTape(plId) {
    if (tempTape(plId)) { playSysTape(plId); return; } // 임의 테이프
    const pl = plId === "liked" ? likedPl() : L.playlists.find((p) => p.id === plId);
    if (!pl) return;
    if (isPlayingPl(pl) && P.current) { if (!P.playing) P.play(); openFull(); return; }
    const ids = pl.items.filter((id) => L.byId.has(id));
    if (!ids.length) { toast("빈 테이프예요"); return; }
    P.playList(ids, 0, { type: "playlist", id: pl.id, name: pl.name });
  }
  // 테이프는 어느 화면에서든 같은 메뉴 (재생 화면의 선반·팝업 안 테이프는 제외: 거기선 누르기가 꽂기·고르기)
  U.onContext(document, ".tape[data-pl], .tape[data-plid]", (el, x, y) => {
    if (TD || el.closest("#fullplayer, #modal")) return;
    const id = el.dataset.pl || el.dataset.plid; if (tempTape(id)) sysTapeMenu(id, x, y); else if (tapeById(id)) tapeMenu(id, x, y);
  });
  U.onContext(document, "#view [data-sys]", (el, x, y) => sysTapeMenu(el.dataset.sys, x, y));
  U.onContext(document, ".lp[data-album], .card[data-album]", (el, x, y) => { if (!el.closest("#fullplayer, #modal")) albumMenu(el.dataset.album, x, y); });

  // ── 테이프를 끌어다 상자에 넣기 (상자가 보이는 화면에서만) ──
  // PC 마우스: 누른 채 조금 움직이면 바로 집힌다. 폰: 꾹 누르면 테이프가 들리고, 그대로 끌면 옮기고 그냥 떼면 메뉴
  let TD = null;
  // 상자 화면에서는 위쪽 상자 그림(data-unbox)이 「상자 밖으로」 놓는 자리가 된다 (편집 중엔 순서 바꾸기 손잡이를 쓰므로 제외)
  const DROP = ".tbox[data-box], [data-unbox]";
  const dragSrc = (t) => { const el = t && t.closest && t.closest(".tape-grid .tape[data-pl]"); return el && view.contains(el) && !el.closest(".editing") && !el.dataset.pl.startsWith("tmp-") && $(DROP, view) ? el : null; };
  function tdLift(x, y) {
    const el = TD.el, r = el.getBoundingClientRect();
    const k = Math.min(1, 200 / r.width); // 손에 든 테이프는 작게
    const g = el.cloneNode(true);
    g.removeAttribute("data-pl"); g.removeAttribute("data-plid"); g.classList.remove("now", "lifted"); g.classList.add("tape-ghost");
    g.style.width = r.width * k + "px";
    document.body.appendChild(g);
    Object.assign(TD, { on: true, g, ox: (x - r.left) * k, oy: (y - r.top) * k });
    el.classList.remove("lifted"); el.classList.add("drag-src"); document.body.classList.add("tape-dragging");
    tdMove(x, y); tdAuto();
  }
  function tdMove(x, y) {
    TD.x = x; TD.y = y;
    TD.g.style.transform = `translate(${x - TD.ox}px, ${y - TD.oy}px) rotate(-3deg)`;
    const hit = document.elementFromPoint(x, y), bx = hit && hit.closest(DROP);
    if (bx !== TD.over) { if (TD.over) TD.over.classList.remove("drop-over"); TD.over = bx; if (bx) bx.classList.add("drop-over"); }
  }
  // 위·아래 끝으로 끌고 가면 화면이 따라 움직인다 (상자 줄이 위로 지나가 있어도 닿게)
  function tdAuto() {
    if (!TD || !TD.on) return;
    const r = view.getBoundingClientRect(), edge = 70;
    const v = TD.y < r.top + edge ? -(r.top + edge - TD.y) : TD.y > r.bottom - edge ? TD.y - (r.bottom - edge) : 0;
    if (v) { view.scrollTop += v * 0.35; tdMove(TD.x, TD.y); }
    TD.raf = requestAnimationFrame(tdAuto);
  }
  function tdEnd(drop) {
    const d = TD; TD = null; if (!d) return;
    clearTimeout(d.timer); cancelAnimationFrame(d.raf);
    d.el.classList.remove("lifted", "drag-src"); document.body.classList.remove("tape-dragging");
    if (!d.on) return;
    U._suppressClick = Date.now(); // 놓은 자리에서 클릭으로 테이프·상자가 열리지 않게
    if (d.over) d.over.classList.remove("drop-over");
    // 상자 화면 위쪽 점선 자리에 놓으면: 이 상자에서 꺼낸다
    if (drop && d.over && d.over.dataset.unbox) {
      const from = L.boxes.find((b) => b.id === d.over.dataset.unbox), pl = tapeById(d.id);
      d.g.style.transition = "transform .2s ease-in, opacity .2s ease-in"; d.g.style.opacity = "0";
      setTimeout(() => d.g.remove(), 220);
      if (from && from.items.includes(d.id)) setTimeout(() => { moveTapes([d.id], null); toast(`「${pl ? pl.name : "테이프"}」을(를) 「${from.name}」 상자에서 꺼냈어요`); }, 180);
      return;
    }
    const bx = drop && d.over && L.boxes.find((b) => b.id === d.over.dataset.box);
    if (!bx) { d.g.remove(); return; }
    // 상자 속으로 쏙 들어가는 움직임 뒤에 옮긴다
    const r = d.over.getBoundingClientRect(), gr = d.g.getBoundingClientRect();
    d.g.style.transition = "transform .22s ease-in, opacity .22s ease-in";
    d.g.style.transform = `translate(${r.left + r.width / 2 - gr.width * 0.15}px, ${r.top + r.height * 0.3}px) scale(.3)`;
    d.g.style.opacity = "0";
    setTimeout(() => d.g.remove(), 240);
    const pl = tapeById(d.id), had = boxOf(d.id);
    if (had === bx) { toast("이미 들어 있어요"); return; }
    setTimeout(() => { moveTapes([d.id], bx); toast(`「${pl ? pl.name : "테이프"}」을(를) 「${bx.name}」 상자에 넣었어요`); }, 200);
  }
  // 마우스
  view.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch" || e.button !== 0 || TD) return;
    const el = dragSrc(e.target); if (!el || e.target.closest("button")) return;
    TD = { el, id: el.dataset.pl, sx: e.clientX, sy: e.clientY, on: false };
  });
  window.addEventListener("pointermove", (e) => {
    if (!TD || e.pointerType === "touch") return;
    if (!TD.on) { if (Math.hypot(e.clientX - TD.sx, e.clientY - TD.sy) < 6) return; tdLift(e.clientX, e.clientY); }
    else tdMove(e.clientX, e.clientY);
  });
  window.addEventListener("pointerup", (e) => { if (TD && e.pointerType !== "touch") tdEnd(true); });
  window.addEventListener("keydown", (e) => { if (e.key === "Escape" && TD) tdEnd(false); });
  view.addEventListener("dragstart", (e) => { if (e.target.closest && e.target.closest(".tape-grid .tape")) e.preventDefault(); }); // 앨범아트 이미지가 끌려 나가지 않게
  // 터치
  view.addEventListener("touchstart", (e) => {
    if (TD || e.touches.length !== 1) return;
    const el = dragSrc(e.target); if (!el || e.target.closest("button")) return;
    const p = e.touches[0];
    TD = { el, id: el.dataset.pl, sx: p.clientX, sy: p.clientY, on: false, armed: false, touch: true };
    TD.timer = setTimeout(() => { if (!TD) return; TD.armed = true; el.classList.add("lifted"); if (navigator.vibrate) navigator.vibrate(12); }, 380);
  }, { passive: true });
  document.addEventListener("touchmove", (e) => {
    if (!TD || !TD.touch) return;
    const p = e.touches[0];
    if (!TD.armed) { if (Math.hypot(p.clientX - TD.sx, p.clientY - TD.sy) > 8) { clearTimeout(TD.timer); TD = null; } return; } // 그냥 스크롤
    e.preventDefault();
    if (!TD.on) { if (Math.hypot(p.clientX - TD.sx, p.clientY - TD.sy) < 6) return; tdLift(p.clientX, p.clientY); }
    else tdMove(p.clientX, p.clientY);
  }, { passive: false });
  const touchUp = (e) => {
    if (!TD || !TD.touch) return;
    const d = TD;
    if (d.on) { tdEnd(e.type === "touchend"); return; }
    tdEnd(false);
    if (d.armed && e.type === "touchend") { U._suppressClick = Date.now(); tapeMenu(d.id, d.sx, d.sy); } // 끌지 않고 뗐으면 메뉴
  };
  document.addEventListener("touchend", touchUp);
  document.addEventListener("touchcancel", touchUp);
  U.onContext(document, ".row[data-id], .card[data-id]", (el, x, y) => {
    if (el.closest(".add-finder") || el.closest("#fullplayer")) return;
    const lst = el.closest("[data-list]");
    trackMenu(el.dataset.id, x, y, { list: lst ? lst.dataset.list : "", i: +el.dataset.i, sel: !!el.closest("#view") });
  });

  // 키보드 (PC)
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input,textarea,select")) return;
    if (e.code === "Space") { e.preventDefault(); P.toggle(); }
    else if (e.code === "ArrowRight" && e.shiftKey) P.next();
    else if (e.code === "ArrowLeft" && e.shiftKey) P.prev();
    else if (e.code === "ArrowRight") P.seek(Math.min(P.dur, P.pos + 5000));
    else if (e.code === "ArrowLeft") P.seek(Math.max(0, P.pos - 5000));
    else if (e.key === "/" ) { e.preventDefault(); location.hash = "#/search"; }
    else if (e.code === "Escape") { if (SEL.on && menu.hidden && modal.hidden && fp.hidden) { selEnd(); return; } closeMenu(); closeModal(); closeFull(); }
  });

  // 안드로이드 뒤로 가기: 처리했으면 true
  window.__back = () => {
    if (!menu.hidden) { closeMenu(); return true; }
    if (!modal.hidden) { closeModal(); return true; }
    if (!fp.hidden) { closeFull(); return true; }
    if (SEL.on) { selEnd(); return true; }
    if (route().name !== "home") { history.back(); return true; }
    return false;
  };

  // ───────── 여러 곡 선택 → 현재 재생목록으로 묶어 재생 ─────────
  // ids는 고른 순서대로. 재생하면 그 순서가 그대로 지금 듣는 (임시) 재생목록이 된다
  const SEL = { on: false, ids: [], list: "", last: null };
  const selBtn = (list, keep) => `<button class="icon-btn sel-btn${keep ? "" : " m-only"}" data-act="sel-start" data-list="${esc(list)}" title="여러 곡 선택"><i class="ic ic-checkbox"></i></button>`;
  function selStart(id, list) {
    SEL.on = true; SEL.list = list || SEL.list;
    if (id && !SEL.ids.includes(id)) { SEL.ids.push(id); SEL.last = id; }
    $$(".row.sel").forEach((r) => r.classList.remove("sel"));
    syncSel();
  }
  function selEnd() { SEL.on = false; SEL.ids = []; SEL.list = ""; SEL.last = null; syncSel(); }
  function selPick(el, range) {
    const id = el.dataset.id, box = el.closest("[data-list]"), name = box ? box.dataset.list : "";
    const arr = name && lists[name];
    if (range && SEL.last && arr && arr.includes(SEL.last) && arr.includes(id)) {
      // Shift: 마지막으로 고른 곡부터 여기까지 목록 순서대로 모두
      const a = arr.indexOf(SEL.last), b = arr.indexOf(id);
      arr.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((x) => { if (!SEL.ids.includes(x)) SEL.ids.push(x); });
    } else {
      const k = SEL.ids.indexOf(id);
      if (k >= 0) SEL.ids.splice(k, 1); else SEL.ids.push(id);
    }
    SEL.last = id; if (name) SEL.list = name;
    syncSel();
  }
  // 모두 선택: 마지막으로 고른 목록 전체 (스크롤해야 보이는 곡까지). 이미 다 골랐으면 모두 해제
  function selScope() {
    if (SEL.list && lists[SEL.list] && $(`#view [data-list="${CSS.escape(SEL.list)}"]`)) return lists[SEL.list];
    const seen = []; $$("#view .row[data-id], #view .card[data-id]").forEach((el) => { if (!el.closest(".add-finder") && !seen.includes(el.dataset.id)) seen.push(el.dataset.id); });
    return seen;
  }
  function selAll() {
    const scope = selScope();
    if (scope.length && scope.every((id) => SEL.ids.includes(id))) SEL.ids = SEL.ids.filter((id) => !scope.includes(id));
    else scope.forEach((id) => { if (!SEL.ids.includes(id)) SEL.ids.push(id); });
    syncSel();
  }
  // 목록 머리의 체크박스: 그 목록을 모두 고르고, 이미 다 골랐으면 모두 풀고 선택을 끝낸다
  function selHead(btn) {
    const box = btn.closest("[data-list]"), name = box && box.dataset.list, arr = name && lists[name];
    if (!arr || !arr.length) return;
    if (SEL.on && arr.every((id) => SEL.ids.includes(id))) {
      SEL.ids = SEL.ids.filter((id) => !arr.includes(id));
      if (!SEL.ids.length) { selEnd(); return; }
    } else {
      if (!SEL.on) { SEL.on = true; $$(".row.sel").forEach((r) => r.classList.remove("sel")); }
      arr.forEach((id) => { if (!SEL.ids.includes(id)) SEL.ids.push(id); });
    }
    SEL.list = name; syncSel();
  }
  function markPicked() {
    const set = new Set(SEL.ids);
    $$("#view .row[data-id], #view .card[data-id]").forEach((el) => el.classList.toggle("picked", set.has(el.dataset.id)));
    $$('#view [data-list] > .tl-head [data-act="sel-head"]').forEach((b) => {
      const arr = lists[b.closest("[data-list]").dataset.list] || [];
      const n = arr.filter((id) => set.has(id)).length;
      b.classList.toggle("on", SEL.on && n > 0 && n === arr.length);
      b.classList.toggle("some", SEL.on && n > 0 && n < arr.length);
    });
  }
  function syncSel() {
    document.body.classList.toggle("selecting", SEL.on);
    markPicked();
    const b = $("#selbar"); if (!b) return;
    b.hidden = !SEL.on;
    if (!SEL.on) { b.innerHTML = ""; return; }
    const n = SEL.ids.length, scope = selScope(), all = scope.length && scope.every((id) => SEL.ids.includes(id));
    const ms = SEL.ids.reduce((s, id) => s + ((L.byId.get(id) || {}).duration || 0), 0);
    const dis = n ? "" : " disabled";
    b.innerHTML = `<div class="selbar-box">
      <button class="icon-btn" data-act="sel-cancel" title="선택 끝내기"><i class="ic ic-x"></i></button>
      <div class="selbar-count"><b>${n ? U.num(n) + "곡 선택" : "곡을 골라 주세요"}</b>${n ? `<span>${esc(fmtTotal(ms))}</span>` : ""}</div>
      <button class="btn ghost selbar-all" data-act="sel-all">${all ? "모두 해제" : "모두 선택"}</button>
      <button class="icon-btn" data-act="sel-addpl" title="테이프에 담기"${dis}><i class="ic ic-stack"></i></button>
      <button class="icon-btn" data-act="sel-next" title="다음에 재생"${dis}><i class="ic ic-queue"></i></button>
      <button class="icon-btn" data-act="sel-shuffle" title="섞어서 재생"${dis}><i class="ic ic-shuffle"></i></button>
      <button class="selbar-play" data-act="sel-play" title="고른 곡을 바로 재생"${dis}><i class="ic ic-play"></i><span>재생</span></button>
    </div>`;
  }

  // ───────── 재생 상태 반영 ─────────
  let lastId = null;
  let widgetName = null;
  function syncWidgetName() {
    try { if (window.NativeBridge && NativeBridge.setTapeName && P.current) { const n = contextTape().name; if (n !== widgetName) { widgetName = n; NativeBridge.setTapeName(n); } } } catch (e) {}
  }
  function onState() {
    const id = P.currentId;
    const changed = id !== lastId; lastId = id;
    renderBar(); refreshHomeNow();
    if (changed) syncWidgetName(); // 상자 통째 재생에서 다음 테이프로 넘어가면 위젯 테이프 이름도
    $$(".row.now, .lp.now, .card.now").forEach((r) => r.classList.remove("now", "paused"));
    if (id) {
      $$(`:is(.row, .card)[data-id="${CSS.escape(id)}"]`).forEach((r) => { r.classList.add("now"); r.classList.toggle("paused", !P.playing); });
      $$(`.lp[data-album="${CSS.escape(albumKeyOf(P.current))}"]`).forEach((r) => { r.classList.add("now"); r.classList.toggle("paused", !P.playing); });
    }
    // 테이프: 지금 듣는 재생목록이면 릴이 돈다. 곡이 바뀌면 띠를 다시 적는다
    if (changed && $("#view .tape[data-plid]")) rerender();
    else $$("#view .tape[data-plid]").forEach((el) => { el.classList.toggle("now", isPlayingPl({ id: el.dataset.plid })); el.classList.toggle("paused", !P.playing); });
    if (changed) renderSidebar();
    else $$("#side-playlists .tape[data-plid]").forEach((el) => { el.classList.toggle("now", isPlayingPl({ id: el.dataset.plid })); el.classList.toggle("paused", !P.playing); });
    if (changed) { renderPanel(); renderFull(); if (id) getLyrics(id); }
    else syncFullControls();
    document.title = P.current ? `${P.current.title} · ${P.current.artist}` : "테이프 박스";
  }
  function onPlayed({ id }) {
    const t = L.byId.get(id); if (!t) return;
    const now = Date.now();
    t.plays++; t.lastPlayed = now; if (!t.firstPlayed) t.firstPlayed = now;
    const a = L.albums.get(t.albumKey); if (a) { a.plays++; a.lastPlayed = now; }
    t._artists.forEach((n) => { const r = L.artists.get(n); if (r) r.plays++; });
  }

  // ───────── 시작 ─────────
  // 상자를 모르는 예전 폰 앱이면 상자 없이
  const loadBoxes = () => API.boxes().then((b) => b || []).catch(() => []);
  async function reloadLibrary() {
    const [lib, pls, bxs] = await Promise.all([API.library(), API.playlists(), loadBoxes()]);
    indexLibrary(lib.tracks || []); L.playlists = pls || []; L.boxes = bxs;
    renderSidebar(); rerender(); renderBar();
  }
  // 개발 (디버그 앱 + PC 개발 서버 pc/dev_proxy.py): 화면 파일이 바뀌면 CSS만일 땐 스타일만 갈아 끼우고(재생·화면 그대로),
  // 그 밖의 파일이면 새로고침한다. 개발 서버가 없으면 조용히 기다렸다가 다시 붙는다
  function devWatch() {
    let v = "", fails = 0;
    const swapCss = (nv) => $$('link[rel="stylesheet"][href^="css/"]').forEach((l) => {
      const n = l.cloneNode(); n.href = l.getAttribute("href").split("?")[0] + "?v=" + nv;
      n.onload = () => l.remove(); l.after(n); // 새 스타일이 다 읽힌 뒤 옛것을 빼서 깜빡이지 않게
    });
    const loop = () => fetch("/__dev/wait?v=" + v, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((o) => {
        fails = 0;
        if (v && o.v !== v) {
          if (!o.css) { location.reload(); return; }
          swapCss(o.v); toast("스타일을 새로 읽었어요");
        }
        v = o.v; loop();
      })
      .catch(() => setTimeout(loop, Math.min(30000, 2000 * ++fails)));
    loop();
  }
  async function boot() {
    try {
      const st = await API.status();
      L.debug = !!st.debug;
      if (L.debug) devWatch();
      if (!st.authorized) return showGate();
      const [lib, pls, bxs] = await Promise.all([API.library(), API.playlists(), loadBoxes()]);
      indexLibrary(lib.tracks || []); L.playlists = pls || []; L.boxes = bxs;
    } catch (e) {
      if (e instanceof API.Unauthorized) return showGate();
      $("#view").innerHTML = `<div class="page"><div class="empty"><b>폰에 연결할 수 없어요</b>폰 앱에서 「PC에서 접속」이 켜져 있는지, 같은 Wi-Fi인지 확인해 주세요.<br><br><button class="btn" onclick="location.reload()">다시 시도</button></div></div>`;
      return;
    }
    P = new Player((id) => L.byId.get(id));
    // 새로 재생을 시작하면 (PC·폰 모두) 카세트 재생 화면으로 바로 넘어간다
    const playList = P.playList.bind(P);
    P.playList = (...args) => { playList(...args); if (fp.hidden) openFull(); };
    P.on("state", onState);
    // 테이프를 '들었다'고 치는 기준: 한 곡을 실제로 10초 들으면 (곡 재생 횟수 기준과는 따로).
    // 재생 시간 알림(time)은 PC·폰 모두 오므로 여기서 직접 센다. 화면이 잠들어 못 센 경우를 위해 곡 재생 횟수 기록 때도 한 번 더
    const TAPE_MS = 10000;
    let tl = { key: null, ms: 0, last: 0, done: false };
    P.on("time", () => {
      const c = P.context, k = (P.currentId || "") + "|" + JSON.stringify(c ? [c.type, c.id || "", c.name || ""] : null), now = performance.now();
      if (tl.key !== k) tl = { key: k, ms: 0, last: now, done: false };
      if (P.playing) tl.ms += Math.min(1500, Math.max(0, now - tl.last)); // 탐색·일시정지 시간은 넣지 않는다
      tl.last = now;
      if (!tl.done && tl.ms >= TAPE_MS) { tl.done = true; markTapePlayed(); }
    });
    P.on("played", markTapePlayed);
    P.on("queue", () => {
      if (panelOpen && panelTab === "queue") renderPanel(); if (npSide === "queue") renderNpSide();
      refreshHomeNow();
      // 폰 홈 화면 위젯의 카세트에도 같은 테이프 이름을 적는다
      syncWidgetName();
    });
    P.on("time", updateTime);
    P.on("played", onPlayed);
    P.on("listened", ({ id, ms }) => { const t = L.byId.get(id); if (t) t.listenedMs += ms; });
    P.on("error", () => toast("이 곡을 재생하지 못했어요"));
    let linkLost = false;
    P.on("link", ({ ok }) => {
      if (!ok && !linkLost) { linkLost = true; toast("폰 연결이 끊겼어요. 다시 연결되면 이어서 재생해요"); }
      else if (ok && linkLost) { linkLost = false; toast("폰과 다시 연결됐어요"); }
    });
    P.on("native", (m) => { if (m.type === "library") reloadLibrary(); if (m.type === "resume") reloadLibrary().catch(() => {}); });
    renderSidebar();
    P.resume();
    render();
    onState();
    renderPanel();
    window.addEventListener("resize", U.debounce(() => { renderBar(); }, 200));
  }
  function showGate() {
    const g = $("#gate"); g.hidden = false;
    g.innerHTML = `<div class="gate-box"><div class="brand-mark"></div><h1>폰의 컬렉션에 연결</h1><p>폰 앱 「설정 · 연결」에 보이는 PIN 6자리를 입력해 주세요</p>
      <div class="pin">${"<input inputmode=numeric maxlength=1>".repeat(6)}</div><div class="gate-err"></div></div>`;
    const ins = $$(".pin input", g); ins[0].focus();
    ins.forEach((inp, i) => {
      inp.addEventListener("input", () => {
        inp.value = inp.value.replace(/\D/g, "").slice(-1);
        if (inp.value && i < 5) ins[i + 1].focus();
        const pin = ins.map((x) => x.value).join("");
        if (pin.length === 6) API.pair(pin).then(() => { g.hidden = true; boot(); }).catch((e) => { $(".gate-err", g).textContent = e.message === "locked" ? "잠시 뒤에 다시 시도해 주세요" : "PIN이 맞지 않아요"; ins.forEach((x) => (x.value = "")); ins[0].focus(); });
      });
      inp.addEventListener("keydown", (e) => { if (e.key === "Backspace" && !inp.value && i > 0) ins[i - 1].focus(); });
      inp.addEventListener("paste", (e) => { const s = (e.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, 6); if (s.length) { e.preventDefault(); s.split("").forEach((c, k) => (ins[k].value = c)); ins[Math.min(5, s.length)].dispatchEvent(new Event("input")); } });
    });
  }

  boot();
})();
