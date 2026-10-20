# AI Content Detection Documentation Vault

Welcome to the centralized documentation vault for the **Crowdsourced Client-Side AI Content Detection System for YouTube**.

This directory organizes all project documentation, specifications, forensic memos, and implementation plans across the lifecycle of the project.

---

## 📌 Master Starting Point for Developers

If you are an incoming engineer or team member (Lakshya Dubey, V Kannabiran, Armaan Z Hussain, Nishanth M), start here:

👉 **[`docs/DEVELOPER_GUIDE_AND_SESSION_LOG.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/DEVELOPER_GUIDE_AND_SESSION_LOG.md)**: The authoritative single-source-of-truth detailing **what has been done, why, and how**, complete provenance attribution, key technical insights (MSE demuxing, Chromium WebM bug resolution, `yt-dlp` server-side audio pipeline), and the Phase 3 developer roadmap.

---

## 📁 Directory Structure & Document Taxonomy

```
docs/
├── DEVELOPER_GUIDE_AND_SESSION_LOG.md # ⭐ Master developer onboarding guide & complete session log
├── README.md                         # ⭐ THIS FILE: Directory index & document map
│
├── memo/                             # In-depth technical engineering memos & retrospectives
│   ├── TEAM_REPOSITORY_COMPATIBILITY_AND_ADAPTATION_REVIEW.md # ⭐ Master compatibility & flaw review of team ML repo
│   ├── AI_MODEL_ENSEMBLE_SPECIFICATION.md   # ⭐ Concrete multimodal inference engine & worker spec
│   ├── SESSION_HANDOFF_AND_ARCHITECTURE.md # Master architectural handoff & verification record
│   ├── BACKEND_ARCHITECTURE_AND_HANDOFF.md  # Ingestion API contract, SQL schema & inference specs
│   ├── WALKTHROUGH.md                       # Server-side audio transition & Qp2zfpqogxU forensic audit
│   ├── EXTENSION_WALKTHROUGH.md             # Extension completion walkthrough & unit test matrix
│   ├── AUDIO_CAPTURE_ANALYSIS_AND_MEMO.md   # YouTube MSE demuxing audit & tabCapture sandbox memo
│   ├── MOTION_ADAPTIVE_FRAME_SAMPLING_MEMO.md # Motion-adaptive frame sampling specification (Implemented)
│   ├── MOTION_ADAPTIVE_SAMPLING_WALKTHROUGH.md # ⭐ Walkthrough of completed pixelmatch sampling engine
│   ├── FRAME_QUOTA_DRIFT_ROOT_CAUSE_REPORT.md # Frame quota drift root-cause report
│   ├── END_TO_END_AUDIO_CAPTION_COVERAGE_AUDIT.md # Audio and caption coverage audit
│   └── MODULAR_SCORING_PIPELINE_WALKTHROUGH.md # ⭐ Walkthrough of completed modular multi-component scoring engine
│
└── plans/                            # Foundational specifications & session implementation plans
    ├── design plans/                 # 📂 External / Pre-Existing Foundational Plans
    │   ├── AI lab abstract.pdf       # Academic project abstract & team ownership
    │   └── extension_scope.md        # Authoritative 17-section product & security specification
    │
    ├── implementation plans/         # 📂 External / Pre-Existing Implementation Plans
    │   └── extension_input_collection_oop_implementation_plan.pdf # 14-page initial OOP blueprint
    │
    ├── EXTENSION_IMPLEMENTATION_PLAN.md                     # Revised extension OOP plan (Phase 1)
    ├── extension_input_collection_oop_plan.md               # Source markdown for OOP plan
    ├── tab_audio_capture_and_popup_ux_plan.md               # TabCapture & popup UX plan (Phase 3 spike)
    ├── youtube_audio_root_cause_and_multi_layer_fix_plan.md # Multi-layer audio fix plan
    ├── server_side_audio_pipeline_and_client_simplification_plan.md # Approved server-side audio plan
    ├── motion_adaptive_frame_sampling_plan.md               # Motion-adaptive sampling plan
    ├── motion_adaptive_frame_sampling_optimization_plan.md  # ⭐ Implemented Mapbox pixelmatch sampling plan
    ├── FRAME_QUOTA_AND_MODALITY_ALIGNMENT_IMPLEMENTATION_PLAN.md # Quota and modality alignment fix plan
    ├── developer_documentation_reorganization_plan.md       # Documentation reorganization plan
    └── MODULAR_SCORING_PIPELINE_PLAN.md                     # ⭐ Implemented Modular Multi-Component AI Scoring Plan
```

---

## 🧭 Provenance & Document Index

Every document in this vault is indexed below with its authorial provenance:

### 1. Master Reference Guides
* **[`DEVELOPER_GUIDE_AND_SESSION_LOG.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/DEVELOPER_GUIDE_AND_SESSION_LOG.md)** *(Maintained & Reorganized in THIS Session)*: Comprehensive onboarding manual, architecture walkthrough, multi-session provenance matrix, and developer roadmap.
* **[`README.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/README.md)** *(Maintained in THIS Session)*: This directory index.

### 2. Engineering Memos (`docs/memo/`)
* **[`TEAM_REPOSITORY_COMPATIBILITY_AND_ADAPTATION_REVIEW.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/memo/TEAM_REPOSITORY_COMPATIBILITY_AND_ADAPTATION_REVIEW.md)** *(Authored in THIS Session)*: Comprehensive compatibility, adaptation, and forensic flaw review report of team member V. Kannabiran's ML repository (`kannabiran-v005/AI_Project`), root-cause diagnostics of visual model collapse, and feasible production adaptation plan.
* **[`AI_MODEL_ENSEMBLE_SPECIFICATION.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/memo/AI_MODEL_ENSEMBLE_SPECIFICATION.md)** *(Authored in THIS Session)*: Concrete technical specification for Milestone B5 Multimodal Inference Engine, Top-2 frame aggregation, dynamic Bayesian fusion math, and Django async worker service.
* **[`BACKEND_ARCHITECTURE_AND_HANDOFF.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/memo/BACKEND_ARCHITECTURE_AND_HANDOFF.md)** *(Authored in Prior Session - Phase 2)*: Django Ingestion Server specification, database schemas, REST API contract (`GET` & `POST`), and multimodal manifest format (`manifest.json` / `llm-input.md`).
* **[`AUDIO_CAPTURE_ANALYSIS_AND_MEMO.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/memo/AUDIO_CAPTURE_ANALYSIS_AND_MEMO.md)** *(Authored in THIS Session - Phase 2)*: Technical analysis of YouTube's Media Source Extension (MSE) demuxing, Chrome security gesture barriers, and tabCapture constraints.
* **[`SESSION_HANDOFF_AND_ARCHITECTURE.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/memo/SESSION_HANDOFF_AND_ARCHITECTURE.md)** *(Authored in Prior Session, Updated in THIS Session)*: High-level architectural handoff, 100% verification matrix across 3 test runners, and Phase 3 handoff diagram.
* **[`EXTENSION_WALKTHROUGH.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/memo/EXTENSION_WALKTHROUGH.md)** *(Authored in Prior Session - Phase 1)*: Chrome MV3 extension walkthrough, OOP domain patterns, 40 Vitest unit tests, and Playwright autonomous browser review results.
* **[`WALKTHROUGH.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/memo/WALKTHROUGH.md)** *(Authored by Other Agentic Session - Pending Separate Review)*: Forensic RCA of `Qp2zfpqogxU`'s unplayable WebM file, Chromium `MediaRecorder` async flush bug resolution, and implementation of the server-side `yt-dlp` audio pipeline.
* **[`MOTION_ADAPTIVE_FRAME_SAMPLING_MEMO.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/memo/MOTION_ADAPTIVE_FRAME_SAMPLING_MEMO.md)** *(Updated in THIS Session)*: Technical specification for motion-adaptive frame sampling (~55% payload reduction; updated to Implemented & Verified).
* **[`MOTION_ADAPTIVE_SAMPLING_WALKTHROUGH.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/memo/MOTION_ADAPTIVE_SAMPLING_WALKTHROUGH.md)** *(Authored in THIS Session)*: Technical walkthrough and test audit of the completed Mapbox `pixelmatch` motion-adaptive sampling implementation.
* **[`FRAME_QUOTA_DRIFT_ROOT_CAUSE_REPORT.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/memo/FRAME_QUOTA_DRIFT_ROOT_CAUSE_REPORT.md)** *(Authored in THIS Session)*: Root-cause analysis of periodic sampling and backend quota drift.
* **[`END_TO_END_AUDIO_CAPTION_COVERAGE_AUDIT.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/memo/END_TO_END_AUDIO_CAPTION_COVERAGE_AUDIT.md)** *(Authored in THIS Session)*: End-to-end audit of server audio and transcript evidence.

