export type TimelineEvent = {
  id?: string;
  type: "edit" | "paste" | "tab" | "blur" | "idle" | "run" | "requirement_change";
  time: string;
  timestamp?: string;
  detail: string;
  count: number;
  characters?: number;
};

export type AIUsage = {
  id?: string;
  prompt: string;
  response?: string;
  verified: boolean;
  summary: string;
  seeded_mistake?: boolean;
  caught?: boolean;
  edited_after?: boolean;
};

export type VivaAnswer = {
  question: string;
  answer: string;
  score: number | null;
  feedback: string;
};

export type LiveCheck = {
  score: number;
  passed: number;
  total: number;
  attempts: number;
  duration_seconds: number;
  focus_changes: number;
  blur_events?: number;
  idle_periods?: number[];
  selected_fix: string;
  requirement_change_seen: boolean;
};

export type TaskVariant = {
  id: string;
  title: string;
  description: string;
  field: string;
  dataset: Record<string, unknown>[];
  thresholds: { minEditEvents: number; maxPasteCharacters: number };
};

export type FlagDetail = {
  key: string;
  evidence: string;
  explanation: string;
  weak_signal: boolean;
};

export type ScoringComponents = {
  viva: number;
  process: number;
  aiUsage: number;
  liveCheck: number;
  timeAndPaste: number;
  aiText: number;
};

export type CredentialDetails = {
  credential_id: string;
  issued_date: string;
  skills: string[];
  evidence_summary: string;
};

export type Candidate = {
  id: string;
  name: string;
  role: string;
  email: string;
  score: number;
  verdict: "Verified skill" | "Needs review" | "Low confidence";
  status: string;
  created_at: string;
  duration_seconds: number;
  keystrokes: number;
  extra_time?: number;
  task_variant?: string;
  verdict_reason?: string;
  ai_text_note?: string;
  flag_details?: FlagDetail[];
  scoring_components?: ScoringComponents;
  code: string;
  events: TimelineEvent[];
  ai_prompts: AIUsage[];
  viva: VivaAnswer[];
  live_check: LiveCheck | null;
  flags: string[];
  credential_id: string | null;
};
