import type { EvidencePackage } from '../../domain/models/EvidencePackage';
import type {
  IBackendApiAdapter,
  VideoLookupResponseDto,
  ContributionUploadResponseDto,
} from '../../ports/IBackendApiAdapter';

export interface HttpBackendConfig {
  baseUrl: string;
  authToken?: string;
  maxRetries: number;
  initialRetryDelayMs: number;
}

export const DEFAULT_HTTP_BACKEND_CONFIG: HttpBackendConfig = {
  // Local Django backend server endpoint; change to https://api.aidetect-crowdsourced.org/v1 for production
  baseUrl: 'http://localhost:8000/v1',
  maxRetries: 3,
  initialRetryDelayMs: 500,
};

export class HttpBackendApiAdapter implements IBackendApiAdapter {
  constructor(private readonly config: HttpBackendConfig = DEFAULT_HTTP_BACKEND_CONFIG) {}

  public async lookupVideoCoverage(
    videoId: string,
    signal?: AbortSignal,
    durationSeconds?: number
  ): Promise<VideoLookupResponseDto> {
    const query = durationSeconds && durationSeconds > 0 ? `?duration=${Math.round(durationSeconds)}` : '';
    const url = `${this.config.baseUrl}/content/youtube/${encodeURIComponent(videoId)}${query}`;

    return this.fetchWithRetry<VideoLookupResponseDto>(
      url,
      {
        method: 'GET',
        headers: this.buildHeaders(),
        signal,
      },
      (resp) => {
        if (resp.status === 404) {
          // Unmapped video
          return {
            videoId,
            status: 'not_found',
            label: 'UNKNOWN',
            aiRelianceScore: null,
            confidence: null,
            segmentDurationSeconds: 30,
            segments: [],
            missingSegmentIndices: [],
            analyzedAt: null,
          };
        }
        return null;
      }
    );
  }

  public async submitContribution(
    pkg: EvidencePackage,
    signal?: AbortSignal,
    videoDurationSeconds?: number
  ): Promise<ContributionUploadResponseDto> {
    const url = `${this.config.baseUrl}/content/youtube/${encodeURIComponent(pkg.videoId)}/contributions`;

    const payload = {
      videoId: pkg.videoId,
      videoDurationSeconds: videoDurationSeconds && videoDurationSeconds > 0 ? videoDurationSeconds : undefined,
      policyVersion: pkg.policyVersion,
      segmentIndex: pkg.segmentIndex,
      segmentStartSeconds: pkg.segmentBounds.startSeconds,
      segmentEndSeconds: pkg.segmentBounds.endSeconds,
      observedIntervals: pkg.observedIntervals.map((i) => ({
        startSeconds: i.startSeconds,
        endSeconds: i.endSeconds,
      })),
      frames: pkg.frames.map((f) => ({
        videoTimestampSeconds: f.videoTimestampSeconds,
        mimeType: f.mimeType,
        data: typeof f.data === 'string' ? f.data : this.uint8ArrayToBase64(f.data),
        width: f.width,
        height: f.height,
      })),
      audioChunks: pkg.audioChunks.map((a) => ({
        startSeconds: a.interval.startSeconds,
        endSeconds: a.interval.endSeconds,
        mimeType: a.mimeType,
        data: typeof a.data === 'string' ? a.data : this.uint8ArrayToBase64(a.data),
        alignmentDriftMs: a.alignmentDriftMs,
      })),
      transcript: pkg.transcript,
      capabilities: pkg.capabilities,
    };

    return this.fetchWithRetry<ContributionUploadResponseDto>(url, {
      method: 'POST',
      headers: {
        ...this.buildHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal,
    });
  }

  public async recalculateVideo(
    videoId: string,
    signal?: AbortSignal
  ): Promise<VideoLookupResponseDto> {
    const url = `${this.config.baseUrl}/content/youtube/${encodeURIComponent(videoId)}/analysis/recalculate`;
    return this.fetchWithRetry<VideoLookupResponseDto>(url, {
      method: 'POST',
      headers: {
        ...this.buildHeaders(),
        'Content-Type': 'application/json',
      },
      signal,
    });
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (this.config.authToken) {
      headers['Authorization'] = `Bearer ${this.config.authToken}`;
    }
    return headers;
  }

  private async fetchWithRetry<T>(
    url: string,
    init: RequestInit,
    fallbackHandler?: (response: Response) => T | null
  ): Promise<T> {
    let attempt = 0;
    let delay = this.config.initialRetryDelayMs;

    while (attempt <= this.config.maxRetries) {
      attempt++;
      try {
        const res = await fetch(url, init);

        if (res.ok) {
          return (await res.json()) as T;
        }

        if (fallbackHandler) {
          const fallback = fallbackHandler(res);
          if (fallback !== null) return fallback;
        }

        if (res.status === 429) {
          const retryAfterSec = Number(res.headers.get('Retry-After')) || 2;
          await new Promise((r) => setTimeout(r, retryAfterSec * 1000));
          continue;
        }

        if (res.status >= 500 && attempt <= this.config.maxRetries) {
          await new Promise((r) => setTimeout(r, delay));
          delay *= 2;
          continue;
        }

        throw new Error(`HTTP Error ${res.status}: ${res.statusText}`);
      } catch (err) {
        if (attempt > this.config.maxRetries) throw err;
        await new Promise((r) => setTimeout(r, delay));
        delay *= 2;
      }
    }

    throw new Error(`Failed to fetch ${url} after ${this.config.maxRetries} retries`);
  }

  private uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}
