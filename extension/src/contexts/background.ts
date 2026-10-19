import { MockBackendApiAdapter } from '../adapters/mocks/MockBackendApiAdapter';
import { HttpBackendApiAdapter } from '../adapters/http/HttpBackendApiAdapter';
import { ChromeStorageResultCacheRepository } from '../adapters/storage/ChromeStorageResultCacheRepository';
import { StoragePolicyConsentAdapter } from '../adapters/storage/StoragePolicyConsentAdapter';
import type { IBackendApiAdapter } from '../ports/IBackendApiAdapter';
import type { EvidencePackage } from '../domain/models/EvidencePackage';

// Environment toggle: default to HttpBackendApiAdapter for live Django integration
const USE_MOCK_BACKEND = false;

const backendAdapter: IBackendApiAdapter = USE_MOCK_BACKEND
  ? new MockBackendApiAdapter({ defaultSegmentDurationSeconds: 30, defaultVideoDurationSeconds: 120 })
  : new HttpBackendApiAdapter();

const cacheRepo = new ChromeStorageResultCacheRepository();
const consentAdapter = new StoragePolicyConsentAdapter();

// Keep-alive port connection listener
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'yt-ai-keepalive') {
    port.onDisconnect.addListener(() => {});
  }
});

// Central Service Worker Message Router
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message) return;

  handleMessage(message)
    .then(sendResponse)
    .catch((err) => {
      sendResponse({ ok: false, error: String(err?.message || err) });
    });

  return true; // Keep channel open for async response
});

async function handleMessage(message: { type: string; [key: string]: unknown }): Promise<Record<string, unknown>> {
  switch (message.type) {
    case 'lookup-video': {
      const videoId = message.videoId as string;
      const duration = typeof message.duration === 'number' && message.duration > 0 ? message.duration : undefined;
      const forceRefresh = Boolean(message.forceRefresh);
      if (!videoId) return { ok: false, error: 'Missing videoId' };

      // 1. Check local cache (only if not forcing refresh and entry is complete with scores)
      if (!forceRefresh) {
        const cached = await cacheRepo.get(videoId);
        if (cached && cached.status === 'complete' && cached.aiRelianceScore != null) {
          return { ok: true, lookup: cached, fromCache: true };
        }
      }

      // 2. Query backend adapter
      const lookup = await backendAdapter.lookupVideoCoverage(videoId, undefined, duration);
      if (lookup && lookup.status !== 'not_found') {
        await cacheRepo.set(videoId, lookup);
      }

      return { ok: true, lookup, fromCache: false };
    }

    case 'upload-evidence-package': {
      const pkg = message.pkg as EvidencePackage;
      const videoDuration = typeof message.videoDuration === 'number' && message.videoDuration > 0 ? message.videoDuration : undefined;
      if (!pkg || !pkg.videoId) {
        return { ok: false, error: 'Invalid EvidencePackage payload' };
      }

      const result = await backendAdapter.submitContribution(pkg, undefined, videoDuration);

      // Invalidate or update local cache
      const updatedLookup = await backendAdapter.lookupVideoCoverage(pkg.videoId, undefined, videoDuration);
      await cacheRepo.set(pkg.videoId, updatedLookup);

      return { ok: true, result, updatedLookup };
    }

    case 'get-preferences': {
      const prefs = await consentAdapter.getPreferences();
      return { ok: true, prefs };
    }

    case 'save-preferences': {
      const updated = await consentAdapter.savePreferences(message.preferences as Record<string, unknown>);
      return { ok: true, prefs: updated };
    }

    default:
      return { ok: false, error: `Unhandled message type: ${message.type}` };
  }
}
