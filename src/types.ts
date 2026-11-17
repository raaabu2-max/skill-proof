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
  field?: string;
  taskId?: string;
  taskTitle?: string;
  starter?: string;
  dataset?: Record<string, unknown>[];
  thresholds?: { minEditEvents: number; maxPasteCharacters: number };
  failingTests?: string[];
  requirementChange?: string;
};

export type TrackDomain = {
  id: string;
  title: string;
  kind: "coding" | "practical";
};

export type TrackDefinition = {
  id: "problem-solver" | "skill" | "adapt";
  title: string;
  description: string;
  domains: string[];
  tasks: {
    id: string;
    domain: string;
    title: string;
    description: string;
    variants: TaskVariant[];
  }[];
};

export type TracksCatalog = {
  version: number;
  trackWeights: Record<string, number>;
  domains: Record<string, TrackDomain>;
  tracks: Record<TrackDefinition["id"], TrackDefinition>;
};

export type TrackResult = {
  track: string;
  domain: string;
  task_variant: string;
  score: number;
  signals: Record<string, number>;
  evidence: Record<string, unknown>;
  submitted_at: string;
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
  session_id?: string | null;
  track?: "problem-solver" | "skill" | "adapt";
  domain?: string;
  track_results?: TrackResult[];
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
