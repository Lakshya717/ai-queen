# YouTube AI-Content Detection Extension --- Revised Scope

**Purpose:** Implementation specification for an agentic AI worker
building the Chrome extension only.\
**Platform:** Google Chrome desktop, Manifest V3, YouTube.\
**Scope principle:** Preserve the original product: crowdsourced
evidence collection, backend inference, shared cached scores, and
optional filtering. This document changes the contribution model to
match the required active-watching and segment-coverage behavior.

------------------------------------------------------------------------

## 1. Functional requirements --- authoritative

The implementation MUST follow these requirements:

1.  **Collect only while the user is actively watching the video.** No
    background collection when the video is merely open, paused, hidden,
    in a background tab, or the user is not actively attending to it.
2.  **Divide each video into timestamped segments.** The backend and
    extension must use a shared, deterministic segmentation scheme.
3.  **Each viewer contributes only evidence for the segment(s) they
    actually watch.** Capture visual samples from the visible tab and
    audio corresponding to the segment being watched. Do not require one
    viewer to watch the entire video.
4.  **Allow partial contributions.** If a viewer leaves, pauses,
    switches tabs, or stops attending, preserve only the successfully
    captured intervals. Mark uncovered intervals as missing so another
    viewer can contribute them.
5.  **Share the full-video transcript when available.** If a permitted,
    accessible transcript is available, it may be submitted with the
    contribution and deduplicated by the backend. Transcript
    availability must not be assumed.
6.  **One-time policy acceptance.** The user accepts the data-collection
    policy during installation/first setup. Ask again only when the
    policy version materially changes. Do not show a per-video
    policy-consent prompt.
7.  **Respect browser permissions separately from policy acceptance.**
    Chrome may require a user gesture or browser permission for
    tab/audio capture. Explain and request the required browser
    capability when needed; do not treat policy acceptance as a
    substitute for browser permission.
8.  **No capture or upload when policy acceptance is absent or outdated,
    contribution is disabled, or the user is not actively watching.**
9.  **Use the shared backend cache first.** If a completed result is
    already available, show it and do not collect evidence unless the
    backend explicitly identifies missing segments and the user is
    actively watching one of them.
10. **Do not disrupt playback.** Never seek, pause, change playback
    speed, or open hidden media solely to collect evidence.

## 2. Product boundaries

### In scope

-   Chrome MV3 extension for YouTube desktop.
-   Video identity and single-page application (SPA) navigation
    handling.
-   Cached score lookup and display.
-   Segment-level contribution tracking.
-   Visible-tab screenshot sampling while actively watching.
-   Best-effort audio capture limited to the currently watched segment,
    subject to Chrome permission and technical feasibility.
-   Best-effort full-video transcript extraction when available through
    a supported, accessible page interface.
-   One-time policy acceptance, versioned policy acceptance,
    contribution toggle, and browser-permission handling.
-   Partial coverage reporting, job status, local cache, badges, and
    optional filtering.
-   API integration with an external workflow, inference service, and
    shared database.
-   Tests and technical feasibility spikes.

### Out of scope

-   Implementing the AI model, inference service, workflow, or database.
-   Capturing videos/audio when the user is not actively watching.
-   Recording microphone input, system-wide audio, other tabs, or other
    applications.
-   Downloading full videos or collecting continuous full-video
    recordings.
-   Bypassing Chrome permissions, YouTube restrictions, DRM,
    cross-origin protections, or browser security.
-   Guaranteeing that a score is ground truth.
-   Supporting other social platforms in V1.
-   Collecting account credentials, cookies, unrelated browsing history,
    or private messages.

## 3. Core definitions

-   **Video ID:** Stable YouTube video identifier used as the shared
    cache key.
-   **Segment:** A fixed playback-time interval, identified by video ID
    and segment index.
-   **Coverage interval:** A timestamp range for which usable evidence
    was actually captured and accepted by the backend.
