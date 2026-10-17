# Implementation Plan: Motion-Adaptive Frame Sampling Architecture & Backlog Memo

## Goal Description

Currently, the Chrome extension captures visual evidence at a fixed static cadence (every 5.0s of video playback), producing 6 frames per 30s segment regardless of video dynamics.
The user requested an evaluation as a senior developer of **motion-adaptive frame sampling** to reduce evidence payload size and storage, with a detailed technical memo marking it as a **TODO suggestion / backlog enhancement** rather than an immediate disruptive goal.

This plan outlines:
1. The feasibility analysis and algorithmic design of client-side motion detection (e.g., 32x32 low-resolution luminance delta).
2. The quantitative impact on bandwidth, storage, and downstream AI vision token costs.
3. The creation of a formal engineering memo ([`docs/memo/MOTION_ADAPTIVE_FRAME_SAMPLING_MEMO.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/memo/MOTION_ADAPTIVE_FRAME_SAMPLING_MEMO.md)) containing architecture diagrams, pseudocode, threshold calibration guidelines, and integration requirements.
4. Marking the task as a clean, self-contained backlog TODO for future phases.

---

## Technical Feasibility & Architectural Concept

### 1. The Core Idea: Dual-Canvas Downsampled Motion Gate
Instead of running expensive computer vision or full-frame diffing in the content script:
- Maintain an off-DOM 32x32 scratch `<canvas>` (1,024 pixels).
- On each active-watch tick (250ms), draw `<video>` to the 32x32 canvas (takes **~0.05ms** of GPU/CPU time).
- Extract grayscale luminance values $Y = 0.299R + 0.587G + 0.114B$.
- Compute the Mean Absolute Difference (MAD) against the previous keyframe:
  $$\Delta = \frac{1}{1024} \sum_{i=1}^{1024} |Y_{\text{current}}[i] - Y_{\text{previous}}[i]|$$

### 2. Hybrid Adaptive Cadence Rules
To balance bandwidth savings with safety:
- **Min Cadence (Debounce)**: 1.5s (prevents burst uploads during action scenes).
- **Motion Trigger**: Sample immediately if $\Delta \ge \tau$ (e.g. $\tau = 0.08$ or $8\%$ average change).
- **Heartbeat (Max Cadence)**: Force a sample every 10.0s even if completely static (preserves temporal ground truth).
- **Segment Boundary Guard**: Always guarantee at least 2 frames per segment to satisfy the backend sufficiency rule ($\text{frame\_count} \ge 2$).

### 3. Quantitative Impact Matrix

| Content Type | Current (Fixed 5s) | Motion-Adaptive (Proposed) | Payload Reduction |
|---|---|---|---|
| **Podcast / Talking Head** | 6 frames (~900 KB) | 2–3 frames (~300–450 KB) | **50% – 66% reduction** |
| **Slide Deck / Tutorial** | 6 frames (~800 KB) | 2 frames (~250 KB) | **70% reduction** |
| **High Action / Vlog** | 6 frames (~1,200 KB) | 6–8 frames (~1,200–1,500 KB) | Dynamic coverage of rapid cuts |
| **Average Across Dataset** | ~1 MB / segment | ~450 KB / segment | **~55% total reduction** |

---

## User Review Required

> [!NOTE]
> **Purely Architectural & Non-Breaking**:
> As requested by the user, this task will **not modify the active production capture code** or break existing tests. It will deliver a comprehensive, actionable technical memo in [`docs/memo/MOTION_ADAPTIVE_FRAME_SAMPLING_MEMO.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/memo/MOTION_ADAPTIVE_FRAME_SAMPLING_MEMO.md) and update documentation registries, categorizing the implementation as a **Phase 4/5 Backlog TODO**.

---

## Proposed Changes

### Documentation & Architecture

#### [NEW] `docs/memo/MOTION_ADAPTIVE_FRAME_SAMPLING_MEMO.md`
A comprehensive engineering memo covering:
1. **Executive Summary & Motivation**: Current fixed-cadence vs adaptive sampling.
2. **Algorithmic Specification**:
   - 32x32 scratch canvas sampling.
   - Mean Absolute Difference (MAD) calculation.
   - Dynamic thresholding ($\tau_{\text{scene\_cut}}$, $\tau_{\text{motion}}$, $\tau_{\text{static}}$).
3. **Edge Case Analysis**:
   - Deepfake facial micro-movements vs global background motion.
   - Rolling ticker bars / captions triggering false motion.
   - Central cropping / facial focus mask options.
4. **Implementation Blueprint (TypeScript)**:
   - Ready-to-integrate `MotionAdaptiveFrameSampler` class.
5. **Backlog Checklist & Acceptance Criteria** for when the team chooses to activate the feature.

#### [MODIFY] `docs/SESSION_HANDOFF_AND_ARCHITECTURE.md`
- Add reference to `docs/memo/MOTION_ADAPTIVE_FRAME_SAMPLING_MEMO.md` in the architectural roadmap section.

---

## Verification Plan

### Automated Checks
- Verify markdown formatting and Mermaid diagram syntax.
- Ensure all existing unit tests (`npm test` in `extension/`) and backend tests (`python manage.py test` in `backend/`) remain 100% green without side effects.

### Deliverables
- [`docs/memo/MOTION_ADAPTIVE_FRAME_SAMPLING_MEMO.md`](file:///C:/Users/Lakshya/Desktop/AI%20Project/docs/memo/MOTION_ADAPTIVE_FRAME_SAMPLING_MEMO.md) committed to the repository.
- Walkthrough updated.
