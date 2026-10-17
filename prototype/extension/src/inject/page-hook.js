(function () {
  const SOURCE = "yt-capture";
  const REPLY = "yt-capture-page";
  const capturedTimedtext = [];
  installNetworkHooks();

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== SOURCE || !data.requestId) return;
    if (data.type === "get-player") {
      reply(data.requestId, { player: readPlayer() });
      return;
    }
    if (data.type === "fetch-tracks") {
      fetchTracks(data.tracks || []).then((result) => {
        reply(data.requestId, result);
      });
    }
  });

  function reply(requestId, payload) {
    window.postMessage(Object.assign({ source: REPLY, requestId }, payload), "*");
  }

  function readPlayer() {
    const responses = playerResponses();
    const response =
      responses.find((item) => item && item.videoDetails && item.videoDetails.title) ||
      responses[0] ||
      {};
    const details = (response && response.videoDetails) || {};
    return {
      id: details.videoId || null,
      title: details.title || "",
      channel: details.author || "",
      durationSec: details.lengthSeconds ? Number(details.lengthSeconds) : null,
      tracks: captionTracks(),
    };
  }

  function playerResponses() {
    const found = [];
    const player = document.getElementById("movie_player");
    try {
      if (player && typeof player.getPlayerResponse === "function") {
        const response = player.getPlayerResponse();
        if (response) found.push(response);
      }
    } catch (error) {
      /* player not ready */
    }
    if (window.ytInitialPlayerResponse) found.push(window.ytInitialPlayerResponse);
    return found;
  }

  function tracksFromResponse(response) {
    const tracks =
      response &&
      response.captions &&
      response.captions.playerCaptionsTracklistRenderer &&
      response.captions.playerCaptionsTracklistRenderer.captionTracks;
    return Array.isArray(tracks) ? tracks : [];
  }

  function trackKind(track) {
    const vss = String(track.vssId || track.vss_id || track.id || "");
    const name = String(
      (track.name && (track.name.simpleText || track.name.runs?.[0]?.text)) ||
        track.languageName ||
        ""
    );
    const base = String(track.baseUrl || track.url || "");
    if (track.kind === "asr" || vss.startsWith("a.") || /kind=asr/.test(base) || /auto-generated/i.test(name)) {
      return "asr";
    }
    return "manual";
  }

  function normalizeTrack(track) {
    const baseUrl = track && (track.baseUrl || track.url);
    if (!baseUrl) return null;
    const language = track.languageCode || track.language || "und";
    return { baseUrl, language, kind: trackKind(track) };
  }

  function addTracks(into, seen, tracks) {
    for (const track of tracks || []) {
      const normalized = track && track.baseUrl && track.kind ? track : normalizeTrack(track);
      if (!normalized) continue;
      const key = `${normalized.language}:${normalized.kind}:${normalized.baseUrl}`;
      if (seen.has(key)) continue;
      seen.add(key);
      into.push(normalized);
    }
  }

  function captionTracks() {
    const seen = new Set();
    const tracks = [];
    for (const response of playerResponses()) {
      addTracks(tracks, seen, tracksFromResponse(response));
    }
    return tracks;
  }

  function installNetworkHooks() {
    if (window.__ytCaptureHooks) return;
    window.__ytCaptureHooks = true;
    const originalFetch = window.fetch;
    if (typeof originalFetch === "function") {
      window.fetch = function (...args) {
        return originalFetch.apply(this, args).then((response) => {
          rememberTimedtext(response && response.url, () => response.clone().text());
          return response;
        });
      };
    }
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__ytCaptureUrl = url;
      return originalOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      this.addEventListener("load", () => {
        if (typeof this.responseText === "string") rememberBody(this.__ytCaptureUrl, this.responseText);
      });
      return originalSend.apply(this, arguments);
    };
  }

  function rememberTimedtext(url, readText) {
    if (!url || !String(url).includes("timedtext")) return;
    Promise.resolve()
      .then(readText)
      .then((text) => rememberBody(url, text))
      .catch(() => {});
  }

  function rememberBody(url, text) {
    if (!url || !String(url).includes("timedtext")) return;
    if (!text || !String(text).trim()) return;
    capturedTimedtext.push({ url: String(url), text: String(text) });
  }

  function playerApi() {
    const player = document.getElementById("movie_player");
    if (!player || typeof player.getOption !== "function") return null;
    try {
      if (typeof player.loadModule === "function") player.loadModule("captions");
    } catch (error) {
      /* captions module not ready */
    }
    return player;
  }

  function uiTracks(player) {
    try {
      return player.getOption("captions", "tracklist") || [];
    } catch (error) {
      return [];
    }
  }

  function uiTrackKind(track) {
    const id = String(track.vss_id || track.vssId || track.id || "");
    const name = String(track.languageName || track.displayName || "");
    if (track.kind === "asr" || id.startsWith("a.") || /auto-generated/i.test(name)) return "asr";
    return "manual";
  }

  async function loadCaptionsFromPlayer() {
    const player = playerApi();
    if (!player || typeof player.setOption !== "function") return [];
    const list = uiTracks(player);
    const manual = list.filter((track) => uiTrackKind(track) !== "asr");
    const asr = list.filter((track) => uiTrackKind(track) === "asr");
    const ordered = manual.length ? manual : asr;
    let previous = null;
    try {
      previous = player.getOption("captions", "track");
    } catch (error) {
      previous = null;
    }
    for (const track of ordered) {
      const before = capturedTimedtext.length;
      try {
        player.setOption("captions", "track", track);
      } catch (error) {
        continue;
      }
      const text = await waitForTimedtext(before, 4000);
      if (!text) continue;
      const payload = parseTimedBody(text);
      if (!payloadHasText(payload)) continue;
      restoreCaptionTrack(player, previous);
      return [
        {
          language: track.languageCode || "en",
          kind: uiTrackKind(track),
          payload,
        },
      ];
    }
    restoreCaptionTrack(player, previous);
    return [];
  }

  function restoreCaptionTrack(player, previous) {
    try {
      if (previous && (previous.languageCode || previous.languageName)) {
        player.setOption("captions", "track", previous);
      } else {
        player.setOption("captions", "track", {});
      }
    } catch (error) {
      /* leaving the selected track is acceptable */
    }
  }

  function waitForTimedtext(previousLength, timeoutMs) {
    const started = Date.now();
    return new Promise((resolve) => {
      const timer = setInterval(() => {
        if (capturedTimedtext.length > previousLength) {
          clearInterval(timer);
          resolve(capturedTimedtext[capturedTimedtext.length - 1].text);
          return;
        }
        if (Date.now() - started >= timeoutMs) {
          clearInterval(timer);
          resolve("");
        }
      }, 200);
    });
  }

  async function readOpenTranscript() {
    const fromData = segmentsFromPanelData();
    if (fromData.length) return transcriptResult(fromData);
    let events = await collectVisibleSegments();
    if (events.length < 2) {
      const button = findTranscriptButton();
      if (button) {
        button.click();
        await delay(1500);
        events = segmentsFromPanelData();
        if (events.length < 2) events = await collectVisibleSegments();
      }
    }
    return events.length ? transcriptResult(events) : null;
  }

  function transcriptResult(events) {
    const filled = events
      .filter((event) => event.segs && event.segs[0] && event.segs[0].utf8)
      .sort((a, b) => a.tStartMs - b.tStartMs);
    const unique = [];
    for (const event of filled) {
      const previous = unique[unique.length - 1];
      if (previous && previous.tStartMs === event.tStartMs && previous.segs[0].utf8 === event.segs[0].utf8) continue;
      unique.push(event);
    }
    for (let i = 0; i < unique.length - 1; i += 1) {
      if (!unique[i].dDurationMs) unique[i].dDurationMs = Math.max(0, unique[i + 1].tStartMs - unique[i].tStartMs);
    }
    if (unique.length && !unique[unique.length - 1].dDurationMs) unique[unique.length - 1].dDurationMs = 2000;
    if (!unique.length) return null;
    return {
      language: String(navigator.language || "en").slice(0, 2).toLowerCase(),
      kind: panelKind(),
      payload: { events: unique },
    };
  }

  function panelKind() {
    const panel = document.querySelector(
      "ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-searchable-transcript']"
    );
    const label = panel ? collectText(panel).slice(0, 400) : "";
    return /auto-generated/i.test(label) ? "asr" : "manual";
  }

  function segmentsFromPanelData() {
    const hosts = [];
    eachShadowRoot((root) => {
      root.querySelectorAll(
        "ytd-engagement-panel-section-list-renderer, ytd-transcript-renderer, ytd-transcript-search-panel-renderer, ytd-transcript-segment-list-renderer, ytd-transcript-segment-renderer"
      ).forEach((node) => hosts.push(node));
    });
    const events = [];
    for (const host of hosts) {
      const data = host.data || host.__data || host.__dataHost;
      walk(data, (node) => {
        if (!node || !node.snippet) return;
        const start = Number(node.startMs != null ? node.startMs : node.startTimeMs);
        const text = runsText(node.snippet);
        if (!Number.isFinite(start) || !text) return;
        const end = Number(node.endMs != null ? node.endMs : start);
        events.push({
          tStartMs: start,
          dDurationMs: Math.max(0, end - start),
          segs: [{ utf8: text }],
        });
      });
    }
    return events;
  }

  function runsText(snippet) {
    const runs = snippet && snippet.runs;
    if (Array.isArray(runs) && runs.length) {
      return runs
        .map((run) => (run && run.text) || "")
        .join("")
        .replace(/\s+/g, " ")
        .trim();
    }
    const simple = snippet && (snippet.simpleText || (snippet.text && snippet.text.simpleText));
    return simple ? String(simple).replace(/\s+/g, " ").trim() : "";
  }

  function segmentsFromDom() {
    const events = [];
    const nodes = [];
    eachShadowRoot((root) => {
      root.querySelectorAll(
        "transcript-segment-view-model, ytd-transcript-segment-renderer, yt-transcript-segment-view-model"
      ).forEach((node) => nodes.push(node));
    });
    for (const node of nodes) {
      const stampNode = node.querySelector(".ytwTranscriptSegmentViewModelTimestamp, .segment-timestamp");
      const textNode = node.querySelector("span[role='text'], .segment-text, yt-formatted-string");
      const start = parseStamp(stampNode && stampNode.textContent);
      const text = textNode ? textNode.textContent.replace(/\s+/g, " ").trim() : "";
      if (start == null || !text) continue;
      events.push({ tStartMs: Math.round(start * 1000), dDurationMs: 0, segs: [{ utf8: text }] });
    }
    return events;
  }

  async function collectVisibleSegments() {
    const seen = new Map();
    const remember = () => {
      for (const event of segmentsFromDom()) {
        seen.set(`${event.tStartMs}|${event.segs[0].utf8}`, event);
      }
    };
    remember();
    const first = document.querySelector("transcript-segment-view-model");
    let scroller = first && first.parentElement;
    while (scroller && scroller.scrollHeight <= scroller.clientHeight + 40) scroller = scroller.parentElement;
    if (!scroller) return [...seen.values()];
    scroller.scrollTop = 0;
    let stuck = 0;
    let last = -1;
    for (let i = 0; i < 60 && stuck < 3; i += 1) {
      remember();
      if (seen.size === last) stuck += 1;
      else stuck = 0;
      last = seen.size;
      scroller.scrollTop += Math.max(240, scroller.clientHeight * 0.85);
      await delay(120);
    }
    return [...seen.values()];
  }

  function eachShadowRoot(visit) {
    const seen = new Set();
    const walkRoots = (root) => {
      if (!root || seen.has(root) || !root.querySelectorAll) return;
      seen.add(root);
      visit(root);
      root.querySelectorAll("*").forEach((node) => {
        if (node.shadowRoot) walkRoots(node.shadowRoot);
      });
    };
    walkRoots(document);
  }

  function collectText(node) {
    if (!node) return "";
    const parts = [];
    const visit = (root) => {
      if (!root) return;
      if (root.nodeType === 3) {
        if (root.textContent && root.textContent.trim()) parts.push(root.textContent);
        return;
      }
      const children = root.childNodes || [];
      for (let i = 0; i < children.length; i += 1) visit(children[i]);
      if (root.shadowRoot) visit(root.shadowRoot);
    };
    visit(node);
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  function findTranscriptButton() {
    const candidates = document.querySelectorAll("button, yt-button-shape button, a");
    for (const candidate of candidates) {
      const label = `${candidate.getAttribute("aria-label") || ""} ${candidate.textContent || ""}`;
      if (/show transcript/i.test(label)) return candidate;
    }
    return null;
  }

  function parseStamp(value) {
    const parts = String(value || "")
      .trim()
      .split(":")
      .map((part) => Number(part));
    if (!parts.length || parts.some((part) => !Number.isFinite(part))) return null;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0];
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function fetchTracks(requested) {
    const openPanel = await readOpenTranscript();
    if (openPanel) return { tracks: [openPanel], note: "" };
    const fromPlayer = await loadCaptionsFromPlayer();
    if (fromPlayer.length) return { tracks: fromPlayer, note: "" };
    const tracks = [];
    const seen = new Set();
    addTracks(tracks, seen, requested && requested.length ? requested : captionTracks());
    if (!tracks.length) addTracks(tracks, seen, await refreshCaptionTracks());
    let results = await fetchTrackList(tracks.filter((track) => track.kind !== "asr"));
    if (!results.length) {
      let asrTracks = tracks.filter((track) => track.kind === "asr");
      if (!asrTracks.length) {
        addTracks(tracks, seen, await refreshCaptionTracks());
        asrTracks = tracks.filter((track) => track.kind === "asr");
      }
      if (!asrTracks.length) asrTracks = synthesizedAsrTracks(tracks);
      results = await fetchTrackList(asrTracks);
    }
    if (!results.length) {
      const fallback = await fetchTranscriptPanel();
      if (fallback) results.push(fallback);
    }
    return {
      tracks: results,
      note: results.length ? "" : "YouTube did not return a transcript or auto-generated captions.",
    };
  }

  async function fetchTrackList(tracks) {
    const results = [];
    for (const track of tracks) {
      const payload = await fetchTimedText(track);
      if (!payloadHasText(payload)) continue;
      results.push({ language: track.language, kind: track.kind, payload });
    }
    return results;
  }

  async function refreshCaptionTracks() {
    const id = currentVideoId();
    const key = innertubeValue("INNERTUBE_API_KEY");
    const version = innertubeValue("INNERTUBE_CLIENT_VERSION") || "2.20250901.00.00";
    if (!id || !key) return [];
    try {
      const response = await fetch(
        `https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(key)}&prettyPrint=false`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            videoId: id,
            context: {
              client: {
                clientName: "WEB",
                clientVersion: version,
                hl: navigator.language || "en",
              },
            },
            contentCheckOk: true,
            racyCheckOk: true,
          }),
        }
      );
      if (!response.ok) return [];
      const payload = await response.json();
      return tracksFromResponse(payload);
    } catch (error) {
      return [];
    }
  }

  function synthesizedAsrTracks(existing) {
    const id = currentVideoId();
    if (!id) return [];
    const languages = asrLanguages();
    const signed = (existing || []).find((track) => track.baseUrl);
    return languages.map((language) => {
      if (signed) {
        const url = new URL(signed.baseUrl, location.href);
        url.searchParams.set("lang", language);
        url.searchParams.set("kind", "asr");
        url.searchParams.set("fmt", "json3");
        return { baseUrl: url.toString(), language, kind: "asr" };
      }
      const url = new URL("https://www.youtube.com/api/timedtext");
      url.searchParams.set("v", id);
      url.searchParams.set("lang", language);
      url.searchParams.set("kind", "asr");
      url.searchParams.set("fmt", "json3");
      return { baseUrl: url.toString(), language, kind: "asr" };
    });
  }

  function asrLanguages() {
    const languages = [];
    for (const response of playerResponses()) {
      const code = response && response.videoDetails && response.videoDetails.language;
      if (code) languages.push(String(code).slice(0, 2).toLowerCase());
    }
    languages.push(String(navigator.language || "en").slice(0, 2).toLowerCase());
    languages.push("en");
    return [...new Set(languages)];
  }

  function currentVideoId() {
    for (const response of playerResponses()) {
      const id = response && response.videoDetails && response.videoDetails.videoId;
      if (id) return id;
    }
    return new URL(location.href).searchParams.get("v") || "";
  }

  function payloadHasText(payload) {
    const events = payload && payload.events;
    if (!Array.isArray(events)) return false;
    return events.some(
      (event) =>
        event &&
        Array.isArray(event.segs) &&
        event.segs.some((seg) => seg && String(seg.utf8 || "").trim())
    );
  }

  async function fetchTimedText(track) {
    if (!track || !track.baseUrl) return null;
    try {
      const url = new URL(track.baseUrl, location.href);
      url.searchParams.set("fmt", "json3");
      const response = await fetch(url.toString(), { credentials: "include" });
      if (!response.ok) return null;
      const text = await response.text();
      return parseTimedBody(text);
    } catch (error) {
      return null;
    }
  }

  function parseTimedBody(text) {
    const trimmed = (text || "").trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return JSON.parse(trimmed);
      } catch (error) {
        return null;
      }
    }
    if (!trimmed.includes("<text")) return null;
    const doc = new DOMParser().parseFromString(trimmed, "text/xml");
    const events = [];
    for (const node of doc.getElementsByTagName("text")) {
      const start = Number(node.getAttribute("start") || 0);
      const duration = Number(node.getAttribute("dur") || 0);
      const value = (node.textContent || "").replace(/\s+/g, " ").trim();
      if (!value) continue;
      events.push({
        tStartMs: Math.round(start * 1000),
        dDurationMs: Math.round(duration * 1000),
        segs: [{ utf8: value }],
      });
    }
    return events.length ? { events } : null;
  }

  async function fetchTranscriptPanel() {
    const params = findTranscriptParams(window.ytInitialData);
    const key = innertubeValue("INNERTUBE_API_KEY");
    const version = innertubeValue("INNERTUBE_CLIENT_VERSION") || "2.20250901.00.00";
    if (!params || !key) return null;
    try {
      const response = await fetch(
        `https://www.youtube.com/youtubei/v1/get_transcript?key=${encodeURIComponent(key)}&prettyPrint=false`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            context: {
              client: {
                clientName: "WEB",
                clientVersion: version,
                hl: navigator.language || "en",
              },
            },
            params,
          }),
        }
      );
      if (!response.ok) return null;
      const payload = await response.json();
      const events = [];
      walk(payload, (node) => {
        const segment = node && node.transcriptSegmentRenderer;
        if (!segment || !segment.snippet) return;
        const text = (segment.snippet.runs || [])
          .map((run) => (run && run.text) || "")
          .join("")
          .replace(/\s+/g, " ")
          .trim();
        if (!text) return;
        const start = Number(segment.startMs || 0);
        const end = Number(segment.endMs || start);
        events.push({
          tStartMs: start,
          dDurationMs: Math.max(0, end - start),
          segs: [{ utf8: text }],
        });
      });
      if (!events.length) return null;
      const language = (navigator.language || "en").slice(0, 2).toLowerCase();
      return { language, kind: "asr", payload: { events } };
    } catch (error) {
      return null;
    }
  }

  function findTranscriptParams(root) {
    let params = null;
    walk(root, (node) => {
      if (params) return;
      const endpoint = node && node.getTranscriptEndpoint;
      if (endpoint && endpoint.params) params = endpoint.params;
    });
    return params;
  }

  function walk(node, visit, depth) {
    if (!node || typeof node !== "object" || (depth || 0) > 14) return;
    visit(node);
    const values = Array.isArray(node) ? node : Object.keys(node).map((key) => node[key]);
    for (const value of values) walk(value, visit, (depth || 0) + 1);
  }

  function innertubeValue(name) {
    try {
      if (window.ytcfg && typeof window.ytcfg.get === "function") {
        const value = window.ytcfg.get(name);
        if (value) return value;
      }
    } catch (error) {
      /* config not ready */
    }
    const match = document.documentElement.innerHTML.match(new RegExp(`"${name}":"([^"]+)"`));
    return match ? match[1] : "";
  }
})();