-   **Contribution:** Evidence from one active viewer for one or more
    portions of the video.
-   **Active watching:** The YouTube tab is visible and active, the
    document is visible, the video is playing, and the user has not
    disabled or suspended contribution. This is a practical
    browser-observable approximation; it cannot prove human attention.
-   **Uncovered segment:** A segment for which the backend lacks
    sufficient accepted evidence.
-   **Policy version:** A version identifier for the collection policy
    the user accepted.

### Suggested segmentation

Start with **30-second segments** (configurable by the backend). Use
half-open intervals to avoid overlap:

-   Segment 0: `[0, 30)`
-   Segment 1: `[30, 60)`
-   Segment 2: `[60, 90)`

The final segment ends at the video duration. If a viewer watches only
seconds 42--55, their contribution covers only that observed interval
within segment 1---not the entire segment. Do not mark a segment fully
covered merely because a viewer entered it.

The segmentation size is a product/configuration value and must be
identical across clients and backend services. If a segment needs
several samples to be considered complete, the backend defines that
sufficiency rule.

## 4. Architecture

``` mermaid
flowchart LR
    YT[Visible YouTube tab] --> ACT[Active-watch gate]
    ACT --> ID[Video ID and playback-time tracker]
    ID --> API[Backend cache and coverage lookup]
    API -->|Completed result| UI[Badge and optional filter]
    API -->|Missing segments| SEG[Segment scheduler]
    SEG --> CAP[Bounded screenshot/audio capture]
    CAP --> TR[Transcript available?]
    TR --> PKG[Evidence package with exact timestamps]
    PKG --> SW[Extension service worker]
    SW -->|HTTPS upload| API
    API --> WF[Backend structuring workflow]
    WF --> AI[AI inference service]
    AI --> DB[(Shared result and segment-coverage database)]
    DB --> API
    SW --> LOCAL[(Preferences, result cache, resumable job state)]
```

### Component responsibilities

  -----------------------------------------------------------------------
  Component                           Responsibilities
  ----------------------------------- -----------------------------------
  Content script                      Detect video ID, playback
                                      time/state, active tab/document
                                      visibility, supported transcript
                                      UI, badges, and filtering

  Service worker                      API requests, message validation,
                                      scheduling coordination, upload
                                      retries, local cache and job state

  Capture module                      Capture visible-tab screenshots and
                                      segment-scoped audio only when the
                                      active-watch gate passes

  Popup/settings                      Policy status, contribution toggle,
                                      permissions explanation, filtering
                                      preferences, current status

  Backend API                         Shared cache lookup, segment
                                      coverage state, atomic contribution
                                      coordination, upload validation,
                                      job status

  Backend workflow/model/database     Structure evidence, infer
                                      labels/scores, aggregate coverage,
                                      persist and serve results
  -----------------------------------------------------------------------

Do not assume that a Manifest V3 service worker stays alive. Persist
minimal job state and resume safely when it wakes. Keep capture
coordination in the active tab context where necessary.

## 5. Active-watching gate

Evidence collection may run only when **all** required conditions are
true:

-   The extension is enabled.
-   The accepted policy version matches the current policy version.
-   Contribution is enabled in settings.
-   The YouTube tab is the active tab in the active browser window.
-   The document is visible (`document.visibilityState === "visible"`).
-   The video element is playing and playback time is advancing.
-   The video is not ended, and the user has not paused or cancelled.
-   The backend reports that this video has at least one segment needing
    evidence.
-   Required Chrome capture capability is available and authorized.

A browser cannot reliably prove that a person is looking at the screen.
The extension must use observable signals as an approximation and
describe the behavior accurately.

### Stop collection immediately when

-   The tab loses visibility or active status.
-   The video pauses, ends, or stops advancing.
-   The user navigates to another video.
-   The extension is disabled, the policy is no longer accepted, or
    contribution is turned off.
-   Capture permission is revoked or capture fails.
-   The backend says the segment is sufficiently covered.
-   The user closes the tab or cancels capture.

