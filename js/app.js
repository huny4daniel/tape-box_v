// 화면 전체: 라우팅, 각 페이지, 재생 막대, 가사·대기열, 메뉴
(function () {
  "use strict";
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = U.esc;

  // ───────── 라이브러리 ─────────
  const L = { tracks: [], byId: new Map(), albums: new Map(), artists: new Map(), playlists: [], loaded: false };
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
  const TIERS = [[100, "인생곡"], [50, "애착"], [20, "단골"], [5, "익숙한"], [1, "첫 만남"]];
  const tierOf = (plays) => { for (let i = 0; i < TIERS.length; i++) if (plays >= TIERS[i][0]) return { level: 5 - i, name: TIERS[i][1] }; return { level: 0, name: "아직 안 들어봄" }; };
  const tierNext = (plays) => { for (let i = TIERS.length - 1; i >= 0; i--) if (plays < TIERS[i][0]) return TIERS[i]; return null; };
  const aff = (plays) => { const lv = tierOf(plays).level; let s = '<span class="aff" title="' + esc(tierOf(plays).name + " · " + U.num(plays) + "회") + '">'; for (let i = 1; i <= 5; i++) s += '<i class="' + (i <= lv ? "f" : "") + '"></i>'; return s + "</span>"; };
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
      : `<span class="no">${first}<i class="ic ic-play play"></i></span>`;
    const tail = mode === "edit"
      ? `<button class="icon-btn" data-act="pl-remove" title="이 재생목록에서 빼기"><i class="ic ic-x"></i></button>`
      : `<button class="icon-btn more" data-act="more" title="더 보기"><i class="ic ic-more"></i></button>`;
    return `<div class="row${now ? " now" + (P.playing ? "" : " paused") : ""}" data-id="${esc(t.id)}" data-i="${i}">
      ${lead}
      <div class="t">${art(t, 120)}<div><b>${isFresh(t) ? '<span class="new-badge">NEW</span>' : ""}${esc(t.title)}${t.memo ? '<span class="memo-dot" title="메모가 있어요"></span>' : ""}</b><span>${artistLinks(t)}</span></div></div>
      <span class="alb"><a href="${albumHref(t)}" data-stop>${esc(t.album)}</a></span>
      <span class="date${isFresh(t) ? " fresh" : ""}" title="${esc(U.fmtDateKo(t.addedAt))}에 수집">${U.fmtDate(t.addedAt)}</span>
      ${aff(t.plays)}
      <button class="icon-btn fav${t.fav ? " on" : ""}" data-act="fav" title="${t.fav ? "아끼는 곡에서 빼기" : "아끼는 곡으로"}"><i class="ic ${t.fav ? "ic-heart-fill" : "ic-heart"}"></i></button>
      <span class="dur">${U.fmtDur(t.duration)}</span>
      ${tail}
    </div>`;
  }
  const tlHead = (mode) => `<div class="tl-head"><span class="r">#</span><span>제목</span><span>앨범</span><span class="r">수집일</span><span class="r">애정도</span><span></span><span class="r">길이</span><span></span></div>`;
  function trackList(name, tracks, mode) {
    lists[name] = tracks.map((t) => t.id);
    return `<div class="tracklist" data-list="${esc(name)}">${tlHead(mode)}${tracks.map((t, i) => row(t, i, mode)).join("")}</div>`;
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
  function artistCard(r) {
    const top = topAlbumOf(r);
    return `<a class="card round" href="#/artist/${encodeURIComponent(r.name)}">${art(top, 300)}<b>${esc(r.name)}</b><span>소장 ${r.tracks.length}곡</span></a>`;
  }
  const topAlbumOf = (r) => { let best = null; for (const k of r.albums) { const a = L.albums.get(k); if (!best || a.plays > best.plays || (a.plays === best.plays && a.tracks.length > best.tracks.length)) best = a; } return best; };
  const section = (title, sub, body, more) => `<section class="section"><div class="section-head"><div><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ""}</div>${more ? `<a href="${more}">모두 보기</a>` : ""}</div>${body}</section>`;

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
  function render(keepScroll) {
    if (!L.loaded) return;
    const r = route();
    if (curRoute && curRoute !== r.hash) scrolls[curRoute] = view.scrollTop;
    const st = keepScroll ? view.scrollTop : scrolls[r.hash] || 0;
    curRoute = r.hash;
    closeMenu();
    const fn = pages[r.name] || pages.home;
    setTint(null);
    $("#topbar-title").textContent = "";
    view.innerHTML = fn(r.arg) || "";
    const navName = { album: "albums", artist: "artists", playlist: "playlists", liked: "playlists" }[r.name] || r.name;
    $$("[data-nav]").forEach((a) => a.classList.toggle("on", a.dataset.nav === r.name || (a.closest("#sidebar") && a.dataset.nav === navName) || (r.name === "home" && a.dataset.nav === "home") || (["albums", "artists", "playlist", "playlists", "liked"].includes(r.name) && a.dataset.nav === "library" )));
    $$(".side-pl").forEach((a) => a.classList.toggle("on", a.getAttribute("href") === "#" + r.hash));
    if (pages[r.name] && pages[r.name].after) pages[r.name].after(r.arg);
    view.scrollTop = st;
    onScroll();
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
  view.addEventListener("wheel", (e) => {
    const row = e.target.closest("[data-hscroll]");
    if (!row || e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
    const max = row.scrollWidth - row.clientWidth;
    if (max <= 0 || (e.deltaY < 0 && row.scrollLeft <= 0) || (e.deltaY > 0 && row.scrollLeft >= max - 1)) return;
    e.preventDefault();
    row.scrollBy({ left: e.deltaY * (e.deltaMode === 1 ? 32 : 1), behavior: "auto" });
  }, { passive: false });

  // ───────── 페이지: 홈 ─────────
  pages.home = () => {
    const T = L.tracks;
    if (!T.length) return `<div class="page"><div class="empty"><b>아직 소장한 곡이 없어요</b>폰에 mp3를 넣고 설정에서 라이브러리를 다시 읽어 주세요.</div></div>`;
    const hr = new Date().getHours();
    const greet = hr < 5 ? "늦은 밤이에요" : hr < 12 ? "좋은 아침이에요" : hr < 18 ? "좋은 오후예요" : "좋은 저녁이에요";
    const first = T.reduce((m, t) => Math.min(m, t.addedAt || Infinity), Infinity);
    const totalDur = T.reduce((s, t) => s + (t.duration || 0), 0);
    const totalListen = T.reduce((s, t) => s + (t.listenedMs || 0), 0);

    // 나의 테이프: 아끼는 곡 + 최근 손댄 재생목록 순
    const tapes = [likedPl()].concat(L.playlists.slice().sort((a, b) => (b.updated || 0) - (a.updated || 0)));

    const recent = T.filter((t) => t.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 14);
    const fresh = T.slice().sort((a, b) => b.n - a.n).slice(0, 14);
    const rnd = U.seeded(Number(new Date().toISOString().slice(0, 10).replace(/-/g, "")));
    const longAgo = U.pick(T.filter((t) => t.plays >= 3 && t.lastPlayed && U.daysAgo(t.lastPlayed) > 90), 14, rnd);
    const unheard = T.filter((t) => !t.plays);
    const top = T.filter((t) => t.plays).sort((a, b) => b.plays - a.plays).slice(0, 10);

    // 발매 연대
    const dec = {}; T.forEach((t) => { if (t.year > 1900) { const d = Math.floor(t.year / 10) * 10; (dec[d] = dec[d] || []).push(t); } });
    const decades = Object.keys(dec).map(Number).sort((a, b) => b - a);

    return `<div class="page">
      <div class="greet"><h1>${greet}</h1><p>${isFinite(first) ? U.fmtDateKo(first).slice(0, 5) + "부터 모아 온 " : ""}${U.num(T.length)}곡의 컬렉션</p></div>
      <div class="stats">
        <div><b>${U.num(T.length)}</b><span>소장곡</span></div>
        <div><b>${U.num(L.artists.size)}</b><span>아티스트</span></div>
        <div><b>${U.num(L.albums.size)}</b><span>앨범</span></div>
        <div><b>${U.fmtHours(totalDur)}</b><span>시간 분량</span></div>
        <div><b>${U.fmtHours(totalListen)}</b><span>함께한 시간</span></div>
      </div>
      ${section("나의 테이프", null, `<div class="tape-row" data-hscroll>${tapes.map(tapeItem).join("")}<button class="tape-new" data-act="new-playlist"><i class="ic ic-plus"></i><span>새 테이프 만들기</span></button></div>`, "#/playlists")}

      ${recent.length ? section("최근 들은 곡", null, `<div class="shelf scroll">${recent.map((t) => trackCard(t, U.ago(t.lastPlayed) + " · " + t.artist)).join("")}</div>`) : ""}
      ${section("새로 들인 곡", "가장 최근에 컬렉션에 들어온 노래들", `<div class="shelf scroll">${fresh.map((t) => trackCard(t, U.fmtDate(t.addedAt) + " 수집")).join("")}</div>`, "#/collection")}
      ${longAgo.length ? section("오랜만이에요", "한때 자주 들었지만 한동안 못 만난 곡", `<div class="shelf scroll">${longAgo.map((t) => trackCard(t, "마지막 " + U.ago(t.lastPlayed))).join("")}</div>`) : ""}
      ${unheard.length ? section("아직 만나지 못한 곡", `소장했지만 한 번도 듣지 않은 곡이 ${U.num(unheard.length)}곡 있어요`, `<div class="shelf scroll">${U.pick(unheard, 14, rnd).map((t) => trackCard(t, t.artist)).join("")}</div>`, "#/collection/unheard") : ""}
      ${top.length ? section("가장 많이 들은 곡", null, trackList("home-top", top, "index")) : ""}
      ${decades.length ? section("시대별 컬렉션", null, `<div class="shelf scroll">${decades.map((d) => `<a class="card" href="#/year/${d}">${mosaic(U.pick(dec[d], 40, U.seeded(d)), 300)}<b>${d}년대</b><span>${U.num(dec[d].length)}곡</span></a>`).join("")}</div>`) : ""}
    </div>`;
  };
  pages.home.after = () => {};

  // ───────── 페이지: 곡 목록 ─────────
  const colState = (() => { try { return Object.assign({ sort: "new", filter: "all" }, JSON.parse(localStorage.getItem("mc.col") || "{}")); } catch (e) { return { sort: "new", filter: "all" }; } })();
  // ── 카세트 = 재생목록(믹스테이프). 마스킹 테이프에 재생목록 이름, 아래 띠에 지금(마지막) 곡 ──
  const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19.5s-7-4.3-8.5-8.8C2.6 7.4 4.6 4.8 7.5 4.8c1.9 0 3.4 1 4.5 2.7 1.1-1.7 2.6-2.7 4.5-2.7 2.9 0 4.9 2.6 4 5.9-1.5 4.5-8.5 8.8-8.5 8.8z"/></svg>';
  const likedPl = () => ({ id: "liked", name: "아끼는 곡", items: L.tracks.filter((t) => t.fav).sort((a, b) => (b.favAt || b.n) - (a.favAt || a.n)).map((t) => t.id) });
  const isPlayingPl = (pl) => !!(P && P.current && P.context && P.context.type === "playlist" && P.context.id === pl.id);
  // 띠에 적을 곡: 지금 이 테이프를 듣고 있으면 그 곡, 아니면 마지막으로 들은 곡, 그것도 없으면 첫 곡
  function bandTrack(pl) {
    if (isPlayingPl(pl) && pl.items.includes(P.currentId)) return P.current;
    let best = null;
    for (const id of pl.items) { const t = L.byId.get(id); if (t && t.lastPlayed && (!best || t.lastPlayed > best.lastPlayed)) best = t; }
    return best || L.byId.get(pl.items.find((id) => L.byId.has(id)));
  }
  // 재생 화면의 테이프: 지금 듣는 재생목록 (앨범·컬렉션에서 틀었으면 그 이름으로)
  function contextTape() {
    const c = P.context || {};
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
  const tapeHref = (pl) => pl.id === "liked" ? "#/liked" : "#/playlist/" + encodeURIComponent(pl.id);
  const tapeItem = (pl) => cassette(pl, bandTrack(pl), { now: isPlayingPl(pl), attrs: `data-pl="${esc(pl.id)}" data-plid="${esc(pl.id)}"` });

  // ── LP 진열대: 앨범 하나 = 재킷 한 장. 그 앨범의 곡을 듣는 중이면 레코드가 빠져나와 돈다 ──
  const albumKeyOf = (t) => t.albumKey || "none:" + t.album;
  function lpAlbum(a) {
    const now = P && P.current && albumKeyOf(P.current) === a.key;
    const lv = tierOf(Math.round(a.plays / Math.max(1, a.tracks.length))).level; // 곡당 평균 재생으로 손때
    const url = a.key && !a.key.startsWith("none:") ? API.artUrl(a.key, 300) : "";
    const img = url ? `<img loading="lazy" decoding="async" alt="" src="${esc(url)}" onerror="this.remove()">` : "";
    const ph = U.phStyle(a.key + a.title);
    return `<a class="lp wear-${lv}${now ? " now" + (P.playing ? "" : " paused") : ""}" href="#/album/${encodeURIComponent(a.key)}" data-album="${esc(a.key)}">
      <div class="lp-stage">
        <div class="lp-disc"><div class="lp-center" style="${ph}">${img}</div></div>
        <div class="lp-sleeve" style="${ph}" data-ini="${esc(U.initial(a.title))}">${img}</div>
      </div>
      <div class="lp-meta"><b>${esc(a.title)}</b><span>${esc((a.year ? a.year + " · " : "") + a.artist)}</span></div>
    </a>`;
  }
  const FILTERS = [["all", "전체"], ["fav", "아끼는 곡"], ["unheard", "아직 안 들은 곡"], ["memo", "메모 있는 곡"], ["heavy", "단골 이상"]];
  const SORTS = [["new", "최근 수집순"], ["old", "처음 수집순"], ["title", "제목순"], ["artist", "아티스트순"], ["plays", "많이 들은 순"], ["year", "발매일순"]];
  const ko = new Intl.Collator("ko");
  function collectionTracks(filter, sort) {
    let T = L.tracks.slice();
    if (filter === "fav") T = T.filter((t) => t.fav);
    else if (filter === "unheard") T = T.filter((t) => !t.plays);
    else if (filter === "memo") T = T.filter((t) => t.memo);
    else if (filter === "heavy") T = T.filter((t) => t.plays >= 20);
    const cmp = {
      new: (a, b) => b.n - a.n, old: (a, b) => a.n - b.n,
      title: (a, b) => ko.compare(a.title, b.title), artist: (a, b) => ko.compare(a.artist, b.artist) || ko.compare(a.album, b.album) || (a.track || 0) - (b.track || 0),
      plays: (a, b) => b.plays - a.plays || (b.lastPlayed || 0) - (a.lastPlayed || 0), year: (a, b) => (b.year || 0) - (a.year || 0) || b.n - a.n,
    }[sort] || ((a, b) => b.n - a.n);
    return T.sort(cmp);
  }
  pages.collection = (arg) => {
    if (arg && FILTERS.some((f) => f[0] === arg)) colState.filter = arg;
    const T = collectionTracks(colState.filter, colState.sort);
    const counts = {}; FILTERS.forEach(([k]) => (counts[k] = k === "all" ? L.tracks.length : collectionTracks(k, "new").length));
    const first = L.tracks.reduce((m, t) => Math.min(m, t.addedAt || Infinity), Infinity);
    $("#topbar-title").textContent = "곡 목록";
    lists.collection = T.map((t) => t.id);
    return `<div class="page">
      <div class="hero"><div class="hero-text">
        <h1>곡 목록</h1>
        <div class="hero-meta"><b>${U.num(L.tracks.length)}곡</b><span class="sep"></span><span>${isFinite(first) ? U.fmtDateKo(first) + "부터" : ""}</span><span class="sep"></span><span>${U.fmtLong(L.tracks.reduce((s, t) => s + (t.duration || 0), 0))}</span></div>
      </div></div>
      <div class="actions">
        <button class="play-fab" data-act="list-play" data-list="collection" title="재생"><i class="ic ic-play"></i></button>
        <button class="icon-btn${P.shuffle ? " on" : ""}" data-act="list-shuffle" data-list="collection" title="셔플 재생"><i class="ic ic-shuffle"></i></button>
        <span style="flex:1"></span>
        <label class="select"><select data-act="col-sort">${SORTS.map(([k, n]) => `<option value="${k}"${k === colState.sort ? " selected" : ""}>${n}</option>`).join("")}</select></label>
      </div>
      <div class="chips" style="margin-bottom:6px">${FILTERS.map(([k, n]) => `<button class="chip${k === colState.filter ? " on" : ""}" data-act="col-filter" data-v="${k}">${n} <span class="count">${U.num(counts[k])}</span></button>`).join("")}</div>
      <div data-list="collection" id="col-list"></div>
      ${T.length ? "" : `<div class="empty"><b>해당하는 곡이 없어요</b></div>`}
    </div>`;
  };
  pages.collection.after = () => {
    // 3천 곡을 한 번에 그리면 폰에서 버벅이므로 한 그리드에 조금씩 이어 붙인다
    const T = lists.collection.map((id) => L.byId.get(id));
    const box = $("#col-list"); if (!box) return;
    box.innerHTML = '<div class="shelf"></div>';
    const grid = box.firstChild;
    const token = curRoute;
    let i = 0;
    const step = () => {
      if (curRoute !== token || !grid.isConnected) return;
      const end = Math.min(T.length, i + 240);
      let html = ""; for (; i < end; i++) html += trackCard(T[i]);
      grid.insertAdjacentHTML("beforeend", html);
      if (i < T.length) requestAnimationFrame(step);
    };
    step();
  };

  // ───────── 페이지: 아끼는 곡 / 연대 ─────────
  pages.liked = () => {
    const T = L.tracks.filter((t) => t.fav).sort((a, b) => (b.favAt || b.n) - (a.favAt || a.n));
    $("#topbar-title").textContent = "아끼는 곡";
    setTint("350 40% 30%");
    return `<div class="page">
      <div class="hero">${heroTape(likedPl(), "liked")}<div class="hero-text"><div class="hero-kicker">재생목록</div><h1>아끼는 곡</h1><div class="hero-meta"><b>${T.length}곡</b><span class="sep"></span><span>${U.fmtLong(T.reduce((s, t) => s + t.duration, 0))}</span></div></div></div>
      <div class="actions"><button class="play-fab" data-act="list-play" data-list="liked"><i class="ic ic-play"></i></button><button class="icon-btn" data-act="list-shuffle" data-list="liked" title="셔플 재생"><i class="ic ic-shuffle"></i></button></div>
      ${T.length ? trackList("liked", T, "index") : `<div class="empty"><b>아직 아끼는 곡이 없어요</b>곡 옆의 하트를 눌러 담아 보세요.</div>`}
    </div>`;
  };
  pages.year = (arg) => {
    const d = parseInt(arg, 10);
    const T = L.tracks.filter((t) => t.year >= d && t.year < d + 10).sort((a, b) => (a.year - b.year) || ko.compare(a.artist, b.artist));
    $("#topbar-title").textContent = d + "년대";
    setTint(U.hue(String(d)) + " 30% 28%");
    return `<div class="page">
      <div class="hero">${mosaic(U.pick(T, 40, U.seeded(d)), 480)}<div class="hero-text"><div class="hero-kicker">시대별 컬렉션</div><h1>${d}년대</h1><div class="hero-meta"><b>${T.length}곡</b><span class="sep"></span><span>${d}~${d + 9}년에 나온 소장곡</span></div></div></div>
      <div class="actions"><button class="play-fab" data-act="list-play" data-list="year"><i class="ic ic-play"></i></button><button class="icon-btn" data-act="list-shuffle" data-list="year"><i class="ic ic-shuffle"></i></button></div>
      ${trackList("year", T, "collection")}
    </div>`;
  };

  // ───────── 페이지: 앨범·아티스트 ─────────
  const libSort = (() => { try { return Object.assign({ albums: "recent", artists: "count" }, JSON.parse(localStorage.getItem("mc.libsort") || "{}")); } catch (e) { return { albums: "recent", artists: "count" }; } })();
  pages.albums = () => {
    const A = Array.from(L.albums.values());
    const s = libSort.albums;
    A.sort(s === "name" ? (a, b) => ko.compare(a.title, b.title) : s === "artist" ? (a, b) => ko.compare(a.artist, b.artist) || (a.year || 0) - (b.year || 0) : s === "year" ? (a, b) => (b.year || 0) - (a.year || 0) : s === "plays" ? (a, b) => b.plays - a.plays : (a, b) => b.addedAt - a.addedAt);
    $("#topbar-title").textContent = "앨범";
    return `<div class="page">
      <div class="section-head" style="margin-top:8px"><div><h2 style="font-size:30px">앨범</h2><p>${U.num(A.length)}장</p></div>
      <label class="select"><select data-act="lib-sort" data-k="albums">${[["recent", "최근 수집순"], ["name", "이름순"], ["artist", "아티스트순"], ["year", "발매연도순"], ["plays", "많이 들은 순"]].map(([k, n]) => `<option value="${k}"${k === s ? " selected" : ""}>${n}</option>`).join("")}</select></label></div>
      <div class="lp-grid">${A.map(lpAlbum).join("")}</div></div>`;
  };
  pages.artists = () => {
    const R = Array.from(L.artists.values());
    const s = libSort.artists;
    R.sort(s === "name" ? (a, b) => ko.compare(a.name, b.name) : s === "plays" ? (a, b) => b.plays - a.plays : s === "first" ? (a, b) => a.first - b.first : (a, b) => b.tracks.length - a.tracks.length);
    $("#topbar-title").textContent = "아티스트";
    return `<div class="page">
      <div class="section-head" style="margin-top:8px"><div><h2 style="font-size:30px">아티스트</h2><p>${U.num(R.length)}명</p></div>
      <label class="select"><select data-act="lib-sort" data-k="artists">${[["count", "소장곡 많은 순"], ["name", "이름순"], ["plays", "많이 들은 순"], ["first", "처음 만난 순"]].map(([k, n]) => `<option value="${k}"${k === s ? " selected" : ""}>${n}</option>`).join("")}</select></label></div>
      <div class="shelf">${R.map(artistCard).join("")}</div></div>`;
  };
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
        <span class="dimmer" style="font-size:13px">${U.fmtDateKo(a.addedAt)} 컬렉션에 들어옴 · 모두 ${U.num(plays)}번 재생</span>
      </div>
      ${trackList("album", T, "album")}
      ${more.length ? section(a.artist + "의 다른 앨범", null, `<div class="shelf scroll">${more.map((x) => albumCard(x, (x.year || "") + " · " + x.tracks.length + "곡")).join("")}</div>`) : ""}
    </div>`;
  };
  pages.artist = (name) => {
    const r = L.artists.get(name);
    if (!r) return notFound();
    const top = topAlbumOf(r);
    tintFromArt(top);
    $("#topbar-title").textContent = r.name;
    const T = r.tracks.slice().sort((a, b) => a.n - b.n);
    const hot = r.tracks.filter((t) => t.plays).sort((a, b) => b.plays - a.plays).slice(0, 5);
    const albums = Array.from(r.albums).map((k) => L.albums.get(k)).sort((a, b) => (b.year || 0) - (a.year || 0));
    const firstT = T[0];
    return `<div class="page">
      <div class="hero round">${art(top, 600)}<div class="hero-text">
        <div class="hero-kicker">아티스트</div><h1>${esc(r.name)}</h1>
        <div class="hero-meta"><b>소장 ${r.tracks.length}곡</b><span class="sep"></span><span>앨범 ${albums.length}장</span><span class="sep"></span><span>${U.num(r.plays)}번 재생</span></div>
      </div></div>
      <div class="actions">
        <button class="play-fab" data-act="list-play" data-list="artist-all"><i class="ic ic-play"></i></button>
        <button class="icon-btn" data-act="list-shuffle" data-list="artist-all" title="셔플 재생"><i class="ic ic-shuffle"></i></button>
        <span class="dimmer" style="font-size:13px">${U.fmtDateKo(r.first)}, 「${esc(firstT.title)}」로 처음 만났어요</span>
      </div>
      ${hot.length ? section("내가 많이 들은 곡", null, trackList("artist-hot", hot, "index")) : ""}
      ${section("앨범", null, `<div class="shelf ${albums.length > 6 ? "scroll" : ""}">${albums.map((a) => albumCard(a, (a.year || "") + " · 소장 " + a.tracks.length + "곡")).join("")}</div>`)}
      ${section("소장한 모든 곡", "수집한 순서대로", trackList("artist-all", T, "collection"))}
    </div>`;
  };

  // ───────── 페이지: 곡 상세보기 ─────────
  pages.track = (id) => {
    const t = L.byId.get(id);
    if (!t) return notFound();
    tintFromArt(t);
    $("#topbar-title").textContent = t.title;
    const tier = tierOf(t.plays), nx = tierNext(t.plays);
    const albumT = (L.albums.get(t.albumKey) || { tracks: [] }).tracks;
    const inLists = L.playlists.filter((p) => p.items.includes(t.id));
    const rank = L.tracks.filter((x) => x.plays > t.plays).length + 1;
    return `<div class="page">
      <div class="hero">${art(t, 600)}<div class="hero-text">
        <div class="hero-kicker">곡</div><h1 class="${t.title.length > 22 ? "long" : ""}">${esc(t.title)}</h1>
        <div class="hero-meta"><b>${artistLinks(t)}</b>${t.album ? `<span class="sep"></span><a href="${albumHref(t)}">${esc(t.album)}</a>` : ""}${t.year ? `<span class="sep"></span><span>${t.year}</span>` : ""}<span class="sep"></span><span>${U.fmtDur(t.duration)}</span></div>
      </div></div>
      <div class="actions">
        <button class="play-fab" data-act="track-play" data-id="${esc(t.id)}"><i class="ic ic-play"></i></button>
        <button class="icon-btn${t.fav ? " on" : ""}" data-act="fav" data-id="${esc(t.id)}" title="아끼는 곡"><i class="ic ${t.fav ? "ic-heart-fill" : "ic-heart"}"></i></button>
        <button class="icon-btn" data-act="more" data-id="${esc(t.id)}"><i class="ic ic-more"></i></button>
      </div>
      <div class="plaque">
        <div><span>수집한 날</span><b>${U.fmtDate(t.addedAt)}</b></div>
        <div><span>애정도</span><b class="tier-name">${esc(tier.name)} ${aff(t.plays)}</b></div>
        <div><span>들은 횟수</span><b>${U.num(t.plays)}<small>회${t.plays ? " · " + U.num(rank) + "위" : ""}</small></b></div>
        <div><span>함께한 시간</span><b>${U.fmtLong(t.listenedMs)}</b></div>
        <div><span>처음 들은 날</span><b>${t.firstPlayed ? U.fmtDate(t.firstPlayed) : "—"}</b></div>
        <div><span>마지막으로 들은 날</span><b>${t.lastPlayed ? U.ago(t.lastPlayed) : "—"}</b></div>
      </div>
      ${nx ? `<p class="dimmer" style="margin:10px 2px 0;font-size:13px">${nx[0] - t.plays}번 더 들으면 「${nx[1]}」이 돼요</p>` : ""}
      <div class="memo-box"><h3>이 곡에 남기는 메모</h3>
        <textarea data-act="memo" data-id="${esc(t.id)}" placeholder="이 노래를 처음 들은 곳, 떠오르는 사람, 그때의 계절…">${esc(t.memo || "")}</textarea>
        <div class="hint"><span>${inLists.length ? "담긴 재생목록: " + inLists.map((p) => `<a href="#/playlist/${encodeURIComponent(p.id)}" style="color:var(--text-2)">${esc(p.name)}</a>`).join(", ") : ""}</span><span id="memo-state"></span></div>
      </div>
      <div class="lyr-box"><h3>가사</h3><pre id="track-lyrics" class="dimmer">불러오는 중…</pre></div>
      ${albumT.length > 1 ? section("같은 앨범의 소장곡", t.album, trackList("track-album", albumT, "album")) : ""}
      <p class="dimmer" style="font-size:12px;margin-top:30px">${t.genre ? esc(t.genre) + " · " : ""}${t.track ? (t.disc > 1 ? t.disc + "-" : "") + t.track + "번 트랙" : ""}</p>
    </div>`;
  };
  pages.track.after = (id) => {
    getLyrics(id).then((d) => {
      const el = $("#track-lyrics"); if (!el) return;
      const text = d && d.synced ? d.synced.map((l) => l[1]).join("\n") : d && d.plain;
      el.textContent = text ? text.trim() : "가사가 없어요";
      el.classList.toggle("dimmer", !text);
    });
  };

  // ───────── 페이지: 재생목록 ─────────
  let plEdit = false;
  pages.playlist = (id) => {
    const p = L.playlists.find((x) => x.id === id);
    if (!p) return notFound();
    const T = p.items.map((i) => L.byId.get(i)).filter(Boolean);
    $("#topbar-title").textContent = p.name;
    if (T[0]) tintFromArt(T[0]); else setTint("30 10% 22%");
    return `<div class="page">
      <div class="hero">${heroTape(p, "playlist")}<div class="hero-text">
        <div class="hero-kicker">재생목록</div><h1 class="${p.name.length > 20 ? "long" : ""}">${esc(p.name)}</h1>
        ${p.desc ? `<p class="hero-desc">${esc(p.desc)}</p>` : ""}
        <div class="hero-meta"><b>${T.length}곡</b><span class="sep"></span><span>${U.fmtLong(T.reduce((s, t) => s + t.duration, 0))}</span>${p.created ? `<span class="sep"></span><span>${U.fmtDate(p.created)}에 만듦</span>` : ""}</div>
      </div></div>
      <div class="actions">
        <button class="play-fab" data-act="list-play" data-list="playlist"><i class="ic ic-play"></i></button>
        <button class="icon-btn" data-act="list-shuffle" data-list="playlist" title="셔플 재생"><i class="ic ic-shuffle"></i></button>
        <button class="icon-btn" data-act="pl-more" title="재생목록 메뉴"><i class="ic ic-more"></i></button>
        <span style="flex:1"></span>
        ${T.length ? `<button class="btn${plEdit ? " primary" : ""}" data-act="pl-edit"><i class="ic ic-pen"></i>${plEdit ? "편집 끝내기" : "순서 편집"}</button>` : ""}
      </div>
      ${T.length ? trackList("playlist", T, plEdit ? "edit" : "index") : `<div class="empty" style="padding:24px"><b>아직 비어 있어요</b>아래에서 곡을 찾아 담거나, 곡 메뉴의 「재생목록에 추가」를 써 보세요.</div>`}
      <div class="add-finder"><h3>담을 곡 찾기</h3><p class="dimmer" style="margin:0 0 12px">제목·아티스트·앨범, 초성으로도 찾을 수 있어요</p>
        <div class="search-box"><i class="ic ic-search"></i><input type="search" data-act="pl-find" placeholder="곡 찾기" autocomplete="off"></div>
        <div id="pl-find-res" style="margin-top:12px"></div>
      </div>
    </div>`;
  };
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
      const r = over && over.closest(".row"); if (!r || !box.contains(r)) return;
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
    const artists = Array.from(L.artists.values()).filter(hit).sort((a, b) => score(0, a.name) - score(0, b.name) || b.tracks.length - a.tracks.length).slice(0, 12);
    const albums = Array.from(L.albums.values()).filter(hit).sort((a, b) => score(0, a.title) - score(0, b.title) || b.plays - a.plays).slice(0, 12);
    return { tracks, artists, albums };
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
    const run = () => {
      lastQuery = inp.value;
      const r = search(inp.value);
      $("#search-browse").hidden = !!r;
      const box = $("#search-res");
      if (!r) { box.innerHTML = ""; return; }
      if (!r.tracks.length && !r.artists.length && !r.albums.length) { box.innerHTML = `<div class="empty"><b>「${esc(inp.value)}」에 맞는 소장곡이 없어요</b>철자를 확인하거나 다른 말로 찾아보세요.</div>`; return; }
      const topArtist = r.artists[0], topT = r.tracks[0];
      const topIsArtist = topArtist && (!topT || U.norm(topArtist.name).startsWith(U.norm(inp.value)));
      const topCard = topIsArtist
        ? `<a class="hit-card" href="#/artist/${encodeURIComponent(topArtist.name)}"><div style="width:96px">${art(topAlbumOf(topArtist), 300, "")}</div><b>${esc(topArtist.name)}</b><span>아티스트 · 소장 ${topArtist.tracks.length}곡</span></a>`
        : topT ? `<a class="hit-card" href="#/track/${encodeURIComponent(topT.id)}">${art(topT, 300)}<b>${esc(topT.title)}</b><span>곡 · ${esc(topT.artist)}</span><button class="play-fab fab" data-act="track-play" data-id="${esc(topT.id)}"><i class="ic ic-play"></i></button></a>` : "";
      box.innerHTML = `
        ${r.tracks.length || topCard ? `<div class="top-hit" style="margin-top:26px"><div><div class="section-head"><h2>가장 잘 맞는 결과</h2></div>${topCard}</div>
          <div><div class="section-head"><h2>곡</h2></div>${trackList("search", r.tracks.slice(0, 5), "collection").replace('class="tl-head"', 'class="tl-head" hidden')}</div></div>` : ""}
        ${r.tracks.length > 5 ? section("곡 더 보기", null, trackList("search-more", r.tracks.slice(5), "collection")) : ""}
        ${r.artists.length ? section("아티스트", null, `<div class="shelf scroll">${r.artists.map(artistCard).join("")}</div>`) : ""}
        ${r.albums.length ? section("앨범", null, `<div class="shelf scroll">${r.albums.map((a) => albumCard(a)).join("")}</div>`) : ""}`;
    };
    inp.addEventListener("input", U.debounce(run, 120));
    if (lastQuery) run();
    if (!isMobile() || !lastQuery) setTimeout(() => inp.focus(), 50);
  };
  pages.genre = (g) => {
    const T = L.tracks.filter((t) => t.genre === g).sort((a, b) => b.n - a.n);
    $("#topbar-title").textContent = g;
    setTint(U.hue(g) + " 40% 30%");
    return `<div class="page"><div class="hero">${mosaic(T, 480)}<div class="hero-text"><div class="hero-kicker">장르</div><h1>${esc(g)}</h1><div class="hero-meta"><b>${T.length}곡</b></div></div></div>
      <div class="actions"><button class="play-fab" data-act="list-play" data-list="genre"><i class="ic ic-play"></i></button><button class="icon-btn" data-act="list-shuffle" data-list="genre"><i class="ic ic-shuffle"></i></button></div>
      ${trackList("genre", T, "collection")}</div>`;
  };

  // ───────── 페이지: 라이브러리 (폰) ─────────
  pages.library = () => {
    $("#topbar-title").textContent = "라이브러리";
    const liked = L.tracks.filter((t) => t.fav);
    return `<div class="page">
      <div class="section-head" style="margin-top:4px"><h2 style="font-size:26px">라이브러리</h2><button class="icon-btn" data-act="new-playlist" title="새 재생목록"><i class="ic ic-plus"></i></button></div>
      <div class="chips" style="margin-bottom:12px"><a class="chip" href="#/albums">앨범 ${U.num(L.albums.size)}</a><a class="chip" href="#/artists">아티스트 ${U.num(L.artists.size)}</a><a class="chip" href="#/settings">설정 · 연결</a></div>
      ${tapeRack()}
    </div>`;
  };
  // 나의 테이프 (재생목록 모음)
  pages.playlists = () => {
    $("#topbar-title").textContent = "나의 테이프";
    return `<div class="page">
      <div class="section-head" style="margin-top:8px"><div><h2 style="font-size:30px">나의 테이프</h2><p>재생목록 ${L.playlists.length + 1}개</p></div><button class="btn" data-act="new-playlist"><i class="ic ic-plus"></i>새 테이프</button></div>
      ${tapeRack()}
    </div>`;
  };
  function tapeRack() {
    return `<div class="tape-grid">${[likedPl()].concat(L.playlists).map(tapeItem).join("")}
      <button class="tape-new" data-act="new-playlist"><i class="ic ic-plus"></i><span>새 테이프 만들기</span></button></div>`;
  }
  function heroTape(pl, listName) {
    return `<div class="hero-tape">${cassette(pl, bandTrack(pl), { now: isPlayingPl(pl), attrs: `data-act="pl-tape-play" data-list="${listName}" data-plid="${esc(pl.id)}" title="이 테이프 재생"` })}</div>`;
  }
  // 사이드바: 작은 카세트 + 오른쪽에 재생목록 이름
  const plItem = (pl) => `<a class="side-pl side-tape" href="${tapeHref(pl)}">${cassette(pl, bandTrack(pl), { now: isPlayingPl(pl), noHeart: true, attrs: `data-plid="${esc(pl.id)}"` })}<div><b>${esc(pl.name)}</b><small>재생목록 · ${pl.items.length}곡</small></div></a>`;
  function renderSidebar() {
    $("#side-playlists").innerHTML = [likedPl()].concat(L.playlists).map(plItem).join("");
    $$(".side-pl").forEach((a) => a.classList.toggle("on", a.getAttribute("href") === "#" + curRoute));
  }

  // ───────── 페이지: 설정·연결 ─────────
  pages.settings = () => {
    $("#topbar-title").textContent = "설정 · 연결";
    const N = window.NativeBridge;
    let conn;
    if (N) {
      let info = {}; try { info = JSON.parse(N.getServerInfo()); } catch (e) {}
      conn = `<div class="set-card"><div class="set-row"><div><h3>PC에서 접속</h3><p>같은 Wi-Fi에 있는 컴퓨터의 브라우저에서 이 폰의 컬렉션을 듣고 재생목록을 편집할 수 있어요.</p></div><button class="switch${info.enabled ? " on" : ""}" data-act="server-toggle" aria-label="PC 접속"></button></div>
        ${info.enabled ? `<div class="addr">${(info.urls || []).map((u) => `<div><span>주소</span><b>${esc(u)}</b></div>`).join("") || `<div><span>주소</span><b>Wi-Fi에 연결되어 있지 않아요</b></div>`}<div><span>PIN</span><b class="pin-code">${esc(info.pin || "")}</b></div></div>
          <p style="margin-top:10px">PC 프로그램 「나의 테이프」를 실행하면 폰을 알아서 찾아요(브라우저 주소창에 위 주소를 넣어도 돼요). 처음 한 번 PIN을 넣으면 돼요. 켜 둔 동안 알림이 표시돼요.</p>` : ""}</div>`;
    } else {
      conn = `<div class="set-card"><h3>폰에 연결됨</h3><p>지금 이 화면은 폰에 저장된 컬렉션을 실시간으로 불러오고 있어요. 재생목록·메모·아끼는 곡은 폰에 바로 저장돼요.</p></div>`;
    }
    return `<div class="page"><h2 style="font-size:30px;margin:8px 0 0">설정 · 연결</h2>
      ${conn}
      <div class="set-card"><div class="set-row"><div><h3>라이브러리 다시 읽기</h3><p>폰에 새 곡을 넣었는데 안 보이면 눌러 주세요. 수집 번호와 기록은 그대로 남아요.</p></div><button class="btn" data-act="rescan">다시 읽기</button></div></div>
      ${N ? playlistDirCard(N) : ""}
      <div class="set-card" id="folder-card">${folderCard()}</div>
      <div class="set-card"><h3>컬렉션</h3><p>${U.num(L.tracks.length)}곡 · ${U.num(L.albums.size)}장의 앨범 · ${U.num(L.artists.size)}명의 아티스트 · 재생목록 ${L.playlists.length}개</p></div>
    </div>`;
  };

  // 다른 앱(삼성뮤직 등)이 내보낸 재생목록 파일 폴더 (폰에서만 고를 수 있다)
  function playlistDirCard(N) {
    let dir = ""; try { dir = N.getPlaylistDir ? N.getPlaylistDir() : ""; } catch (e) {}
    return `<div class="set-card"><div class="set-row"><div><h3>재생목록 파일 가져오기</h3><p>삼성뮤직에서 내보낸 .smpl, 다른 앱의 .m3u 파일이 있는 폴더를 고르면 라이브러리를 읽을 때마다 가져와요. 이 앱에서 고친 재생목록은 그대로 둬요.</p></div>
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

  const notFound = () => `<div class="page"><div class="empty"><b>찾을 수 없어요</b>컬렉션에서 빠진 항목일 수 있어요.</div></div>`;

  // ───────── 재생 막대 ─────────
  const bar = $("#playerbar");
  function renderBar() {
    const t = P.current;
    if (!t) { bar.innerHTML = isMobile() ? "" : `<div class="pb-now"></div><div class="pb-center"><div class="pb-ctrl dimmer">재생할 곡을 골라 주세요</div></div><div class="pb-right"></div>`; return; }
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
        <button class="icon-btn${panelOpen && panelTab === "lyrics" ? " on" : ""}" data-act="panel" data-v="lyrics" title="가사"><i class="ic ic-lyrics"></i></button>
        <button class="icon-btn${panelOpen && panelTab === "queue" ? " on" : ""}" data-act="panel" data-v="queue" title="재생 대기열"><i class="ic ic-queue"></i></button>
        <button class="icon-btn" data-act="open-full" title="재생 화면"><i class="ic ic-expand"></i></button>
        ${P.native ? "" : `<i class="ic ic-volume dim" style="margin-left:6px"></i><div class="range pb-vol" data-range="vol"><div class="track"><div class="fill"></div></div><div class="knob"></div></div>`}
      </div>
      <div class="pb-mini"><button class="icon-btn" data-act="toggle"><i class="ic ${playIc}"></i></button></div>
      <div class="pb-mini-prog"><i></i></div>`;
    bindRange($('[data-range="seek"]', bar), () => (P.dur ? P.pos / P.dur : 0), (f) => P.seek(f * P.dur), (f) => ($('[data-time="pos"]', bar).textContent = U.fmtDur(f * P.dur)));
    const vol = $('[data-range="vol"]', bar);
    if (vol) bindRange(vol, () => P.volume, (f) => (P.volume = f), (f) => (P.volume = f));
    updateTime();
    if (isMobile()) U.tintFrom(API.artUrl(t.albumKey, 64), t.albumKey + t.album).then((c) => { const [h, s] = c.split(" "); bar.style.setProperty("--mini", `${h} ${s} 20%`); });
  }
  function updateTime() {
    const f = P.dur ? Math.min(1, P.pos / P.dur) : 0;
    $$('[data-range="seek"]').forEach((r) => { if (!r.classList.contains("drag")) setRange(r, f); });
    $$('[data-range="vol"]').forEach((r) => { if (!r.classList.contains("drag")) setRange(r, P.volume); });
    $$('[data-time="pos"]').forEach((e) => { if (!e.closest(".drag-host")) e.textContent = U.fmtDur(P.pos); });
    $$('[data-time="dur"]').forEach((e) => (e.textContent = U.fmtDur(P.dur)));
    const mp = $(".pb-mini-prog i"); if (mp) mp.style.width = f * 100 + "%";
    const bt = !fp.hidden && $(".tape.big", fp); if (bt) bt.style.setProperty("--p", f.toFixed(4)); // 릴에 감긴 테이프가 옮겨 간다
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
    const p = API.lyrics(id).catch(() => null);
    lyrCache.set(id, p); return p;
  }
  let lyrState = null; // {id, data, boxes:[el]}
  function lyricsHtml(d) {
    if (!d || (!d.synced && !d.plain)) return `<div class="lyrics plain"><p class="note" style="font-size:16px;margin-top:20px">이 곡에는 가사가 없어요.</p></div>`;
    if (d.synced) return `<div class="lyrics">${d.synced.map(([ms, text], i) => `<p class="ln${text.trim() ? "" : " blank"}" data-ms="${ms}" data-k="${i}">${esc(text) || "♪"}</p>`).join("")}</div>`;
    return `<div class="lyrics plain"><p class="note">시간 정보가 없는 가사예요</p>${d.plain.split(/\r?\n/).map((l) => `<p class="ln">${esc(l) || "&nbsp;"}</p>`).join("")}</div>`;
  }
  function mountLyrics(box) {
    const t = P.current;
    if (!t) { box.innerHTML = `<div class="lyrics plain"><p class="note">재생 중인 곡이 없어요</p></div>`; return; }
    box.innerHTML = `<div class="lyrics plain"><p class="note">가사를 불러오는 중…</p></div>`;
    box.dataset.lyr = t.id;
    getLyrics(t.id).then((d) => {
      if (box.dataset.lyr !== t.id) return;
      box.innerHTML = lyricsHtml(d);
      box._lyr = { data: d, cur: -1 };
      syncLyrics(true);
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
      const scroller = box.closest("#panel-body, .np-side-body");
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
  let panelOpen = (() => { try { return localStorage.getItem("mc.panel") !== "0"; } catch (e) { return true; } })();
  let panelTab = "lyrics";
  function renderPanel() {
    $("#app").classList.toggle("panel-open", panelOpen && !!P.current);
    $$(".panel-tabs [data-panel]").forEach((b) => b.classList.toggle("on", b.dataset.panel === panelTab));
    if (!panelOpen) return;
    const body = $("#panel-body");
    if (panelTab === "lyrics") {
      body.innerHTML = `<div class="lyrics-wrap"><div data-lyr></div></div>`;
      const t = P.current;
      if (t) U.tintFrom(API.artUrl(t.albumKey, 64), t.albumKey + t.album).then((c) => body.firstChild && body.firstChild.style.setProperty("--ly", c));
      mountLyrics($("[data-lyr]", body));
    } else body.innerHTML = queueHtml();
  }
  function queueHtml() {
    const q = P.queue, i = P.index;
    if (i < 0) return `<div class="queue"><p class="dimmer" style="padding:16px">대기열이 비어 있어요</p></div>`;
    const cur = L.byId.get(q[i]);
    const up = q.slice(i + 1, i + 101);
    const qrow = (id, k, now) => { const t = L.byId.get(id); if (!t) return ""; return `<div class="q-row${now ? " now" : ""}" data-q="${k}">${art(t, 100)}<div><b>${esc(t.title)}</b><span>${esc(t.artist)}</span></div>${now ? "" : `<button class="icon-btn" data-act="q-remove" title="대기열에서 빼기"><i class="ic ic-x"></i></button>`}</div>`; };
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
  function openFull() { if (!P.current) return; fp.hidden = false; npId = null; renderFull(); }
  function closeFull() { fp.hidden = true; fp.innerHTML = ""; npId = null; }
  const CTX_LABEL = { album: "앨범에서 재생 중", artist: "아티스트에서 재생 중", playlist: "재생목록에서 재생 중", collection: "곡 목록에서 재생 중" };
  function renderFull() {
    if (fp.hidden) return;
    const t = P.current; if (!t) return closeFull();
    // 같은 곡이면 버튼 상태만 바꾼다 (카세트 애니메이션이 끊기지 않게)
    if (npId === t.id) { syncFullControls(); return; }
    npId = t.id;
    const ctx = P.context;
    const bg = t.albumKey ? API.artUrl(t.albumKey, 300) : "";
    fp.innerHTML = `
      <div class="np-bg" style="${U.phStyle(t.albumKey + t.album)}">${bg ? `<img alt="" src="${esc(bg)}" onerror="this.remove()">` : ""}</div>
      <div class="np-top">
        <button class="icon-btn" data-act="close-full" title="닫기"><i class="ic ic-down"></i></button>
        <div class="ctx"><small>${esc((ctx && CTX_LABEL[ctx.type]) || "재생 중")}</small><b>${esc((ctx && ctx.name) || "")}</b></div>
        <button class="icon-btn" data-act="more" data-id="${esc(t.id)}" title="더 보기"><i class="ic ic-more"></i></button>
      </div>
      <div class="np-main">
        <section class="np-deck">
          <div class="np-tape-wrap">${cassette(contextTape(), t, { big: true, now: true, order: P.index + 1, attrs: 'data-act="toggle" title="재생/일시정지"' })}</div>
          <div class="np-meta">
            <div><b>${esc(t.title)}</b><span>${artistLinks(t)}${t.album ? ` · <a href="${albumHref(t)}" data-stop>${esc(t.album)}</a>` : ""}</span>
              <div class="np-no">${esc(tierOf(t.plays).name)}${t.plays ? " · " + U.num(t.plays) + "번 들음" : ""}</div></div>
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
          ${P.native ? "" : `<div class="np-vol"><i class="ic ic-volume"></i><div class="range" data-range="vol"><div class="track"><div class="fill"></div></div><div class="knob"></div></div></div>`}
        </section>
        <aside class="np-side">
          <div class="np-tabs"><button data-act="np-side" data-v="queue">재생목록</button><button data-act="np-side" data-v="lyrics">가사</button>
            <a class="np-card-link" href="#/track/${encodeURIComponent(t.id)}" data-act="close-full">곡 상세보기 ›</a></div>
          <div class="np-side-body"></div>
        </aside>
      </div>`;
    U.tintFrom(API.artUrl(t.albumKey, 64), t.albumKey + t.album).then((c) => fp.style.setProperty("--fp", c));
    bindRange($('[data-range="seek"]', fp), () => (P.dur ? P.pos / P.dur : 0), (f) => P.seek(f * P.dur), (f) => ($('[data-time="pos"]', fp).textContent = U.fmtDur(f * P.dur)));
    const vol = $('[data-range="vol"]', fp);
    if (vol) bindRange(vol, () => P.volume, (f) => (P.volume = f), (f) => (P.volume = f));
    syncFullControls();
    renderNpSide();
    updateTime();
  }
  function syncFullControls() {
    if (fp.hidden) return;
    const pi = $(".np-play .ic", fp); if (pi) pi.className = "ic " + (P.playing ? "ic-pause" : "ic-play");
    const sh = $('[data-np="shuffle"]', fp); if (sh) sh.classList.toggle("on", P.shuffle);
    const rp = $('[data-np="repeat"]', fp);
    if (rp) { rp.classList.toggle("on", P.repeat !== "off"); rp.firstElementChild.className = "ic " + (P.repeat === "one" ? "ic-repeat1" : "ic-repeat"); }
    const tp = $(".tape.big", fp); if (tp) { tp.classList.add("now"); tp.classList.toggle("paused", !P.playing); }
    const fv = $(".tape.big .tape-heart", fp), t = P.current;
    if (fv && t) fv.classList.toggle("on", !!t.fav);
  }
  function renderNpSide() {
    if (fp.hidden) return;
    const body = $(".np-side-body", fp); if (!body) return;
    $$(".np-tabs [data-v]", fp).forEach((b) => b.classList.toggle("on", b.dataset.v === npSide));
    if (npSide === "lyrics") { body.innerHTML = "<div data-lyr></div>"; mountLyrics($("[data-lyr]", body)); }
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
      <button data-m="addpl" data-id="${esc(id)}"><i class="ic ic-stack"></i>재생목록에 추가…</button>
      <button data-m="fav" data-id="${esc(id)}"><i class="ic ${t.fav ? "ic-heart-fill" : "ic-heart"}"></i>${t.fav ? "아끼는 곡에서 빼기" : "아끼는 곡으로"}</button>
      ${inPl ? `<button data-m="plremove" data-id="${esc(id)}" data-i="${ctx.i}" class="danger"><i class="ic ic-x"></i>이 재생목록에서 빼기</button>` : ""}
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
    }
  });
  const curPlaylist = () => { const r = route(); return r.name === "playlist" ? L.playlists.find((p) => p.id === r.arg) : null; };

  const modal = $("#modal");
  function openModal(html, cls) {
    modal.innerHTML = `<div class="modal-box${cls ? " " + cls : ""}">${html}</div>`; modal.hidden = false;
    const f = $("input,textarea", modal);
    if (f) setTimeout(() => { f.focus(); if (f.setSelectionRange) f.setSelectionRange(f.value.length, f.value.length); }, 30);
  }
  function closeModal() { modal.hidden = true; modal.innerHTML = ""; }
  modal.addEventListener("click", (e) => { if (e.target === modal || e.target.closest("[data-close]")) closeModal(); });

  function playlistModal(p, thenAdd) {
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
        if (thenAdd && thenAdd.length) toast(`「${name}」에 담았어요`);
        else location.hash = "#/playlist/" + encodeURIComponent(np.id);
      } catch (err) { toast("만들지 못했어요: " + err.message); }
    });
  }
  function addToPlaylistModal(ids) {
    const one = ids.length === 1;
    // 꽂혀 있는 테이프 중에서 골라 담는다
    openModal(`<h3>재생목록에 추가</h3><div class="pick-tapes">
      ${L.playlists.map((p) => `<div class="pick-tape" role="button" tabindex="0" data-pl="${esc(p.id)}" title="「${esc(p.name)}」에 담기">${cassette(p, bandTrack(p), { noHeart: true })}${one && p.items.includes(ids[0]) ? '<span class="already">담겨 있음</span>' : ""}</div>`).join("")}
      <button class="tape-new" data-pl="__new"><i class="ic ic-plus"></i><span>새 테이프 만들기</span></button>
    </div><div class="row-btns"><button class="btn ghost" data-close>닫기</button></div>`, "wide");
    $(".pick-tapes", modal).addEventListener("keydown", (e) => { const b = e.target.closest(".pick-tape"); if (b && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); e.stopPropagation(); b.click(); } });
    $(".pick-tapes", modal).addEventListener("click", (e) => {
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
  function deletePlaylist(p) {
    if (!p) return;
    openModal(`<h3>재생목록을 지울까요?</h3><p class="dim" style="margin:0">「${esc(p.name)}」을(를) 지워요. 곡 자체는 컬렉션에 그대로 남아요.</p>
      <div class="row-btns"><button class="btn ghost" data-close>취소</button><button class="btn primary" id="pl-del-ok" style="background:#e06464;color:#fff">지우기</button></div>`);
    $("#pl-del-ok").addEventListener("click", () => {
      closeModal();
      L.playlists = L.playlists.filter((x) => x !== p); renderSidebar();
      API.deletePlaylist(p.id).catch((e) => toast("지우지 못했어요: " + e.message));
      location.hash = "#/";
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
    if (["liked", "home", "playlists", "library"].includes(route().name)) return rerender();
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
    const a = e.target.closest("[data-act]");
    const rowEl = e.target.closest(".row[data-id]");
    if (e.target.closest("[data-stop]")) {
      if (isMobile() && e.target.closest("#playerbar")) { e.preventDefault(); openFull(); return; }
      if (!fp.hidden) closeFull();
      return; // 링크는 그대로
    }
    if (a) {
      const act = a.dataset.act;
      const id = a.dataset.id || (a.closest("[data-id]") && a.closest("[data-id]").dataset.id);
      switch (act) {
        case "back": history.back(); return;
        case "toggle": P.toggle(); return;
        case "next": P.next(); return;
        case "prev": P.prev(); return;
        case "shuffle": toast(P.toggleShuffle() ? "셔플을 켰어요" : "셔플을 껐어요"); return;
        case "repeat": { const m = P.cycleRepeat(); toast({ off: "반복을 껐어요", all: "전체 반복", one: "한 곡 반복" }[m]); renderBar(); renderFull(); return; }
        case "fav": e.preventDefault(); toggleFav(id); return;
        case "more": { e.preventDefault(); e.stopPropagation(); const r = a.getBoundingClientRect(); const lst = a.closest("[data-list]"); trackMenu(id, r.left - 200, r.bottom + 4, lst ? { list: lst.dataset.list, i: rowEl ? +rowEl.dataset.i : -1 } : null); return; }
        case "open-full": openFull(); return;
        case "close-full": closeFull(); return;
        case "np-side": npSide = a.dataset.v; renderNpSide(); return;
        case "panel": { const v = a.dataset.v; if (panelOpen && panelTab === v) panelOpen = false; else { panelOpen = true; panelTab = v; } try { localStorage.setItem("mc.panel", panelOpen ? "1" : "0"); } catch (err) {} renderPanel(); renderBar(); return; }
        case "close-panel": panelOpen = false; try { localStorage.setItem("mc.panel", "0"); } catch (err) {} renderPanel(); renderBar(); return;
        case "q-remove": { e.stopPropagation(); P.removeAt(+a.closest("[data-q]").dataset.q); return; }
        case "list-play": case "list-shuffle": {
          const name = a.dataset.list; const ids = lists[name] || [];
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
        case "new-playlist": playlistModal(null); return;
        case "pl-tape-play": { e.preventDefault(); const name = a.dataset.list; const ctx = ctxFor(name); const pl = name === "liked" ? likedPl() : curPlaylist(); if (P.current && P.context && P.context.id === ctx.id) P.toggle(); else if (pl && pl.items.length) P.playList(pl.items, 0, ctx); return; }
        case "pl-edit": plEdit = !plEdit; rerender(); return;
        case "pl-more": { const r = a.getBoundingClientRect(); openMenu(r.left, r.bottom + 4, `<button data-m="pl-rename"><i class="ic ic-pen"></i>이름·설명 고치기</button><button data-m="pl-queue"><i class="ic ic-queue"></i>대기열에 추가</button><hr><button data-m="pl-delete" class="danger"><i class="ic ic-trash"></i>재생목록 지우기</button>`); return; }
        case "pl-remove": { const p = curPlaylist(); if (p && rowEl) { const items = p.items.slice(); items.splice(+rowEl.dataset.i, 1); savePlaylist(p, { items }); } return; }
        case "pl-add": { const p = curPlaylist(); if (p && !p.items.includes(id)) { savePlaylist(p, { items: p.items.concat([id]) }); toast("담았어요"); } return; }
        case "pldir-pick": try { window.NativeBridge.pickPlaylistDir(); } catch (err) {} return;
        case "pldir-clear": try { window.NativeBridge.clearPlaylistDir(); } catch (err) {} toast("가져오기 폴더를 해제했어요. 이미 가져온 재생목록은 남아 있어요"); rerender(); return;
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
        case "server-toggle": { const on = !a.classList.contains("on"); try { window.NativeBridge.setServerEnabled(on); } catch (err) {} setTimeout(rerender, 400); return; }
        case "rescan": { toast("라이브러리를 다시 읽는 중…"); (window.NativeBridge ? Promise.resolve(window.NativeBridge.rescan()) : API.rescan()).then(() => setTimeout(reloadLibrary, 300)).catch((err) => toast("실패: " + err.message)); return; }
      }
    }
    // 대기열 줄을 누르면 그 곡으로
    const qr = e.target.closest(".q-row[data-q]");
    if (qr) { P.jump(+qr.dataset.q); return; }
    // 카드
    const card = e.target.closest('.card[data-card="track"]');
    if (card && isMobile()) { /* 폰에서는 카드도 링크로 동작 */ return; }
    // 테이프는 그 재생목록으로 (LP 앨범은 링크)
    const tp = e.target.closest(".tape[data-pl]");
    if (tp) { const id = tp.dataset.pl; location.hash = id === "liked" ? "#/liked" : "#/playlist/" + encodeURIComponent(id); return; }
    // 곡 줄: 폰은 한 번 누르면 재생, PC는 선택(두 번 누르면 재생)
    if (rowEl) {
      if (e.target.closest(".no .play")) { playRow(rowEl); return; }
      if (rowEl.closest(".add-finder")) return;
      if (isMobile()) { playRow(rowEl); return; }
      $$(".row.sel").forEach((r) => r.classList.remove("sel")); rowEl.classList.add("sel");
    }
  });
  document.addEventListener("dblclick", (e) => {
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
    if (a.dataset.act === "pl-find") findForPlaylist(a.value);
  });
  const findForPlaylist = U.debounce((q) => {
    const box = $("#pl-find-res"); if (!box) return;
    const r = search(q); const p = curPlaylist();
    if (!r) { box.innerHTML = ""; return; }
    box.innerHTML = `<div class="tracklist">${r.tracks.slice(0, 20).map((t) => `<div class="row" data-id="${esc(t.id)}"><div class="t">${art(t, 120)}<div><b>${esc(t.title)}</b><span>${esc(t.artist)}</span></div></div><span class="alb">${esc(t.album)}</span>${p && p.items.includes(t.id) ? '<span class="dimmer" style="justify-self:end;font-size:12px">담겨 있음</span>' : `<button class="btn" data-act="pl-add" data-id="${esc(t.id)}">담기</button>`}</div>`).join("") || '<p class="dimmer">찾는 곡이 없어요</p>'}</div>`;
  }, 150);

  const saveCol = () => { try { localStorage.setItem("mc.col", JSON.stringify(colState)); } catch (e) {} };
  function ctxFor(name) {
    const r = route();
    if (name === "album") { const a = L.albums.get(r.arg); return { type: "album", id: r.arg, name: a && a.title }; }
    if (name.startsWith("artist")) return { type: "artist", id: r.arg, name: r.arg };
    if (name === "playlist") { const p = curPlaylist(); return { type: "playlist", id: r.arg, name: p && p.name }; }
    if (name === "liked") return { type: "playlist", id: "liked", name: "아끼는 곡" };
    if (name === "collection") return { type: "collection", name: "곡 목록" };
    if (name === "year") return { type: "collection", name: r.arg + "년대" };
    if (name === "genre") return { type: "collection", name: r.arg };
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

  U.onContext(document, ".row[data-id], .card[data-id]", (el, x, y) => {
    if (el.closest(".add-finder") || el.closest("#fullplayer")) return;
    const lst = el.closest("[data-list]");
    trackMenu(el.dataset.id, x, y, lst ? { list: lst.dataset.list, i: +el.dataset.i } : null);
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
    else if (e.code === "Escape") { closeMenu(); closeModal(); closeFull(); }
  });

  // 안드로이드 뒤로 가기: 처리했으면 true
  window.__back = () => {
    if (!menu.hidden) { closeMenu(); return true; }
    if (!modal.hidden) { closeModal(); return true; }    if (!fp.hidden) { closeFull(); return true; }
    if (route().name !== "home") { history.back(); return true; }
    return false;
  };

  // ───────── 재생 상태 반영 ─────────
  let lastId = null;
  function onState() {
    const id = P.currentId;
    const changed = id !== lastId; lastId = id;
    renderBar();
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
    document.title = P.current ? `${P.current.title} · ${P.current.artist}` : "소장곡";
  }
  function onPlayed({ id }) {
    const t = L.byId.get(id); if (!t) return;
    const now = Date.now();
    t.plays++; t.lastPlayed = now; if (!t.firstPlayed) t.firstPlayed = now;
    const a = L.albums.get(t.albumKey); if (a) { a.plays++; a.lastPlayed = now; }
    t._artists.forEach((n) => { const r = L.artists.get(n); if (r) r.plays++; });
    const nm = tierOf(t.plays);
    if (TIERS.some(([n]) => n === t.plays) && t.plays > 1) toast(`「${t.title}」이(가) ${nm.name}이 됐어요 · ${t.plays}회`);
  }

  // ───────── 시작 ─────────
  async function reloadLibrary() {
    const [lib, pls] = await Promise.all([API.library(), API.playlists()]);
    indexLibrary(lib.tracks || []); L.playlists = pls || [];
    renderSidebar(); rerender(); renderBar();
  }
  async function boot() {
    try {
      const st = await API.status();
      if (!st.authorized) return showGate();
      const [lib, pls] = await Promise.all([API.library(), API.playlists()]);
      indexLibrary(lib.tracks || []); L.playlists = pls || [];
    } catch (e) {
      if (e instanceof API.Unauthorized) return showGate();
      $("#view").innerHTML = `<div class="page"><div class="empty"><b>폰에 연결할 수 없어요</b>폰 앱에서 「PC에서 접속」이 켜져 있는지, 같은 Wi-Fi인지 확인해 주세요.<br><br><button class="btn" onclick="location.reload()">다시 시도</button></div></div>`;
      return;
    }
    P = new Player((id) => L.byId.get(id));
    P.on("state", onState);
    P.on("queue", () => { if (panelOpen && panelTab === "queue") renderPanel(); if (npSide === "queue") renderNpSide(); });
    P.on("time", updateTime);
    P.on("played", onPlayed);
    P.on("listened", ({ id, ms }) => { const t = L.byId.get(id); if (t) t.listenedMs += ms; });
    P.on("error", () => toast("이 곡을 재생하지 못했어요"));
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
