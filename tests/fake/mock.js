// 시험용 가짜 서버 (tests/ui_smoke.py): 폰 없이 화면을 띄워 시험할 때 쓴다. 앱에는 들어가지 않는다.
// 곡·아티스트 이름은 무작위로 만든 것이며 실제 곡이 아니다.
(function () {
  "use strict";
  let s = 20261109;
  const rnd = () => { s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x6d2b79f5) >>> 0; s ^= s >>> 13; return (s >>> 0) / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];

  const W1 = ["밤", "여름", "바다", "기억", "별", "우리", "너", "그날", "봄", "비", "새벽", "골목", "하늘", "편지", "노을", "창문", "겨울", "꿈", "숲", "파도", "달", "온도", "계절", "바람", "시간"];
  const W2 = ["의 끝", "에게", "처럼", " 속으로", "이 오면", "을 걷다", "의 노래", " 한 조각", "을 닮은", "이 지나면", "가 내린다", " 너머", "의 온도", "을 기다려", ""];
  const EN = ["Blue", "Midnight", "Lights", "Holiday", "Echo", "Runaway", "Paper", "Gravity", "Daydream", "Neon", "Polaroid", "Honey", "Satellite", "Velvet", "Summer Rain"];
  const AR = ["하늘색 우체통", "도시의 오후", "LUMEN", "새벽세시", "김온유", "파란 고래", "윤슬", "MONO TONE", "정다운", "오렌지 필름", "이서해", "NOVA", "숲속의 밤", "백야", "HAZEL", "모래시계", "초록불", "한여름", "LOOP", "서로", "이도", "구름 정류장", "PRISM", "달빛 소년단", "최하람"];
  const GEN = ["발라드", "댄스", "인디음악", "R&B/Soul", "록/메탈", "포크/블루스", "랩/힙합", "일렉트로니카", "OST"];
  const title = () => rnd() < 0.3 ? pick(EN) + (rnd() < 0.3 ? " " + pick(EN) : "") : pick(W1) + pick(W2);

  const tracks = [];
  const prefs = {}; // 폰 DB의 화면 상태 (/api/prefs)
  const now = Date.now();
  const start = new Date(2015, 2, 3).getTime();
  let albumNo = 0;
  while (tracks.length < 3144) {
    const artist = pick(AR);
    const year = 1995 + Math.floor(rnd() * 31);
    const albumKey = "a" + albumNo++;
    const album = rnd() < 0.25 ? title() + " (Single)" : title();
    const n = rnd() < 0.4 ? 1 + Math.floor(rnd() * 2) : 3 + Math.floor(rnd() * 9);
    // 수집 시기: 앞쪽이 덜 촘촘하고 최근이 촘촘하게
    const added = start + Math.pow(rnd(), 0.6) * (now - start);
    const genre = pick(GEN);
    for (let k = 0; k < n && tracks.length < 3144; k++) {
      const plays = rnd() < 0.18 ? 0 : Math.floor(Math.pow(rnd(), 2.2) * 160);
      const first = plays ? added + rnd() * 86400000 * 30 : 0;
      const last = plays ? Math.min(now, first + rnd() * (now - first)) : 0;
      const dur = 150000 + Math.floor(rnd() * 150000);
      const feat = rnd() < 0.08 ? ", " + pick(AR) : "";
      tracks.push({
        id: "t" + tracks.length, title: title(), artist: artist + feat, albumArtist: artist, album, albumKey,
        year, genre, track: k + 1, disc: 1, duration: dur, addedAt: Math.round(added + k * 1000),
        plays, firstPlayed: Math.round(first), lastPlayed: Math.round(last), listenedMs: plays * dur * 0.9,
        fav: rnd() < 0.06, memo: rnd() < 0.02 ? pick(["처음 이 노래를 들은 건 퇴근길 버스 안이었다.", "비 오는 날이면 꼭 생각나는 곡.", "친구가 추천해 준 노래. 그 뒤로 계속 듣는 중", "여행 내내 반복해서 들었던 곡"]) : "",
      });
    }
  }
  tracks.sort((a, b) => a.addedAt - b.addedAt).forEach((t, i) => (t.n = i + 1));
  const byId = new Map(tracks.map((t) => [t.id, t]));

  const loadPl = () => { try { return JSON.parse(localStorage.getItem("mock.pl")); } catch (e) { return null; } };
  let playlists = loadPl() || [
    { id: "p1", name: "출근길", desc: "아침에 듣기 좋은 곡", created: now - 86400000 * 200, updated: now - 86400000 * 3, items: tracks.slice(100, 124).map((t) => t.id) },
    { id: "p2", name: "비 오는 날", desc: "", created: now - 86400000 * 90, updated: now - 86400000 * 10, items: tracks.slice(800, 840).map((t) => t.id) },
  ];
  const savePl = () => { try { localStorage.setItem("mock.pl", JSON.stringify(playlists)); } catch (e) {} };
  const loadBox = () => { try { return JSON.parse(localStorage.getItem("mock.box")); } catch (e) { return null; } };
  let boxes = loadBox() || [{ id: "b1", name: "여름 상자", created: now - 86400000 * 30, updated: now - 86400000 * 2, items: ["p2"] }];
  const saveBox = () => { try { localStorage.setItem("mock.box", JSON.stringify(boxes)); } catch (e) {} };
  const ok = (v) => new Promise((r) => setTimeout(() => r(JSON.parse(JSON.stringify(v))), 40));

  const mockFolders = { autoNew: true, off: ["Download/KakaoTalk/"], folders: [
    { path: "Music/", count: 12 }, { path: "Music/Albums/A/", count: 140 }, { path: "Music/Albums/B/", count: 96 },
    { path: "Download/", count: 8 }, { path: "Download/KakaoTalk/", count: 31 }, { path: "Recordings/", count: 54 },
  ] };
  window.MOCK_API = {
    status: () => ok({ authorized: true, name: "dev", version: "0.0.0" }),
    pair: () => ok({ ok: true }),
    library: () => ok({ tracks }),
    lyrics: (id) => {
      const t = byId.get(id); const lines = [];
      if (rnd() < 0.15) return ok({ synced: null, plain: null });
      for (let ms = 12000, i = 0; ms < t.duration - 8000; ms += 3500 + Math.floor(rnd() * 2500), i++) lines.push([ms, i % 9 === 8 ? "" : title() + " " + title()]);
      return ok({ synced: lines, plain: null, source: rnd() < 0.5 ? "aligned" : "file", check: rnd() < 0.5 });
    },
    revertLyrics: () => ok({ ok: true }),
    setTrack: (id, patch) => { Object.assign(byId.get(id), patch); return ok({ ok: true }); },
    reportPlay: (id, ms, counted) => { const t = byId.get(id); t.listenedMs += ms; if (counted) { t.plays++; t.lastPlayed = Date.now(); t.firstPlayed = t.firstPlayed || Date.now(); } return ok({ ok: true }); },
    playlists: () => ok(playlists),
    createPlaylist: (name, items) => { const p = { id: "p" + Date.now(), name, desc: "", created: Date.now(), updated: Date.now(), items: items || [] }; playlists.push(p); savePl(); return ok(p); },
    // 재생 동기화: 이 기기 하나뿐 (기다리는 요청은 답하지 않는다)
    now: (ver, wait) => (wait ? new Promise(() => {}) : ok({ ver: 0, owner: "", ids: [], index: -1, pos: 0, playing: false, dur: 0, repeat: "off", cmds: [], cmdSeq: 0, metaVer: 0 })),
    nowPublish: () => ok({}),
    nowClaim: () => ok({}),
    nowCmd: () => ok({}),
    updatePlaylist: (id, patch) => { const p = playlists.find((x) => x.id === id); Object.assign(p, patch, { updated: Date.now() }); savePl(); return ok(p); },
    deletePlaylist: (id) => { playlists = playlists.filter((x) => x.id !== id); savePl(); return ok({ ok: true }); },
    boxes: () => ok(boxes),
    history: () => ok([{ month: new Date().toISOString().slice(0, 7), items: tracks.slice(0, 30).map((t) => t.id) }]),
    resetRecords: () => ok({ ok: true }),
    syncFiles: () => ok({ changed: false }),
    prefs: () => ok(JSON.parse(JSON.stringify(prefs))),
    setPrefs: (patch) => { window.Prefs._mergeInto(prefs, JSON.parse(JSON.stringify(patch))); return ok(JSON.parse(JSON.stringify(prefs))); },
    createBox: (name, items) => { const b = { id: "b" + Date.now(), name, created: Date.now(), updated: Date.now(), items: items || [] }; boxes.push(b); saveBox(); return ok(b); },
    updateBox: (id, patch) => { const b = boxes.find((x) => x.id === id); Object.assign(b, patch, { updated: Date.now() }); saveBox(); return ok(b); },
    deleteBox: (id) => { boxes = boxes.filter((x) => x.id !== id); saveBox(); return ok({ ok: true }); },
    rescan: () => ok({ ok: true }),
    folders: () => ok(mockFolders),
    setFolders: (off, autoNew) => { mockFolders.off = off; mockFolders.autoNew = autoNew; return ok({ ok: true }); },
    artUrl: () => "",
    streamUrl: () => "",
  };
})();
