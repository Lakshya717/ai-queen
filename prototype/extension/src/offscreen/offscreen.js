(function () {
  let mediaStream = null;
  let preview = null;
  let audioContext = null;
  let recorder = null;
  let chunks = [];
  let lastLuma = null;
  let segmentStart = null;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.target !== "offscreen") return;
    handle(message).then(sendResponse, (error) => {
      sendResponse({ ok: false, error: String(error && error.message ? error.message : error) });
    });
    return true;
  });

  async function handle(message) {
    if (message.type === "start-tab-capture") {
      await startTabCapture(message.streamId);
      return { ok: true };
    }
    if (message.type === "stop-tab-capture") {
      await stopTabCapture();
      return { ok: true };
    }
    if (message.type === "diff") {
      return { diff: diffScore(message.rect) };
    }
    if (message.type === "jpeg") {
      const bytes = await jpegBytes(message.rect);
      if (bytes) lastLuma = lumaFromPreview(message.rect).luma;
      return { bytes: bytes ? Bytes.encodeBytes(bytes) : null };
    }
    if (message.type === "audio-begin") {
      beginAudio(message.mediaStart);
      return { ok: true };
    }
    if (message.type === "audio-end") {
      const blob = await endAudio();
      if (!blob || !blob.size) return { ok: false };
      return { ok: true, bytes: Bytes.encodeBytes(await blob.arrayBuffer()) };
    }
    if (message.type === "audio-cancel") {
      cancelAudio();
      return { ok: true };
    }
    return { ok: false };
  }

  async function startTabCapture(streamId) {
    if (mediaStream) await stopTabCapture();
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
        },
      },
      video: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
        },
      },
    });
    preview = document.createElement("video");
    preview.srcObject = mediaStream;
    preview.muted = true;
    await preview.play();
    audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(new MediaStream(mediaStream.getAudioTracks()));
    source.connect(audioContext.destination);
    if (audioContext.state === "suspended") await audioContext.resume();
    lastLuma = null;
  }

  async function stopTabCapture() {
    cancelAudio();
    if (preview) {
      preview.pause();
      preview.srcObject = null;
      preview = null;
    }
    if (audioContext) {
      await audioContext.close();
      audioContext = null;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }
    lastLuma = null;
  }

  function crop(rect) {
    const videoWidth = preview ? preview.videoWidth : 0;
    const videoHeight = preview ? preview.videoHeight : 0;
    if (!videoWidth || !videoHeight) return null;
    if (!rect || !rect.width || !rect.height) {
      return { sx: 0, sy: 0, sw: videoWidth, sh: videoHeight };
    }
    const scaleX = videoWidth / (rect.vw || window.innerWidth || videoWidth);
    const scaleY = videoHeight / (rect.vh || window.innerHeight || videoHeight);
    const sx = clamp(rect.x * scaleX, 0, videoWidth - 1);
    const sy = clamp(rect.y * scaleY, 0, videoHeight - 1);
    const sw = clamp(rect.width * scaleX, 1, videoWidth - sx);
    const sh = clamp(rect.height * scaleY, 1, videoHeight - sy);
    return { sx, sy, sw, sh };
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function lumaFromPreview(rect) {
    const region = crop(rect);
    const luma = new Float32Array(64 * 36);
    if (!region || !preview) return { luma, diff: 1 };
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 36;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(preview, region.sx, region.sy, region.sw, region.sh, 0, 0, 64, 36);
    const data = ctx.getImageData(0, 0, 64, 36).data;
    for (let i = 0; i < luma.length; i += 1) {
      const offset = i * 4;
      luma[i] = (0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2]) / 255;
    }
    if (!lastLuma || lastLuma.length !== luma.length) return { luma, diff: 1 };
    let sum = 0;
    for (let i = 0; i < luma.length; i += 1) sum += Math.abs(luma[i] - lastLuma[i]);
    return { luma, diff: sum / luma.length };
  }

  function diffScore(rect) {
    if (!preview) return 1;
    return lumaFromPreview(rect).diff;
  }

  function jpegBytes(rect) {
    const region = crop(rect);
    if (!region || !preview) return Promise.resolve(null);
    const maxSide = 1280;
    const scale = Math.min(1, maxSide / Math.max(region.sw, region.sh));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(region.sw * scale));
    canvas.height = Math.max(1, Math.round(region.sh * scale));
    canvas.getContext("2d").drawImage(
      preview,
      region.sx,
      region.sy,
      region.sw,
      region.sh,
      0,
      0,
      canvas.width,
      canvas.height
    );
    return new Promise((resolve) => {
      canvas.toBlob(async (blob) => {
        resolve(blob ? blob.arrayBuffer() : null);
      }, "image/jpeg", 0.7);
    });
  }

  function beginAudio(mediaStart) {
    if (!mediaStream) return;
    cancelAudio();
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
    recorder = new MediaRecorder(new MediaStream(mediaStream.getAudioTracks()), { mimeType });
    chunks = [];
    segmentStart = mediaStart;
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size) chunks.push(event.data);
    };
    recorder.start();
  }

  function endAudio() {
    const active = recorder;
    const localChunks = chunks;
    recorder = null;
    chunks = [];
    segmentStart = null;
    if (!active) return Promise.resolve(null);
    return new Promise((resolve) => {
      active.onstop = () => resolve(new Blob(localChunks, { type: active.mimeType || "audio/webm" }));
      if (active.state === "inactive") {
        resolve(new Blob(localChunks, { type: "audio/webm" }));
        return;
      }
      active.stop();
    });
  }

  function cancelAudio() {
    const active = recorder;
    recorder = null;
    chunks = [];
    segmentStart = null;
    if (active && active.state !== "inactive") {
      active.onstop = null;
      active.stop();
    }
  }
})();
