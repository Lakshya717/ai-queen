(function () {
  const pageEl = document.getElementById("page");
  const folderEl = document.getElementById("folder");
  const titleEl = document.getElementById("title");
  const progressEl = document.getElementById("progress");
  const countsEl = document.getElementById("counts");
  const errorEl = document.getElementById("error");
  const chooseBtn = document.getElementById("choose");
  const allowBtn = document.getElementById("allow");
  const startBtn = document.getElementById("start");
  const stopBtn = document.getElementById("stop");

  let tabId = null;
  let videoId = null;

  chooseBtn.addEventListener("click", () => {
    chooseFolder().catch(showError);
  });
  allowBtn.addEventListener("click", () => {
    allowFolder().catch(showError);
  });
  startBtn.addEventListener("click", onStart);
  stopBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "stop" }).then(refresh).catch(showError);
  });

  refresh().catch(showError);
  setInterval(() => refresh().catch(() => {}), 700);

  async function refresh() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab ? tab.id : null;
    videoId = tab ? videoIdFromUrl(tab.url) : null;
    pageEl.textContent = videoId
      ? `Video ${videoId}`
      : "Open a YouTube watch page to capture.";
    const status = videoId
      ? await chrome.runtime.sendMessage({ type: "get-status", videoId })
      : await chrome.runtime.sendMessage({ type: "get-status" });
    folderEl.textContent = status.folderName ? status.folderName : "No folder selected";
    allowBtn.hidden = !status.folderName || status.folderReady;
    titleEl.textContent = status.title || "";
    const covered = formatSeconds(status.coveredSec || 0);
    const duration = status.durationSec ? formatSeconds(status.durationSec) : "unknown length";
    progressEl.textContent = status.continuing
      ? `Continuing ${status.videoId || videoId}. Covered ${covered} of ${duration}.`
      : `Covered ${covered} of ${duration}.`;
    countsEl.textContent = `${status.frameCount || 0} frames, ${status.audioCount || 0} audio segments, ${status.transcriptCount || 0} caption tracks`;
    startBtn.disabled = !videoId || !status.folderReady || status.capturing;
    stopBtn.disabled = !status.capturing;
    if (status.error) showError(status.error);
    else hideError();
  }

  function onStart() {
    if (!tabId) return;
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
      const failed = chrome.runtime.lastError;
      chrome.runtime
        .sendMessage({ type: "start", tabId, streamId: failed ? null : streamId })
        .then(refresh)
        .catch(showError);
    });
  }

  async function chooseFolder() {
    const handle = await window.showDirectoryPicker({ mode: "readwrite", id: "yt-watch-capture" });
    await CaptureDb.setKv("root", handle);
    await chrome.runtime.sendMessage({ type: "folder-updated" });
    await refresh();
  }

  async function allowFolder() {
    const handle = await CaptureDb.getKv("root");
    if (!handle) return chooseFolder();
    const permission = await handle.requestPermission({ mode: "readwrite" });
    if (permission !== "granted") throw new Error("Folder access was not granted.");
    await chrome.runtime.sendMessage({ type: "folder-updated" });
    await refresh();
  }

  function videoIdFromUrl(url) {
    try {
      const parsed = new URL(url);
      if (!/^https:\/\/(www\.)?youtube\.com$/.test(parsed.origin)) return null;
      if (parsed.pathname === "/watch") {
        const id = parsed.searchParams.get("v");
        return /^[A-Za-z0-9_-]{11}$/.test(id || "") ? id : null;
      }
      const shorts = parsed.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{11})/);
      return shorts ? shorts[1] : null;
    } catch (error) {
      return null;
    }
  }

  function formatSeconds(total) {
    const seconds = Math.max(0, Math.floor(total));
    const minutes = Math.floor(seconds / 60);
    const remain = seconds % 60;
    return `${minutes}:${String(remain).padStart(2, "0")}`;
  }

  function showError(error) {
    errorEl.hidden = false;
    errorEl.textContent = error instanceof Error ? error.message : String(error);
  }

  function hideError() {
    errorEl.hidden = true;
    errorEl.textContent = "";
  }
})();
