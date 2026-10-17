# YouTube Watch Capture

Chrome extension that records a YouTube video while someone watches it, at their own pace, and stores the result as a folder an LLM can read. It does not download the full video file, seek ahead, or play faster than the viewer.

Each YouTube video id has one folder. Leaving midway already saves what was captured. Opening the same video days later appends only timeline that is not already in that folder.

## Install

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Choose **Load unpacked** and select this `extension` folder.
4. After any code change, click **Reload** on the extension card, then refresh the YouTube tab. The page script is injected when the tab loads, so a reload of the extension alone does not update an already open watch page.

## Use

1. Open the extension popup and choose a root folder. Chrome may ask again later if it drops permission; use **Allow folder access**.
2. Open a YouTube watch page. For captions, open the transcript panel (or leave **Show transcript** available in the description). The extension will click **Show transcript** if the panel is not already open.
3. Press **Start**. Playback continues at whatever speed you choose. Pauses are not stored as long silence. Seeks split the audio into separate files.
4. Press **Stop** to end the capture loop. Frames and finished audio segments are already on disk if you close the laptop before that.
5. The popup shows covered time against duration, frame count, audio segment count, and caption-track count. The toolbar badge shows the frame count.

**Send to API** is disabled. `src/lib/upload.js` exports `uploadBundle(endpoint, bundle)` and throws `Not implemented`. The manifest in the folder is the body a later upload should POST. There is no endpoint setting and no auth.

## What is captured

| Kind | When | File |
| --- | --- | --- |
| Frames | While the video is playing, on screen, and not an ad | `frames/00012.400.jpg` |
| Audio | While playback is in a stretch that is not already covered | `audio/seg-00012.400.webm` |
| Captions | Once per visit, from the open transcript panel or the player | `transcripts/{lang}-{manual\|asr}.json` |

Sample times use the player’s `currentTime`, so pauses, seeks, and playback rate stay aligned with the video. Ads (`#movie_player.ad-showing`) are skipped. If the video element is scrolled mostly off screen, frame grabs pause and audio continues while it is still playing.

Identity is the 11-character video id only. `watch`, Shorts, and playlist links for the same id share one folder. Query params such as `t`, `list`, and `si` are ignored.

## Folder layout

`{root}/{videoId}/`

- `manifest.json` — schema `yt-watch-capture/1`
- `frames/` — JPEG stills, longest side about 1280px, quality about 0.7
- `audio/` — one Opus WebM per continuous play stretch
- `transcripts/` — caption segments with a `watched` flag for lines that overlap covered time
- `llm-input.md` — rebuilt from the whole folder: watched transcript lines with the nearest frame filename

`manifest.json` fields:

- `video` — id, url, title, channel, `durationSec`
- `firstCaptureAt`, `lastCaptureAt`
- `capturePath` — `in-page` when the page video can be read, otherwise `tab-capture`
- `coveredRanges` — merged half-open intervals `[start, end)` of video time already saved
- `frames[]` — `t`, `reason` (`scene_change`, `max_gap`, or `caption_boundary`), `changeScore`, `file`
- `audio[]` — `file`, `mediaStart`, `mediaEnd`
- `transcripts[]` — `language`, `kind` (`manual` or `asr`), `file`, `segments`

Writes are incremental. Each new frame and each finished audio segment is stored as it happens, and `coveredRanges` is updated then. IndexedDB holds the same index so a visit can resume before the directory handle is re-authorized. Once the handle is available, the folder is the copy to keep.

The 240-frame cap is for the life of that folder. A later visit does not reset it. When the cap is hit, a later sample replaces the lowest-change frame within 15 seconds only when the new frame’s change score is clearly higher (at least 1.5× and at least 0.08 above the old score).

## Dynamic sample rate

`src/lib/sample-policy.js` decides whether to save a frame. A 64×36 luma diff runs about every 100ms while the video plays. A timestamp inside an already covered range is rejected before that diff.

A frame is saved when any of these is true:

- Visual change is at least **0.12**, and at least **0.5s** of video time has passed since the last saved frame.
- **10s** of video time has passed (static shots and talking heads).
- A new caption cue has started and at least **1s** has passed.

Hard caps: about **2 frames per second** of video time (the 0.5s minimum), and **240 frames** over the life of the video. A frame within **0.4s** of one already saved is skipped.

## Resume

Covered ranges are half-open, so playback can continue at the previous end. Rewatching the middle of a covered stretch adds nothing. Playback past the previous end, or in a gap that was never watched, is appended.

Audio is rotated about every 15 seconds of playback so a crash keeps all but the latest stretch. Segments shorter than 0.3s are discarded. Changing videos flushes the current folder and opens the folder for the new id.

## How frames and audio are read

On Start, the content script tries `drawImage` plus `getImageData` on the page `<video>`.

1. **In-page.** If the canvas is readable, frames come from the video element and audio comes from `video.captureStream()`. This is the real picture, without recommendations or controls.
2. **Tab capture.** If the canvas is tainted, an offscreen document consumes `chrome.tabCapture.getMediaStreamId`, crops to the video element’s viewport rect, and echoes the tab audio back to the speakers so Chrome does not mute the tab. The popup Start click is the user gesture Chrome requires before that call.

