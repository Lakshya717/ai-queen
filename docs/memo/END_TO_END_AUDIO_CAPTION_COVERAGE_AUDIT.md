# End-to-End Audio and Caption Coverage Audit

## Intended pipeline

```text
active watch interval
  -> extension submits observedIntervals and visual frames
  -> Django clamps and merges half-open intervals
  -> server audio fallback slices each observed interval with yt-dlp/FFmpeg
  -> transcript service uses client cues or server caption fallback
  -> manifest builder writes audio chunks and segment-bounded cues
  -> sufficiency evaluates interval coverage plus cumulative evidence
```

## Audio result

The reliable production path is server-side audio synthesis. YouTube's MSE
playback frequently exposes no audio track through `HTMLMediaElement.captureStream`
in a content script, and Chrome tab capture additionally requires a user gesture
and MV3 background/offscreen coordination. The live extension path was also
starting an in-page recorder without flushing its result into the package.

The selected design therefore keeps `tabAudio: false` and relies on
`MediaStorageService.save_audio_chunks()` to call `YouTubeAudioService` for every
valid observed interval when no client chunk is supplied. A failed download or
slice must produce no audio record and must remain visible in server logs; it
must not become false coverage.

Audio duration is accumulated across contributions and capped at the merged
observed duration for the segment. This allows three periodic ten-second
contributions to satisfy the 15-second audio threshold without allowing
overlapping retries to inflate duration beyond the segment.

## Caption result

The extension can provide DOM transcript cues and hashes. When cues are absent,
`TranscriptService` uses the server-side YouTube transcript extraction fallback.
The returned `TranscriptProcessResult` carries the canonical cues, language,
scope, and hash. `ManifestBuilder` filters cues to the segment bounds and writes
them to both `manifest.json` and `llm-input.md`.

Captions are not treated as playback coverage: a segment still requires merged
observed intervals. Caption scope is metadata indicating whether speech evidence
is full, partial, or unavailable.

## Boundary and failure requirements

- Clamp every interval to `[segment_start, segment_end)`.
- Generate audio only for positive, observed intervals.
- Preserve transcript hash deduplication while retaining cues for manifest output.
- Keep audio and caption timestamps on the same video timeline as frames.
- Do not mark a segment complete when server audio extraction fails unless the
  cumulative frame minimum independently satisfies the policy.
- Do not reintroduce automatic permission prompts or full-video client downloads.

## Verification matrix

| Path | Expected evidence |
|---|---|
| Visual-only periodic flush | Cumulative frame count reaches two or more; coverage can complete |
| Server audio fallback | `.webm` records match observed intervals and duration is cumulative |
| Client audio supplied | Valid client chunk is preserved; fallback is not duplicated |
| Client transcript supplied | Hash, scope, cues, and language reach the segment manifest |
| No client transcript | Server fallback is attempted; unavailable remains explicit |
| Overlapping/retried interval | Merged coverage and audio duration remain bounded by segment bounds |
