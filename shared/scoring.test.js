import test from "node:test";
import assert from "node:assert/strict";
import { scoreCandidate } from "./scoring.js";

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
