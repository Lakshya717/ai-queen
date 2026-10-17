import type { CoverageStatus } from '../domain/models/VideoSegment';
import type { EvidencePackage } from '../domain/models/EvidencePackage';

export interface VideoLookupResponseDto {
  readonly videoId: string;
  readonly status: 'not_found' | 'partial' | 'processing' | 'complete' | 'insufficient_evidence';
  readonly label: 'AI_GENERATED' | 'HUMAN_MADE' | 'MIXED' | 'UNKNOWN';
  readonly aiRelianceScore: number | null;
  readonly confidence: number | null;
  readonly segmentDurationSeconds: number;
  readonly segments: ReadonlyArray<{
    index: number;
    startSeconds: number;
    endSeconds: number;
    coverage: CoverageStatus;
  }>;
  readonly missingSegmentIndices: ReadonlyArray<number>;
  readonly analyzedAt: string | null;
  readonly requiredPolicyVersion?: string;
}

export interface ContributionUploadResponseDto {
  readonly contributionId: string;
  readonly acceptedIntervals: ReadonlyArray<{ startSeconds: number; endSeconds: number }>;
  readonly remainingIntervals: ReadonlyArray<{ startSeconds: number; endSeconds: number }>;
  readonly videoStatus: 'partial' | 'processing' | 'complete';
}

export interface IBackendApiAdapter {
  lookupVideoCoverage(videoId: string, signal?: AbortSignal, durationSeconds?: number): Promise<VideoLookupResponseDto>;
  submitContribution(pkg: EvidencePackage, signal?: AbortSignal, videoDurationSeconds?: number): Promise<ContributionUploadResponseDto>;
}
