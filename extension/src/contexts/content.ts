import { YouTubePlatformAdapter } from '../adapters/youtube/YouTubePlatformAdapter';
import { ActiveWatchGate } from '../domain/specifications/ActiveWatchGate';
import { createDefaultGateSpecifications } from '../domain/specifications/ActiveWatchSpecs';
import { ObservedIntervalTracker, type IntervalFlushEvent } from '../domain/services/ObservedIntervalTracker';
import { SegmentScheduler } from '../domain/services/SegmentScheduler';
import { ConfigurableFixedSegmentationStrategy } from '../domain/services/SegmentationStrategy';
import { InPageMediaCaptureAdapter } from '../adapters/media/InPageMediaCaptureAdapter';
import { MotionAdaptiveFrameSampler } from '../adapters/media/MotionAdaptiveFrameSampler';
import { YouTubeDomTranscriptAdapter } from '../adapters/youtube/YouTubeDomTranscriptAdapter';
import { BadgePresenter } from '../extensions/badges/BadgePresenter';
import { MarkOnlyFilterStrategy } from '../extensions/filtering/MarkOnlyFilterStrategy';
import { ThresholdHideFilterStrategy } from '../extensions/filtering/ThresholdHideFilterStrategy';
import { InputCollectionStateMachine } from '../domain/state/InputCollectionStateMachine';
import { EvidencePackager } from '../domain/services/EvidencePackager';
import type { VideoLookupResponseDto } from '../ports/IBackendApiAdapter';
import type { ScreenshotSample, TranscriptPayload } from '../domain/models/EvidencePackage';
import { CURRENT_POLICY_VERSION, type UserPreferences, DEFAULT_USER_PREFERENCES } from '../domain/models/PolicyState';

