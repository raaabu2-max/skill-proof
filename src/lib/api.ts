import type { Candidate, CredentialDetails, LiveCheck, TaskVariant, TimelineEvent, VivaAnswer } from "../types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body as T;
}

export const api = {
  candidates: () => request<Candidate[]>("/candidates"),
  candidate: (id: string) => request<Candidate>(`/candidates/${id}`),
  startSession: (name: string, email: string, extraTime: boolean) => request<{
    candidate_id: string;
    session_id: string;
    task_variant: TaskVariant;
    requirement_change_delay_ms: number;
  }>("/consent", {
    method: "POST",
    body: JSON.stringify({ name, email, consent: true, extra_time: extraTime }),
  }),
  task: (sessionId: string) => request<{ task_variant: TaskVariant }>(`/sessions/${sessionId}/task`),
  requirementChange: (sessionId: string) => request<{ fired: boolean; acknowledged: boolean; message: string | null }>(`/sessions/${sessionId}/requirement-change`),
  acknowledgeRequirementChange: (sessionId: string) => request<{ acknowledged: boolean }>(`/sessions/${sessionId}/requirement-change`, { method: "POST" }),
  sessionEvents: (sessionId: string, events: TimelineEvent[]) => request<{ accepted: number }>(`/sessions/${sessionId}/events`, {
    method: "POST", body: JSON.stringify({ events: events.map(({ id, type, timestamp, detail, count, characters }) => ({
      id, type, timestamp: timestamp || new Date().toISOString(), payload: { detail, count, characters },
    })) }),
  }),
  sessionAssistant: (sessionId: string, prompt: string) => request<{
    answer: string;
    prompt: { id: string; seeded_mistake: boolean };
  }>(`/sessions/${sessionId}/assistant`, {
    method: "POST", body: JSON.stringify({ prompt }),
  }),
  verifyPrompt: (sessionId: string, promptId: string, verified: boolean) => request<{ verified: boolean }>(
    `/sessions/${sessionId}/ai-prompts/${promptId}`, { method: "PATCH", body: JSON.stringify({ verified }) },
  ),
  submitAssessment: (data: {
    name: string; email: string; code: string; consent: boolean; session_id?: string; events: Candidate["events"];
    ai_prompts: Candidate["ai_prompts"]; duration_seconds: number; keystrokes: number;
  }) => request<{ id: string; candidate: Candidate }>("/assessment", { method: "POST", body: JSON.stringify(data) }),
  questions: (id: string, task?: string) => request<{ questions: VivaAnswer[] }>(`/candidates/${id}/questions`, {
    method: "POST", body: JSON.stringify({ task }),
  }),
  answer: (id: string, index: number, answer: string) => request<{ answer: VivaAnswer; score_10: number; reason: string }>(`/candidates/${id}/answer`, {
    method: "POST", body: JSON.stringify({ index, answer }),
  }),
  liveCheck: (id: string, result: Omit<LiveCheck, "score">) => request<{ live_check: LiveCheck }>(`/candidates/${id}/live-check`, {
    method: "POST", body: JSON.stringify(result),
  }),
  complete: (id: string) => request<Candidate>(`/candidates/${id}/complete`, { method: "POST" }),
  scoringConfig: () => request<{ weights: Record<string, number>; verdictThresholds: { verified: number; review: number }; lowConfidenceMinimumWeakSignals: number }>("/scoring-config"),
  verifyCredential: (credentialId: string) => request<Candidate>(`/verify/${encodeURIComponent(credentialId)}`),
  credential: (credentialId: string) => request<{ candidate: Candidate; credential: CredentialDetails }>(
    `/credentials/${encodeURIComponent(credentialId)}`,
  ),
  assistant: (prompt: string, code: string) => request<{ answer: string }>("/assistant", {
    method: "POST", body: JSON.stringify({ prompt, code }),
  }),
};