On stop, flush only valid, already captured chunks if policy and upload
state permit; otherwise discard them. Never continue capture in the
background.

``` mermaid
stateDiagram-v2
    [*] --> Inactive
    Inactive --> Checking: YouTube video detected
    Checking --> ActiveWatching: all active-watch conditions pass
    Checking --> Inactive: any condition fails
    ActiveWatching --> Capturing: missing segment and capture permitted
    ActiveWatching --> Inactive: pause / tab hidden / navigation / disable
    Capturing --> Uploading: valid bounded chunk completed
    Capturing --> Inactive: active-watch condition fails
    Uploading --> ActiveWatching: accepted or more evidence needed
    Uploading --> Inactive: user no longer actively watching
    ActiveWatching --> Complete: no missing segments
    Complete --> Inactive: navigation / pause / tab hidden
```

## 6. Segment contribution protocol

### Required behavior

1.  Detect the video ID and current playback timestamp.
2.  Query the backend for the result status and missing segment
    coverage.
3.  If the result is already complete and no segment is missing, display
    it and do not collect.
4.  If segments are missing, identify the segment containing the current
    playback time.
5.  Capture evidence only for the segment interval currently being
    watched.
6.  Timestamp each screenshot/audio chunk against the video's playback
    timeline. Include capture start/end times and observed coverage
    intervals.
7.  Submit bounded evidence chunks. Do not claim coverage for timestamps
    that were skipped, unavailable, or not captured.
8.  If the viewer leaves midway, submit or retain only valid completed
    chunks; mark the rest uncovered.
9.  When another viewer watches an uncovered interval, their client may
    contribute it. The backend merges coverage from multiple viewers.
10. Stop contributing to a segment when the backend confirms that enough
    evidence has been collected for it.

### Example

A video is 120 seconds long and uses 30-second segments. Viewer A
watches from 10s to 48s, then leaves.

-   Segment 0 `[0, 30)`: Viewer A can contribute only the observed
    portion `[10, 30)`.
-   Segment 1 `[30, 60)`: Viewer A can contribute only `[30, 48)`.
-   Segment 2 `[60, 90)` and segment 3 `[90, 120)`: no contribution from
    Viewer A.
-   Viewer B later watches `[0, 10)` and `[48, 60)`. The backend
    combines valid coverage to fill gaps.
-   A segment is considered sufficiently covered only when the backend's
    evidence sufficiency rule is met; elapsed time alone is not proof of
    adequate evidence.

``` mermaid
gantt
    title Example: partial contributions and remaining coverage
    dateFormat X
    axisFormat %S
    section Viewer A
    Observed 10-48s :a1, 10, 38
    section Viewer B
    Observed 0-10s :b1, 0, 10
    Observed 48-60s :b2, 48, 12
    section Uncovered initially
    60-120s :crit, u1, 60, 60
```

The Gantt chart is illustrative; the implementation should represent
coverage as video-time intervals, not wall-clock dates.

## 7. Screenshot and audio capture

### Visible-tab screenshots

-   Use Chrome's supported visible-tab capture API where technically
    appropriate.
-   Capture only when the YouTube tab is active and visible and the
    playback timestamp is inside a missing segment.
-   Use a bounded sample cadence and maximum count per segment.
-   Record the video playback timestamp at capture time; wall-clock time
    alone is insufficient.
-   Resize/compress before upload and enforce per-image and per-request
    limits.
-   Do not capture unrelated tabs or take screenshots when the YouTube
    tab is not visible.
-   The captured screenshot may include UI or unrelated visible content.
    Minimize the capture area if a supported method permits it;
    otherwise document the limitation and avoid uploading unnecessary
    regions. Do not silently crop in a way that loses needed visual
    evidence.
-   Do not treat screenshots as extracted source frames: they are
    screenshots of the visible tab and may include overlays, controls,
    or captions.