### 3. Foundational External Plans (`docs/plans/design plans/` & `docs/plans/implementation plans/`)
* **[`AI lab abstract.pdf`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/plans/design%20plans/AI%20lab%20abstract.pdf)** *(Pre-existing / External Academic Team)*: Original project abstract, problem statement, crowdsourcing rationale, and student ownership roles.
* **[`extension_scope.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/plans/design%20plans/extension_scope.md)** *(Pre-existing / External Project Lead)*: Authoritative 17-section product and security specification.
* **[`extension_input_collection_oop_implementation_plan.pdf`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/plans/implementation%20plans/extension_input_collection_oop_implementation_plan.pdf)** *(Pre-existing / External Prior Session)*: 14-page initial OOP implementation blueprint.

### 4. Implementation Plans (`docs/plans/`)
* **[`EXTENSION_IMPLEMENTATION_PLAN.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/plans/EXTENSION_IMPLEMENTATION_PLAN.md)** *(Authored in Prior Session - Phase 1)*: Detailed 5-phase OOP implementation plan for the Chrome extension.
* **[`extension_input_collection_oop_plan.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/plans/extension_input_collection_oop_plan.md)** *(Authored in Prior Session - Phase 1)*: Source markdown for extension OOP plan.
* **[`server_side_audio_pipeline_and_client_simplification_plan.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/plans/server_side_audio_pipeline_and_client_simplification_plan.md)** *(Authored by Other Agentic Session - Pending Separate Review)*: Architectural plan proposing transition of audio capture to backend `yt-dlp` service.
* **[`motion_adaptive_frame_sampling_plan.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/plans/motion_adaptive_frame_sampling_plan.md)** *(Authored by Other Agentic Session - Pending Separate Review)*: Initial plan for motion-adaptive frame sampling research.
* **[`motion_adaptive_frame_sampling_optimization_plan.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/plans/motion_adaptive_frame_sampling_optimization_plan.md)** *(Authored & Implemented in THIS Session)*: Approved and executed implementation plan for Mapbox `pixelmatch` motion-adaptive sampling.
* **[`tab_audio_capture_and_popup_ux_plan.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/plans/tab_audio_capture_and_popup_ux_plan.md)** *(Authored by Other Agentic Session - Pending Separate Review)*: Intermediate plan exploring tabCapture popup UX before server-side transition.
* **[`youtube_audio_root_cause_and_multi_layer_fix_plan.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/plans/youtube_audio_root_cause_and_multi_layer_fix_plan.md)** *(Authored by Other Agentic Session - Pending Separate Review)*: Multi-layer audio fix plan.
* **[`developer_documentation_reorganization_plan.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/plans/developer_documentation_reorganization_plan.md)** *(Authored by Other Agentic Session - Pending Separate Review)*: Plan for documentation directory organization.
* **[`FRAME_QUOTA_AND_MODALITY_ALIGNMENT_IMPLEMENTATION_PLAN.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/plans/FRAME_QUOTA_AND_MODALITY_ALIGNMENT_IMPLEMENTATION_PLAN.md)** *(Authored in THIS Session)*: Implementation plan for cumulative quota accounting and modality alignment.

---

## ⚡ Role-Based Quickstart Links

- **Full-Stack Developer**: Start with [`DEVELOPER_GUIDE_AND_SESSION_LOG.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/DEVELOPER_GUIDE_AND_SESSION_LOG.md).
- **Backend / Audio Engineer**: Consult [`BACKEND_ARCHITECTURE_AND_HANDOFF.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/memo/BACKEND_ARCHITECTURE_AND_HANDOFF.md) and [`WALKTHROUGH.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/memo/WALKTHROUGH.md).
- **Frontend / Extension Engineer**: Consult [`EXTENSION_WALKTHROUGH.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/memo/EXTENSION_WALKTHROUGH.md) and [`AUDIO_CAPTURE_ANALYSIS_AND_MEMO.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/memo/AUDIO_CAPTURE_ANALYSIS_AND_MEMO.md).
- **AI / ML Model Engineer**: Consult [`BACKEND_ARCHITECTURE_AND_HANDOFF.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/memo/BACKEND_ARCHITECTURE_AND_HANDOFF.md) Section 4 (Inference Worker Contract) and [`MOTION_ADAPTIVE_FRAME_SAMPLING_MEMO.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/memo/MOTION_ADAPTIVE_FRAME_SAMPLING_MEMO.md).
