import { scoringConfig } from "./scoring-config.js";

const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, Number(value) || 0));

function averageViva(viva = []) {
  const scores = viva.map((item) => Number(item.score)).filter(Number.isFinite);
  if (!scores.length) return 0;
  const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  return clamp(average <= 10 ? average * 10 : average);
}

function processEvidence(events = []) {
  const edits = events.filter((event) => event.type === "edit").reduce((sum, event) =>
    sum + Math.max(0, Number(event.payload?.count ?? event.count) || 0), 0);
  const pastes = events.filter((event) => event.type === "paste");
  const pasteChars = pastes.reduce((sum, event) => {
    const characters = Number(event.payload?.characters ?? event.characters);
    return sum + (Number.isFinite(characters) ? Math.max(0, characters) : Math.max(0, Number(event.count) || 0) * 40);
  }, 0);
  const score = clamp(10 + Math.min(edits, 10) * 8 + (edits >= 4 ? 15 : 0) -
    (pasteChars >= 1200 ? 45 : pasteChars >= 500 ? 25 : pasteChars > 0 ? 10 : 0) -
    (pastes.length > 0 && edits < 3 ? 20 : 0));
  return { score, edits, pasteChars, pasteCount: pastes.length };
}

function aiUsageEvidence(prompts = []) {
  if (!prompts.length) return { score: 75, seededMistakes: 0, caughtMistakes: 0, verified: 0 };
  const quality = prompts.map((item) => {
    if (item.seeded_mistake && item.caught) return 100;
    if (item.seeded_mistake && !item.caught) return 35;
    if (item.verified || item.edited_after) return 95;
    return 70;
  });
  return {
    score: Math.round(quality.reduce((sum, score) => sum + score, 0) / quality.length),
    seededMistakes: prompts.filter((item) => item.seeded_mistake).length,
    caughtMistakes: prompts.filter((item) => item.seeded_mistake && item.caught).length,
    verified: prompts.filter((item) => item.verified || item.edited_after).length,
  };
}

function liveCheckEvidence(liveCheck) {
  if (!liveCheck) return { score: 0, passed: 0, total: 0 };
  const total = Math.max(0, Number(liveCheck.tests_total ?? liveCheck.total) || 0);
  const passed = clamp(Number(liveCheck.tests_passed ?? liveCheck.passed) || 0, 0, total);
  const testsScore = total ? passed / total * 100 : 0;
  const timeUsed = Math.max(0, Number(liveCheck.time_used ?? liveCheck.duration_seconds) || 0);
  const timeScore = timeUsed <= 180 ? 100 : timeUsed <= 300 ? 85 : timeUsed <= 600 ? 70 : 55;
  return { score: Math.round(testsScore * 0.9 + timeScore * 0.1), passed, total };
}

function timeAndPasteEvidence(durationSeconds, pasteChars) {
  const duration = Math.max(0, Number(durationSeconds) || 0);
  const timeScore = duration < 60 ? 35 : duration < 180 ? 55 : duration < 300 ? 68 : duration < 600 ? 82 : 95;
  const pasteScore = pasteChars >= 1600 ? 25 : pasteChars >= 800 ? 50 : pasteChars >= 300 ? 75 : 95;
  return Math.round(timeScore * 0.6 + pasteScore * 0.4);
}

function makeFlag(key, evidence, explanation, weak = false) {
  return { key, evidence, explanation, weak_signal: weak };
}

