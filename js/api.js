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
