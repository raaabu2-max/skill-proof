// All weighted evidence and verdict thresholds live here so the scorer and API share one source.
export const scoringConfig = Object.freeze({
  weights: Object.freeze({
    viva: 0.30,
    process: 0.20,
    aiUsage: 0.20,
    liveCheck: 0.20,
    timeAndPaste: 0.10,
    aiText: 0,
  }),
  verdictThresholds: Object.freeze({ verified: 80, review: 55 }),
  lowConfidenceMinimumWeakSignals: 3,
  weakSignalLabel: "Weak signal, not used alone",
});