export function scoreCandidate({ viva = [], events = [], aiPrompts = [], liveCheck = null, durationSeconds = 0, vivaText = "" }) {
  const vivaScore = averageViva(viva);
  const process = processEvidence(events);
  const ai = aiUsageEvidence(aiPrompts);
  const live = liveCheckEvidence(liveCheck);
  const timeAndPasteScore = timeAndPasteEvidence(durationSeconds, process.pasteChars);
  const components = {
    viva: vivaScore,
    process: process.score,
    aiUsage: ai.score,
    liveCheck: live.score,
    timeAndPaste: timeAndPasteScore,
    aiText: 0,
  };
  const score = Math.round(
    components.viva * scoringConfig.weights.viva +
    components.process * scoringConfig.weights.process +
    components.aiUsage * scoringConfig.weights.aiUsage +
    components.liveCheck * scoringConfig.weights.liveCheck +
    components.timeAndPaste * scoringConfig.weights.timeAndPaste
  );
  const weak = [
    ["viva", components.viva < 45],
    ["process", components.process < 45],
    ["liveCheck", components.liveCheck < 45],
    ["timeAndPaste", components.timeAndPaste < 45],
  ].filter(([, flagged]) => flagged).map(([name]) => name);
  const values = Object.values(components).filter((value) => value > 0);
  const conflictingEvidence = values.some((value) => value >= 80) && values.some((value) => value < 45);
  const canVerify = score >= scoringConfig.verdictThresholds.verified &&
    components.viva >= 70 && components.liveCheck >= 70 && !conflictingEvidence;
  const lowConfidence = score < scoringConfig.verdictThresholds.review &&
    weak.length >= scoringConfig.lowConfidenceMinimumWeakSignals && !conflictingEvidence;
  const verdict = canVerify ? "Verified skill" : lowConfidence ? "Low confidence" : "Needs review";

  const flags = [];
  if (vivaScore < 45) flags.push(makeFlag("low-viva", `Average viva understanding was ${vivaScore}/100.`, "Invite the candidate to explain a decision or edge case; a low viva score is only one part of the evidence.", true));
  if (process.score < 45) flags.push(makeFlag("limited-process", `${process.edits} edit actions and ${process.pasteChars} pasted characters were recorded.`, "The recorded work shows limited iterative editing. This may reflect the task or the candidate's workflow, so review it with other evidence.", true));
  if (live.score < 45) flags.push(makeFlag("low-live-check", `${live.passed}/${live.total} live-check tests passed.`, "The focused follow-up tests were mostly unsuccessful; discuss the candidate's debugging approach before drawing conclusions.", true));
  if (timeAndPasteScore < 45) flags.push(makeFlag("time-and-paste", `${Math.round(durationSeconds)} seconds elapsed; ${process.pasteChars} characters were pasted.`, "A short duration or large paste can have many explanations and is not evidence of misconduct by itself.", true));
  if (conflictingEvidence) flags.push(makeFlag("conflicting-evidence", "At least one component scored 80 or higher while another scored below 45.", "Mixed evidence points to a follow-up conversation rather than an automated conclusion."));
  if (ai.seededMistakes > 0) {
    flags.push(makeFlag("seeded-ai-mistake", `${ai.caughtMistakes} of ${ai.seededMistakes} seeded assistant edge-case suggestions were corrected or explicitly verified.`, "This records how the candidate evaluated a suggestion; AI use itself is not treated as negative."));
  }

  const text = String(vivaText).trim();
  const words = text ? text.split(/\s+/).length : 0;
  const aiTextNote = `${scoringConfig.weakSignalLabel}: response-length patterns are not evidence of AI authorship, are worth 0% of the score, and can produce false positives (including for non-native English speakers).`;
  const verdictReason = verdict === "Verified skill"
    ? "Strong viva and live-check evidence align with the rest of the assessment."
    : verdict === "Low confidence"
      ? `${weak.length} separate evidence areas are weak; a human reviewer should evaluate the supporting evidence.`
      : conflictingEvidence
        ? "Evidence conflicts across assessment areas; a human follow-up is appropriate."
        : "The evidence is mixed or incomplete; review the supporting details before making a decision.";

  return {
    score,
    verdict,
    verdictReason,
    components,
    weakSignals: weak,
    flags,
    aiTextNote,
    aiTextWordCount: words,
    evidence: { ...process, ...ai, liveCheck: live },
    scoringConfig,
  };
}
