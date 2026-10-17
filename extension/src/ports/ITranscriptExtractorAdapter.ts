import type { TranscriptPayload } from '../domain/models/EvidencePackage';

export interface ITranscriptExtractorAdapter {
  extractTranscript(videoId: string, signal?: AbortSignal): Promise<TranscriptPayload>;
}
