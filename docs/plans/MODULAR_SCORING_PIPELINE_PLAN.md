# Modular Multi-Component AI Scoring Architecture with Hardcoded Backend Connectors

## Goal Description

The objective of this architecture is to establish a **modular, fault-isolated multi-component inference framework** where:
1. **Multiple independent components** evaluate different parts of the multimodal evidence captured by the Chrome extension (visual frames, transcript text, audio streams, temporal frame sequences).
2. For every component, the backend contains **dedicated, hardcoded connector code** that:
   - **Prepares the exact input structure** the component expects from the raw extension files and manifest (e.g., converting frame file paths to PIL Images, extracting concatenated English transcript text, or preparing ordered timestamp-frame pairs).
   - **Invokes the component** within a fault-isolated runtime wrapper.
   - **Collects the variety of details, metrics, and diagnostic signals** returned by that component (not just a single float score), normalizing them into persistent records.
3. **Runtime Fault Isolation**: A failure, unhandled exception, corrupt asset, or CUDA OOM in any one component is isolated within that component's connector. It records `status="FAILED"` with error diagnostics and allows all other components to proceed normally without crashing the backend or interrupting API requests.
4. **Integration of Team Component (`kannabiran_AI_Project` / SlopOut)**: Ingests the team's visual frame detector (CLIP ViT-B/32 + ViT baseline) and transcript NLP detector (RoBERTa on HC3), preserving their empirical findings regarding compression artifacts and chunking.
5. **Future-Proofing for Audio and Temporal Signals**: Establishes first-class hardcoded connectors for temporal frame dynamics (inter-frame luminance deltas and jitter) and audio signal analysis (WebM Opus chunk properties / synthetic voice stubs).
6. **Backend Schema & Comparative Analysis**: Persists the variety of component details into `SegmentComponentScore`, supporting side-by-side strategy comparison in Django Admin and via a dedicated analysis API (`GET /v1/content/youtube/<video_id>/analysis`).

---

## Architectural Blueprint

```mermaid
flowchart TD
    subgraph Client ["Client (Chrome MV3 Extension)"]
        CONTRIB["POST /v1/content/youtube/:id/contributions\n(JPEG frames, WebM Opus audio, transcript cues)"]
    end

    subgraph Backend_Storage ["Backend Storage & Evidence Manifest"]
        STORAGE["media/youtube/:id/segments/seg_k/\n(contrib_id/frames/*.jpg, contrib_id/audio/*.webm)"]
        MANIFEST["manifest.json\n(Timestamps, intervals, cues, file paths)"]
        JOB["InferenceJob (status='PENDING')"]
    end

    subgraph Dispatcher_Layer ["Backend Inference Dispatcher"]
        DISPATCH["Inference Dispatcher\n(Loads SegmentContext from manifest)"]
    end

    subgraph Connectors ["Hardcoded Backend Component Connectors"]
        direction TB
        
        subgraph C_VIS ["SlopOut Visual Connector"]
            V_IN["prepare_input: Loads JPEG files -> List[PIL.Image]"]
            V_RUN["invoke: SlopOutVisualScorer.score_frames(images)"]
            V_OUT["collect_output: Collects mean, max, std, per_frame, peak timestamp"]
            V_IN --> V_RUN --> V_OUT
        end

        subgraph C_TXT ["SlopOut Transcript Connector"]
            T_IN["prepare_input: Extracts cues -> concatenated text string"]
            T_RUN["invoke: SlopOutTextScorer.score_text(text)"]
            T_OUT["collect_output: Collects chunk_count, per_chunk, mean, max"]
            T_IN --> T_RUN --> T_OUT
        end

        subgraph C_TEMP ["Temporal Consistency Connector"]
            M_IN["prepare_input: Sorts frames by timestamp -> ordered pairs"]
            M_RUN["invoke: TemporalScorer.score_temporal(ordered_frames)"]
            M_OUT["collect_output: Collects delta_L, temporal_jitter, freeze_ratio"]
            M_IN --> M_RUN --> M_OUT
        end

        subgraph C_AUD ["Audio Signal Connector"]
            A_IN["prepare_input: Verifies WebM Opus path & duration"]
            A_RUN["invoke: AudioScorer.score_audio(audio_path)"]
            A_OUT["collect_output: Collects duration, silence_ratio, rms_energy"]
            A_IN --> A_RUN --> A_OUT
        end
    end

    subgraph Fusion_Persistence ["Fusion & Persistence Layer"]
        DB_COMP[("SegmentComponentScore\n(component_name, score, confidence, latency, details)")]
        FUSION["Multimodal Fusion Engine\n(Weights active components -> segment score)"]
        DB_SEG[("VideoSegment (ai_segment_score)")]
        DB_VID[("Video (ai_reliance_score, label, status='complete')")]
    end

    subgraph Output_APIs ["Analysis & Inspection APIs"]
        ANALYSIS_API["GET /v1/content/youtube/:id/analysis\n(Full Side-by-Side Breakdown Matrix)"]
        ADMIN["Django Admin Dashboard"]
        LOOKUP["GET /v1/content/youtube/:id\n(Enriched Client Response)"]
    end

    CONTRIB --> STORAGE --> MANIFEST --> JOB
    JOB --> DISPATCH
    DISPATCH --> C_VIS & C_TXT & C_TEMP & C_AUD

    V_OUT & T_OUT & M_OUT & A_OUT --> DB_COMP
    V_OUT & T_OUT & M_OUT & A_OUT --> FUSION
    FUSION --> DB_SEG --> DB_VID

    DB_COMP & DB_SEG & DB_VID --> ANALYSIS_API & ADMIN
    DB_VID --> LOOKUP
```

---

## Technical Details & Component Contracts

### Hardcoded Backend Connectors for Component-Specific Input/Output
Rather than forcing components into an artificial, one-size-fits-all signature, each component has a dedicated **hardcoded connector** in the backend:
- **Input Preparation**: The connector inspects the segment context and constructs the precise input types and shapes the component requires (e.g. `List[PIL.Image]` for vision, raw `str` for transcript NLP, ordered `(timestamp, Path)` pairs for temporal analysis, or `Path` to WebM file for audio).
- **Output Collection**: The connector knows the exact schema returned by the component and collects its specific variety of metrics into `SegmentComponentScore.details`.
- **Fault Isolation**: Each connector runs in an isolated `try...except` block, ensuring a component failure or missing file never crashes the backend.

### Shared Python Virtual Environment & Lazy Loading
All components share the backend's Python environment. Heavy ML libraries (e.g., PyTorch, Transformers) are loaded lazily inside their respective component modules so that lightweight connectors (e.g., temporal motion calculation or audio metadata checks) remain instant and consume negligible memory.
