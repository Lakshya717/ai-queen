const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("https://www.youtube.com/watch?v=38uv47uXz8I", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  const consent = page.locator("button", { hasText: /accept all|i agree|reject all/i }).first();
  if (await consent.isVisible().catch(() => false)) await consent.click().catch(() => {});
  await page.waitForTimeout(4000);
  const more = page.locator("tp-yt-paper-button#expand, #expand").first();
  if (await more.isVisible().catch(() => false)) await more.click().catch(() => {});
  await page.waitForTimeout(1000);
  const buttons = await page.locator("ytd-video-description-transcript-section-renderer button, ytd-video-description-transcript-section-renderer yt-button-shape").allTextContents();
  console.log("transcript buttons", buttons);
  const show = page.locator("ytd-video-description-transcript-section-renderer button").first();
  if (await show.count()) await show.click({ force: true }).catch((error) => console.log("click failed", error.message));
  await page.waitForTimeout(4000);
  const report = await page.evaluate(async () => {
    const names = new Set();
    const visit = (root) => {
      if (!root || !root.querySelectorAll) return;
      root.querySelectorAll("*").forEach((node) => {
        const name = node.localName || "";
        if (/transcript|caption|segment/i.test(name) || /transcript|segment/i.test(node.className || "")) {
          names.add(`${name}.${String(node.className).slice(0, 80)}`);
        }
        if (node.shadowRoot) visit(node.shadowRoot);
      });
    };
    visit(document);
    const sample = [];
    const grab = (root) => {
      if (!root || !root.querySelectorAll) return;
      root.querySelectorAll("transcript-segment-view-model").forEach((node) => {
        if (sample.length > 3) return;
        sample.push({
          tag: node.localName,
          text: (node.innerText || "").replace(/\s+/g, " ").trim().slice(0, 200),
          html: node.innerHTML.replace(/\s+/g, " ").trim().slice(0, 500),
          dataKeys: node.data ? Object.keys(node.data).slice(0, 20) : [],
          shadow: !!node.shadowRoot,
        });
      });
      root.querySelectorAll("*").forEach((node) => {
        if (node.shadowRoot) grab(node.shadowRoot);
      });
    };
    grab(document);
    const seen = new Map();
    const remember = () => {
      document.querySelectorAll("transcript-segment-view-model").forEach((node) => {
        const stamp = node.querySelector(".ytwTranscriptSegmentViewModelTimestamp");
        const text = node.querySelector("span[role='text']");
        if (!stamp || !text) return;
        const line = `${stamp.textContent.trim()} ${text.textContent.trim()}`;
        seen.set(line, line);
      });
    };
    remember();
    let scroller = document.querySelector("transcript-segment-view-model");
    scroller = scroller && scroller.parentElement;
    while (scroller && scroller.scrollHeight <= scroller.clientHeight + 40) scroller = scroller.parentElement;
    if (scroller) {
      scroller.scrollTop = 0;
      let stuck = 0;
      let last = -1;
      for (let i = 0; i < 60 && stuck < 3; i += 1) {
        remember();
        if (seen.size === last) stuck += 1;
        else stuck = 0;
        last = seen.size;
        scroller.scrollTop += Math.max(240, scroller.clientHeight * 0.85);
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
    }
    const lines = [...seen.values()];
    return {
      title: document.title,
      names: [...names].slice(0, 40),
      sample,
      segmentCount: lines.length,
      first: lines[0] || "",
      last: lines[lines.length - 1] || "",
    };
  });
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
