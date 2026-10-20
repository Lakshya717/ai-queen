# YouTube AI Detection Extension

## Shorts support

The extension supports direct YouTube Shorts pages at `/shorts/{videoId}`. It:

- Finds the Shorts vertical player and mounts the analysis badge inside it.
- Reinitializes the active-watch session when a swipe or autoplay transition changes the Shorts video ID.
- Ignores late lookup responses from the previous Short.
- Uses one bounded segment for Shorts shorter than the normal 30-second segment window.
- Reuses the existing backend contract keyed by the YouTube video ID.

## Manual validation

1. Build the extension with `npm run build`.
2. Load `extension/dist` as an unpacked extension in Chrome.
3. Open a direct Shorts URL such as `https://www.youtube.com/shorts/{videoId}`.
4. Confirm the badge appears in the vertical player after the page settles.
5. Play the Short, swipe to another Short, and confirm the extension resets the status for the new video rather than retaining the previous result.
6. Confirm the popup still reports the current video and that no raw media is persisted in extension storage.

Automated coverage is available with `npm test` and `npm run test:e2e`.
