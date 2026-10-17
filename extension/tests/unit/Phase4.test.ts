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