### Audio for the current segment

-   Audio capture must be limited to the active YouTube tab and to the
    time interval being watched.
-   Use Chrome's supported tab-capture mechanism only after any required
    explicit user gesture/browser permission.
-   Do not capture microphone audio or audio from other tabs/apps.
-   Buffer short chunks in memory, tag them with video playback
    start/end timestamps, and stop immediately when the active-watch
    gate fails.
-   Do not persist raw audio in `chrome.storage`.
-   Avoid disrupting the user's ability to hear the video; verify audio
    routing and capture behavior in a technical spike.
-   Enforce audio duration, codec, bitrate, chunk size, and upload
    limits agreed with the backend.
-   If supported tab audio capture cannot be made reliable under the
    required UX, do not silently substitute full-video download, hidden
    playback, or another invasive capture path. Report the limitation
    and implement an explicit unsupported/unavailable state.

### Technical feasibility gate

Before implementing the complete contribution pipeline, build a small
prototype to prove:

1.  Visible-tab screenshots can be captured at the needed cadence while
    the video is active.
2.  Tab audio can be captured with the required permission/user-gesture
    behavior and without making playback inaudible.
3.  Audio chunks can be aligned to the video playback timeline with
    acceptable drift.
4.  Capture stops promptly on pause, tab switch, navigation, and
    cancellation.
5.  The implementation works with current stable Chrome and does not
    bypass browser security controls.

The policy may be accepted once, but **Chrome's technical permission
requirements still apply**. Do not promise silent audio capture without
verifying the browser API behavior.

## 8. Full-video transcript

The extension should attach a full-video transcript only when one is
accessible through a supported and permitted interface.

-   Prefer a transcript already exposed by YouTube's visible transcript
    UI or a supported caption track.
-   Do not force playback, open hidden media, or bypass access controls
    to obtain a transcript.
-   Do not assume every video has captions or a transcript.
-   If only the captions observed during playback are available, label
    them as partial rather than full-video transcript.
-   Preserve segment timestamps and language when available.
-   Include a field such as
    `transcript_scope: "full" | "partial" | "unavailable"`.
-   Send the transcript only when permitted by the approved policy and
    backend contract.
-   Avoid uploading the same full transcript repeatedly: send a
    transcript hash/version or let the backend deduplicate it.
-   Bound transcript size and segment count. If it exceeds limits, use
    the backend-approved chunking scheme or omit it with an explicit
    reason.
-   Transcript availability is supplementary; a viewer's visual/audio
    contribution remains scoped to the segment they actually watched.

## 9. One-time policy acceptance and permissions

### Policy acceptance

-   On first setup, show the collection policy with a clear summary of
    collected data, purpose, destinations, retention, and controls.
-   The user accepts once for the current policy version.
-   Store `accepted_policy_version` and `accepted_at` locally. Do not
    collect evidence until the stored version matches the current
    version.
-   When the policy materially changes, require acceptance of the new
    version before any further collection.
-   A policy update must stop new capture until accepted. Previously
    uploaded evidence remains governed by the disclosed
    retention/deletion policy.
-   Provide a settings page to disable contribution or withdraw
    acceptance. Withdrawal stops future collection and uploads; backend
    deletion behavior must be defined separately.
-   Do not show a policy-consent dialog for every video.

### Browser permissions

Policy acceptance and browser permission are separate:

-   Request only the Chrome permissions needed for the feature.
-   Explain why tab/audio capture is required before the relevant
    browser prompt or user gesture.
-   If Chrome requires a direct user gesture to begin tab capture,
    provide a one-time **Enable contribution** action or another
    compliant activation step; do not falsely claim the policy
    acceptance itself grants browser access.
-   If a permission is denied, continue normal YouTube browsing and
    display contribution as unavailable.
-   Never try to work around a denied permission.

Suggested preference structure:

