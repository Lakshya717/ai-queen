import { describe, it, expect, beforeEach, vi } from 'vitest';
import { YouTubePlatformAdapter } from '../../src/adapters/youtube/YouTubePlatformAdapter';
import { ActiveWatchGate } from '../../src/domain/specifications/ActiveWatchGate';
import {
  createDefaultGateSpecifications,
  PolicyVersionMatchSpec,
  TabAndDocumentVisibleSpec,
  VideoPlayingSpec,
} from '../../src/domain/specifications/ActiveWatchSpecs';
import type { WatchContextSnapshot } from '../../src/domain/specifications/IGateSpecification';
import { ObservedIntervalTracker } from '../../src/domain/services/ObservedIntervalTracker';
import { InputCollectionStateMachine } from '../../src/domain/state/InputCollectionStateMachine';
import { MockTranscriptExtractorAdapter } from '../../src/adapters/mocks/MockTranscriptExtractorAdapter';
import { YouTubeDomTranscriptAdapter } from '../../src/adapters/youtube/YouTubeDomTranscriptAdapter';
import { ChromeStorageResultCacheRepository } from '../../src/adapters/storage/ChromeStorageResultCacheRepository';
import { StoragePolicyConsentAdapter } from '../../src/adapters/storage/StoragePolicyConsentAdapter';
import type { VideoLookupResponseDto } from '../../src/ports/IBackendApiAdapter';

