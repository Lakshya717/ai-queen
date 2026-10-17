# Crowdsourced Client-Side AI Content Detection System for YouTube

> An organic, privacy-safe, crowdsourced architecture for detecting, scoring, and filtering AI-generated content on YouTube desktop.

---

## 1. Project Overview & Architectural Vision

Centralized scanning of YouTube videos at platform scale is computationally prohibitive and bandwidth-intensive. This project solves that bottleneck through a decentralized, organic crowdsourcing model:
1. **Lightweight Client Collection**: The first active viewer of an unmapped or partially mapped YouTube video contributes bounded visual, audio, and transcript evidence strictly for the timestamp intervals they actually watch.
2. **Backend Structuring & Inference**: Contributed evidence is uploaded to an asynchronous backend structuring workflow and classified by a multimodal ensemble of deep learning models (visual deepfake detectors, voice synthesis classifiers, and transcript perplexity analyzers).
3. **Shared Centralized Cache**: The resulting AI-reliance scores (0.0 to 1.0) and segment coverage maps are cached in a centralized database so all subsequent viewers instantly receive the score without re-analyzing the video.

---

## 2. Repository Layout & Organization

The repository is organized into decoupled, modular top-level components:

```
├── docs/                                 # Centralized Documentation & Architecture Vault
│   ├── DEVELOPER_GUIDE_AND_SESSION_LOG.md # ⭐ Master developer onboarding guide & complete session log
│   ├── README.md                         # Documentation directory index & provenance matrix
│   ├── memo/                             # Technical engineering memos & architectural retrospectives
│   │   ├── SESSION_HANDOFF_AND_ARCHITECTURE.md # Master architectural handoff
│   │   ├── BACKEND_ARCHITECTURE_AND_HANDOFF.md # Ingestion API, DB schema & inference specs
│   │   ├── WALKTHROUGH.md               # Server-side audio pipeline & Qp2zfpqogxU forensic audit
│   │   ├── EXTENSION_WALKTHROUGH.md     # Extension completion walkthrough & unit test matrix
│   │   ├── AUDIO_CAPTURE_ANALYSIS_AND_MEMO.md # YouTube MSE demuxing & Chrome sandbox audit
│   │   └── MOTION_ADAPTIVE_FRAME_SAMPLING_MEMO.md # 32x32 luminance delta sampling (Backlog TODO)
│   └── plans/                            # Foundational specifications & session plans
│       ├── design plans/                 # External / pre-existing foundational design plans
│       └── implementation plans/         # External / pre-existing OOP implementation blueprints
│
├── extension/                            # Production Chrome Manifest V3 Extension
│   ├── manifest.json                     # Chrome MV3 extension manifest
│   ├── package.json                      # Build & test scripts
│   ├── tsconfig.json                     # Strict TypeScript configuration
│   ├── vitest.config.ts                  # Unit test runner configuration
│   ├── README.md                         # Extension-specific installation & development guide
│   ├── scripts/
│   │   └── build.mjs                     # Fast esbuild bundler (emits to dist/ in <2s)
│   ├── src/                              # Full modular OOP source code
│   │   ├── domain/                       # Pure value objects, specifications & state machine
│   │   ├── ports/                        # 8 abstract port interfaces
│   │   ├── adapters/                     # Mock, YouTube, Media, Storage & HTTP adapters
│   │   ├── extensions/                   # Badges & filter strategies
│   │   └── contexts/                     # Content script, Service Worker, Offscreen & Popup
│   ├── tests/
│   │   ├── unit/                         # 5 Vitest suites (40 unit tests, 100% pass)
│   │   └── e2e/                          # Playwright autonomous browser review suite
│   └── dist/                             # Compiled, ready-to-load unpacked Chrome extension
│
├── prototype/                            # Legacy Technical Prototype (Retained for reference)
│   ├── captures/
│   ├── extension/
│   └── tests/
│
└── backend/                              # Production Django Ingestion & Structuring Server
    ├── aidetect_backend/                 # Settings, ASGI/WSGI, CORS & root URL routing
    ├── apps/
    │   └── content/                      # Ingestion API views, models, serializers, admin & services
    │       ├── services/                 # Interval merger, media storage, transcript & manifest services
    │       └── management/commands/      # Development superuser seeding ('init_admin')
    ├── tests/                            # Comprehensive Django test suite (17 tests, 100% pass)
    ├── media/                            # Structured media vault (media/youtube/<video_id>/...)
    └── manage.py                         # Django administrative runner
```

