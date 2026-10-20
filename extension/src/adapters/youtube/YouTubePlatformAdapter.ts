import type { IPlatformAdapter } from '../../ports/IPlatformAdapter';
import type { ITranscriptExtractorAdapter } from '../../ports/ITranscriptExtractorAdapter';
import { YouTubeDomTranscriptAdapter } from './YouTubeDomTranscriptAdapter';

export class YouTubePlatformAdapter implements IPlatformAdapter {
  public readonly platformId = 'youtube' as const;

  private static readonly VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;

  public extractVideoIdFromUrl(urlStr: string): string | null {
    try {
      const url = new URL(urlStr);

      // 1. Standard youtube.com/watch?v=...
      if (url.pathname === '/watch') {
        const id = url.searchParams.get('v');
        return id && YouTubePlatformAdapter.VIDEO_ID_REGEX.test(id) ? id : null;
      }

      // 2. YouTube Shorts: /shorts/12345678901
      const shortsMatch = url.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{11})(?:\/|$)/);
      if (shortsMatch && YouTubePlatformAdapter.VIDEO_ID_REGEX.test(shortsMatch[1])) {
        return shortsMatch[1];
      }

      // 3. youtu.be/12345678901
      if (url.hostname === 'youtu.be') {
        const id = url.pathname.slice(1).split('/')[0];
        return id && YouTubePlatformAdapter.VIDEO_ID_REGEX.test(id) ? id : null;
      }

      // 4. /embed/12345678901
      const embedMatch = url.pathname.match(/^\/embed\/([A-Za-z0-9_-]{11})/);
      if (embedMatch && YouTubePlatformAdapter.VIDEO_ID_REGEX.test(embedMatch[1])) {
        return embedMatch[1];
      }

      return null;
    } catch {
      return null;
    }
  }

  public isShortsUrl(urlStr: string): boolean {
    try {
      return new URL(urlStr).pathname === '/shorts' ||
        new URL(urlStr).pathname.startsWith('/shorts/');
    } catch {
      return false;
    }
  }

  public locatePrimaryVideoElement(root: Document = document): HTMLVideoElement | null {
    // Priority order of selectors
    return (
      (root.querySelector('#shorts-player video, ytd-shorts video, ytd-reel-video-renderer video') as HTMLVideoElement) ||
      (root.querySelector('#movie_player video') as HTMLVideoElement) ||
      (root.querySelector('video.html5-main-video') as HTMLVideoElement) ||
      (root.querySelector('video') as HTMLVideoElement) ||
      null
    );
  }

  public observeSpaNavigation(onVideoChange: (newVideoId: string | null) => void): () => void {
    let lastVideoId: string | null = typeof window !== 'undefined'
      ? this.extractVideoIdFromUrl(window.location.href)
      : null;

    const handler = () => {
      const currentVideoId = this.extractVideoIdFromUrl(window.location.href);
      if (currentVideoId !== lastVideoId) {
        lastVideoId = currentVideoId;
        onVideoChange(currentVideoId);
      }
    };

    let pollId: ReturnType<typeof setInterval> | null = null;
    if (typeof document !== 'undefined') {
      document.addEventListener('yt-navigate-finish', handler);
      document.addEventListener('yt-page-data-updated', handler);
      window.addEventListener('popstate', handler);
      // Shorts can update the URL during swipe/autoplay without consistently
      // emitting a history event.
      pollId = setInterval(handler, 500);
    }

    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('yt-navigate-finish', handler);
        document.removeEventListener('yt-page-data-updated', handler);
        window.removeEventListener('popstate', handler);
        if (pollId !== null) clearInterval(pollId);
      }
    };
  }

  public createTranscriptExtractor(): ITranscriptExtractorAdapter {
    return new YouTubeDomTranscriptAdapter();
  }

  public createBadgeMountPoint(root: Document = document): HTMLElement | null {
    const shortsPlayer = root.querySelector(
      '#shorts-player, ytd-shorts, ytd-reel-video-renderer, #shorts-container'
    ) as HTMLElement | null;
    if (shortsPlayer) {
      let mount = root.getElementById('yt-ai-detect-badge-root');
      if (!mount) {
        mount = root.createElement('div');
        mount.id = 'yt-ai-detect-badge-root';
        mount.className = 'yt-ai-detect-badge-container';
        shortsPlayer.appendChild(mount);
      }
      return mount;
    }

    // Mount near the video title or below the player
    const titleContainer =
      root.querySelector('#title h1, ytd-watch-metadata #title, #above-the-fold') ||
      root.querySelector('#movie_player');

    if (!titleContainer) return null;

    let mount = root.getElementById('yt-ai-detect-badge-root');
    if (!mount) {
      mount = root.createElement('div');
      mount.id = 'yt-ai-detect-badge-root';
      mount.className = 'yt-ai-detect-badge-container';
      titleContainer.parentElement?.insertBefore(mount, titleContainer.nextSibling);
    }

    return mount;
  }
}
