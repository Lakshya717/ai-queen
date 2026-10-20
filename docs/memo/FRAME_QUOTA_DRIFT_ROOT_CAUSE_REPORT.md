# Frame Quota Drift Root-Cause Report

## Finding

The motion-adaptive sampler changed the shape of evidence packages without changing
the backend's segment accounting model. A continuous watch is now flushed
periodically (currently after roughly ten seconds of playback), and
`resetEvidenceAccumulators()` clears the frame list after every flush. The next
package therefore commonly contains one new frame.

The server previously evaluated each package as though it were the complete
segment:

```python
segment.frame_count = max(segment.frame_count, len(saved_frames))
segment.audio_duration_seconds = max(segment.audio_duration_seconds, audio_dur)
```

For three ten-second packages with one frame each, `max(1, 1, 1)` remains `1`.
Even when the merged observation intervals cover 95% or more of the segment, the
fixed sufficiency predicate (`frame_count >= 2 OR audio_duration >= 15s`) can
never pass. This is the quota deadlock introduced by the sampling change.

## Contributing drift

1. The live content loop starts an in-page audio recorder but never calls
   `stopAndFlushRecording()` when an interval is uploaded; it always sends
   `audioChunks: []`.
2. The server has a server-side audio fallback, so client audio is not required,
   but the segment duration must be accumulated from each successfully stored
   interval.
3. Transcript processing already returns cues and language through
   `TranscriptProcessResult`; ingestion must continue using those attributes when
   generating manifests. Captions describe speech alignment but do not replace
   observed playback coverage.
4. A manifest is rebuilt after each contribution. Downstream consumers must treat
   the segment's merged intervals and stored contribution media as the complete
   evidence set, rather than assuming the latest package is the whole segment.

## Correctness rule

The existing policy remains:

```text
merged observed coverage >= 95%
AND (cumulative valid frames >= 2 OR cumulative valid audio >= 15 seconds)
```

The fix is to aggregate contribution evidence at the segment level. The
aggregation is capped by merged observed coverage for audio, preventing the
stored duration from claiming more playable audio than the segment has observed.
Client-side audio remains optional; server-side slicing is the authoritative
fallback for every observed interval.

## Implemented correction

- Backend now sums frame counts and audio duration from prior contributions before
  evaluating sufficiency.
- Audio duration is bounded by the merged segment coverage.
- The extension no longer starts an unused in-page recorder while the chosen
  server-side audio strategy is active.
- A regression test covers three periodic single-frame packages and verifies that
  the segment reaches `complete`.

## Follow-up implementation requirements

- Add media-level deduplication if retries can submit identical frame/audio
  packages and exact distinct evidence counts are required.
- Keep server audio and caption failures observable; never mark a segment complete
  from claimed capability metadata alone.
