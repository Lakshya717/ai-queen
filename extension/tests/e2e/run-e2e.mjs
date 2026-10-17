import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const distPath = path.resolve('dist');
const profilePath = path.resolve('scratch/e2e-profile');

async function runBrowserReview() {
  console.log('--- Starting Playwright Autonomous Browser Review ---');
  console.log('Loading unpacked extension from:', distPath);

  fs.rmSync(profilePath, { recursive: true, force: true });
  fs.mkdirSync(profilePath, { recursive: true });

  const defaultChromePath = path.join(
    process.env.LOCALAPPDATA,
    'ms-playwright/chromium-1243/chrome-win64/chrome.exe'
  );
  const executablePath = fs.existsSync(defaultChromePath) ? defaultChromePath : undefined;

  const context = await chromium.launchPersistentContext(profilePath, {
    executablePath,
    headless: false,
    args: [
      `--headless=new`,
      `--disable-extensions-except=${distPath}`,
      `--load-extension=${distPath}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });

  try {
    // 1. Wait for Service Worker to register
    let serviceWorker = null;
    for (const sw of context.serviceWorkers()) {
      serviceWorker = sw;
      break;
    }

    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker', { timeout: 10000 });
    }

    console.log('✓ Extension Service Worker registered successfully:', serviceWorker.url());

    const extensionId = new URL(serviceWorker.url()).hostname;
    console.log('✓ Extension ID resolved:', extensionId);

    // 2. Test Popup UI and Policy Acceptance
    console.log('\n[E2E Step 1] Testing Extension Popup Onboarding...');
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/src/contexts/popup.html`);

    // Verify Policy Banner is visible initially
    const banner = popupPage.locator('#policy-banner');
    await banner.waitFor({ state: 'visible', timeout: 5000 });
    console.log('  Policy banner visible on first launch: true');

    // Click "Accept Policy"
    const acceptBtn = popupPage.locator('#accept-policy-btn');
    await acceptBtn.click();
    await popupPage.waitForTimeout(300);

    const isBannerHiddenAfterAccept = await banner.evaluate((el) => el.classList.contains('hidden'));
    console.log('  Policy banner hidden after acceptance:', isBannerHiddenAfterAccept);
    if (!isBannerHiddenAfterAccept) {
      throw new Error('Policy banner should be hidden after acceptance');
    }

    await popupPage.close();

    // 3. Test In-Page Content Script on YouTube fixture
    console.log('\n[E2E Step 2] Testing Active-Watch Gate & Badges on YouTube Watch Fixture...');
    const page = await context.newPage();

    // Listen to page console
    const consoleLogs = [];
    page.on('console', (msg) => consoleLogs.push(`[Browser] ${msg.text()}`));

    // Load mock watch fixture
    const htmlFixture = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Test Video - YouTube</title>
        <link rel="stylesheet" href="chrome-extension://${extensionId}/src/extensions/badges/badge.css">
      </head>
      <body style="background: #0f0f0f; color: #fff; padding: 20px;">
        <div id="above-the-fold">
          <div id="title"><h1>Simulated YouTube AI Video</h1></div>
        </div>
        <div id="movie_player" style="position: relative; width: 640px; height: 360px; background: #000;">
          <video class="html5-main-video" width="640" height="360" controls></video>
        </div>
      </body>
      </html>
    `;

    // Intercept navigation to youtube.com/watch?v=mockTest123
    await page.route('https://www.youtube.com/watch?v=mockTest123', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: htmlFixture,
      });
    });

    await page.goto('https://www.youtube.com/watch?v=mockTest123', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    // Verify badge container mounted in DOM
    const badgeRoot = page.locator('#yt-ai-detect-badge-root');
    const isBadgeMounted = await badgeRoot.isVisible({ timeout: 5000 }).catch(() => false);
    console.log('  On-page badge mounted into DOM:', isBadgeMounted);

    // Simulate video playing
    console.log('\n[E2E Step 3] Simulating Playback and Active Watch Gate...');
    await page.evaluate(() => {
      const video = document.querySelector('video');
      if (video) {
        Object.defineProperty(video, 'readyState', { value: 4 });
        Object.defineProperty(video, 'paused', { value: false });
        Object.defineProperty(video, 'ended', { value: false });
        Object.defineProperty(video, 'currentTime', { value: 12.5, writable: true });
        video.dispatchEvent(new Event('playing'));
      }
    });

    await page.waitForTimeout(1000);

    // Advance playback time to simulate watched 12.5s -> 18.0s
    await page.evaluate(() => {
      const video = document.querySelector('video');
      if (video) {
        video.currentTime = 18.0;
      }
    });
    await page.waitForTimeout(1000);

    // 4. Verify Streamlined Popup Interface on Reopen
    console.log('\n[E2E Step 4] Testing Streamlined Popup Interface...');
    const secondPopup = await context.newPage();
    await secondPopup.goto(`chrome-extension://${extensionId}/src/contexts/popup.html`);
    const statusCard = secondPopup.locator('.popup-container');
    await statusCard.waitFor({ state: 'visible', timeout: 5000 });

    const cardContent = await statusCard.textContent();
    console.log('  Popup multimodal status verified:', cardContent?.includes('Multimodal Ingestion'));
    if (!cardContent?.includes('Multimodal Ingestion')) {
      throw new Error('Popup should display automated multimodal ingestion status');
    }
    await secondPopup.close();

    // 5. Verify Storage Invariant (Zero raw media or transcripts leaked into storage)
    console.log('\n[E2E Step 5] Auditing chrome.storage.local Privacy Invariant...');
    const storageAudit = await serviceWorker.evaluate(async () => {
      const all = await chrome.storage.local.get(null);
      const serialized = JSON.stringify(all);
      const hasMedia =
        serialized.includes('data:image') ||
        serialized.includes('audio/webm') ||
        serialized.includes('synthetic_jpeg');

      return {
        keys: Object.keys(all),
        hasMediaLeakage: hasMedia,
        preferences: all.preferences,
      };
    });

    console.log('  Stored keys in chrome.storage.local:', storageAudit.keys);
    console.log('  Raw media leakage detected:', storageAudit.hasMediaLeakage);
    console.log('  Accepted policy version stored:', storageAudit.preferences?.acceptedPolicyVersion);

    if (storageAudit.hasMediaLeakage) {
      throw new Error('Privacy Invariant Violated: Raw media detected in chrome.storage.local!');
    }
    if (storageAudit.preferences?.acceptedPolicyVersion !== 'v1') {
      throw new Error('Policy acceptance was not persisted properly in chrome.storage.local');
    }

    console.log('\n✓ All Playwright Browser Review checks passed successfully!');
  } finally {
    await context.close();
  }
}

runBrowserReview().catch((err) => {
  console.error('\n❌ Browser Review Failed:', err);
  process.exit(1);
});