``` json
{
  "enabled": true,
  "contribution_enabled": true,
  "accepted_policy_version": "v1",
  "accepted_at": "ISO-8601 timestamp",
  "show_badges": true,
  "filter_mode": "mark_only",
  "threshold": 0.8
}
```

This is conceptual. Store no raw media in preferences.

## 10. Proposed backend API contract

Final endpoint names and schemas must be agreed with the backend owner
before implementation.

### 10.1 Lookup result and segment coverage

`GET /v1/content/youtube/{video_id}`

Illustrative response:

``` json
{
  "video_id": "abcdefghijk",
  "status": "partial",
  "label": "UNKNOWN",
  "ai_reliance_score": null,
  "confidence": null,
  "segment_duration_seconds": 30,
  "segments": [
    {"index": 0, "start_seconds": 0, "end_seconds": 30, "coverage": "partial"},
    {"index": 1, "start_seconds": 30, "end_seconds": 60, "coverage": "missing"}
  ],
  "missing_segment_indices": [0, 1],
  "analyzed_at": null
}
```

The server should return only the segment information the client needs.
Use `not_found` for unmapped content and distinguish it from server
errors.

### 10.2 Submit a contribution

`POST /v1/content/youtube/{video_id}/contributions`

Illustrative request:

``` json
{
  "video_id": "abcdefghijk",
  "policy_version": "v1",
  "segment_index": 1,
  "segment_start_seconds": 30,
  "segment_end_seconds": 60,
  "observed_intervals": [
    {"start_seconds": 30.0, "end_seconds": 48.0}
  ],
  "frames": [
    {
      "video_timestamp_seconds": 36.0,
      "mime_type": "image/jpeg",
      "data": "<bounded image payload>"
    }
  ],
  "audio_chunks": [
    {
      "start_seconds": 30.0,
      "end_seconds": 48.0,
      "mime_type": "audio/webm",
      "data": "<bounded audio payload>"
    }
  ],
  "transcript": {
    "scope": "full",
    "language": "en",
    "segments": [
      {"start_seconds": 0.0, "end_seconds": 3.5, "text": "Example"}
    ],
    "content_hash": "server-agreed-hash"
  },
  "capture_capabilities": {
    "screenshots": true,
    "tab_audio": true,
    "transcript_scope": "full"
  }
}
```

All sample data is illustrative. Use multipart or bounded binary upload
if that is more efficient than Base64. Do not send fields for evidence
that was not captured. The server must validate timestamps, payload
size, segment boundaries, media type, and schema.

Illustrative response:

``` json
{
  "contribution_id": "contrib_123",
  "accepted_intervals": [
    {"start_seconds": 30.0, "end_seconds": 48.0}
  ],
  "remaining_intervals": [
    {"start_seconds": 48.0, "end_seconds": 60.0}
  ],
  "video_status": "partial"
}
```

### 10.3 Required backend behavior

-   Maintain canonical segmentation and per-video coverage intervals.
-   Atomically merge accepted intervals from concurrent contributors.
-   Deduplicate duplicate uploads by stable contribution/evidence hashes
    where appropriate.
-   Avoid making the client the authority on whether a segment is
    complete.
-   Define evidence sufficiency criteria per segment and modality.
-   Accept partial coverage and leave gaps available for future viewers.
-   Deduplicate the full transcript independently from segment
    contributions.
-   Protect against malicious clients, fabricated timestamps, repeated
    submissions, oversized payloads, and rate abuse.
-   Return status and missing intervals in a machine-readable schema.
-   Use HTTPS; never put model API secrets in the extension.
-   Define retention, deletion, rate limits, and authentication before
    public release.

## 11. Result presentation and filtering

### On-page badge states

-   `Analyzed`: show the AI-reliance score/label and the analysis
    timestamp.
-   `Partially analyzed`: explain that the result may not cover all
    segments.
-   `Not analyzed`: no cached result exists.
-   `Collecting evidence`: active contribution is underway.
-   `Processing`: backend accepted evidence and is working.
-   `Insufficient evidence` / `Unknown`: no reliable classification is
    available.
