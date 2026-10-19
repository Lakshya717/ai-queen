import type { CoverageStatus } from '../domain/models/VideoSegment';
import type { EvidencePackage } from '../domain/models/EvidencePackage';

export interface ComponentScoreDto {
  readonly componentName: string;
  readonly modality: 'visual' | 'text' | 'temporal' | 'audio' | string;
  readonly score: number | null;
  readonly confidence?: number | null;
  readonly status: 'SUCCESS' | 'SKIPPED' | 'FAILED' | string;
  readonly executionTimeMs?: number;
  readonly details?: Record<string, any>;
  readonly errorMessage?: string;
}

export interface ComponentSummaryDto {
  readonly modalityAverages: Record<string, number>;
  readonly componentsEvaluated: ReadonlyArray<string>;
  readonly totalEvaluations: number;
}

export interface SegmentLookupDto {
  readonly index: number;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly coverage: CoverageStatus;
  readonly aiSegmentScore?: number | null;
  readonly components?: ReadonlyArray<ComponentScoreDto>;
}

export interface VideoLookupResponseDto {
  readonly videoId: string;
  readonly status: 'not_found' | 'partial' | 'processing' | 'complete' | 'insufficient_evidence';
  readonly label: 'AI_GENERATED' | 'HUMAN_MADE' | 'MIXED' | 'UNKNOWN';
  readonly aiRelianceScore: number | null;
  readonly confidence: number | null;
  readonly segmentDurationSeconds: number;
  readonly segments: ReadonlyArray<SegmentLookupDto>;
  readonly missingSegmentIndices: ReadonlyArray<number>;
  readonly componentSummary?: ComponentSummaryDto | null;
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