describe('Phase 3: Active-Watch Gating, Identity, State Machine & Transcripts (Review Loop 3)', () => {
  describe('YouTubePlatformAdapter URL Parsing (Test #1)', () => {
    const adapter = new YouTubePlatformAdapter();

    it('parses standard watch URLs with various query parameters', () => {
      expect(adapter.extractVideoIdFromUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
      expect(adapter.extractVideoIdFromUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&feature=shared')).toBe(
        'dQw4w9WgXcQ'
      );
    });

    it('parses YouTube Shorts URLs', () => {
      expect(adapter.extractVideoIdFromUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
      expect(adapter.extractVideoIdFromUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=share')).toBe(
        'dQw4w9WgXcQ'
      );
    });

    it('parses youtu.be shortlinks', () => {
      expect(adapter.extractVideoIdFromUrl('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
      expect(adapter.extractVideoIdFromUrl('https://youtu.be/dQw4w9WgXcQ?t=15')).toBe('dQw4w9WgXcQ');
    });

    it('returns null for invalid or non-video URLs', () => {
      expect(adapter.extractVideoIdFromUrl('https://www.youtube.com/feed/subscriptions')).toBeNull();
      expect(adapter.extractVideoIdFromUrl('https://www.google.com')).toBeNull();
      expect(adapter.extractVideoIdFromUrl('not-a-valid-url')).toBeNull();
    });
  });

  describe('ActiveWatchGate Specification Composite (Tests #2, #10, #11, #12)', () => {
    let gate: ActiveWatchGate;

    const baseValidContext: WatchContextSnapshot = {
      extensionEnabled: true,
      acceptedPolicyVersion: 'v1',
      currentPolicyVersion: 'v1',
      contributionEnabled: true,
      isTabActiveInWindow: true,
      documentVisibility: 'visible',
      isVideoPlaying: true,
      isPlaybackTimeAdvancing: true,
      isVideoEndedOrSeeking: false,
      hasMissingBackendSegments: true,
      hasScreenshotOrAudioCapability: true,
    };

    beforeEach(() => {
      gate = new ActiveWatchGate(createDefaultGateSpecifications());
    });

    it('passes when all 9 active-watch specifications are satisfied', () => {
      const res = gate.evaluate(baseValidContext);
      expect(res.passed).toBe(true);
      expect(res.failedReasons).toHaveLength(0);
    });

    it('fails immediately when tab or document is hidden (Test #2)', () => {
      const hiddenTab = { ...baseValidContext, isTabActiveInWindow: false };
      expect(gate.evaluate(hiddenTab).passed).toBe(false);

      const hiddenDoc = { ...baseValidContext, documentVisibility: 'hidden' as DocumentVisibilityState };
      expect(gate.evaluate(hiddenDoc).passed).toBe(false);
    });

    it('fails immediately when video is paused or playback stalls (Test #2)', () => {
      const paused = { ...baseValidContext, isVideoPlaying: false };
      expect(gate.evaluate(paused).passed).toBe(false);

      const stalled = { ...baseValidContext, isPlaybackTimeAdvancing: false };
      expect(gate.evaluate(stalled).passed).toBe(false);
    });

    it('fails when policy version mismatches or policy is not accepted (Tests #10, #11)', () => {
      const unaccepted = { ...baseValidContext, acceptedPolicyVersion: null };
      expect(gate.evaluate(unaccepted).passed).toBe(false);

      const versionBump = { ...baseValidContext, acceptedPolicyVersion: 'v1', currentPolicyVersion: 'v2' };
      const res = gate.evaluate(versionBump);
      expect(res.passed).toBe(false);
      expect(res.failedReasons[0]).toContain('v2');
    });

    it('notifies listeners on gate state change (<50ms trigger)', () => {
      const listener = vi.fn();
      gate.onGateChange(listener);

      // Transition from uninitialized to passed
      gate.evaluate(baseValidContext);
      expect(listener).toHaveBeenCalledWith(true, []);

      // Transition from passed to failed
      gate.evaluate({ ...baseValidContext, isVideoPlaying: false });
      expect(listener).toHaveBeenCalledWith(false, expect.arrayContaining([expect.any(String)]));
    });
  });

  describe('ObservedIntervalTracker Timing & Rollover Math (Test #3 & Test #5)', () => {
    it('extends interval on normal advancing playback ticks', () => {
      const tracker = new ObservedIntervalTracker(30);

      tracker.onPlaybackTick(10.0, 250);
      tracker.onPlaybackTick(10.25, 250);
      tracker.onPlaybackTick(10.5, 250);

      const state = tracker.getCurrentTrackingState();
      expect(state.openIntervalStart).toBe(10.0);
      expect(state.lastObservedTime).toBe(10.5);
    });

    it('seals interval and emits seek_jump event on user seek scrub', () => {
      const flushes: any[] = [];
      const tracker = new ObservedIntervalTracker(30, (e) => flushes.push(e));

      // Simulate playing 10.0 to 15.0 in 250ms ticks
      for (let t = 10.0; t <= 15.0; t = Number((t + 0.25).toFixed(2))) {
        tracker.onPlaybackTick(t, 250);
      }

      // User jumps from 15.0 to 45.0s (seek jump > 1.25s)
      const sealed = tracker.onPlaybackTick(45.0, 250);

      expect(sealed).not.toBeNull();
      expect(sealed?.startSeconds).toBe(10.0);
      expect(sealed?.endSeconds).toBe(15.0);
      expect(flushes).toHaveLength(1);
      expect(flushes[0].reason).toBe('seek_jump');

      // Fresh interval starts at 45.0
      expect(tracker.getCurrentTrackingState().openIntervalStart).toBe(45.0);
    });

    it('seals interval at exact 30s boundary upon natural boundary rollover', () => {
      const flushes: any[] = [];
      const tracker = new ObservedIntervalTracker(30, (e) => flushes.push(e));

      // Simulate playing 28.0 to 29.8 in 200ms ticks
      for (let t = 28.0; t <= 29.8; t = Number((t + 0.2).toFixed(2))) {
        tracker.onPlaybackTick(t, 200);
      }

      // Crosses from 29.8s to 30.2s into Segment 1 (advance of 0.4s is <= maxExpected 0.55s)
      const sealed = tracker.onPlaybackTick(30.2, 200);

      expect(sealed).not.toBeNull();
      expect(sealed?.startSeconds).toBe(28.0);
      expect(sealed?.endSeconds).toBe(30.0); // Exact boundary
      expect(flushes[0].reason).toBe('boundary_rollover');
      expect(flushes[0].segmentIndex).toBe(0);

      // New interval starts at boundary 30.0
      expect(tracker.getCurrentTrackingState().openIntervalStart).toBe(30.0);
      expect(tracker.getCurrentTrackingState().segmentIndex).toBe(1);
    });

    it('flushes pending interval immediately on gate close (<50ms)', () => {
      const flushes: any[] = [];
      const tracker = new ObservedIntervalTracker(30, (e) => flushes.push(e));

      // Simulate playing 10.0 to 18.5 in 250ms ticks
      for (let t = 10.0; t <= 18.5; t = Number((t + 0.25).toFixed(2))) {
        tracker.onPlaybackTick(t, 250);
      }

      // Tab switched or paused at 18.5
      const flushed = tracker.flushOnGateClose(18.5);
      expect(flushed).not.toBeNull();
      expect(flushed?.startSeconds).toBe(10.0);
      expect(flushed?.endSeconds).toBe(18.5);
      expect(tracker.getCurrentTrackingState().openIntervalStart).toBeNull();
    });
  });

  describe('InputCollectionStateMachine Transitions', () => {
    it('transitions deterministically across lifecycle states', () => {
      const sm = new InputCollectionStateMachine('inactive');
      expect(sm.stateName).toBe('inactive');

      sm.transitionTo('checking_cache');
      expect(sm.stateName).toBe('checking_cache');

      sm.transitionTo('active_watching');
      expect(sm.stateName).toBe('active_watching');

      sm.transitionTo('capturing');
      expect(sm.stateName).toBe('capturing');

      sm.transitionTo('uploading');
      expect(sm.stateName).toBe('uploading');

      sm.transitionTo('completed');
      expect(sm.stateName).toBe('completed');
    });
  });

  describe('Transcript Extraction & Deduplication (Test #9)', () => {
    it('distinguishes between full, partial, and unavailable transcript scopes', async () => {
      const fullAdapter = new MockTranscriptExtractorAdapter('full');
      const fullRes = await fullAdapter.extractTranscript('vid1');
      expect(fullRes.scope).toBe('full');
      expect(fullRes.segments.length).toBeGreaterThan(1);
      expect(fullRes.contentHash).toBeDefined();

      const partialAdapter = new MockTranscriptExtractorAdapter('partial');
      const partialRes = await partialAdapter.extractTranscript('vid2');
      expect(partialRes.scope).toBe('partial');
      expect(partialRes.segments).toHaveLength(1);

      const unavailAdapter = new MockTranscriptExtractorAdapter('unavailable');
      const unavailRes = await unavailAdapter.extractTranscript('vid3');
      expect(unavailRes.scope).toBe('unavailable');
      expect(unavailRes.segments).toHaveLength(0);
      expect(unavailRes.omissionReason).toBeDefined();
    });

    it('YouTubeDomTranscriptAdapter parses timestamps and calculates hashes', async () => {
      const adapter = new YouTubeDomTranscriptAdapter();
      expect(adapter.parseTimestampToSeconds('0:45')).toBe(45);
      expect(adapter.parseTimestampToSeconds('1:20')).toBe(80);
      expect(adapter.parseTimestampToSeconds('1:02:30')).toBe(3750);
      expect(adapter.parseTimestampToSeconds('invalid')).toBeNull();

      const hash1 = await adapter.computeSha256('same content');
      const hash2 = await adapter.computeSha256('same content');
      const hash3 = await adapter.computeSha256('different content');
      expect(hash1).toBe(hash2);
      expect(hash1).not.toBe(hash3);
    });
  });

  describe('ChromeStorageResultCacheRepository & Privacy Invariants (Tests #8, #14, #15)', () => {
    let repo: ChromeStorageResultCacheRepository;

    const mockLookup: VideoLookupResponseDto = {
      videoId: 'vid_cache_test',
      status: 'complete',
      label: 'AI_GENERATED',
      aiRelianceScore: 0.88,
      confidence: 0.95,
      segmentDurationSeconds: 30,
      segments: [],
      missingSegmentIndices: [],
      analyzedAt: new Date().toISOString(),
    };

    beforeEach(async () => {
      repo = new ChromeStorageResultCacheRepository({ maxEntries: 10, ttlSeconds: 3600 });
      await repo.clear();
    });

    it('caches lookup results and retrieves them (Test #8)', async () => {
      await repo.set('vid_cache_test', mockLookup);
      const retrieved = await repo.get('vid_cache_test');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.aiRelianceScore).toBe(0.88);
    });

    it('expires cached results after TTL', async () => {
      const shortTtlRepo = new ChromeStorageResultCacheRepository({ maxEntries: 10, ttlSeconds: -1 }); // Expired immediately
      await shortTtlRepo.set('vid_cache_test', mockLookup);

      const retrieved = await shortTtlRepo.get('vid_cache_test');
      expect(retrieved).toBeNull();
    });

    it('throws error if any payload attempts to store raw media (Privacy Invariant Test #15)', async () => {
      const taintedLookup = {
        ...mockLookup,
        rawImage: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...',
      } as unknown as VideoLookupResponseDto;

      await expect(repo.set('vid_tainted', taintedLookup)).rejects.toThrow(
        /Privacy Invariant Violation/
      );
    });
  });

  describe('StoragePolicyConsentAdapter Version Handling (Test #10)', () => {
    it('manages one-time policy acceptance and version checking', async () => {
      const consent = new StoragePolicyConsentAdapter();
      expect(await consent.isPolicyAccepted('v1')).toBe(false);

      await consent.recordPolicyAcceptance('v1');
      expect(await consent.isPolicyAccepted('v1')).toBe(true);

      // Version bump to v2 requires fresh consent
      expect(await consent.isPolicyAccepted('v2')).toBe(false);

      // Withdrawal resets acceptance
      await consent.withdrawPolicyAcceptance();
      expect(await consent.isPolicyAccepted('v1')).toBe(false);
    });
  });
});