-   `Unavailable`: service or network failure.

Do not present a partial evidence set as a definitive full-video
assessment. The backend must decide whether enough segments and
modalities are covered to produce a whole-video score.

### Filtering

-   Default to `mark_only`; users must explicitly enable hiding.
-   Hide only when the backend provides a valid completed result above
    the user's threshold.
-   Do not hide partial, unknown, pending, failed, or stale results by
    default.
-   Provide a way to reveal a hidden video for the current session.
-   Restore extension-hidden cards when filtering is disabled.
-   Do not use a missing score as zero and do not interpret `UNKNOWN` as
    human-made.

## 12. Storage, performance, and privacy

-   Use `chrome.storage.local` for preferences, result cache, and
    minimal resumable job state.
-   Do not persist raw screenshot/audio chunks or full transcripts in
    extension storage.
-   Keep local result cache bounded and use a configurable TTL.
-   Cache backend results; do not cache a server error as a
    classification.
-   Deduplicate lookups and limit concurrent video-card requests.
-   Debounce DOM scans and handle YouTube SPA navigation.
-   Cancel stale work when the active video changes.
-   Use bounded retries and honor `Retry-After`.
-   Do not log audio, screenshots, transcript text, or unnecessary
    identifiers.
-   Make contribution status visible and allow contribution to be
    disabled.
-   Default to fail-open behavior: an unavailable backend must not break
    YouTube or unexpectedly hide videos.

## 13. Manifest and permission principles

Use Manifest V3 and request only permissions justified by implemented
features. Likely candidates include `storage`, `activeTab`, `scripting`,
host permission for the backend API, and the required YouTube
content-script match. The exact permission set must be validated against
Chrome's current API requirements.

Do not request `history`, `cookies`, `downloads`, microphone, broad
`<all_urls>`, or unrelated tab access for V1. Tab-audio capture has
special API and user-gesture constraints; the implementation worker must
verify the current Chrome documentation and prove feasibility before
finalizing the manifest.

## 14. Testing and acceptance criteria

### Automated tests

1.  Video ID parsing for watch, short-link, and Shorts URLs.
2.  Active-watch gate fails when tab/document is hidden, playback is
    paused, or playback time is not advancing.
3.  Capture stops on tab switch, pause, navigation, policy mismatch, and
    disable.
4.  Segmentation boundaries are correct, including exact boundary
    timestamps and final partial segment.
5.  A contribution records only intervals actually observed.
6.  A partial contribution leaves remaining intervals uncovered.
7.  Multiple viewers' intervals merge without falsely claiming full
    coverage.
8.  Duplicate requests and concurrent uploads are handled safely.
9.  Full, partial, and unavailable transcript states remain distinct.
10. Policy acceptance is requested once per policy version, not once per
    video.
11. No evidence is captured/uploaded without current policy acceptance
    and contribution enabled.
12. No evidence is captured/uploaded when the active-watch gate fails.
13. Filtering does not hide partial, unknown, pending, failed, or stale
    results by default.
14. API failure, rate limiting, invalid schemas, and oversized payloads
    fail safely.
15. No raw evidence is persisted in local storage or logs.

### Manual acceptance checklist

-   [ ] Accept the policy during first setup; navigate to multiple
    videos without repeat policy prompts.
-   [ ] Simulate a policy-version update; collection stops until the
    updated policy is accepted.
-   [ ] Open a video in a background tab; verify no capture.
-   [ ] Switch away from a playing tab; verify capture stops.
-   [ ] Pause the video; verify capture stops.
-   [ ] Watch only part of a segment, then navigate away; verify only
    observed intervals are submitted.
-   [ ] Have a second client contribute a missing interval; verify
    backend coverage merges.
-   [ ] Verify cached complete results trigger no capture.
-   [ ] Verify missing segments can be contributed during active
    watching.
