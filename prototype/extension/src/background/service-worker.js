importScripts(
  "../lib/bytes.js",
  "../lib/resume.js",
  "../lib/transcript.js",
  "../lib/bundle.js",
  "../lib/upload.js",
  "../lib/idb.js"
);

const live = {
  tabId: null,
  videoId: null,
  capturing: false,
  streamId: null,
  manifest: null,
  error: null,
  capturePath: null,
  audioPath: null,
  tabAudioOn: false,
};

let chain = Promise.resolve();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "capture") return;
  port.onDisconnect.addListener(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target === "offscreen") return;
  handle(message, sender)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });
  return true;
});

chrome.storage.session.get("live").then(({ live: stored }) => {
  if (!stored || !stored.capturing) return;
  live.tabId = stored.tabId;
  live.videoId = stored.videoId;
  live.capturing = true;
  enqueue(() => ensureManifest(stored.videoId, {})).catch(() => {});
});

async function handle(message, sender) {
  if (message.type === "get-status") return statusFor(message.videoId);
  if (message.type === "folder-updated") {
    if (live.videoId) await enqueue(() => flushPending(live.videoId));
    return { ok: true };
  }
  if (message.type === "start") return start(message);
  if (message.type === "stop") return stop();
  if (message.type === "capture-started") return onCaptureStarted(message);
  if (message.type === "enable-tab-audio") return enableTabAudio();
  if (message.type === "fallback-diff") return fallbackDiff(message.rect);
  if (message.type === "fallback-jpeg") return fallbackJpeg(message.rect);
  if (message.type === "frame") return enqueue(() => saveFrame(message));
  if (message.type === "audio-begin") return audioBegin(message.mediaStart);
  if (message.type === "audio-end") return audioEnd(message);
  if (message.type === "audio-cancel") return audioCancel();
  if (message.type === "audio-segment") return enqueue(() => saveAudio(message));
  if (message.type === "transcripts") return enqueue(() => saveTranscripts(message));
  if (message.type === "switch-video") return switchVideo(message.videoId, sender);
  if (message.type === "capture-error") {
    live.error = message.message;
    return { ok: true };
  }
  return { ok: false };
}

function enqueue(task) {
  const run = chain.then(task, task);
  chain = run.then(
    () => {},
    () => {}
  );
  return run;
}

async function persistLive() {
  await chrome.storage.session.set({
    live: {
      tabId: live.tabId,
      videoId: live.videoId,
      capturing: live.capturing,
    },
  });
}

async function start(message) {
  live.tabId = message.tabId;
  live.streamId = message.streamId || null;
  live.error = null;
  live.tabAudioOn = false;
  const info = await chrome.tabs.sendMessage(message.tabId, { type: "get-page-info" });
  if (!info || !info.videoId) throw new Error("Open a YouTube video.");
  await enqueue(() => ensureManifest(info.videoId, info));
  live.videoId = info.videoId;
  live.capturing = true;
  await persistLive();
  const state = policyState();
  const started = await chrome.tabs.sendMessage(message.tabId, { type: "start-capture", state });
  if (!started || started.ok === false) throw new Error((started && started.error) || "Could not start capture.");
  return { ok: true };
}

async function stop() {
  const tabId = live.tabId;
  live.capturing = false;
  await persistLive();
  if (tabId) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: "stop-capture" });
    } catch (error) {
      /* tab already closed */
    }
  }
  await audioCancel();
  if (live.tabAudioOn) {
    await sendOffscreen({ type: "stop-tab-capture" });
    live.tabAudioOn = false;
  }
  await closeOffscreen();
  if (live.videoId) await enqueue(() => writeDerived(live.videoId));
  updateBadge();
  return { ok: true };
}

async function onCaptureStarted(message) {
  live.capturePath = message.capturePath;
  live.audioPath = message.audioPath;
  if (live.manifest) {
    live.manifest.capturePath = message.capturePath;
    if (message.meta) applyMeta(live.manifest, message.meta);
  }
  if (message.audioPath === "tab-capture" || message.capturePath === "tab-capture") {
    await enableTabAudio();
  }
  if (live.videoId) await enqueue(() => writeDerived(live.videoId));
  return { ok: true };
}

let tabAudioPromise = null;

