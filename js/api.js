// 폰의 내장 서버와 이야기하는 층.
(function () {
  "use strict";

  class Unauthorized extends Error {}

  async function req(method, path, body) {
    const opt = { method, headers: {}, credentials: "same-origin" };
    if (body !== undefined) { opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(body); }
    const res = await fetch(path, opt);
    if (res.status === 401) throw new Unauthorized("PIN이 필요해요");
    if (!res.ok) {
      let msg = res.status + "";
      try { msg = (await res.json()).error || msg; } catch (e) {}
      throw new Error(msg);
    }
    const ct = res.headers.get("Content-Type") || "";
    return ct.includes("json") ? res.json() : res.text();
  }

  const real = {
    status: () => req("GET", "/api/status"),
    pair: (pin) => req("POST", "/api/pair", { pin }),
    library: () => req("GET", "/api/library"),
    lyrics: (id) => req("GET", "/api/lyrics/" + encodeURIComponent(id)),
    revertLyrics: (id) => req("DELETE", "/api/lyrics/" + encodeURIComponent(id) + "?reject=1"),
    setTrack: (id, patch) => req("POST", "/api/track/" + encodeURIComponent(id), patch),
    history: () => req("GET", "/api/history"), // 히스토리 상자: [{ month: "2026-11", items: [곡 id…] }]
    syncFiles: () => req("POST", "/api/sync-files"), // 테이프 저장 폴더에서 밖에서 고친 파일을 반영 → { changed }
    importPlaylist: (name, data) => req("POST", "/api/import-playlist", { name, data }), // PC에서 고른 재생목록 파일(base64) → { ok, id, name, count, saved } | { ok:false, error }
    prefs: () => req("GET", "/api/prefs"), // 기기를 가리지 않는 화면 상태 (js/prefs.js)
    setPrefs: (patch) => req("PUT", "/api/prefs", patch), // 바뀐 부분만. 폰이 합쳐서 전체를 돌려준다
    resetRecords: (what) => req("POST", "/api/reset-records", what), // { plays, favs, history }
    // PC·폰 재생 동기화: 지금 재생 상태 (wait면 바뀔 때까지 최대 20초 기다림), 상태 알리기, 소리 가져오기, 조작 보내기
    now: (ver, wait) => req("GET", "/api/now?ver=" + (ver == null ? -1 : ver) + (wait ? "&wait=1" : "")),
    nowPublish: (b) => req("POST", "/api/now", b),
    nowClaim: (b) => req("POST", "/api/now/claim", b),
    nowCmd: (b) => req("POST", "/api/now/cmd", b),
    reportPlay: (id, listenedMs, counted) => req("POST", "/api/plays", { id, listenedMs: Math.round(listenedMs), counted: !!counted }),
    playlists: () => req("GET", "/api/playlists"),
    createPlaylist: (name, items) => req("POST", "/api/playlists", { name, items: items || [] }),
    updatePlaylist: (id, patch) => req("PUT", "/api/playlists/" + encodeURIComponent(id), patch),
    deletePlaylist: (id) => req("DELETE", "/api/playlists/" + encodeURIComponent(id)),
    boxes: () => req("GET", "/api/boxes"),
    createBox: (name, items) => req("POST", "/api/boxes", { name, items: items || [] }),
    updateBox: (id, patch) => req("PUT", "/api/boxes/" + encodeURIComponent(id), patch),
    deleteBox: (id) => req("DELETE", "/api/boxes/" + encodeURIComponent(id)),
    devImport: () => req("POST", "/api/dev-import"),
    rescan: () => req("POST", "/api/rescan"),
    folders: () => req("GET", "/api/folders"),
    token: () => req("POST", "/api/token"),
    setFolders: (off, autoNew) => req("PUT", "/api/folders", { off, autoNew }),
    artUrl: (albumKey, size) => albumKey ? "/api/art/" + encodeURIComponent(albumKey) + "?s=" + (size || 300) : "",
    streamUrl: (id) => "/api/stream/" + encodeURIComponent(id),
  };

  window.API = Object.assign({}, real);
  window.API.Unauthorized = Unauthorized;
})();
