# Frame Quota and Modality Alignment Implementation Plan

## Objective

Align the backend quota model with motion-adaptive periodic frame collection while
preserving end-to-end server-side audio and caption evidence.

## Work packages

### 1. Backend cumulative accounting

- Aggregate `Contribution.frame_count` per video and segment before evaluating
  `VideoSegment` sufficiency.
- Aggregate valid audio duration from stored contribution results and cap it at
  merged observed coverage.
- Keep the existing 95% coverage and `two frames OR 15 seconds audio` policy.
- Add retry/overlap fixtures and decide whether a future media index is required
  for exact deduplication.

### 2. Modality alignment

- Use server-side `yt-dlp`/FFmpeg slicing for every observed interval when client
  audio is absent.
- Keep valid client audio as an optional optimization, never as a prerequisite.
- Preserve transcript cues/language/scope from `TranscriptProcessResult`.
- Build segment manifests from segment-bounded audio and caption records.

### 3. Extension orchestration

- Keep periodic interval flushes and motion-adaptive sampling.
- Do not start an in-page recorder that cannot be flushed into the package.
- Report server-side audio as the selected path through capabilities and retain
  explicit unavailable states for extraction failures.
- Continue sending observed intervals and transcript payloads through the existing
  HTTP adapter.

### 4. Tests and operational checks

- Regression test: three one-frame periodic contributions complete a 30-second
  segment.
- Regression test: cumulative audio reaches the threshold across contributions.
- Test audio fallback and client-audio precedence.
- Test transcript cues are written to segment manifests and filtered by bounds.
- Run backend tests, extension unit tests, extension build, and the existing E2E
  smoke flow.
- Verify logs and media output for an extraction failure do not claim completion.

## Acceptance criteria

1. A segment with `[0,10)`, `[10,20)`, and `[20,30)` observations is complete when
   each package has one valid frame, even though no package has two frames.
2. The same segment can complete through cumulative server audio without client
   tab-capture permission.
3. Audio duration never exceeds merged observed segment duration.
4. Transcript cues and audio records remain aligned to segment bounds in manifests.
5. Existing lookup, missing-index, auto-analysis, privacy, and cache behavior is
   unchanged outside the corrected evidence accounting.