async function enableTabAudio() {
  if (live.tabAudioOn) return { ok: true };
  if (tabAudioPromise) return tabAudioPromise;
  tabAudioPromise = startTabAudio().finally(() => {
    tabAudioPromise = null;
  });
  return tabAudioPromise;
}

async function startTabAudio() {
  if (live.tabAudioOn) return { ok: true };
  if (!live.streamId) {
    live.error = "Tab audio needs another click on Start.";
    return { ok: false, error: live.error };
  }
  await ensureOffscreen();
  const response = await sendOffscreen({ type: "start-tab-capture", streamId: live.streamId });
  if (!response || response.ok === false) {
    live.error = (response && response.error) || "Tab capture failed.";
    return { ok: false, error: live.error };
  }
  live.tabAudioOn = true;
  return { ok: true };
}

async function fallbackDiff(rect) {
  if (!live.tabAudioOn) await enableTabAudio();
  const response = await sendOffscreen({ type: "diff", rect });
  return { diff: response && Number.isFinite(response.diff) ? response.diff : 1 };
}

async function fallbackJpeg(rect) {
  if (!live.tabAudioOn) await enableTabAudio();
  const response = await sendOffscreen({ type: "jpeg", rect });
  return { bytes: response ? response.bytes : null };
}

async function audioBegin(mediaStart) {
  if (live.audioPath === "in-page") return { ok: true };
  if (!live.tabAudioOn) await enableTabAudio();
  if (!live.tabAudioOn) return { ok: false, error: live.error || "Tab audio is not running." };
  return sendOffscreen({ type: "audio-begin", mediaStart });
}

async function audioEnd(message) {
  const response = await sendOffscreen({ type: "audio-end" });
  if (!response || !response.ok || !response.bytes) return { ok: false };
  await enqueue(() =>
    saveAudio({
      videoId: message.videoId || live.videoId,
      mediaStart: message.mediaStart,
      mediaEnd: message.mediaEnd,
      bytes: response.bytes,
    })
  );
  return { ok: true };
}

async function audioCancel() {
  if (!live.tabAudioOn) return { ok: true };
  return sendOffscreen({ type: "audio-cancel" });
}

async function switchVideo(videoId, sender) {
  const previous = live.videoId;
  if (previous) await enqueue(() => writeDerived(previous));
  const tabId = (sender && sender.tab && sender.tab.id) || live.tabId;
  let meta = {};
  if (tabId) {
    try {
      meta = await chrome.tabs.sendMessage(tabId, { type: "get-page-info" });
    } catch (error) {
      meta = { videoId };
    }
  }
  await enqueue(() => ensureManifest(videoId, meta || { videoId }));
  live.videoId = videoId;
  live.capturing = true;
  await persistLive();
  updateBadge();
  return { ok: true, state: policyState() };
}

function policyState() {
  const frames = (live.manifest && live.manifest.frames) || [];
  const last = frames.length ? frames[frames.length - 1].t : null;
  return {
    videoId: live.videoId,
    coveredRanges: (live.manifest && live.manifest.coveredRanges) || [],
    frames,
    lastSampleTime: last,
  };
}

async function ensureManifest(videoId, meta) {
  const merged = await readMerged(videoId);
  live.manifest = merged || Bundle.emptyManifest({ id: videoId });
  live.videoId = videoId;
  applyMeta(live.manifest, meta);
  await storeManifest(videoId, live.manifest);
  await writeDerived(videoId);
}

function applyMeta(manifest, meta) {
  if (!meta) return;
  if (meta.url) manifest.video.url = meta.url;
  if (meta.title) manifest.video.title = meta.title;
  if (meta.channel) manifest.video.channel = meta.channel;
  if (Number.isFinite(meta.durationSec)) manifest.video.durationSec = meta.durationSec;
}

async function saveFrame(message) {
  const manifest = await manifestFor(message.videoId);
  if (message.replaceFile) {
    manifest.frames = manifest.frames.filter((frame) => frame.file !== message.replaceFile);
    await removeRelative(message.videoId, message.replaceFile);
  }
  manifest.frames = manifest.frames.filter((frame) => frame.file !== message.file);
  manifest.frames.push({
    t: message.t,
    reason: message.reason,
    changeScore: message.changeScore,
    file: message.file,
  });
  manifest.frames.sort((a, b) => a.t - b.t);
  touch(manifest);
  const blob = new Blob([Bytes.decodeBytes(message.bytes)], { type: "image/jpeg" });
  await CaptureDb.putBlob(message.videoId, message.file, blob);
  await storeManifest(message.videoId, manifest, [message.file]);
  await flushPending(message.videoId);
  updateBadge();
  return { ok: true };
}

