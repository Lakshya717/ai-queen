const assert = require("assert");
const resume = require("../src/lib/resume.js");
const policy = require("../src/lib/sample-policy.js");
const transcripts = require("../src/lib/transcript.js");
const bundle = require("../src/lib/bundle.js");
const upload = require("../src/lib/upload.js");
const bytes = require("../src/lib/bytes.js");

function state(extra) {
  return Object.assign(
    {
      lastSampleTime: null,
      lastCaptionCueStart: null,
      coveredRanges: [],
      frames: [],
    },
    extra
  );
}

function event(extra) {
  return Object.assign({ t: 0, diff: 0, captionCueStart: null, playing: true }, extra);
}

{
  const decision = policy.decide(state({ coveredRanges: [{ start: 0, end: 30 }] }), event({ t: 12, diff: 0.9 }));
  assert.strictEqual(decision.save, false);
  assert.strictEqual(decision.skip, "covered");
}

{
  const decision = policy.decide(state(), event({ t: 1, diff: 0 }));
  assert.strictEqual(decision.save, true);
  assert.strictEqual(decision.reason, "scene_change");
}

{
  const decision = policy.decide(
    state({ lastSampleTime: 10, frames: [{ t: 10, changeScore: 0.2, file: "a" }] }),
    event({ t: 10.4, diff: 0.9 })
  );
  assert.strictEqual(decision.save, false);
}

{
  const decision = policy.decide(
    state({ lastSampleTime: 10, frames: [{ t: 10, changeScore: 0.2, file: "a" }] }),
    event({ t: 10.6, diff: 0.2 })
  );
  assert.strictEqual(decision.save, true);
  assert.strictEqual(decision.reason, "scene_change");
}

{
  const decision = policy.decide(
    state({ lastSampleTime: 10, frames: [{ t: 10, changeScore: 0.2, file: "a" }] }),
    event({ t: 20, diff: 0.01 })
  );
  assert.strictEqual(decision.save, true);
  assert.strictEqual(decision.reason, "max_gap");
}

{
  const base = state({ lastSampleTime: 10, frames: [{ t: 10, changeScore: 0.2, file: "a" }] });
  const tooSoon = policy.decide(base, event({ t: 10.8, diff: 0.01, captionCueStart: 10.7 }));
  assert.strictEqual(tooSoon.save, false);
  const ready = policy.decide(base, event({ t: 11.1, diff: 0.01, captionCueStart: 10.7 }));
  assert.strictEqual(ready.save, true);
  assert.strictEqual(ready.reason, "caption_boundary");
}

{
  const decision = policy.decide(
    state({ lastSampleTime: 40, frames: [{ t: 40, changeScore: 0.3, file: "a" }] }),
    event({ t: 12, diff: 0.5 })
  );
  assert.strictEqual(decision.save, true);
  assert.strictEqual(decision.reason, "scene_change");
}

{
  const frames = Array.from({ length: 240 }, (_, i) => ({
    t: i * 20,
    changeScore: 0.05,
    file: `f${i}`,
  }));
  const blocked = policy.decide(
    state({ lastSampleTime: 20, frames, coveredRanges: [] }),
    event({ t: 21, diff: 0.01 })
  );
  assert.strictEqual(blocked.save, false);
  const weak = policy.decide(state({ lastSampleTime: 20, frames }), event({ t: 21, diff: 0.06 }));
  assert.strictEqual(weak.save, false);
  const replaced = policy.decide(state({ lastSampleTime: 20, frames }), event({ t: 21, diff: 0.4 }));
  assert.strictEqual(replaced.save, true);
  assert.strictEqual(replaced.replaceIndex >= 0, true);
}

{
  assert.strictEqual(resume.isCovered(30, [{ start: 0, end: 30 }]), false);
  assert.strictEqual(resume.isCovered(29.9, [{ start: 0, end: 30 }]), true);
  const merged = resume.addCoverage([{ start: 0, end: 30 }], 30, 45);
  assert.deepStrictEqual(merged, [{ start: 0, end: 45 }]);
  assert.strictEqual(resume.coveredSeconds([{ start: 0, end: 10 }, { start: 20, end: 25 }]), 15);
}

{
  const segments = transcripts.parseTimedText({
    events: [
      { tStartMs: 0, dDurationMs: 1200, segs: [{ utf8: "Hello" }] },
      { tStartMs: 1200, dDurationMs: 800, segs: [{ utf8: " " }, { utf8: "there" }] },
      { tStartMs: 2000, dDurationMs: 500, segs: [{ utf8: "\n" }] },
    ],
  });
  assert.strictEqual(segments.length, 2);
  assert.strictEqual(segments[1].text, "there");
  const flagged = transcripts.flagWatched(segments, [{ start: 0, end: 1 }]);
  assert.strictEqual(flagged[0].watched, true);
  assert.strictEqual(flagged[1].watched, false);
  assert.strictEqual(transcripts.transcriptFileName("en", "asr"), "transcripts/en-asr.json");
}

{
  const manifest = bundle.emptyManifest({ id: "abcdefghijk", title: "Demo" });
  manifest.coveredRanges = [{ start: 0, end: 5 }];
  manifest.frames = [{ t: 1.2, reason: "scene_change", changeScore: 0.4, file: bundle.frameFileName(1.2) }];
  manifest.transcripts = [
    {
      language: "en",
      kind: "manual",
      file: "transcripts/en-manual.json",
      segments: [{ start: 0, end: 4, text: "Hello there" }],
    },
  ];
  const text = bundle.renderLlmInput(manifest, "en");
  assert.ok(text.includes("Hello there"));
  assert.ok(text.includes("frames/00001.200.jpg"));
  const again = bundle.mergeManifests(manifest, {
    ...manifest,
    coveredRanges: [{ start: 20, end: 25 }],
    frames: [{ t: 22, reason: "max_gap", changeScore: 0.1, file: "frames/00022.000.jpg" }],
  });
  assert.strictEqual(again.frames.length, 2);
  assert.strictEqual(again.coveredRanges.length, 2);
}

{
  assert.throws(() => upload.uploadBundle("https://example.test", {}), /Not implemented/);
}

{
  const original = Uint8Array.from([0xff, 0xd8, 0xff, 0, 1, 255, 10]);
  const encoded = bytes.encodeBytes(original);
  assert.strictEqual(typeof encoded, "string");
  assert.deepStrictEqual(bytes.decodeBytes(encoded), original);
  assert.throws(() => bytes.decodeBytes({}), /not readable/);
}

{
  const manual = { language: "es", kind: "manual", segments: [{ start: 0, end: 1, text: "hola" }] };
  const asr = { language: "en", kind: "asr", segments: [{ start: 0, end: 1, text: "hello" }] };
  assert.strictEqual(transcripts.chooseTranscript([asr, manual], "en").kind, "manual");
  assert.strictEqual(transcripts.chooseTranscript([asr], "en").kind, "asr");
}

console.log("capture tests passed");
