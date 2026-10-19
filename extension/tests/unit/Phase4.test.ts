import { describe, it, expect, beforeEach } from 'vitest';
import { BadgePresenter } from '../../src/extensions/badges/BadgePresenter';
import { MarkOnlyFilterStrategy } from '../../src/extensions/filtering/MarkOnlyFilterStrategy';
import { ThresholdHideFilterStrategy } from '../../src/extensions/filtering/ThresholdHideFilterStrategy';
import type { VideoLookupResponseDto } from '../../src/ports/IBackendApiAdapter';
import type { BadgeState } from '../../src/ports/IBadgeAndFilterExtension';
import { setupMockDom } from './mockDom';

describe('Phase 4: Badges Presenter & Filtering Strategies (Review Loop 4 - Test #13)', () => {
  beforeEach(() => {
    setupMockDom();
  });
  describe('BadgePresenter 7-State Rendering', () => {
    let presenter: BadgePresenter;

    beforeEach(() => {
      presenter = new BadgePresenter();
    });

    it('renders analyzed badge with high and low reliance styles', () => {
      const container = document.createElement('div');

      // High AI reliance (>= 70%)
      presenter.renderBadge(container, 'analyzed', { score: 0.85, label: 'AI_GENERATED' });
      expect(container.querySelector('.yt-ai-badge-analyzed')).not.toBeNull();
      expect(container.querySelector('.yt-ai-badge-high')).not.toBeNull();
      expect(container.textContent).toContain('85%');

      // Low AI reliance (< 70%)
      presenter.renderBadge(container, 'analyzed', { score: 0.2, label: 'HUMAN_MADE' });
      expect(container.querySelector('.yt-ai-badge-low')).not.toBeNull();
      expect(container.textContent).toContain('20%');
    });

    it('renders all remaining 6 badge states cleanly', () => {
      const states: BadgeState[] = [
        'partially_analyzed',
        'collecting_evidence',
        'processing',
        'not_analyzed',
        'insufficient_evidence',
        'unavailable',
      ];

      for (const st of states) {
        const container = document.createElement('div');
        presenter.renderBadge(container, st, { coveredSegments: 2, totalSegments: 4 });
        expect(container.querySelector(`.yt-ai-badge-${st}`)).not.toBeNull();
        expect(container.textContent?.length).toBeGreaterThan(0);
      }
    });

    it('renders popover HUD with multi-component modality breakdown', () => {
      const container = document.createElement('div');
      presenter.renderBadge(container, 'analyzed', {
        score: 0.85,
        label: 'AI_GENERATED',
        confidence: 0.90,
        componentSummary: {
          modalityAverages: {
            visual: 0.82,
            text: 0.88,
            temporal: 0.45,
            audio: 0.50,
          },
          componentsEvaluated: ['kannabiran_visual_scorer', 'transcript_perplexity_scorer'],
          totalEvaluations: 4,
        },
      });

      // Assert interactive arrow and popover presence
      expect(container.querySelector('.yt-ai-badge-interactive')).not.toBeNull();
      expect(container.querySelector('.yt-ai-badge-arrow')).not.toBeNull();
      const popover = container.querySelector('.yt-ai-popover');
      expect(popover).not.toBeNull();

      // Assert modality scores displayed in text
      expect(popover?.textContent).toContain('Visual Synthesis');
      expect(popover?.textContent).toContain('82%');
      expect(popover?.textContent).toContain('Script / Text Model');
      expect(popover?.textContent).toContain('88%');
      expect(popover?.textContent).toContain('Temporal Continuity');
      expect(popover?.textContent).toContain('45%');
      expect(popover?.textContent).toContain('Audio / Voice Clone');
      expect(popover?.textContent).toContain('50%');

      // Assert component tags
      expect(popover?.textContent).toContain('kannabiran_visual');
      expect(popover?.textContent).toContain('transcript_perplexity');
      expect(popover?.textContent).toContain('Confidence: 90%');
    });

    it('renders peak anomaly diagnostics from segment details', () => {
      const container = document.createElement('div');
      presenter.renderBadge(container, 'analyzed', {
        score: 0.85,
        label: 'AI_GENERATED',
        segments: [
          {
            index: 0,
            startSeconds: 0,
            endSeconds: 30,
            coverage: 'complete',
            aiSegmentScore: 0.85,
            components: [
              {
                componentName: 'kannabiran_visual_scorer',
                modality: 'visual',
                score: 0.88,
                status: 'SUCCESS',
                details: {
                  peakAnomalyTimestamp: 15.2,
                  anomalyExplanation: 'Isolated synthetic cutaway detected',
                },
              },
            ],
          },
        ],
      });

      const popover = container.querySelector('.yt-ai-popover');
      expect(popover).not.toBeNull();
      expect(popover?.textContent).toContain('Peak Anomaly at 00:15');
      expect(popover?.textContent).toContain('Isolated synthetic cutaway detected');
      expect(container.querySelector('.yt-ai-popover-diagnostics.has-anomaly')).not.toBeNull();
    });
  });

  describe('Filtering Strategies & Fail-Open Invariant (Test #13)', () => {
    it('MarkOnlyFilterStrategy never hides any cards', () => {
      const strategy = new MarkOnlyFilterStrategy();
      const card = document.createElement('div');

      const completeHighAi: VideoLookupResponseDto = {
        videoId: 'vid1',
        status: 'complete',
        label: 'AI_GENERATED',
        aiRelianceScore: 0.95,
        confidence: 0.99,
        segmentDurationSeconds: 30,
        segments: [],
        missingSegmentIndices: [],
        analyzedAt: new Date().toISOString(),
      };

      strategy.applyFilter(card, completeHighAi, 0.8);
      expect(card.classList.contains('yt-ai-filtered-card')).toBe(false);
    });

    it('ThresholdHideFilterStrategy hides only complete results >= threshold', () => {
      const strategy = new ThresholdHideFilterStrategy();
      const card = document.createElement('div');

      const completeHighAi: VideoLookupResponseDto = {
        videoId: 'vid_ai',
        status: 'complete',
        label: 'AI_GENERATED',
        aiRelianceScore: 0.85,
        confidence: 0.9,
        segmentDurationSeconds: 30,
        segments: [],
        missingSegmentIndices: [],
        analyzedAt: new Date().toISOString(),
      };

      // Below threshold (0.90) -> not hidden
      strategy.applyFilter(card, completeHighAi, 0.9);
      expect(card.classList.contains('yt-ai-filtered-card')).toBe(false);

      // Above threshold (0.80) -> hidden with overlay
      strategy.applyFilter(card, completeHighAi, 0.8);
      expect(card.classList.contains('yt-ai-filtered-card')).toBe(true);
      expect(card.querySelector('.yt-ai-filtered-overlay')).not.toBeNull();
    });

    it('ThresholdHideFilterStrategy never hides partial, unknown, or pending results (Fail-Open)', () => {
      const strategy = new ThresholdHideFilterStrategy();
      const card = document.createElement('div');

      const partialVideo: VideoLookupResponseDto = {
        videoId: 'vid_partial',
        status: 'partial',
        label: 'UNKNOWN',
        aiRelianceScore: 0.9, // Even if an intermediate partial score existed
        confidence: null,
        segmentDurationSeconds: 30,
        segments: [],
        missingSegmentIndices: [1],
        analyzedAt: null,
      };

      strategy.applyFilter(card, partialVideo, 0.5);
      expect(card.classList.contains('yt-ai-filtered-card')).toBe(false);

      const processingVideo: VideoLookupResponseDto = {
        ...partialVideo,
        status: 'processing',
      };
      strategy.applyFilter(card, processingVideo, 0.5);
      expect(card.classList.contains('yt-ai-filtered-card')).toBe(false);
    });

    it('supports session-level reveal and complete restore', () => {
      const strategy = new ThresholdHideFilterStrategy();
      const card = document.createElement('div');
      document.body.appendChild(card);

      const lookup: VideoLookupResponseDto = {
        videoId: 'vid_reveal',
        status: 'complete',
        label: 'AI_GENERATED',
        aiRelianceScore: 0.9,
        confidence: 0.9,
        segmentDurationSeconds: 30,
        segments: [],
        missingSegmentIndices: [],
        analyzedAt: new Date().toISOString(),
      };

      strategy.applyFilter(card, lookup, 0.8);
      expect(card.classList.contains('yt-ai-filtered-card')).toBe(true);

      // Reveal for session
      strategy.revealForSession('vid_reveal');
      expect(card.classList.contains('yt-ai-filtered-card')).toBe(false);

      // Subsequent re-filtering leaves it unhidden
      strategy.applyFilter(card, lookup, 0.8);
      expect(card.classList.contains('yt-ai-filtered-card')).toBe(false);

      document.body.removeChild(card);
    });
  });
});
