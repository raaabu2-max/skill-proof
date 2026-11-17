export const scoringConfig: {
  weights: {
    viva: number;
    process: number;
    aiUsage: number;
    liveCheck: number;
    timeAndPaste: number;
    aiText: number;
  };
  verdictThresholds: {
    verified: number;
    review: number;
  };
  lowConfidenceMinimumWeakSignals: number;
  weakSignalLabel: string;
};
