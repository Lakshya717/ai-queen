import { TimeInterval } from '../../domain/models/TimeInterval';
import type { CoverageStatus } from '../../domain/models/VideoSegment';
import type { EvidencePackage } from '../../domain/models/EvidencePackage';
import type {
  IBackendApiAdapter,
  VideoLookupResponseDto,
  ContributionUploadResponseDto,
} from '../../ports/IBackendApiAdapter';

export interface MockBackendConfig {
  defaultSegmentDurationSeconds: number;
  defaultVideoDurationSeconds: number;
  sufficiencyRatioThreshold: number;
  simulateNetworkLatencyMs: number;
  simulateRateLimitEveryNRequests: number;
}

export const DEFAULT_MOCK_BACKEND_CONFIG: MockBackendConfig = {
  defaultSegmentDurationSeconds: 30,
  defaultVideoDurationSeconds: 120,
  sufficiencyRatioThreshold: 0.95,
  simulateNetworkLatencyMs: 0,
  simulateRateLimitEveryNRequests: 0,
};

interface StoredVideoState {
  durationSeconds: number;
  segmentDuration: number;
  observedBySegment: Map<number, TimeInterval[]>;
  transcriptHashes: Set<string>;
}

export class MockBackendApiAdapter implements IBackendApiAdapter {
  private readonly config: MockBackendConfig;
  private readonly videoStore = new Map<string, StoredVideoState>();
  private requestCount = 0;

  constructor(config: Partial<MockBackendConfig> = {}) {
    this.config = { ...DEFAULT_MOCK_BACKEND_CONFIG, ...config };
  }

  public async lookupVideoCoverage(
    videoId: string,
    _signal?: AbortSignal,
    durationSeconds?: number
  ): Promise<VideoLookupResponseDto> {
    this.checkSimulatedRateLimit();
    if (this.config.simulateNetworkLatencyMs > 0) {
      await new Promise((r) => setTimeout(r, this.config.simulateNetworkLatencyMs));
    }

    const state = this.getOrCreateVideoState(videoId);
    if (durationSeconds && durationSeconds > 0) {
      state.durationSeconds = durationSeconds;
    }
    const totalSegments = Math.ceil(state.durationSeconds / state.segmentDuration);
    const segments: Array<{
      index: number;
      startSeconds: number;
      endSeconds: number;
      coverage: CoverageStatus;
    }> = [];
    const missingSegmentIndices: number[] = [];

    for (let i = 0; i < totalSegments; i++) {
      const start = i * state.segmentDuration;
      const end = Math.min((i + 1) * state.segmentDuration, state.durationSeconds);
      const segBounds = new TimeInterval(start, end);
      const observed = TimeInterval.mergeContiguous(state.observedBySegment.get(i) ?? []);
      const coveredSec = observed.reduce((acc, iv) => acc + iv.durationSeconds, 0);
      const ratio = coveredSec / segBounds.durationSeconds;

      const coverage: CoverageStatus =
        ratio >= this.config.sufficiencyRatioThreshold
          ? 'complete'
          : coveredSec > 0
          ? 'partial'
          : 'missing';

      if (coverage !== 'complete') {
        missingSegmentIndices.push(i);
      }

      segments.push({
        index: i,
        startSeconds: start,
        endSeconds: end,
        coverage,
      });
    }

    const allComplete = missingSegmentIndices.length === 0;
    const hasAnyCoverage = segments.some((s) => s.coverage !== 'missing');

    return {
      videoId,
      status: allComplete ? 'complete' : hasAnyCoverage ? 'partial' : 'not_found',
      label: allComplete ? 'AI_GENERATED' : 'UNKNOWN',
      aiRelianceScore: allComplete ? 0.86 : null,
      confidence: allComplete ? 0.91 : null,
      segmentDurationSeconds: state.segmentDuration,
      segments,
      missingSegmentIndices,
      analyzedAt: allComplete ? new Date().toISOString() : null,
      requiredPolicyVersion: 'v1',
    };
  }