(function initYouTubeExtension() {
  const platformAdapter = new YouTubePlatformAdapter();
  const segmentationStrategy = new ConfigurableFixedSegmentationStrategy(30);
  const segmentScheduler = new SegmentScheduler(segmentationStrategy);
  const gate = new ActiveWatchGate(createDefaultGateSpecifications());
  const stateMachine = new InputCollectionStateMachine('inactive');
  const badgePresenter = new BadgePresenter();
  const markOnlyFilter = new MarkOnlyFilterStrategy();
  const thresholdHideFilter = new ThresholdHideFilterStrategy();
  const transcriptAdapter = new YouTubeDomTranscriptAdapter();

  let activeVideoElement: HTMLVideoElement | null = null;
  const mediaAdapter = new InPageMediaCaptureAdapter(() => activeVideoElement);
  const frameSampler = new MotionAdaptiveFrameSampler();

  let currentVideoId: string | null = null;
  let currentLookup: VideoLookupResponseDto | null = null;
  let userPrefs: UserPreferences = { ...DEFAULT_USER_PREFERENCES };
  let cachedTranscript: TranscriptPayload | null = null;

  // Evidence accumulation for the current segment
  let currentSegmentIndex: number | null = null;
  const accumulatedFrames: ScreenshotSample[] = [];
  let lastFrameCaptureTime = -1;
  let lastTickWallClock = Date.now();

  const intervalTracker = new ObservedIntervalTracker(30, handleIntervalFlush);

  // 1. Maintain Keep-Alive connection to Service Worker
  connectKeepAlive();
  function connectKeepAlive() {
    try {
      const port = chrome.runtime.connect({ name: 'yt-ai-keepalive' });
      port.onDisconnect.addListener(() => {
        setTimeout(connectKeepAlive, 1000);
      });
    } catch {
      // Ignore
    }
  }

  // 2. Fetch User Preferences on Load
  chrome.runtime.sendMessage({ type: 'get-preferences' }, (res) => {
    if (res && res.prefs) {
      userPrefs = res.prefs;
    }
  });

  // Helper to ensure segments are populated from video duration for unmapped or empty videos
  function ensureSegmentsPopulated() {
    if (!currentVideoId) return;
    if (!activeVideoElement) {
      activeVideoElement = platformAdapter.locatePrimaryVideoElement(document);
    }
    const duration = activeVideoElement?.duration;
    if (typeof duration === 'number' && !isNaN(duration) && duration > 0 && isFinite(duration)) {
      if (!currentLookup || currentLookup.status === 'not_found' || currentLookup.segments.length === 0) {
        const segDur = currentLookup?.segmentDurationSeconds || 30;
        const total = Math.ceil(duration / segDur);
        const synthSegments = [];
        const missing = [];
        for (let i = 0; i < total; i++) {
          synthSegments.push({
            index: i,
            startSeconds: i * segDur,
            endSeconds: Math.min((i + 1) * segDur, duration),
            coverage: 'missing' as const,
          });
          missing.push(i);
        }
        if (!currentLookup) {
          currentLookup = {
            videoId: currentVideoId,
            status: 'not_found',
            label: 'UNKNOWN',
            aiRelianceScore: null,
            confidence: null,
            segmentDurationSeconds: segDur,
            segments: synthSegments,
            missingSegmentIndices: missing,
            analyzedAt: null,
          };
        } else {
          currentLookup = {
            ...currentLookup,
            segments: synthSegments,
            missingSegmentIndices: missing,
          };
        }
        segmentScheduler.updateMissingIndices(missing);
      }
    }
  }

  // 3. Listen for Messages from Popup & Background
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message) return;

    if (message.type === 'get-status') {
      ensureSegmentsPopulated();
      const totalSegments = currentLookup?.segments.length ?? 0;
      const missingSegments = currentLookup?.missingSegmentIndices.length ?? 0;
      const coveredSegments = Math.max(0, totalSegments - missingSegments);
      const ratio = totalSegments > 0 ? coveredSegments / totalSegments : 0;

      sendResponse({
        videoId: currentVideoId,
        stateName: stateMachine.stateName,
        coverageRatio: ratio,
        coverageText: currentVideoId
          ? totalSegments > 0
            ? `Covered ${coveredSegments} of ${totalSegments} segments (${Math.round(ratio * 100)}%)`
            : 'Detecting video segments...'
          : 'Open a YouTube video to detect AI reliance',
      });
      return true;
    }
  });

  // 4. Hook SPA Navigation
  platformAdapter.observeSpaNavigation((newVideoId) => {
    onVideoNavigated(newVideoId);
  });

  // Initial check on document ready
  setTimeout(() => {
    const initialId = platformAdapter.extractVideoIdFromUrl(window.location.href);
    if (initialId) {
      onVideoNavigated(initialId);
    }
  }, 500);

  async function onVideoNavigated(videoId: string | null) {
    // Flush and reset previous session
    if (currentVideoId && stateMachine.stateName === 'capturing') {
      intervalTracker.flushOnGateClose(activeVideoElement?.currentTime);
    }

    currentVideoId = videoId;
    currentLookup = null;
    cachedTranscript = null;
    intervalTracker.reset();
    activeVideoElement = null;
    resetEvidenceAccumulators();
    stateMachine.transitionTo('inactive');

    if (!videoId) return;

    // Locate primary video element
    activeVideoElement = platformAdapter.locatePrimaryVideoElement(document);
    if (activeVideoElement) {
      activeVideoElement.addEventListener('loadedmetadata', () => {
        ensureSegmentsPopulated();
      }, { once: true });
    }

    // Query backend for cache and missing segments
    stateMachine.transitionTo('checking_cache');
    updateBadge('processing');

    const videoDur = activeVideoElement?.duration && !isNaN(activeVideoElement.duration) && activeVideoElement.duration > 0
      ? activeVideoElement.duration
      : undefined;

    chrome.runtime.sendMessage({ type: 'lookup-video', videoId, duration: videoDur }, async (res) => {
      if (res && res.ok && res.lookup) {
        currentLookup = res.lookup as VideoLookupResponseDto;
        if (currentLookup.status === 'not_found' || currentLookup.segments.length === 0) {
          segmentScheduler.setUnmapped(true);
          ensureSegmentsPopulated();
        } else {
          segmentScheduler.updateMissingIndices(currentLookup.missingSegmentIndices);
        }

        // Apply on-page badges and content filtering
        renderOnPageBadges(currentLookup);
        applyFiltering(currentLookup);

        if (currentLookup.status === 'complete') {
          stateMachine.transitionTo('completed');
        } else {
          stateMachine.transitionTo('active_watching');
        }

        // Fetch accessible transcript in background
        if (userPrefs.contributionEnabled && (segmentScheduler.hasAnyMissingSegments() || currentLookup.missingSegmentIndices.length > 0)) {
          transcriptAdapter.extractTranscript(videoId).then((t) => {
            cachedTranscript = t;
          });
        }
      } else {
        updateBadge('unavailable');
        stateMachine.transitionTo('inactive');
      }
    });
  }

  // 5. Active-Watch 250ms Main Coordination Loop
  setInterval(tick, 250);

  async function tick() {
    if (!currentVideoId) return;

    if (!activeVideoElement) {
      activeVideoElement = platformAdapter.locatePrimaryVideoElement(document);
      if (!activeVideoElement) return;
    }

    ensureSegmentsPopulated();

    const now = Date.now();
    const wallClockDeltaMs = now - lastTickWallClock;
    lastTickWallClock = now;

    const t = activeVideoElement.currentTime;
    const isPlaying =
      !activeVideoElement.paused &&
      !activeVideoElement.ended &&
      activeVideoElement.readyState >= 2 &&
      !isAdShowing();

    const isMissing = segmentScheduler.isTimestampInMissingSegment(t);

    // Evaluate 9 Gate Specifications
    const gateEval = gate.evaluate({
      extensionEnabled: userPrefs.enabled,
      acceptedPolicyVersion: userPrefs.acceptedPolicyVersion,
      currentPolicyVersion: CURRENT_POLICY_VERSION,
      contributionEnabled: userPrefs.contributionEnabled,
      isTabActiveInWindow: document.hasFocus(),
      documentVisibility: document.visibilityState,
      isVideoPlaying: isPlaying,
      isPlaybackTimeAdvancing: isPlaying,
      isVideoEndedOrSeeking: activeVideoElement.seeking || activeVideoElement.ended,
      hasMissingBackendSegments: isMissing,
      hasScreenshotOrAudioCapability: true,
    });

    if (gateEval.passed) {
      // Target segment is missing and viewer is actively watching
      if (stateMachine.stateName !== 'capturing') {
        stateMachine.transitionTo('capturing');
        updateBadge('collecting_evidence');

        currentSegmentIndex = segmentScheduler.getSegmentIndex(t);
        const bounds = segmentationStrategy.getSegmentBounds(currentSegmentIndex);
        mediaAdapter.startSegmentRecording(bounds, t);
      }

      // Track playback interval advance
      intervalTracker.onPlaybackTick(t, wallClockDeltaMs, activeVideoElement.playbackRate || 1.0);

      // Motion-adaptive frame sampling based on pixel movement (via pixelmatch)
      if (activeVideoElement && frameSampler.shouldSample(activeVideoElement, t)) {
        const frame = await mediaAdapter.captureFrame(t);
        if (frame) {
          accumulatedFrames.push(frame);
        }
      }
    } else {
      // Gate closed (paused, tab switch, unmissing segment, etc.)
      if (stateMachine.stateName === 'capturing') {
        stateMachine.transitionTo(currentLookup?.status === 'complete' ? 'completed' : 'active_watching');
        updateBadge(currentLookup?.status === 'complete' ? 'analyzed' : 'partially_analyzed');

        intervalTracker.flushOnGateClose(t);
        lastFrameCaptureTime = -1;
        frameSampler.reset();
      }
    }
  }

  // 6. Handle Interval Flush (Rollover, Seek Jump, Gate Close)
  async function handleIntervalFlush(event: IntervalFlushEvent) {
    if (!currentVideoId || !userPrefs.contributionEnabled) return;

    const segIndex = event.segmentIndex;
    const bounds = segmentationStrategy.getSegmentBounds(segIndex);

    const framesToUpload = [...accumulatedFrames];
    resetEvidenceAccumulators();

    try {
      const evidencePkg = EvidencePackager.package({
        videoId: currentVideoId,
        policyVersion: CURRENT_POLICY_VERSION,
        segmentIndex: segIndex,
        segmentBounds: bounds,
        observedIntervals: [event.interval],
        frames: framesToUpload,
        audioChunks: [],
        transcript: cachedTranscript,
        capabilities: {
          screenshots: framesToUpload.length > 0,
          tabAudio: false,
          transcriptScope: cachedTranscript?.scope || 'unavailable',
        },
      });

      // Submit bounded package to Service Worker
      const videoDur = activeVideoElement?.duration && !isNaN(activeVideoElement.duration) && activeVideoElement.duration > 0
        ? activeVideoElement.duration
        : undefined;

      chrome.runtime.sendMessage(
        { type: 'upload-evidence-package', pkg: evidencePkg, videoDuration: videoDur },
        (res) => {
          if (res && res.ok && res.updatedLookup) {
            currentLookup = res.updatedLookup as VideoLookupResponseDto;
            ensureSegmentsPopulated();
            segmentScheduler.updateMissingIndices(currentLookup.missingSegmentIndices);
            renderOnPageBadges(currentLookup);
          }
        }
      );
    } catch {
      // Ignore packaging failure for zero observations
    }
  }

  function resetEvidenceAccumulators() {
    accumulatedFrames.length = 0;
    currentSegmentIndex = null;
    frameSampler.reset();
  }

  function isAdShowing(): boolean {
    const player = document.getElementById('movie_player');
    return !!player?.classList.contains('ad-showing');
  }

  function renderOnPageBadges(lookup: VideoLookupResponseDto) {
    if (!userPrefs.showBadges) return;
    const mount = platformAdapter.createBadgeMountPoint(document);
    if (!mount) return;

    if (lookup.status === 'complete') {
      badgePresenter.renderBadge(mount, 'analyzed', {
        score: lookup.aiRelianceScore,
        label: lookup.label,
        confidence: lookup.confidence,
        analyzedAt: lookup.analyzedAt,
      });
    } else if (lookup.status === 'partial') {
      const total = lookup.segments.length;
      const missing = lookup.missingSegmentIndices.length;
      badgePresenter.renderBadge(mount, 'partially_analyzed', {
        coveredSegments: total - missing,
        totalSegments: total,
      });
    } else {
      badgePresenter.renderBadge(mount, 'not_analyzed');
    }
  }

  function updateBadge(state: 'collecting_evidence' | 'processing' | 'analyzed' | 'partially_analyzed' | 'unavailable') {
    if (!userPrefs.showBadges) return;
    const mount = platformAdapter.createBadgeMountPoint(document);
    if (!mount) return;

    if (state === 'analyzed' && currentLookup) {
      renderOnPageBadges(currentLookup);
    } else {
      badgePresenter.renderBadge(mount, state);
    }
  }

  function applyFiltering(lookup: VideoLookupResponseDto) {
    const videoContainer = document.querySelector('#movie_player, #player') as HTMLElement | null;
    if (!videoContainer) return;

    if (userPrefs.filterMode === 'threshold_hide') {
      thresholdHideFilter.applyFilter(videoContainer, lookup, userPrefs.threshold);
    } else {
      markOnlyFilter.applyFilter(videoContainer, lookup, userPrefs.threshold);
    }
  }
})();
