(function () {
  const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
  const session = {
    capturing: false,
    videoId: null,
    coveredRanges: [],
    frames: [],
    lastSampleTime: null,
    lastCaptionCueStart: null,
    segments: [],
    path: null,
    audioPath: null,
    lastLuma: null,
    openAudio: null,
    lastT: null,
    timer: null,
    busy: false,
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return;
    if (message.type === "get-page-info") {
      pageInfo().then(sendResponse);
      return true;
    }
    if (message.type === "start-capture") {
      startCapture(message.state || {}).then(sendResponse);
      return true;
    }
    if (message.type === "stop-capture") {
      stopCapture().then(() => sendResponse({ ok: true }));
      return true;
    }
    if (message.type === "apply-state") {
      applyState(message.state || {});
      sendResponse({ ok: true });
    }
  });

  document.addEventListener("yt-navigate-finish", () => {
    onNavigate();
  });
  window.addEventListener("pagehide", () => {
    if (session.capturing) void stopCapture();
  });

  keepAlive();

  function keepAlive() {
    const port = chrome.runtime.connect({ name: "capture" });
    port.onDisconnect.addListener(() => {
      setTimeout(keepAlive, 500);
    });
  }

  function videoIdFromLocation() {
    const url = new URL(location.href);
    if (url.pathname === "/watch") {
      const id = url.searchParams.get("v");
      return VIDEO_ID.test(id || "") ? id : null;
    }
    const shorts = url.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{11})/);
    return shorts ? shorts[1] : null;
  }

  function askPage(type, extra, timeoutMs) {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        window.removeEventListener("message", onMessage);
        resolve(null);
      }, timeoutMs || 5000);
      function onMessage(event) {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.source !== "yt-capture-page" || data.requestId !== requestId) return;
        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        resolve(data);
      }
      window.addEventListener("message", onMessage);
      window.postMessage(Object.assign({ source: "yt-capture", type, requestId }, extra || {}), "*");
    });
  }

  async function pageInfo() {
    const id = videoIdFromLocation();
    const reply = await askPage("get-player");
    const player = (reply && reply.player) || {};
    const video = playerVideo();
    return {
      videoId: id,
      url: id ? `https://www.youtube.com/watch?v=${id}` : location.href,
      title: player.title || document.title.replace(/ - YouTube$/, ""),
      channel: player.channel || "",
      durationSec: player.durationSec || (video && Number.isFinite(video.duration) ? video.duration : null),
      tracks: player.tracks || [],
    };
  }

  function playerVideo() {
    return document.querySelector("#movie_player video") || document.querySelector("video.html5-main-video") || document.querySelector("video");
  }

  function isAd() {
    const player = document.getElementById("movie_player");
    return !!(player && player.classList.contains("ad-showing"));
  }

  function isOnScreen(video) {
    const rect = video.getBoundingClientRect();
    if (rect.width < 32 || rect.height < 32) return false;
    const visibleW = Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0);
    const visibleH = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
    return visibleW > rect.width * 0.5 && visibleH > rect.height * 0.5;
  }

  function videoRect(video) {
    const rect = video.getBoundingClientRect();
    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      vw: window.innerWidth,
      vh: window.innerHeight,
    };
  }

  function canReadFrames(video) {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 8;
      canvas.height = 8;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, 8, 8);
      ctx.getImageData(0, 0, 1, 1);
      return true;
    } catch (error) {
      return false;
    }
  }

  function applyState(state) {
    session.coveredRanges = state.coveredRanges || [];
    session.frames = state.frames || [];
    session.lastSampleTime = state.lastSampleTime == null ? null : state.lastSampleTime;
    session.lastCaptionCueStart = state.lastCaptionCueStart == null ? null : state.lastCaptionCueStart;
    if (state.videoId) session.videoId = state.videoId;
  }

  async function startCapture(state) {
    const info = await pageInfo();
    if (!info.videoId) return { ok: false, error: "Open a YouTube video." };
    applyState(state);
    session.videoId = info.videoId;
    session.capturing = true;
    session.lastT = null;
    session.lastLuma = null;
    await waitForVideo();
    loadTranscripts(info.tracks);
    const video = playerVideo();
    session.path = video && canReadFrames(video) ? "in-page" : "tab-capture";
    session.audioPath = session.path === "in-page" && localAudioAvailable(video) ? "in-page" : "tab-capture";
    chrome.runtime.sendMessage({
      type: "capture-started",
      videoId: info.videoId,
      capturePath: session.path,
      audioPath: session.audioPath,
      meta: info,
    });
    schedule();
    return { ok: true, capturePath: session.path, audioPath: session.audioPath };
  }

  function localAudioAvailable(video) {
    try {
      if (typeof video.captureStream !== "function") return false;
      const stream = video.captureStream();
      const ok = stream.getAudioTracks().length > 0;
      stream.getTracks().forEach((track) => track.stop());
      return ok;
    } catch (error) {
      return false;
    }
  }

  function waitForVideo() {
    return new Promise((resolve) => {
      const started = Date.now();
      const timer = setInterval(() => {
        const video = playerVideo();
        if ((video && video.readyState >= 2) || Date.now() - started > 8000) {
          clearInterval(timer);
          resolve();
        }
      }, 200);
    });
  }

  async function loadTranscripts(tracks) {
    const started = Date.now();
    let parsed = [];
    let note = "";
    while (session.capturing && Date.now() - started < 25000) {
      let available = tracks;
      if (!available || !available.length) {
        const info = await pageInfo();
        available = info.tracks || [];
      }
      const reply = await askPage("fetch-tracks", { tracks: available }, 20000);
      note = (reply && reply.note) || note;
      parsed = ((reply && reply.tracks) || [])
        .map((track) => ({
          language: track.language,
          kind: track.kind,
          segments: Transcripts.parseTimedText(track.payload),
        }))
        .filter((track) => track.segments.length);
      if (parsed.length) break;
      tracks = null;
      await delay(1000);
    }
    const preferred = Transcripts.chooseTranscript(parsed, navigator.language);
    session.segments = preferred ? preferred.segments : [];
    if (!parsed.length || !session.videoId) {
      if (note) chrome.runtime.sendMessage({ type: "capture-error", message: note });
      return;
    }
    chrome.runtime.sendMessage({
      type: "transcripts",
      videoId: session.videoId,
      tracks: parsed,
    });
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function stopCapture() {
    session.capturing = false;
    if (session.timer) clearTimeout(session.timer);
    session.timer = null;
    await closeAudio(session.lastT);
  }

  function schedule() {
    if (!session.capturing) return;
    session.timer = setTimeout(tick, 100);
  }

  async function tick() {
    if (!session.capturing) return;
    if (session.busy) {
      schedule();
      return;
    }
    session.busy = true;
    try {
      await step();
    } catch (error) {
      chrome.runtime.sendMessage({ type: "capture-error", message: String(error && error.message ? error.message : error) });
    } finally {
      session.busy = false;
      schedule();
    }
  }

  async function onNavigate() {
    if (!session.capturing) return;
    const id = videoIdFromLocation();
    if (!id || id === session.videoId) return;
    await closeAudio(session.lastT);
    const response = await chrome.runtime.sendMessage({ type: "switch-video", videoId: id });
    session.lastLuma = null;
    session.lastT = null;
    session.lastCaptionCueStart = null;
    applyState((response && response.state) || { videoId: id, coveredRanges: [], frames: [] });
    const info = await pageInfo();
    await loadTranscripts(info.tracks);
  }

  async function step() {
    const id = videoIdFromLocation();
    if (id && session.videoId && id !== session.videoId) {
      await onNavigate();
      return;
    }
    const video = playerVideo();
    if (!video) return;
    const t = video.currentTime;
    const playing = !video.paused && !video.ended && !isAd() && video.readyState >= 2;
    const jumped = session.lastT != null && Math.abs(t - session.lastT) > 1.25;
    if (jumped && session.openAudio) await closeAudio(session.lastT);
    const covered = Resume.isCovered(t, session.coveredRanges);
    if (playing && !covered) {
      if (!session.openAudio) await openAudio(video, t);
      else session.openAudio.mediaEnd = t;
      if (isOnScreen(video)) await maybeFrame(video, t);
      if (session.openAudio && t - session.openAudio.mediaStart >= 15) {
        await closeAudio(t);
        if (session.capturing && !Resume.isCovered(t, session.coveredRanges)) await openAudio(video, t);
      }
    } else if (session.openAudio) {
      await closeAudio(playing ? t : session.lastT == null ? t : session.lastT);
    }
    if (Number.isFinite(t)) session.lastT = t;
  }

  async function maybeFrame(video, t) {
    const cue = Transcripts.cueAt(session.segments, t);
    let diff = 1;
    if (session.path === "in-page") {
      const sample = lumaDiff(video, session.lastLuma);
      session.pendingLuma = sample.luma;
      diff = sample.diff;
    } else {
      const response = await chrome.runtime.sendMessage({
        type: "fallback-diff",
        rect: videoRect(video),
      });
      diff = response && Number.isFinite(response.diff) ? response.diff : 1;
    }
    const decision = SamplePolicy.decide(session, {
      t,
      diff,
      captionCueStart: cue,
      playing: true,
    });
    if (!decision.save) return;
    const file = frameFileName(t);
    const replaceFile =
      decision.replaceIndex == null ? null : session.frames[decision.replaceIndex].file;
    const bytes = await grabFrame(video);
    if (typeof bytes !== "string" || !bytes) return;
    const saved = await chrome.runtime.sendMessage({
      type: "frame",
      videoId: session.videoId,
      t,
      reason: decision.reason,
      changeScore: decision.changeScore,
      file,
      replaceFile,
      bytes,
    });
    if (!saved || saved.ok === false) return;
    if (replaceFile) session.frames = session.frames.filter((frame) => frame.file !== replaceFile);
    session.frames.push({
      t,
      reason: decision.reason,
      changeScore: decision.changeScore,
      file,
    });
    session.frames.sort((a, b) => a.t - b.t);
    session.lastSampleTime = t;
    if (cue != null) session.lastCaptionCueStart = cue;
    if (session.path === "in-page") session.lastLuma = session.pendingLuma;
  }

  function frameFileName(t) {
    const [whole, frac] = Math.max(0, t).toFixed(3).split(".");
    return `frames/${whole.padStart(5, "0")}.${frac}.jpg`;
  }

  async function grabFrame(video) {
    if (session.path === "in-page") {
      const blob = await jpegFromVideo(video);
      return blob ? Bytes.encodeBytes(await blob.arrayBuffer()) : null;
    }
    const response = await chrome.runtime.sendMessage({
      type: "fallback-jpeg",
      rect: videoRect(video),
    });
    return response && response.bytes ? response.bytes : null;
  }

  function jpegFromVideo(video) {
    const maxSide = 1280;
    const width = video.videoWidth || 0;
    const height = video.videoHeight || 0;
    if (!width || !height) return Promise.resolve(null);
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.7));
  }

  function lumaDiff(video, previous) {
    const width = 64;
    const height = 36;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, width, height);
    const data = ctx.getImageData(0, 0, width, height).data;
    const luma = new Float32Array(width * height);
    for (let i = 0; i < luma.length; i += 1) {
      const offset = i * 4;
      luma[i] = (0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2]) / 255;
    }
    if (!previous || previous.length !== luma.length) return { luma, diff: 1 };
    let sum = 0;
    for (let i = 0; i < luma.length; i += 1) sum += Math.abs(luma[i] - previous[i]);
    return { luma, diff: sum / luma.length };
  }

  async function openAudio(video, t) {
    if (session.audioPath === "tab-capture") {
      const response = await chrome.runtime.sendMessage({ type: "audio-begin", mediaStart: t });
      if (!response || response.ok === false) return;
      session.openAudio = { mediaStart: t, mediaEnd: t, remote: true };
      return;
    }
    const local = startLocalRecorder(video);
    if (!local) {
      session.audioPath = "tab-capture";
      session.openAudio = { mediaStart: t, mediaEnd: t, remote: true };
      await chrome.runtime.sendMessage({ type: "enable-tab-audio" });
      chrome.runtime.sendMessage({ type: "audio-begin", mediaStart: t });
      return;
    }
    session.openAudio = {
      mediaStart: t,
      mediaEnd: t,
      remote: false,
      recorder: local.recorder,
      chunks: local.chunks,
      stream: local.stream,
    };
  }

  function startLocalRecorder(video) {
    try {
      const stream = video.captureStream();
      const tracks = stream.getAudioTracks();
      stream.getVideoTracks().forEach((track) => track.stop());
      if (!tracks.length) {
        tracks.forEach((track) => track.stop());
        return null;
      }
      const audioStream = new MediaStream(tracks);
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(audioStream, { mimeType });
      const chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size) chunks.push(event.data);
      };
      recorder.start();
      return { recorder, chunks, stream };
    } catch (error) {
      return null;
    }
  }

  async function closeAudio(end) {
    const open = session.openAudio;
    if (!open) return;
    session.openAudio = null;
    const mediaEnd = Math.max(open.mediaStart, Number.isFinite(end) ? end : open.mediaEnd);
    if (mediaEnd - open.mediaStart < 0.3) {
      if (open.remote) chrome.runtime.sendMessage({ type: "audio-cancel" });
      else discardLocal(open);
      return;
    }
    let ok = false;
    if (open.remote) {
      const response = await chrome.runtime.sendMessage({
        type: "audio-end",
        videoId: session.videoId,
        mediaStart: open.mediaStart,
        mediaEnd,
      });
      ok = !!(response && response.ok);
    } else {
      const blob = await finishLocal(open);
      if (blob && blob.size) {
        const response = await chrome.runtime.sendMessage({
          type: "audio-segment",
          videoId: session.videoId,
          mediaStart: open.mediaStart,
          mediaEnd,
          bytes: Bytes.encodeBytes(await blob.arrayBuffer()),
        });
        ok = !!(response && response.ok);
      }
      discardLocal(open);
    }
    if (ok) session.coveredRanges = Resume.addCoverage(session.coveredRanges, open.mediaStart, mediaEnd);
  }

  function finishLocal(open) {
    return new Promise((resolve) => {
      const recorder = open.recorder;
      if (!recorder || recorder.state === "inactive") {
        resolve(new Blob(open.chunks, { type: "audio/webm" }));
        return;
      }
      recorder.onstop = () => resolve(new Blob(open.chunks, { type: recorder.mimeType || "audio/webm" }));
      recorder.stop();
    });
  }

  function discardLocal(open) {
    try {
      if (open.recorder && open.recorder.state !== "inactive") open.recorder.stop();
    } catch (error) {
      /* already stopped */
    }
    if (open.stream) open.stream.getTracks().forEach((track) => track.stop());
  }
})();