async function saveAudio(message) {
  const manifest = await manifestFor(message.videoId);
  const file = Bundle.audioFileName(message.mediaStart);
  manifest.audio = manifest.audio.filter((segment) => segment.file !== file);
  manifest.audio.push({
    file,
    mediaStart: message.mediaStart,
    mediaEnd: message.mediaEnd,
  });
  manifest.audio.sort((a, b) => a.mediaStart - b.mediaStart);
  manifest.coveredRanges = Resume.addCoverage(manifest.coveredRanges, message.mediaStart, message.mediaEnd);
  touch(manifest);
  const blob = new Blob([Bytes.decodeBytes(message.bytes)], { type: "audio/webm" });
  await CaptureDb.putBlob(message.videoId, file, blob);
  await storeManifest(message.videoId, manifest, [file]);
  await flushPending(message.videoId);
  return { ok: true };
}

async function saveTranscripts(message) {
  const manifest = await manifestFor(message.videoId);
  const ranges = manifest.coveredRanges || [];
  for (const track of message.tracks || []) {
    const file = Transcripts.transcriptFileName(track.language, track.kind);
    if (!track.segments || !track.segments.length) continue;
    const segments = Transcripts.flagWatched(track.segments, ranges);
    const existing = manifest.transcripts.find((item) => item.file === file);
    if (existing && (existing.segments || []).length > segments.length) continue;
    manifest.transcripts = manifest.transcripts.filter((item) => item.file !== file);
    manifest.transcripts.push({
      language: track.language,
      kind: track.kind,
      file,
      segments,
    });
    const body = JSON.stringify({ language: track.language, kind: track.kind, segments }, null, 2);
    const blob = new Blob([body], { type: "application/json" });
    await CaptureDb.putBlob(message.videoId, file, blob);
    await storeManifest(message.videoId, manifest, [file]);
  }
  touch(manifest);
  await storeManifest(message.videoId, manifest);
  await flushPending(message.videoId);
  return { ok: true };
}

async function manifestFor(videoId) {
  if (live.manifest && live.videoId === videoId) return live.manifest;
  await ensureManifest(videoId, { videoId });
  return live.manifest;
}

function touch(manifest) {
  const now = new Date().toISOString();
  if (!manifest.firstCaptureAt) manifest.firstCaptureAt = now;
  manifest.lastCaptureAt = now;
}

async function storeManifest(videoId, manifest, extraPending) {
  const existing = await CaptureDb.getVideo(videoId);
  const pending = new Set((existing && existing.pending) || []);
  for (const file of extraPending || []) pending.add(file);
  await CaptureDb.putVideo({ videoId, manifest, pending: [...pending] });
}

async function flushPending(videoId) {
  const record = await CaptureDb.getVideo(videoId);
  if (!record) return;
  const handle = await writableRoot();
  if (!handle) return;
  for (const file of record.pending || []) {
    const blob = await CaptureDb.getBlob(videoId, file);
    if (!blob) continue;
    await writeRelative(handle, videoId, file, blob);
    await CaptureDb.deleteBlob(videoId, file);
  }
  record.pending = [];
  record.manifest = live.videoId === videoId ? live.manifest : record.manifest;
  await CaptureDb.putVideo(record);
  await writeDerived(videoId);
}

async function writeDerived(videoId) {
  const manifest = live.videoId === videoId ? live.manifest : (await CaptureDb.getVideo(videoId) || {}).manifest;
  if (!manifest) return;
  const handle = await writableRoot();
  await storeManifest(videoId, manifest);
  if (!handle) return;
  const copy = JSON.parse(JSON.stringify(manifest));
  for (const track of copy.transcripts || []) {
    if (track.segments) track.segments = Transcripts.flagWatched(track.segments, copy.coveredRanges);
  }
  const language = copy.transcripts[0] ? copy.transcripts[0].language : "en";
  await writeRelative(handle, videoId, "manifest.json", JSON.stringify(copy, null, 2));
  await writeRelative(handle, videoId, "llm-input.md", Bundle.renderLlmInput(copy, language));
  for (const track of copy.transcripts || []) {
    await writeRelative(
      handle,
      videoId,
      track.file,
      JSON.stringify(
        { language: track.language, kind: track.kind, segments: track.segments },
        null,
        2
      )
    );
  }
}