  public async submitContribution(
    pkg: EvidencePackage,
    _signal?: AbortSignal,
    videoDurationSeconds?: number
  ): Promise<ContributionUploadResponseDto> {
    this.checkSimulatedRateLimit();
    if (this.config.simulateNetworkLatencyMs > 0) {
      await new Promise((r) => setTimeout(r, this.config.simulateNetworkLatencyMs));
    }

    const state = this.getOrCreateVideoState(pkg.videoId);
    if (videoDurationSeconds && videoDurationSeconds > 0) {
      state.durationSeconds = videoDurationSeconds;
    }

    if (pkg.transcript?.contentHash) {
      state.transcriptHashes.add(pkg.transcript.contentHash);
    }

    const existing = state.observedBySegment.get(pkg.segmentIndex) ?? [];
    const merged = TimeInterval.mergeContiguous([...existing, ...pkg.observedIntervals]);
    state.observedBySegment.set(pkg.segmentIndex, merged);

    const lookup = await this.lookupVideoCoverage(pkg.videoId);

    // Compute remaining intervals within segment bounds
    const remainingIntervals = this.computeRemainingIntervals(pkg.segmentBounds, merged);

    return {
      contributionId: `mock_contrib_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      acceptedIntervals: merged.map((i) => ({ startSeconds: i.startSeconds, endSeconds: i.endSeconds })),
      remainingIntervals: remainingIntervals.map((i) => ({
        startSeconds: i.startSeconds,
        endSeconds: i.endSeconds,
      })),
      videoStatus: lookup.status === 'complete' ? 'complete' : 'partial',
    };
  }

  public async recalculateVideo(
    videoId: string,
    _signal?: AbortSignal
  ): Promise<VideoLookupResponseDto> {
    return this.lookupVideoCoverage(videoId);
  }

  public getStoredIntervals(videoId: string, segmentIndex: number): TimeInterval[] {
    const state = this.videoStore.get(videoId);
    if (!state) return [];
    return state.observedBySegment.get(segmentIndex) ?? [];
  }

  public getTranscriptHashes(videoId: string): Set<string> {
    return this.videoStore.get(videoId)?.transcriptHashes ?? new Set();
  }

  public clearStore(): void {
    this.videoStore.clear();
    this.requestCount = 0;
  }

  private getOrCreateVideoState(videoId: string): StoredVideoState {
    let state = this.videoStore.get(videoId);
    if (!state) {
      state = {
        durationSeconds: this.config.defaultVideoDurationSeconds,
        segmentDuration: this.config.defaultSegmentDurationSeconds,
        observedBySegment: new Map(),
        transcriptHashes: new Set(),
      };
      this.videoStore.set(videoId, state);
    }
    return state;
  }

  private computeRemainingIntervals(
    bounds: TimeInterval,
    merged: TimeInterval[]
  ): TimeInterval[] {
    if (merged.length === 0) return [bounds];
    const remaining: TimeInterval[] = [];
    let current = bounds.startSeconds;

    for (const iv of merged) {
      if (iv.startSeconds > current) {
        remaining.push(new TimeInterval(current, iv.startSeconds));
      }
      current = Math.max(current, iv.endSeconds);
    }

    if (current < bounds.endSeconds) {
      remaining.push(new TimeInterval(current, bounds.endSeconds));
    }

    return remaining;
  }

  private checkSimulatedRateLimit(): void {
    this.requestCount++;
    if (
      this.config.simulateRateLimitEveryNRequests > 0 &&
      this.requestCount % this.config.simulateRateLimitEveryNRequests === 0
    ) {
      const err = new Error('Too Many Requests');
      (err as unknown as { status: number; retryAfter: number }).status = 429;
      (err as unknown as { status: number; retryAfter: number }).retryAfter = 2;
      throw err;
    }
  }
}