-   [ ] Verify full transcript is submitted only when available and its
    scope is correctly labeled.
-   [ ] Verify denial/unavailability of audio capture does not trigger a
    workaround or break playback.
-   [ ] Verify no raw media is retained in extension storage.
-   [ ] Verify YouTube remains usable during network/API failures.

## 15. Implementation milestones

1.  **Repository and API review:** inspect existing code, agree on
    endpoint schemas, segmentation duration, coverage semantics, and
    policy version.
2.  **Feasibility prototype:** prove active-tab screenshots, tab audio
    capture, timestamp alignment, and stop behavior in current Chrome.
3.  **Extension shell and identity:** MV3 setup, video ID extraction,
    SPA navigation, policy-version storage, and popup.
4.  **Cached result and coverage lookup:** display result, partial
    status, missing intervals, and deduplicate lookups.
5.  **Active-watch segment capture:** implement strict active-watch
    gate, bounded screenshots/audio, timestamps, cancellation, and
    upload.
6.  **Transcript handling:** detect full/partial/unavailable transcript
    without bypassing restrictions; deduplicate with backend.
7.  **Filtering and UI:** badge states, preferences, mark-only mode,
    opt-in hide threshold, reveal/restore behavior.
8.  **Hardening:** privacy review, permission review, automated tests,
    API error handling, performance and manual QA.

## 16. Decisions the agent must not invent

Before completing implementation, confirm:

-   Backend API base URL, auth/rate-limiting approach, and final
    schemas.
-   Segment duration and evidence sufficiency rule.
-   Whether coverage is tracked by fixed segments, observed intervals,
    or both. Recommended: fixed segments for scheduling plus precise
    intervals for evidence coverage.
-   Maximum screenshot rate, dimensions, and count.
-   Audio format, chunk duration, bitrate, maximum bytes, and retention.
-   Supported transcript access method and what counts as a full
    transcript.
-   Whether one-time policy acceptance is installation-wide and how
    policy version changes are delivered.
-   Chrome permissions and user-gesture requirements for tab audio
    capture.
-   Whether incomplete video coverage may still produce a partial score.
-   Result TTL, score semantics, and how corrected classifications are
    propagated.

## 17. Definition of done

The extension is complete when:

-   It loads as a Chrome MV3 extension and handles YouTube SPA
    navigation.
-   It looks up cached results and missing segment coverage before
    collecting evidence.
-   It collects only while the active-watch gate passes.
-   It attributes screenshots/audio only to the actual video-time
    intervals observed.
-   A viewer can leave midway without blocking future viewers from
    contributing missing intervals.
-   Full-video transcript is attached only when available and is marked
    full/partial/unavailable accurately.
-   Policy acceptance is stored by version and is not requested per
    video.
-   Required Chrome permissions are requested transparently and no
    browser restriction is bypassed.
-   Raw evidence is not persisted locally.
-   Filtering defaults to marking and never treats missing/unknown data
    as proof of human content.
-   Automated tests and manual acceptance checks pass.
-   README documents build, installation, permissions, API contract,
    policy behavior, known capture limitations, and test results.

------------------------------------------------------------------------

## Instructions to the agentic implementation worker

1.  Inspect the repository and existing conventions before editing.
2.  Present an implementation plan and blockers before coding.
3.  Implement the feasibility prototype before building the full
    audio/screenshot pipeline.
4.  Do not claim active watching proves human attention; implement the
    observable gate defined above.
5.  Do not request policy acceptance for each video. Re-request only
    when the policy version changes; browser permission prompts remain
    separate.
6.  Do not mark a whole segment covered when only part was observed.
7.  Keep collection bounded, cancellable, and inactive outside the
    active-watch gate.
8.  Do not bypass browser or YouTube restrictions. If capture is
    technically unavailable, report the blocker and preserve the rest of
    the extension functionality.
9.  Add tests for each milestone, update README, and report test
    results, unresolved decisions, and deviations from this
    specification.