async function readMerged(videoId) {
  const stored = await CaptureDb.getVideo(videoId);
  const fromFolder = await readFolderManifest(videoId);
  return Bundle.mergeManifests(fromFolder, stored && stored.manifest);
}

async function readFolderManifest(videoId) {
  const handle = await writableRoot();
  if (!handle) return null;
  try {
    const dir = await handle.getDirectoryHandle(videoId);
    const fileHandle = await dir.getFileHandle("manifest.json");
    const file = await fileHandle.getFile();
    return JSON.parse(await file.text());
  } catch (error) {
    return null;
  }
}

async function writableRoot() {
  const handle = await CaptureDb.getKv("root");
  if (!handle || !handle.queryPermission) return null;
  const permission = await handle.queryPermission({ mode: "readwrite" });
  if (permission !== "granted") return null;
  return handle;
}

async function writeRelative(root, videoId, relativePath, data) {
  const parts = relativePath.split("/");
  let dir = await root.getDirectoryHandle(videoId, { create: true });
  for (let i = 0; i < parts.length - 1; i += 1) {
    dir = await dir.getDirectoryHandle(parts[i], { create: true });
  }
  const fileHandle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(data);
  await writable.close();
}

async function removeRelative(videoId, relativePath) {
  const root = await writableRoot();
  if (!root) return;
  try {
    const parts = relativePath.split("/");
    let dir = await root.getDirectoryHandle(videoId);
    for (let i = 0; i < parts.length - 1; i += 1) {
      dir = await dir.getDirectoryHandle(parts[i]);
    }
    await dir.removeEntry(parts[parts.length - 1]);
  } catch (error) {
    /* already gone */
  }
}

async function statusFor(videoId) {
  let manifest = live.manifest && live.videoId === videoId ? live.manifest : null;
  if (!manifest && videoId) manifest = await readMerged(videoId);
  const folder = await folderInfo();
  const frames = manifest && manifest.frames ? manifest.frames.length : 0;
  return {
    capturing: live.capturing && live.videoId === videoId,
    videoId: videoId || live.videoId,
    title: manifest && manifest.video ? manifest.video.title : "",
    coveredSec: manifest ? Resume.coveredSeconds(manifest.coveredRanges) : 0,
    durationSec: manifest && manifest.video ? manifest.video.durationSec : null,
    frameCount: frames,
    audioCount: manifest && manifest.audio ? manifest.audio.length : 0,
    transcriptCount: manifest && manifest.transcripts ? manifest.transcripts.length : 0,
    folderReady: folder.ready,
    folderName: folder.name,
    continuing: !!(manifest && ((manifest.frames && manifest.frames.length) || (manifest.coveredRanges && manifest.coveredRanges.length))),
    error: live.error,
    capturePath: (manifest && manifest.capturePath) || live.capturePath,
  };
}

async function folderInfo() {
  const handle = await CaptureDb.getKv("root");
  if (!handle) return { ready: false, name: "" };
  const permission = await handle.queryPermission({ mode: "readwrite" });
  return { ready: permission === "granted", name: handle.name || "folder" };
}

function updateBadge() {
  const count = live.manifest && live.manifest.frames ? live.manifest.frames.length : 0;
  const text = count ? String(Math.min(count, 999)) : "";
  if (!live.tabId) return;
  chrome.action.setBadgeBackgroundColor({ color: "#9a3412", tabId: live.tabId });
  chrome.action.setBadgeText({ text, tabId: live.tabId });
}

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (contexts.length) return;
  await chrome.offscreen.createDocument({
    url: "src/offscreen/offscreen.html",
    reasons: ["USER_MEDIA", "AUDIO_PLAYBACK"],
    justification: "Capture tab audio and cropped video frames when the YouTube player cannot be read directly.",
  });
}

async function closeOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (!contexts.length) return;
  await chrome.offscreen.closeDocument();
}

function sendOffscreen(message) {
  return chrome.runtime.sendMessage(Object.assign({ target: "offscreen" }, message));
}