---

## 3. Quickstart Guides

### Loading the Chrome Extension
1. Navigate into the extension folder and build:
   ```bash
   cd extension
   npm install
   npm run build
   ```
2. Open Google Chrome and go to `chrome://extensions`.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select the `extension/dist/` directory.
5. Open any YouTube video (`https://www.youtube.com/watch?v=...`) to test active watching and badges.

### Running the Django Backend Server
1. Navigate into the backend folder and apply migrations:
   ```bash
   cd backend
   python manage.py migrate
   ```
2. (Optional) Initialize the local inspection admin user (`admin` / `admin123`):
   ```bash
   python manage.py init_admin
   ```
3. Start the development server on port 8000:
   ```bash
   python manage.py runserver 8000
   ```
4. Access the Django Admin visual dashboard at `http://localhost:8000/admin/` or query endpoints at `http://localhost:8000/v1/content/youtube/<video_id>`.

### Running Automated Tests
* **Backend Unit & Integration Tests (20 tests across 6 test modules, 100% pass)**:
  ```bash
  cd backend
  python manage.py test tests
  ```
* **Extension Unit Tests (Vitest - 40 tests across 5 suites, 100% pass)**:
  ```bash
  cd extension
  npm test
  ```
* **Extension Autonomous Browser Review (Playwright E2E in real Chromium)**:
  ```bash
  cd extension
  npm run test:e2e
  ```

---

## 4. Key Documentation Links

For full technical context without needing to review past conversational transcripts, consult the documentation vault in `docs/`:

* **⭐ Master Developer Onboarding Guide & Session Log (START HERE)**:  
  [`docs/DEVELOPER_GUIDE_AND_SESSION_LOG.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/DEVELOPER_GUIDE_AND_SESSION_LOG.md)
* **Documentation Vault Index & Provenance Map**:  
  [`docs/README.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/README.md)
* **Master Architecture Handoff & Verification Record**:  
  [`docs/memo/SESSION_HANDOFF_AND_ARCHITECTURE.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/memo/SESSION_HANDOFF_AND_ARCHITECTURE.md)
* **Backend Ingestion API Contract, SQL Schema & Inference Specs**:  
  [`docs/memo/BACKEND_ARCHITECTURE_AND_HANDOFF.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/memo/BACKEND_ARCHITECTURE_AND_HANDOFF.md)
* **Server-Side Audio Pipeline & Qp2zfpqogxU Forensic Walkthrough**:  
  [`docs/memo/WALKTHROUGH.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/memo/WALKTHROUGH.md)
* **Extension Verification Walkthrough & Unit Test Audit**:  
  [`docs/memo/EXTENSION_WALKTHROUGH.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/memo/EXTENSION_WALKTHROUGH.md)
* **YouTube MSE Audio Demuxing & Sandbox Constraints Memo**:  
  [`docs/memo/AUDIO_CAPTURE_ANALYSIS_AND_MEMO.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/memo/AUDIO_CAPTURE_ANALYSIS_AND_MEMO.md)
* **Motion-Adaptive Frame Sampling Feasibility Memo (Backlog TODO)**:  
  [`docs/memo/MOTION_ADAPTIVE_FRAME_SAMPLING_MEMO.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/memo/MOTION_ADAPTIVE_FRAME_SAMPLING_MEMO.md)
* **Foundational Design Documents**:  
  [`docs/plans/design plans/extension_scope.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/plans/design%20plans/extension_scope.md) and [`docs/plans/design plans/AI lab abstract.pdf`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/plans/design%20plans/AI%20lab%20abstract.pdf)
