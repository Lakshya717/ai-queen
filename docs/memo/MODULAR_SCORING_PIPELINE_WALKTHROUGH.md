# Modular Multi-Component AI Scoring Architecture Walkthrough

## Summary of Completed Work

We have implemented a **modular, fault-isolated multi-component inference and scoring architecture** within the Django backend (`AI Project/backend`). 

Each component operates independently, receives its exact required input through dedicated backend connector code, and outputs a rich, structured set of domain metrics (not just a single float score). Runtime failures or exceptions in any individual component are trapped and isolated, allowing other components to continue uninterrupted.

---

## Key Components Implemented

### 1. Database Persistence (`apps/content/models.py`)
- Added `SegmentComponentScore` model with fields:
  - `segment`: ForeignKey to `VideoSegment`
  - `component_name`: Unique component identifier (`slopout_visual`, `slopout_text`, `temporal_consistency`, `audio_signal`)
  - `modality`: Categorical tag (`visual`, `text`, `temporal`, `audio`)
  - `score`: Primary normalized AI-reliance rating (0.0 to 1.0)
  - `confidence`: Calibrated reliability score (0.0 to 1.0)
  - `status`: Execution status (`SUCCESS`, `SKIPPED`, `FAILED`)
  - `execution_time_ms`: Execution latency in milliseconds
  - `details`: Component-specific structured payload (JSONField)
  - `error_message`: Traceback or failure diagnostics if failed
- Created and applied migration `apps/content/migrations/0002_segmentcomponentscore.py`.
- Registered `SegmentComponentScoreAdmin` in Django Admin.

### 2. Hardcoded Backend Connectors (`apps/content/inference/connectors/`)
Each connector implements:
- `prepare_input(context)`: Extracts and shapes the exact parameters the component requires from `SegmentContext`.
- `invoke_component(input)`: Executes the component.
- `collect_output(raw_output)`: Parses the component's output dictionary into a standardized `CollectedScoreRecord`.
- `run(context)`: Wraps execution in `try...except` fault isolation with timing.

Implemented Connectors:
1. **`SlopOutVisualConnector`** (Team Component):
   - **Input**: Loads saved JPEG screenshot frames into `List[PIL.Image]`.
   - **Output Details Collected**: `mean_prob`, `max_prob`, `std_prob`, `peak_frame_index`, `peak_frame_timestamp`, `model_used`, and per-frame probabilities mapped to timestamps and filenames.
2. **`SlopOutTextConnector`** (Team Component):
   - **Input**: Concatenates transcript cues into a clean string. Skips gracefully if captions are missing or $< 20$ words.
   - **Output Details Collected**: `chunks_count`, `per_chunk_scores`, `mean_chunk_score`, `max_chunk_score`, `total_words`, `model_used`.
3. **`TemporalConsistencyConnector`** (Temporal Dynamics):
   - **Input**: Chronologically sorted `(timestamp, Path)` frame pairs. Skips if $< 2$ frames.
   - **Output Details Collected**: Pairwise luminance deltas ($\Delta L$), `temporal_jitter_index`, `static_freeze_ratio`, `frame_pairs_analyzed`, and individual pair metrics.
4. **`AudioSignalConnector`** (Audio Signal Analysis):
   - **Input**: Validates WebM Opus file existence and intervals. Skips if audio is absent.
   - **Output Details Collected**: `chunks_count`, `total_duration_seconds`, `total_bytes`, `mime_type`, and chunk summaries.

### 3. Inference Dispatcher & Multimodal Fusion (`apps/content/inference/`)
- **`InferenceDispatcher`**:
  - Builds `SegmentContext` from `manifest.json`.
  - Runs active connectors in sequence with fault isolation.
  - Upserts records into `SegmentComponentScore`.
  - Triggers multimodal fusion and updates `InferenceJob(status='COMPLETED')`.
- **`FusionEngine`**:
  - Dynamically normalizes weights over available modalities (visual: 0.50, text: 0.30, temporal: 0.10, audio: 0.10).
  - Updates `VideoSegment.ai_segment_score`.
  - Aggregates time-weighted score across segments: `Video.ai_reliance_score`, `confidence`, `label` (`HUMAN_MADE` $<0.35$, `MIXED` $0.35-0.70$, `AI_GENERATED` $\ge 0.70$).

### 4. API & Management CLI
- **`GET /v1/content/youtube/<video_id>/analysis`**:
  - Returns video-level verdict, segment breakdown, side-by-side component scores, and `strategyComparison` (modality averages and evaluation counts).
- **`python manage.py run_inference`**:
  - CLI command supporting `--video-id <id>`, `--segment <idx>`, and `--all`.

---

## Verification & Test Results

### 1. Automated Test Suites (42 Tests, 100% Pass)
Ran `python manage.py test tests`:
```text
Creating test database for alias 'default'...
......................Component connector 'crashing_component' failed during execution: Simulated fatal CUDA out-of-memory or division by zero in component
....................
----------------------------------------------------------------------
Ran 42 tests in 0.420s

OK
Destroying test database for alias 'default'...
Found 42 test(s).
System check identified no issues (0 silenced).
```

### 2. Fault Isolation Verification
Tested via `test_inference_fault_isolation.py`:
- Injected an unhandled `RuntimeError` into a mock component.
- The crashing component was trapped with `status="FAILED"` and traceback captured.
- The remaining component executed with `status="SUCCESS"` (score 0.85).
- Segment score was computed (0.85) without any crash or uncaught exception.

### 3. CLI Evaluation on Saved Media (`y2rPvroMk-8`)
Executed `python manage.py run_inference --video-id y2rPvroMk-8`:
```text
Running inference for video 'y2rPvroMk-8' (3 segments)...
  Segment #0 (Video y2rPvroMk-8)...
    -> [slopout_visual] status=SUCCESS score=0.5 latency=37.62ms
    -> [slopout_text] status=SUCCESS score=0.5 latency=0.14ms
    -> [temporal_consistency] status=SUCCESS score=0.2176 latency=16.22ms
    -> [audio_signal] status=SUCCESS score=0.5 latency=0.23ms
    Fused Segment Score: 0.4718
  Segment #1 (Video y2rPvroMk-8)...
    -> [slopout_visual] status=SUCCESS score=0.5 latency=19.03ms
    -> [slopout_text] status=SUCCESS score=0.5 latency=0.25ms
    -> [temporal_consistency] status=SUCCESS score=0.2 latency=20.0ms
    -> [audio_signal] status=SUCCESS score=0.5 latency=0.32ms
    Fused Segment Score: 0.47
  Segment #2 (Video y2rPvroMk-8)...
    -> [slopout_visual] status=SUCCESS score=0.5 latency=9.35ms
    -> [slopout_text] status=SUCCESS score=0.5 latency=0.21ms
    -> [temporal_consistency] status=SKIPPED score=None latency=0.0ms
    -> [audio_signal] status=SUCCESS score=0.5 latency=0.38ms
    Fused Segment Score: 0.5
Video y2rPvroMk-8 complete: Score=0.4806, Label=MIXED, Status=partial
```

### 4. Analysis API Verification (`GET /v1/content/youtube/y2rPvroMk-8/analysis`)
The analysis endpoint successfully returned:
- `videoId`: `"y2rPvroMk-8"`
- `label`: `"MIXED"`
- `aiRelianceScore`: `0.4806`
- Full breakdown for segments 0, 1, and 2.
- `strategyComparison` showing modality averages (`audio: 0.5`, `text: 0.5`, `visual: 0.5`, `temporal: 0.2088`) and `totalEvaluations: 11`.
