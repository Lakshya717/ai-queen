import { TimeInterval } from '../models/TimeInterval';
import {
  EvidencePackage,
  type ScreenshotSample,
  type AudioChunkSample,
  type TranscriptPayload,
  type CaptureCapabilities,
} from '../models/EvidencePackage';

export interface PackageBuildParams {
  videoId: string;
  policyVersion: string;
  segmentIndex: number;
  segmentBounds: TimeInterval;
  observedIntervals: ReadonlyArray<TimeInterval>;
  frames: ReadonlyArray<ScreenshotSample>;
  audioChunks: ReadonlyArray<AudioChunkSample>;
  transcript: TranscriptPayload | null;
  capabilities: CaptureCapabilities;
}

export class EvidencePackager {
  public static package(params: PackageBuildParams): EvidencePackage {
    const clampedIntervals: TimeInterval[] = [];
    for (const iv of params.observedIntervals) {
      const clamped = params.segmentBounds.intersect(iv);
      if (clamped) {
        clampedIntervals.push(clamped);
      }
    }

    const merged = TimeInterval.mergeContiguous(clampedIntervals);
    if (merged.length === 0) {
      throw new Error('Cannot package evidence without at least one valid clamped observed interval.');
    }

    return new EvidencePackage(
      params.videoId,
      params.policyVersion,
      params.segmentIndex,
      params.segmentBounds,
      merged,
      params.frames,
      params.audioChunks,
      params.transcript,
      params.capabilities
    );
  }
}
