import test from "node:test";
import assert from "node:assert/strict";
import { scoreCandidate, scoreTrackResult } from "./scoring.js";
import { getTrack, getTrackVariants, tracksConfig } from "./tracks.config.js";

const strongEvidence = {
  viva: [{ score: 9 }, { score: 9 }],
  events: Array.from({ length: 8 }, () => ({ type: "edit", count: 1 })),
  aiPrompts: [{ verified: true, edited_after: true }],
  liveCheck: { tests_passed: 4, tests_total: 4, time_used: 120 },
  durationSeconds: 700,
};

test("one weak signal cannot produce Low confidence", () => {
  const result = scoreCandidate({
    ...strongEvidence,
    liveCheck: { tests_passed: 1, tests_total: 4, time_used: 120 },
  });

  assert.equal(result.weakSignals.length, 1);
  assert.equal(result.verdict, "Needs review");
});

test("Low confidence requires at least three independent weak areas", () => {
  const result = scoreCandidate({
    viva: [{ score: 2 }],
    events: [{ type: "paste", count: 30 }],
    aiPrompts: [{ seeded_mistake: true, caught: false }],
    liveCheck: { tests_passed: 0, tests_total: 4, time_used: 30 },
    durationSeconds: 30,
  });

  assert.ok(result.weakSignals.length >= 3);
  assert.equal(result.verdict, "Low confidence");
  assert.ok(result.flags.every((flag) => flag.evidence && flag.explanation));
});

test("conflicting strong and weak evidence requires human review", () => {
  const result = scoreCandidate({
    ...strongEvidence,
    viva: [{ score: 10 }],
    liveCheck: { tests_passed: 0, tests_total: 4, time_used: 120 },
  });

  assert.equal(result.verdict, "Needs review");
  assert.ok(result.flags.some((flag) => flag.key === "conflicting-evidence"));
});

test("using and checking AI suggestions is not penalized", () => {
  const noAi = scoreCandidate({ ...strongEvidence, aiPrompts: [] });
  const checkedAi = scoreCandidate({
    ...strongEvidence,
    aiPrompts: [{ verified: true, seeded_mistake: true, caught: true, edited_after: true }],
  });

  assert.equal(checkedAi.components.aiUsage, 100);
  assert.ok(checkedAi.score >= noAi.score);
});

test("process scoring reads counts from batched event payloads", () => {
  const result = scoreCandidate({
    ...strongEvidence,
    events: Array.from({ length: 5 }, () => ({ type: "edit", payload: { count: 2 } })),
  });

  assert.equal(result.evidence.edits, 10);
  assert.equal(result.components.process, 100);
});

test("AI-text notes do not affect the weighted score", () => {
  const concise = scoreCandidate({ ...strongEvidence, vivaText: "short" });
  const long = scoreCandidate({ ...strongEvidence, vivaText: "many ".repeat(100) });

  assert.equal(concise.components.aiText, 0);
  assert.equal(concise.score, long.score);
  assert.match(concise.aiTextNote, /non-native English speakers/);
});

test("track config signal and aggregate weights are normalized", () => {
  for (const track of Object.values(tracksConfig.tracks)) {
    const weight = Object.values(track.signals).reduce((sum, signal) => sum + signal.weight, 0);
    assert.ok(Math.abs(weight - 1) < 1e-10);
    for (const domain of track.domains) assert.ok(getTrackVariants(track.id, domain).length > 0);
  }
  assert.ok(Math.abs(Object.values(tracksConfig.trackWeights).reduce((sum, weight) => sum + weight, 0) - 1) < 1e-10);
});

test("track scoring rejects unsupported signals and out-of-range values", () => {
  assert.throws(() => scoreTrackResult({
    track: "skill", domain: "javascript",
    signals: { viva: 90, process: 90, aiUsage: 90, liveCheck: 101, timeAndPaste: 90 },
  }), /0 to 100/);
  assert.throws(() => scoreTrackResult({
    track: "skill", domain: "marketing",
    signals: { viva: 90, process: 90, aiUsage: 90, liveCheck: 90, timeAndPaste: 90, extra: 1 },
  }), /exactly the configured signals/);
  assert.throws(() => scoreTrackResult({
    track: "skill", domain: "javascript",
    signals: { viva: "90", process: 90, aiUsage: 90, liveCheck: 90, timeAndPaste: 90 },
  }), /number from 0 to 100/);
});

test("track results combine using configured track weights", () => {
  const signals = (score) => ({ viva: score, process: score, aiUsage: score, liveCheck: score, timeAndPaste: score });
  const result = scoreCandidate({
    trackResults: [
      { track: "problem-solver", domain: "javascript", signals: signals(100) },
      { track: "skill", domain: "javascript", signals: signals(50) },
      { track: "adapt", domain: "javascript", signals: signals(0) },
    ],
  });

  assert.equal(result.score, 50);
  assert.deepEqual(result.trackScores.map(({ track }) => track), ["problem-solver", "skill", "adapt"]);
});

test("track scoring preserves the low-confidence and conflict safeguards", () => {
  const oneWeakSignal = scoreCandidate({
    trackResults: [{
      track: "problem-solver",
      domain: "javascript",
      signals: { viva: 45, process: 0, aiUsage: 45, liveCheck: 45, timeAndPaste: 45 },
    }],
  });
  const threeWeakSignals = scoreCandidate({
    trackResults: [{
      track: "problem-solver",
      domain: "javascript",
      signals: { viva: 20, process: 20, aiUsage: 20, liveCheck: 20, timeAndPaste: 20 },
    }],
  });
  const conflict = scoreCandidate({
    trackResults: [{
      track: "adapt",
      domain: "marketing",
      signals: { viva: 90, process: 70, aiUsage: 20, liveCheck: 70, timeAndPaste: 70 },
    }],
  });

  assert.equal(oneWeakSignal.score < 55, true);
  assert.equal(oneWeakSignal.weakSignals.length, 1);
  assert.equal(oneWeakSignal.verdict, "Needs review");
  assert.equal(threeWeakSignals.verdict, "Low confidence");
  assert.equal(conflict.verdict, "Needs review");
  assert.ok(conflict.flags.some((flag) => flag.key === "conflicting-evidence"));
});

test("responsible AI use does not reduce a track score", () => {
  const makeResult = (aiUsage) => scoreCandidate({
    trackResults: [{
      track: "skill",
      domain: "javascript",
      signals: { viva: 80, process: 80, aiUsage, liveCheck: 80, timeAndPaste: 80 },
    }],
  });

  assert.ok(makeResult(95).score >= makeResult(70).score);
  assert.equal(getTrack("skill").domains.includes("marketing"), true);
});
