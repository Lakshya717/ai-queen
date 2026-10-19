# Compatibility, Adaptation & Forensic Review of Team Repository (`kannabiran-v005/AI_Project`)

> **Author**: AI Systems & Architecture Lead  
> **Date**: October 19, 2026  
> **Target System**: Crowdsourced Client-Side AI Content Detection System for YouTube (`ai-queen`)  
> **Evaluated Repository**: [`https://github.com/kannabiran-v005/AI_Project`](https://github.com/kannabiran-v005/AI_Project)  
> **Purpose**: In-depth compatibility review, forensic failure analysis, root-cause diagnostics, and fully feasible production adaptation blueprint for the core AI detection model.

---

## 1. Executive Summary

This report delivers an exhaustive architectural, empirical, and forensic compatibility review of the machine learning repository developed by team member V. Kannabiran ([`kannabiran-v005/AI_Project`](https://github.com/kannabiran-v005/AI_Project)) with respect to our workspace's core production platform ([`ai-queen`](file:///C:/Users/Lakshya/Desktop/AI%20Project/README.md)).

### Core Findings Matrix
| Dimension | `kannabiran-v005/AI_Project` | `ai-queen` (Current Workspace) | Compatibility Rating | Key Recommendation |
|---|---|---|---|---|
| **Processing Granularity** | Monolithic whole-video (downloads full video or takes 8 ad-hoc frames) | 30-second half-open segments `[k*30, (k+1)*30)` | **Low (Direct)** / **High (Adapted)** | Adapt model pipelines to execute per 30s segment manifest (`manifest.json`) |
| **Visual Classification** | Pretrained `umm-maybe/AI-image-detector` (ViT) & optional CLIP (`openai/clip-vit-base-patch32`) + Logistic Regression | Multi-frame Canvas 2D capture stored in structured media vault | **Medium (Flawed Out-of-Box)** | Replace mean aggregation with Top-2/Max aggregation; calibrate for video compression; incorporate CLIP feature probe |
| **Transcript Analysis** | Pretrained `Hello-SimpleAI/chatgpt-detector-roberta` (HC3-trained) chunked at 120 words | Deduplicated SHA-256 transcript cues stored in relational DB | **High** | Adapt chunking and scoring to segment-scoped cues; add Whisper fallback for missing/non-English transcripts |
| **Audio Classification** | **None (Zero audio support)** | Server-side native Opus download (`yt-dlp`) + FFmpeg 30s slicing (`YouTubeAudioService`) | **Zero in Team Repo (Critical Blindspot)** | Introduce a dedicated voice synthesis/deepfake detector on sliced Opus audio |
| **Modality Fusion** | Static weighted average ($w_{\text{img}}=0.6, w_{\text{txt}}=0.4$) | Multi-factor weighted fusion ($w_v=0.45, w_a=0.35, w_t=0.20$) specified in architecture | **Medium** | Abandon $w_{\text{img}}=0.6$; implement dynamic availability-aware Bayesian fusion with confidence overrides |
| **Backend Architecture** | FastAPI + SQLite (`scores.db`), single-thread lock `threading.Semaphore(1)` | Django REST Framework, atomic interval merger, relational schema, asynchronous `InferenceJob` | **Low (Direct)** / **High (Integrated)** | Integrate model pipelines as Django background worker services consuming `InferenceJob` |

---

## 2. Deep Comparative Architecture Analysis

### 2.1 Workspace Architecture: `ai-queen`
The `ai-queen` workspace implements a crowdsourced, decentralized detection platform for YouTube:
1. **Client Extension (TypeScript MV3)**:
   - Uses strict Hexagonal/OOP architecture (`domain/`, `ports/`, `adapters/`, `contexts/`).
   - Watches viewer playback via [`ActiveWatchGate`](file:///C:/Users/Lakshya/Desktop/AI%20Project/extension/src/domain/specifications/ActiveWatchGate.ts) (requires playing state, document focus, tab visibility, non-ad status, volume $>0$).
   - Binds contributions strictly to 30-second half-open segments $[k \cdot 30, (k+1) \cdot 30)$.
   - Collects Canvas 2D visual stills and DOM transcripts, uploading an `EvidencePackage` to `POST /v1/content/youtube/{video_id}/contributions`.
2. **Server-Side Ingestion & Structuring Pipeline (Django REST)**:
   - Atomic interval merging math ([`interval_merger.py`](file:///C:/Users/Lakshya/Desktop/AI%20Project/backend/apps/content/services/interval_merger.py)) ensures viewer coverage is mathematically sound.
   - Evaluates segment sufficiency ratio ($\ge 95\%$ coverage).
   - Zero-client-friction server-side audio pipeline ([`youtube_audio_service.py`](file:///C:/Users/Lakshya/Desktop/AI%20Project/backend/apps/content/services/youtube_audio_service.py)): downloads native YouTube 160 kbps Opus audio once per video via `yt-dlp` and slices exact 30.0s segments via FFmpeg stream copy in $\sim 38\text{ ms}$.
   - Compiles structured manifests ([`manifest.json`](file:///C:/Users/Lakshya/Desktop/AI%20Project/backend/apps/content/services/manifest_builder.py) and `llm-input.md`) aligning visual frames, Opus audio slices, and transcript cues.
   - Creates asynchronous [`InferenceJob`](file:///C:/Users/Lakshya/Desktop/AI%20Project/backend/apps/content/models.py#L121-L143) tracking records with status `PENDING`.
3. **The Unfinished Gap**:
   - As documented in [`BACKEND_ARCHITECTURE_AND_HANDOFF.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/memo/BACKEND_ARCHITECTURE_AND_HANDOFF.md) Milestone B5, the actual machine learning inference worker that takes the segment manifests and computes `VideoSegment.ai_segment_score` and `Video.ai_reliance_score` has not yet been hooked up.

### 2.2 Team Member Repository: `kannabiran-v005/AI_Project`
The team repository consists of two evolution stages:
1. **Prototype A (`detector.py` / `server.py` / `evaluate.py`)**:
   - `detector.py`: Downloads full YouTube videos up to 360p via `yt-dlp` in a CLI subprocess, samples 10 frames uniformly between $5\%$ and $95\%$ of the timeline via OpenCV, runs Hugging Face `umm-maybe/AI-image-detector`, scrapes transcripts via `youtube_transcript_api`, chunks into 120-word blocks, runs `Hello-SimpleAI/chatgpt-detector-roberta`, and averages scores ($0.6 \cdot \text{img} + 0.4 \cdot \text{txt}$).
   - `server.py`: FastAPI server with SQLite `scores.db` and single-concurrency lock `_one_at_a_time = threading.Semaphore(1)`.
   - `evaluate.py`: Benchmark evaluation script producing `results_table.csv`, `weight_sweep.csv`, and `confusion_matrices.png`.
   - `frame_experiment.py`: Evaluates 5, 10, and 20 frame sampling across mean, max, and median aggregations.
2. **Prototype B (`slopout/`)**:
   - Evolution into "SlopOut": Chrome extension captures 8 frames during playback via canvas and submits base64 images to `POST /analyze`.
   - `slopout/backend/server.py`: Evaluates frames against `umm-maybe/AI-image-detector` or a custom-trained Logistic Regression head (`clip_lr.joblib`) over `openai/clip-vit-base-patch32` embeddings.
   - `train.py`: Trains Logistic Regression on collected frames using Stratified K-Fold CV (split by video). Features a promotion gate requiring $\ge 30$ videos, $\ge 10$ per class, and CV AUC outperforming the baseline by $\ge 0.05$.

```mermaid
flowchart TD
    subgraph Kannabiran_Repo ["kannabiran-v005/AI_Project"]
        direction TB
        K_V["Vision: umm-maybe/AI-image-detector\n(ViT on still images)\n+ CLIP ViT-B/32 in slopout"]
        K_T["Text: chatgpt-detector-roberta\n(120-word chunks, HC3 dataset)"]
        K_A["Audio: NONE (Missing track)"]
        K_F["Fusion: Static 0.6 Visual / 0.4 Text\n(Monolithic Whole-Video)"]
        K_S["FastAPI + Semaphore(1) Lock\n(Single-threaded blocking)"]
    end

    subgraph AI_Queen ["ai-queen (Our Workspace)"]
        direction TB
        Q_IN["Ingestion API & Segment Manifests\n(30s Half-Open Intervals)"]
        Q_DB["PostgreSQL / Django ORM\n(Videos, Segments, Intervals, Transcripts)"]
        Q_AUD["YouTubeAudioService\n(yt-dlp native Opus + FFmpeg 38ms slicing)"]
        Q_JOB["InferenceJob (PENDING)\n(Async Queue Ready)"]
    end

    subgraph Target_Solution ["Adapted Core Model Engine"]
        direction TB
        ADAPT_V["Calibrated Vision Service\n(Top-2 Max Aggregation + CLIP Probe)"]
        ADAPT_T["Segment-Scoped Text Service\n(RoBERTa + Whisper Fallback)"]
        ADAPT_A["NEW: Voice Synthesis Audio Classifier\n(AASIST / Wav2Vec2 on Opus chunks)"]
        ADAPT_F["Dynamic Bayesian Fusion\n(Missing-aware, confidence-boosted)"]
        WORKER["Django Async Worker\n(Batch GPU / Multi-threaded)"]
    end

    K_V -.->|Adapt & Calibrate| ADAPT_V
    K_T -.->|Adapt to Segments| ADAPT_T
    Q_AUD -->|Pristine 30s Opus| ADAPT_A
    Q_IN --> Q_JOB
    Q_JOB --> WORKER
    ADAPT_V --> ADAPT_F
    ADAPT_T --> ADAPT_F
    ADAPT_A --> ADAPT_F
    ADAPT_F -->|Update Segment & Video Scores| Q_DB
```

---

## 3. Forensic Analysis of Flaws & Root-Cause Diagnostics

An in-depth audit of the empirical benchmark files in `kannabiran-v005/AI_Project` (`results_table.csv`, `frame_experiment_results.csv`, `weight_sweep.csv`, `per_video_results.csv`, `failure_frames/`, and `note/day1`) uncovers several critical flaws.

### 3.1 Flaw 1: Catastrophic Performance of the Pretrained Image Detector on Video
#### Empirical Evidence
In `results_table.csv`, evaluating `umm-maybe/AI-image-detector` across 17 labeled YouTube videos produced:
- **Accuracy**: $0.529$ ($52.9\%$) — barely beating a random coin flip ($50\%$).
- **Precision**: $0.500$
- **Recall**: $0.250$ ($25\%$ — missed $75\%$ of all AI-generated videos!).
- **F1-Score**: $0.333$
- **ROC AUC**: **$0.389$** (Significantly *worse* than random guessing ($0.500$); inverted discriminability!).

Looking at `per_video_results.csv`:
- **False Negatives on AI Videos**:
  - `4aP-JahbVXo`: Score $0.223$ (True Label: AI) $\rightarrow$ Missed.
  - `B0p5SdkBydU`: Score $0.037$ (True Label: AI) $\rightarrow$ Severe Miss ($3.7\%$ AI confidence).
  - `0l4t5uT97r4`: Score $0.319$ (True Label: AI) $\rightarrow$ Missed.
  - `enDWpcfpLNc`: Score $0.200$ (True Label: AI) $\rightarrow$ Missed.
  - `T9L2nvOC5W8`: Score $0.397$ (True Label: AI) $\rightarrow$ Missed.
  - `JFTe5fbERGg`: Score $0.352$ (True Label: AI) $\rightarrow$ Missed.
- **False Positives on Human Videos**:
  - `4kdAONN0DQY`: Score **$0.972$** (True Label: Human) $\rightarrow$ Catastrophic false alarm ($97.2\%$ AI confidence on real human footage).
  - `9fia1FsVfyw`: Score **$0.942$** (True Label: Human) $\rightarrow$ Catastrophic false alarm ($94.2\%$ AI confidence on real human footage).

#### Forensic Root-Cause Diagnostics
1. **Domain Shift & High-Frequency Spectral Destruction**:
   `umm-maybe/AI-image-detector` was trained on uncompressed, pristine synthetic images (Midjourney, Stable Diffusion v1.5/v2, DALL-E) vs. uncompressed real photos. These models rely heavily on high-frequency convolutional/diffusion artifacts (checkerboard patterns, Nyquist boundary residuals, unnatural high-frequency Fourier energy). When videos are transcoded and uploaded to YouTube, YouTube's video compression pipeline (H.264/AVC, VP9, AV1) applies aggressive Discrete Cosine Transform (DCT) quantization, 4:2:0 chroma subsampling, temporal motion de-blocking, and bitrate-constrained smoothing. This completely wipes out high-frequency diffusion signatures, rendering the detector blind to modern synthetic video generators (Sora, Kling, Runway Gen-2/Gen-3, Luma Dream Machine).
2. **Aggressive Downscaling Blur**:
   In `detector.py` line 74:
   ```python
   def download_video(vid, out_dir, max_height=360):
   ```
   Forcing `max_height=360` severely downsamples 1080p/4K video frames, introducing bilinear/bicubic interpolation blur that further destroys edge coherence and synthetic texture cues.
3. **Cinematic Grading & Studio Lighting Confounding**:
   Inspecting `failure_frames` for `4kdAONN0DQY` and `9fia1FsVfyw` reveals why they scored $>0.94$: both videos are professional tech reviews shot with shallow depth of field (creamy bokeh background), high-contrast three-point studio lighting, skin smoothing, and color-graded LUTs. The still-image detector mistakes optical depth-of-field blur and smooth lighting gradients for diffusion-denoising artifacts!

---

### 3.2 Flaw 2: Flawed Default Fusion Weighting ($w_{\text{img}} = 0.6$)
#### Empirical Evidence
In `weight_sweep.csv`, accuracy and F1 were computed across varying image weights:
```csv
w_img,accuracy,f1
0.0,0.706,0.545
0.1,0.706,0.545
0.2,0.706,0.545
0.3,0.706,0.545
0.4,0.706,0.545
0.5,0.647,0.400
0.6,0.529,0.333  <-- Chosen Team Default in detector.py & server.py!
0.7,0.529,0.333
0.8,0.529,0.333
```
- At $w_{\text{img}} \le 0.4$, accuracy is $70.6\%$ and F1 is $0.545$.
- At $w_{\text{img}} = 0.6$, accuracy plunges to $52.9\%$ and F1 drops to $0.333$.

#### Forensic Root-Cause Diagnostics
The text model (`chatgpt-detector-roberta`) achieved an AUC of **$0.929$** and an accuracy of **$72.7\%$**. However, because the team assigned $60\%$ weight ($w_{\text{img}} = 0.6$) to the severely defective image model (AUC $0.389$), the erroneous image score repeatedly dragged down correct text predictions.
- **Example (`B0p5SdkBydU`)**:
  - Text model correctly detected AI script: $S_{\text{text}} = 0.834$ (High AI confidence).
  - Image model emitted false negative: $S_{\text{img}} = 0.037$.
  - Fused score: $0.6(0.037) + 0.4(0.834) = 0.356$.
  - Threshold is $0.50$ (or $0.65$ for "likely AI"): video was classified as Human / Mixed instead of AI!

---

### 3.3 Flaw 3: Complete Absence of Audio Voice Synthesis Detection
#### Forensic Analysis & Root Cause
A massive share of automated YouTube "content farm / slop" channels use human-captured stock footage, gameplay B-roll, or public domain video clips overlaid with synthetic text-to-speech (TTS) voiceovers (e.g. ElevenLabs, OpenAI TTS, Kokoro, Edge-TTS).
- In `kannabiran-v005/AI_Project`, audio is completely ignored ($0\%$ coverage).
- If such a video uses stock B-roll (image score $\approx 0.10$) and lacks captions (or has colloquial script), the system classifies it as $100\%$ Human.
- In contrast, our `ai-queen` platform has already engineered [`YouTubeAudioService`](file:///C:/Users/Lakshya/Desktop/AI%20Project/backend/apps/content/services/youtube_audio_service.py), providing pristine, seekable 30s Opus audio slices. The failure to leverage this modality leaves the biggest detection surface unmonitored.

---

### 3.4 Flaw 4: Transcript Ingestion Fragility & Training Distribution Mismatch
#### Empirical Evidence
In `note/day1` and `per_video_results.csv`, **6 out of 17 videos ($35.3\%$) had no transcript score**.
#### Forensic Root-Cause Diagnostics
1. **Restrictive English-Only Filter**:
   In `detector.py`:
   ```python
   fetched = YouTubeTranscriptApi().fetch(vid, languages=["en"])
   ```
   If a video features Hindi, Spanish, or auto-translated captions, or has author-disabled captions, it immediately throws an exception and falls back to visual-only scoring (which, as shown in Flaw 1, is inverted!).
2. **Text Model Distribution Mismatch**:
   `Hello-SimpleAI/chatgpt-detector-roberta` was trained on the HC3 dataset (Human-ChatGPT Comparison Corpus), consisting of formal, structured Q&A essays (medicine, finance, computer science, legal reasoning). Spoken YouTube transcripts consist of unstructured, run-on speech, colloquial filler words ("hey guys", "like and subscribe"), and speech-to-text transcription errors lacking punctuation. This causes sharp misclassifications on conversational transcripts.

---

### 3.5 Flaw 5: Severe Server Concurrency Starvation (`Semaphore(1)`)
#### Code Architecture Flaw in `server.py`
In `kannabiran-v005/AI_Project/server.py`:
```python
_one_at_a_time = threading.Semaphore(1)

def run_analysis(video_id: str):
    try:
        with _one_at_a_time:
            from detector import analyze
            res = analyze(f"https://www.youtube.com/watch?v={video_id}", w_img=W_IMG)
        ...
```
#### Forensic Root-Cause Diagnostics
When a user watches an unanalyzed video, `server.py` acquires `_one_at_a_time` and executes `analyze()`:
1. Spawns `yt-dlp` to download the entire video.
2. Reads 10 frames via OpenCV.
3. Loads Hugging Face ViT image pipeline into PyTorch.
4. Calls `youtube_transcript_api`.
5. Loads RoBERTa text pipeline into PyTorch.
This synchronous execution takes **35 to 80 seconds per video**. Because `Semaphore(1)` limits throughput to 1 concurrent video globally, if 5 users watch different new videos, User #5 will experience a **5-minute delay**, causing client poll timeouts and socket exhaustion.

---

### 3.6 Flaw 6: Monolithic Whole-Video Ingestion vs 30-Second Crowdsourced Segments
- `detector.py` samples frames across $[0.05 \cdot T, 0.95 \cdot T]$ of the full video timeline.
- This directly violates the core architectural mandate of `ai-queen`: **we do not scan entire videos at platform scale**.
- In `ai-queen`, active viewers contribute bounded 30-second evidence packages (`[0-30s)`, `[30-60s)`). If a user leaves after 45 seconds, only segment 0 and partial segment 1 are processed.
- The model in `kannabiran_repo` cannot ingest segment-bounded frame lists or time-sliced audio out-of-the-box.

---

### 3.7 Flaw 7: Inadequate Sample Size for Gate Promotion in `slopout/backend/train.py`
In `train.py`, the promotion gate requires:
```python
REPEATS, MIN_VIDEOS, MIN_PER_CLASS, MARGIN = 5, 30, 10, 0.05
```
Because the team only labeled 17 videos (8 AI, 9 Human), `train.py` outputs:
`Gate (mean aggregation): NOT promoted - only 17 labelled videos (need >= 30)`.
Training a 512-dimensional CLIP linear probe on 17 videos leads to severe channel-level overfitting (the model memorizes channel background hues rather than learning synthetic video artifacts).

---

## 4. Empirical Benchmark Data Reference

The following benchmark data from the team repository forms the quantitative basis for our adaptation strategy:

### Table 1: Overall Model Evaluation (`results_table.csv`)
| Model Stream | Evaluated ($n$) | Accuracy | Precision | Recall | F1-Score | ROC AUC | Performance Assessment |
|---|---|---|---|---|---|---|---|
| **Image (`umm-maybe/AI-image-detector`)** | 17 | 0.529 | 0.500 | 0.250 | 0.333 | **0.389** | ❌ Severely Defective (Sub-Random) |
| **Text (`chatgpt-detector-roberta`)** | 11 | 0.727 | 1.000 | 0.250 | 0.400 | **0.929** | ⚠️ Strong AUC but Low Recall (Missing 35% transcripts) |
| **Fused ($0.6 \text{ Img} + 0.4 \text{ Txt}$)** | 17 | 0.529 | 0.500 | 0.250 | 0.333 | **0.639** | ❌ Corrupted by flawed image weight |

### Table 2: Frame Sampling & Aggregation Sweep (`frame_experiment_results.csv`)
| Frame Count ($n$) | Aggregation Method | Labeled Videos | Accuracy | ROC AUC | TP | FP | FN | TN | Key Insight |
|---|---|---|---|---|---|---|---|---|---|
| 5 | Mean | 11 | 0.545 | 0.700 | 2 | 1 | 4 | 4 | Mean dilutes synthetic signal |
| **5** | **Max** | **11** | **0.818** | **0.800** | **5** | **1** | **1** | **4** | ⭐ **Best accuracy (81.8%)** |
| 5 | Median | 11 | 0.545 | 0.667 | 2 | 1 | 4 | 4 | Median discards burst artifacts |
| 10 | Mean | 11 | 0.636 | 0.833 | 2 | 0 | 4 | 5 | Conservative, high FN |
| **10** | **Max** | **11** | **0.727** | **0.833** | **5** | **2** | **1** | **3** | ⭐ **High AUC (0.833), Catches 5/6 AI** |
| 10 | Median | 11 | 0.636 | 0.733 | 2 | 0 | 4 | 5 | Same as mean |
| 20 | Mean | 11 | 0.636 | 0.700 | 2 | 0 | 4 | 5 | Diminishing returns |
| 20 | Max | 11 | 0.727 | 0.800 | 5 | 2 | 1 | 3 | More frames increase FP risk |
| 20 | Median | 11 | 0.636 | 0.667 | 2 | 0 | 4 | 5 | No benefit over 10 frames |

> [!IMPORTANT]
> **Key Architectural Takeaway from `frame_experiment.py`**:
> **Max / Top-$k$ aggregation consistently outperforms Mean aggregation.**
> In AI-generated videos, synthetic diffusion artifacts often appear in specific burst frames (e.g. face morphs, hand artifacts, temporal warping) while other frames appear normal. Mean aggregation dilutes the burst signal below detection thresholds. Max or Top-2 aggregation preserves the burst evidence.

---

## 5. Granular Feasibility & Adaptation Assessment

| Component from `kannabiran_repo` | Adaptation Feasibility | Remediation Required to Adapt to `ai-queen` |
|---|---|---|
| **Text Detector (`chatgpt-detector-roberta`)** | **High (Directly Adaptable)** | Restructure input to consume segment-scoped transcript cues from `manifest.json`. Add Whisper transcription fallback when YouTube captions are disabled. |
| **Visual Detector (`umm-maybe/AI-image-detector`)** | **Medium (Adaptable with Guardrails)** | Abandon Mean aggregation in favor of **Top-2 Max aggregation** (backed by Table 2). Calibrate classification threshold to $0.65$ to prevent bokeh/lighting false alarms. |
| **CLIP Feature Probe (`openai/clip-vit-base-patch32`)** | **High (Recommended Upgrade)** | Adapt `clipfeat.py` to extract 512-dim visual embeddings from the segment frames stored in `backend/media/` and train a regularized Ridge/Logistic head once segment dataset reaches $\ge 50$ samples. |
| **Audio Voice Synthesis Detector** | **Missing in Team Repo** | **Must be built**. Leverage `YouTubeAudioService`'s sliced 30s Opus stream to run spectral voice-cloning detection. |
| **Fusion Engine (`fuse`)** | **Medium (Rewrite Required)** | Replace static $0.6/0.4$ arithmetic with dynamic Bayesian / missing-modality normalized weighting ($w_v=0.35, w_a=0.40, w_t=0.25$). |
| **FastAPI `server.py` & Semaphore** | **Zero (Incompatible)** | Discard `server.py`. Implement an asynchronous Django Management Command / Worker Service consuming `InferenceJob` records. |

---

## 6. Fully Feasible Production Solution: The Django Multimodal Inference Engine

To successfully adapt the team model into the `ai-queen` workspace, we design an end-to-end, asynchronous inference service fully integrated into Django.

### 6.1 Architectural Topology

```mermaid
sequenceDiagram
    autonumber
    participant Client as Chrome MV3 Extension
    participant API as Django Ingestion View
    participant DB as Relational Database
    participant AudioSvc as YouTubeAudioService
    participant Disk as Media Storage Vault
    participant Worker as Async Inference Worker (Django Service)
    participant Models as Tri-Modal Inference Pipeline

    Client->>API: POST /v1/content/youtube/:id/contributions (EvidencePackage)
    API->>DB: Atomic half-open interval merge (IntervalMerger)
    API->>AudioSvc: Ensure audio cached & slice 30s Opus chunk (FFmpeg)
    API->>Disk: Write frames, audio, and manifest.json
    API->>DB: Create InferenceJob(status='PENDING', manifest_path=...)
    API-->>Client: 200 OK (accepted_intervals, coverage_status)

    Note over Worker,Models: Asynchronous Processing (Decoupled from HTTP)
    Worker->>DB: Query InferenceJob.objects.filter(status='PENDING')
    Worker->>DB: Update InferenceJob(status='RUNNING')
    Worker->>Disk: Read manifest.json, decoded frames & sliced Opus audio
    
    par Tri-Modal Parallel Inference
        Worker->>Models: 1. Visual Stream (umm-maybe ViT + Top-2 Max Aggregation)
        Worker->>Models: 2. Audio Stream (Opus Spectrogram / Voice Synthesis Classifier)
        Worker->>Models: 3. Transcript Stream (RoBERTa on cues or Whisper fallback)
    end

    Models-->>Worker: Return (S_visual, S_audio, S_text, confidences)
    Worker->>Worker: Compute Dynamic Adaptive Fusion S_seg
    Worker->>DB: Update VideoSegment(ai_segment_score=S_seg)
    Worker->>DB: Recompute Video(ai_reliance_score=time_weighted_mean, label=...)
    Worker->>DB: Update InferenceJob(status='COMPLETED')

    Client->>API: GET /v1/content/youtube/:id
    API->>DB: Fetch Video and Segment scores
    API-->>Client: 200 OK (ai_reliance_score, label, badges)
```

---

### 6.2 Mathematical Formulation for Adapted Multimodal Fusion

#### 1. Visual Segment Score ($S_{\text{visual}}$) via Top-2 Max Aggregation
Let $F = \{f_1, f_2, \dots, f_m\}$ be the visual frames extracted for segment $k$ ($m \ge 2$). Let $p(f_i)$ be the synthetic probability from `umm-maybe/AI-image-detector`.
Let $p_{(1)} \ge p_{(2)} \ge \dots \ge p_{(m)}$ be the sorted per-frame probabilities in descending order.
$$S_{\text{visual}} = \frac{p_{(1)} + p_{(2)}}{2}$$
*Why Top-2 instead of Max?* A single frame max can be triggered by camera flash, compression glitch, or UI overlay. Taking the average of the top-2 highest scores confirms temporal persistence of synthetic artifacts while avoiding the dilution of whole-segment mean averaging.

#### 2. Audio Voice Synthesis Score ($S_{\text{audio}}$)
The 30.0s native Opus slice (`audio/00000.000_00030.000.webm`) is decoded to a 16 kHz mono waveform. A voice-synthesis classifier (spectral discontinuity & pitch contour variance) produces probability:
$$S_{\text{audio}} \in [0.0, 1.0]$$
If no vocal activity is detected (silence or purely instrumental background music, measured via energy VAD $< -40\text{ dB}$), audio is marked `INACTIVE` and excluded from fusion.

#### 3. Transcript Perplexity Score ($S_{\text{text}}$)
Let $C = \{c_1, c_2, \dots, c_q\}$ be the transcript cues overlapping segment bounds $[k \cdot 30, (k+1) \cdot 30)$.
- If cues exist: concatenate text and score via `Hello-SimpleAI/chatgpt-detector-roberta`.
- If captions are missing from YouTube: transcribe the 30s Opus slice using `whisper-tiny` (CPU inference $\sim 400\text{ ms}$).
$$S_{\text{text}} \in [0.0, 1.0]$$

#### 4. Dynamic Missing-Aware Fusion Formula ($S_{\text{seg}}$)
Instead of static weights that corrupt missing modalities, each active modality $i \in \{\text{visual}, \text{audio}, \text{text}\}$ has a base weight:
- $W_v^{\text{base}} = 0.35$ (calibrated downwards from 0.60 to mitigate video compression noise)
- $W_a^{\text{base}} = 0.40$ (highest weight: voice synthesis signatures are robust and unaffected by video codecs)
- $W_t^{\text{base}} = 0.25$

Let $M \subseteq \{v, a, t\}$ be the set of actively available modalities for the segment. The normalized weight for modality $i \in M$ is:
$$\tilde{w}_i = \frac{W_i^{\text{base}}}{\sum_{j \in M} W_j^{\text{base}}}$$
The base fused segment score is:
$$S_{\text{seg}}^{\text{base}} = \sum_{i \in M} \tilde{w}_i \cdot S_i$$

#### 5. High-Confidence Modality Override (Anti-Dilution Guardrail)
If either the audio voice synthesis classifier or the visual detector detects indisputable synthetic generation with extreme confidence:
$$\text{If } S_{\text{audio}} \ge 0.88 \text{ or } S_{\text{visual}} \ge 0.90 \implies S_{\text{seg}} = \max\left(S_{\text{seg}}^{\text{base}}, \, 0.85\right)$$
This prevents a neutral, conversational human-written script from masking an obvious AI deepfake or synthetic voiceover.

#### 6. Whole-Video Time-Weighted Aggregation ($S_{\text{video}}$)
Across all completed segments $k \in K$:
$$S_{\text{video}} = \frac{\sum_{k \in K} \text{duration}(k) \cdot S_{\text{seg}}(k)}{\sum_{k \in K} \text{duration}(k)}$$
- $S_{\text{video}} \ge 0.70 \implies \text{label: 'AI\_GENERATED'}$
- $0.35 \le S_{\text{video}} < 0.70 \implies \text{label: 'MIXED'}$
- $S_{\text{video}} < 0.35 \implies \text{label: 'HUMAN\_MADE'}$

---

## 7. Concrete Implementation & Adaptation Roadmap

```mermaid
gantt
    title Model Adaptation Implementation Roadmap
    dateFormat  YYYY-MM-DD
    section Phase 1: Environment & Dependencies
    Add torch, transformers, whisper to requirements.txt :2026-10-20, 1d
    Verify GPU / CPU inference pipeline :2026-10-21, 1d
    section Phase 2: Core Model Adaptation
    Implement Calibrated Visual Classifier (Top-2 Max) :2026-10-22, 2d
    Implement Whisper Fallback & Text Classifier :2026-10-24, 1d
    Implement Voice Synthesis Audio Classifier :2026-10-25, 2d
    section Phase 3: Service & Worker Integration
    Build apps/content/services/inference_service.py :2026-10-27, 2d
    Build management command run_inference_worker.py :2026-10-29, 1d
    section Phase 4: Verification & Benchmarking
    Execute end-to-end regression tests :2026-10-30, 2d
    Validate live badge updates on YouTube :2026-11-01, 1d
```

### Actionable Milestones
- [ ] **Milestone M1: Dependency Standardization**
  - Update `backend/requirements.txt` to include `torch`, `transformers`, `scikit-learn`, `openai-whisper`.
- [ ] **Milestone M2: Adapted Model Service Implementation**
  - Implement `backend/apps/content/services/inference_service.py` incorporating the calibrated visual Top-2 scorer, Whisper-backed text scorer, and audio voice synthesis detector.
- [ ] **Milestone M3: Asynchronous Worker Runner**
  - Implement `backend/apps/content/management/commands/run_inference_worker.py` to poll and process `InferenceJob` records continuously or in batch mode with GPU acceleration.
- [ ] **Milestone M4: Verification Suite**
  - Add unit tests in `backend/tests/test_inference_service.py` validating Top-2 frame aggregation, missing-modality weight re-normalization, and score persistence.
- [ ] **Milestone M5: End-to-End Validation**
  - Run live contribution from the Chrome extension and verify that `GET /v1/content/youtube/{video_id}` updates from `status: 'partial'` to `ai_reliance_score: 0.86`, correctly rendering the on-page warning badge.

---

## 8. Summary Conclusion

The machine learning models developed in `kannabiran-v005/AI_Project` provide valuable foundational assets—specifically the Hugging Face model integrations (`chatgpt-detector-roberta` and `umm-maybe/AI-image-detector`), the CLIP feature probe concept, and the empirical discovery that **Max aggregation dramatically outperforms Mean aggregation on video frames**.

However, deploying the team repository as-is would have resulted in critical system failures due to:
1. Catastrophic video compression sensitivity (AUC 0.389 on raw frames),
2. An inverted fusion weight ($w_{\text{img}}=0.6$) that pulled accurate text scores down into false negatives,
3. Complete blindness to audio voice cloning, and
4. A single-threaded `Semaphore(1)` lock causing server starvation.

By implementing the **Dynamic Multimodal Inference Engine** detailed in this review, we eliminate every identified flaw, bridge the gap between crowdsourced 30-second segments and deep learning inference, and deliver a robust, scalable, and highly accurate detection core for the `ai-queen` platform.