Bytes are sent from the page to the service worker as base64. Chrome’s extension messaging turned raw `ArrayBuffer`s into plain objects, and `new Blob([object])` wrote the 15-byte text `[object Object]` into every JPEG and WebM. `src/lib/bytes.js` encodes before send and decodes before write.

## How transcripts are read

YouTube’s `timedtext` URL often returns HTTP 200 with an empty body unless the request carries a Proof-of-Origin token that only the player creates. Fetching `captionTracks[].baseUrl` from the extension therefore saved nothing, and the popup reported that no transcript was found even while the transcript panel was open.

The panel that actually shows the lines is not `ytd-transcript-segment-renderer`. Playwright opened `https://www.youtube.com/watch?v=38uv47uXz8I`, clicked **Show transcript**, and found:

```html
<transcript-segment-view-model>
  <div class="ytwTranscriptSegmentViewModelTimestamp">0:01</div>
  <div class="ytwTranscriptSegmentViewModelTimestampA11yLabel">1 second</div>
  <span role="text">[संगीत]</span>
</transcript-segment-view-model>
```

The extension now reads those rows. It uses the timestamp div and the `span[role="text"]`, not the accessibility label. YouTube only mounts the visible rows, so the list is scrolled and the lines are merged. On that video the probe collected 61 lines, from `0:01 [संगीत]` through `7:10`.

Order of attempts:

1. The open transcript panel (component data, then the segment elements above, including shadow roots).
2. If the panel is closed, click **Show transcript** in `ytd-video-description-transcript-section-renderer` and read it.
3. Ask the player to load a caption track and keep any `timedtext` response the player itself fetches.
4. If there is still no manual transcript, request auto-generated captions (`kind: asr`, `vssId` starting with `a.`, or a name containing “auto-generated”).

A manual transcript is preferred for `llm-input.md` when one has segments. Auto-generated captions are used when it does not. Both can be stored; the filename is `transcripts/{lang}-manual.json` or `transcripts/{lang}-asr.json`.

Caption capture does not depend on covered ranges. Pressing Start on a video that already has frames still fetches the transcript.

## Architecture

```
popup  →  service worker  →  IndexedDB and the video folder
                ↑
         content script  →  sample policy, currentTime, canvas probe
                ↑
         page hook (main world)  →  player response and transcript panel
                ↓
         offscreen document  →  tab-capture fallback only
```

| File | Role |
| --- | --- |
| `manifest.json` | Manifest V3. Permissions: `tabCapture`, `offscreen`, `downloads`, `storage`. Host: `https://www.youtube.com/*`. |
| `src/background/service-worker.js` | Session, stream id, IndexedDB, folder writes, badge. |
| `src/content/content.js` | Watch page: time, rect, ads, sampling loop, in-page audio. |
| `src/inject/page-hook.js` | Main-world access to the player and the transcript panel. |
| `src/offscreen/offscreen.js` | Tab-capture crop, audio echo, and audio recording when the canvas is blocked. |
| `src/popup/` | Folder picker, Start, Stop, covered-time status, disabled API button. |
| `src/lib/sample-policy.js` | Frame decision. |
| `src/lib/resume.js` | Merge covered ranges and test whether a timestamp is already saved. |
| `src/lib/transcript.js` | Parse timed text, choose manual over auto-generated, flag watched lines. |
| `src/lib/bundle.js` | File names, manifest merge, `llm-input.md`. |
| `src/lib/bytes.js` | Base64 transport for JPEG and WebM bytes. |
| `src/lib/idb.js` | Extension IndexedDB: folder handle, manifests, pending blobs. |
| `src/lib/upload.js` | API upload stub. |

The service worker may sleep. Blobs live in IndexedDB. The offscreen document stays alive only while a tab-capture fallback is running. A port named `capture` from the content script keeps the worker awake during a session.

## Checks

Unit tests, from the `extension` folder:

```
node test/capture.test.js
```

They cover the sample policy (covered timestamps, scene change, max gap, caption boundary, frame cap), range merge, timed-text parsing, manual-over-ASR selection, the zip-free manifest merge, byte encode/decode, and the upload stub.

Playwright probe, from the repo root, against a live watch page:

```
node tests/probe-transcript.js
```

That script launches Chromium, opens the Rahgir watch page, clicks **Show transcript**, and prints how many `transcript-segment-view-model` rows it can scroll through. It is a DOM probe, not the extension test. The extension itself cannot run inside headless Playwright without a persistent Chrome profile and `--load-extension`.

## Limits

- Capture follows the viewer. It does not pre-sample the rest of the video.
- A video with no transcript panel and no player caption track stays at 0 caption tracks.
- The transcript list is virtualized. Collection scrolls the open panel; if YouTube does not mount a row, that line is missing.
- Tab capture needs a fresh Start click because Chrome ties `getMediaStreamId` to a user gesture.
- API upload is not implemented.
