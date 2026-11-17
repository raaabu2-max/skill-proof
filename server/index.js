import express from "express";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scoreCandidate } from "../shared/scoring.js";
import { scoringConfig } from "../shared/scoring-config.js";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(here, "../data");
mkdirSync(dataDir, { recursive: true });
const db = new Database(resolve(dataDir, "skillproof.db"));
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS candidates (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL,
    email TEXT, score INTEGER NOT NULL, verdict TEXT NOT NULL,
    status TEXT NOT NULL, created_at TEXT NOT NULL, duration_seconds INTEGER DEFAULT 0,
    keystrokes INTEGER NOT NULL DEFAULT 0,
    code TEXT DEFAULT '', events TEXT DEFAULT '[]', ai_prompts TEXT DEFAULT '[]',
    viva TEXT DEFAULT '[]', flags TEXT DEFAULT '[]', credential_id TEXT,
    live_check TEXT DEFAULT NULL, session_id TEXT, task_variant TEXT,
    consented_at TEXT, extra_time INTEGER NOT NULL DEFAULT 0,
    verdict_reason TEXT, flag_details TEXT DEFAULT '[]', ai_text_note TEXT,
    scoring_components TEXT DEFAULT '{}'
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    candidate_id TEXT NOT NULL UNIQUE REFERENCES candidates(id),
    started_at TEXT NOT NULL,
    consented_at TEXT NOT NULL,
    task_variant TEXT NOT NULL,
    extra_time INTEGER NOT NULL DEFAULT 0,
    requirement_change_seen INTEGER NOT NULL DEFAULT 0,
    requirement_change_at TEXT,
    completed_at TEXT
  );
  CREATE TABLE IF NOT EXISTS process_events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX IF NOT EXISTS idx_process_events_session_timestamp
    ON process_events(session_id, timestamp);
  CREATE TABLE IF NOT EXISTS ai_prompts (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    prompt TEXT NOT NULL,
    answer TEXT NOT NULL,
    seeded_mistake INTEGER NOT NULL DEFAULT 0,
    caught INTEGER NOT NULL DEFAULT 0,
    edited_after INTEGER NOT NULL DEFAULT 0,
    verified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS viva_qas (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    question_index INTEGER NOT NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL DEFAULT '',
    score REAL,
    reason TEXT NOT NULL DEFAULT '',
    UNIQUE(session_id, question_index)
  );
  CREATE TABLE IF NOT EXISTS live_checks (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    tests_passed INTEGER NOT NULL,
    tests_total INTEGER NOT NULL,
    time_used INTEGER NOT NULL,
    tab_switches INTEGER NOT NULL DEFAULT 0,
    blur_events INTEGER NOT NULL DEFAULT 0,
    idle_periods TEXT NOT NULL DEFAULT '[]',
    evidence TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE IF NOT EXISTS credentials (
    credential_id TEXT PRIMARY KEY,
    candidate_id TEXT NOT NULL UNIQUE REFERENCES candidates(id),
    issued_date TEXT NOT NULL,
    skills TEXT NOT NULL DEFAULT '[]',
    evidence_summary TEXT NOT NULL DEFAULT ''
  );
`);
const candidateColumns = new Set(db.prepare("PRAGMA table_info(candidates)").all().map((column) => column.name));
const addCandidateColumn = (name, definition) => {
  if (!candidateColumns.has(name)) db.exec(`ALTER TABLE candidates ADD COLUMN ${name} ${definition}`);
};
addCandidateColumn("keystrokes", "INTEGER NOT NULL DEFAULT 0");
addCandidateColumn("live_check", "TEXT DEFAULT NULL");
addCandidateColumn("session_id", "TEXT");
addCandidateColumn("task_variant", "TEXT");
addCandidateColumn("consented_at", "TEXT");
addCandidateColumn("extra_time", "INTEGER NOT NULL DEFAULT 0");
addCandidateColumn("verdict_reason", "TEXT");
addCandidateColumn("flag_details", "TEXT DEFAULT '[]'");
addCandidateColumn("ai_text_note", "TEXT");
addCandidateColumn("scoring_components", "TEXT DEFAULT '{}'");

const requirementChangeDelay = process.env.REQUIREMENT_CHANGE_DELAY_MS === undefined
  ? 180000
  : Number(process.env.REQUIREMENT_CHANGE_DELAY_MS);
if (!Number.isInteger(requirementChangeDelay) || requirementChangeDelay < 1000 || requirementChangeDelay > 3600000) {
  throw new Error("REQUIREMENT_CHANGE_DELAY_MS must be an integer from 1000 to 3600000.");
}

const taskVariants = [
  {
    id: "group-by-region",
    title: "Group records by region",
    description: "Complete groupByRegion(records). Group every record by its region, including records with a missing region.",
    field: "region",
    dataset: [{ region: "north", name: "A" }, { region: "south", name: "B" }, { name: "C" }],
    thresholds: { minEditEvents: 3, maxPasteCharacters: 500 },
  },
  {
    id: "group-by-status",
    title: "Group tickets by status",
    description: "Complete groupByStatus(tickets). Keep every ticket and account for empty values and special object keys.",
    field: "status",
    dataset: [{ status: "open", id: 1 }, { status: "closed", id: 2 }, { status: "__proto__", id: 3 }],
    thresholds: { minEditEvents: 3, maxPasteCharacters: 500 },
  },
  {
    id: "group-by-category",
    title: "Group products by category",
    description: "Complete groupByCategory(products). Group categories and decide how to represent missing category values.",
    field: "category",
    dataset: [{ category: "books", sku: "B1" }, { category: "tools", sku: "T1" }, { sku: "U1" }],
    thresholds: { minEditEvents: 3, maxPasteCharacters: 500 },
  },
];

function variantForCandidate(candidateId) {
  let hash = 0;
  for (const character of candidateId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return taskVariants[hash % taskVariants.length];
}

const demos = [
  {
    id: "maya-chen", name: "Maya Chen", role: "Frontend Engineer", email: "maya.chen@example.com",
    score: 92, verdict: "Verified skill", status: "Verified", duration_seconds: 1482, keystrokes: 1264,
    code: "function groupBy(items, key) {\n  return items.reduce((groups, item) => {\n    const value = item[key];\n    (groups[value] ??= []).push(item);\n    return groups;\n  }, {});\n}",
    events: [
      { type: "edit", time: "00:02", detail: "Read task and mapped the input shape", count: 1 },
      { type: "edit", time: "04:18", detail: "Added reduce accumulator", count: 7 },
      { type: "paste", time: "07:42", detail: "Pasted 3 lines from AI suggestion", count: 3 },
      { type: "edit", time: "08:09", detail: "Renamed accumulator and added null-safe initialization", count: 5 },
      { type: "edit", time: "17:56", detail: "Tested empty input and explained tradeoffs", count: 9 },
    ],
    ai_prompts: [
      { prompt: "What are two ways to group objects by a property in JS? Compare readability and complexity.", verified: true, summary: "Asked for alternatives and tradeoffs, then adapted the idea." },
      { prompt: "Does ??= mutate this accumulator safely?", verified: true, summary: "Checked language behavior against her implementation." },
    ],
    viva: [
      { question: "Why did you choose reduce here instead of a for loop?", answer: "Reduce keeps the transformation in one expression, but a loop may be easier to debug. The accumulator is a plain object. For arbitrary untrusted keys I would use Object.create(null) to avoid prototype names.", score: 96, feedback: "Clear tradeoff reasoning and a strong edge-case observation." },
      { question: "What happens if an item is missing the requested key?", answer: "The undefined bucket collects those items. If that is not desired I'd validate the key first or skip those records.", score: 90, feedback: "Explains current behavior and a reasonable alternative." },
      { question: "How would you adapt this if the input doubled in size?", answer: "It is linear in item count, so doubling items roughly doubles work. Memory is linear too because every item is kept in a group.", score: 89, feedback: "Accurately identifies time and space complexity." },
    ],
    flags: [], credential_id: "sp-8f31c4",
    live_check: { score: 100, passed: 4, total: 4, attempts: 1, duration_seconds: 48, focus_changes: 0, selected_fix: "null-prototype", requirement_change_seen: true },
  },
  {
    id: "leo-martin", name: "Leo Martin", role: "Backend Engineer", email: "leo.martin@example.com",
    score: 61, verdict: "Needs review", status: "Review", duration_seconds: 512, keystrokes: 198,
    code: "function dedupe(items) {\n  return [...new Set(items)];\n}",
    events: [
      { type: "edit", time: "00:01", detail: "Opened task and began implementation", count: 2 },
      { type: "paste", time: "00:38", detail: "Large paste inserted 14 lines", count: 14 },
      { type: "edit", time: "01:11", detail: "Adjusted function name", count: 1 },
      { type: "tab", time: "02:08", detail: "Assessment tab lost focus", count: 1 },
      { type: "edit", time: "07:42", detail: "Submitted final answer", count: 2 },
    ],
    ai_prompts: [
      { prompt: "Write a dedupe function.", verified: false, summary: "Broad code-generation request; no follow-up verification recorded." },
    ],
    viva: [
      { question: "Why did you choose Set for this solution?", answer: "It removes duplicates I think and is simple.", score: 58, feedback: "Basic intent is clear; could explain equality semantics and complexity." },
      { question: "What happens if the input doubles in size?", answer: "It might take longer. Not sure what the complexity is.", score: 52, feedback: "Needs more detail on expected linear-time behavior." },
      { question: "Does this work for objects with the same fields?", answer: "I think Set compares them by values.", score: 46, feedback: "Important misunderstanding: objects are compared by reference." },
    ],
    flags: ["Large paste (14 lines) with limited follow-up edits", "Short completion time relative to task"],
    live_check: { score: 75, passed: 3, total: 4, attempts: 3, duration_seconds: 110, focus_changes: 1, selected_fix: "validate-key", requirement_change_seen: true },
  },
  {
    id: "amara-okafor", name: "Amara Okafor", role: "Product Engineer", email: "amara.okafor@example.com",
    score: 34, verdict: "Low confidence", status: "Low confidence", duration_seconds: 384, keystrokes: 64,
    code: "function flatten(input) {\n  return input.flat(Infinity);\n}",
    events: [
      { type: "edit", time: "00:02", detail: "Started assessment", count: 1 },
      { type: "paste", time: "00:19", detail: "Large paste inserted 22 lines", count: 22 },
      { type: "tab", time: "01:04", detail: "Assessment tab lost focus", count: 1 },
      { type: "edit", time: "06:23", detail: "Small final edit", count: 1 },
    ],
    ai_prompts: [
      { prompt: "Solve this task completely and give me only the code.", verified: false, summary: "Requested a complete solution; no verification or adaptation recorded." },
    ],
    viva: [
      { question: "Why did you choose this approach?", answer: "I don't remember the details.", score: 21, feedback: "Unable to connect the implementation to a reasoned approach." },
      { question: "What happens if the input doubles in size?", answer: "It just goes deeper.", score: 35, feedback: "Could clarify the difference between depth and number of elements." },
      { question: "How would you handle non-array values?", answer: "I am not sure.", score: 25, feedback: "Could not describe validation or expected input behavior." },
    ],
    flags: ["Large paste (22 lines)", "Very few edits after paste", "Short completion time relative to task"],
    live_check: { score: 25, passed: 1, total: 4, attempts: 1, duration_seconds: 35, focus_changes: 4, selected_fix: "plain-object", requirement_change_seen: false },
  },
];

const insertCandidate = db.prepare(`
  INSERT OR IGNORE INTO candidates
  (id,name,role,email,score,verdict,status,created_at,duration_seconds,keystrokes,code,events,ai_prompts,viva,flags,credential_id,live_check)
  VALUES (@id,@name,@role,@email,@score,@verdict,@status,@created_at,@duration_seconds,@keystrokes,@code,@events,@ai_prompts,@viva,@flags,@credential_id,@live_check)
`);
for (const demo of demos) insertCandidate.run({
  credential_id: null, ...demo, created_at: new Date().toISOString(),
  events: JSON.stringify(demo.events), ai_prompts: JSON.stringify(demo.ai_prompts),
  viva: JSON.stringify(demo.viva), flags: JSON.stringify(demo.flags), live_check: JSON.stringify(demo.live_check),
});
const updateSeedKeystrokes = db.prepare("UPDATE candidates SET keystrokes = @keystrokes WHERE id = @id AND keystrokes = 0");
for (const demo of demos) updateSeedKeystrokes.run(demo);
const getSeedLiveCheck = db.prepare("SELECT live_check FROM candidates WHERE id = ?");
const updateSeedLiveCheck = db.prepare("UPDATE candidates SET live_check = ? WHERE id = ?");
for (const demo of demos) {
  const row = getSeedLiveCheck.get(demo.id);
  const existing = row?.live_check ? JSON.parse(row.live_check) : null;
  if (!existing || typeof existing.requirement_change_seen !== "boolean") {
    updateSeedLiveCheck.run(JSON.stringify({
      ...demo.live_check,
      ...existing,
      requirement_change_seen: demo.live_check.requirement_change_seen,
    }), demo.id);
  }
}

const existingCandidates = db.prepare("SELECT * FROM candidates").all();
const insertSession = db.prepare(`INSERT OR IGNORE INTO sessions
  (id,candidate_id,started_at,consented_at,task_variant,extra_time,requirement_change_seen,requirement_change_at)
  VALUES (?,?,?,?,?,?,?,?)`);
const insertProcessEvent = db.prepare(`INSERT OR IGNORE INTO process_events
  (id,session_id,type,timestamp,payload) VALUES (?,?,?,?,?)`);
const insertAiPrompt = db.prepare(`INSERT OR IGNORE INTO ai_prompts
  (id,session_id,prompt,answer,seeded_mistake,caught,edited_after,verified,created_at)
  VALUES (?,?,?,?,?,?,?,?,?)`);
const insertVivaQa = db.prepare(`INSERT OR IGNORE INTO viva_qas
  (id,session_id,question_index,question,answer,score,reason) VALUES (?,?,?,?,?,?,?)`);
const insertLiveCheck = db.prepare(`INSERT OR IGNORE INTO live_checks
  (session_id,tests_passed,tests_total,time_used,tab_switches,blur_events,idle_periods,evidence)
  VALUES (?,?,?,?,?,?,?,?)`);
const insertCredential = db.prepare(`INSERT OR IGNORE INTO credentials
  (credential_id,candidate_id,issued_date,skills,evidence_summary) VALUES (?,?,?,?,?)`);
const migrateLegacyEvidence = db.transaction(() => {
  for (const row of existingCandidates) {
    const taskVariant = row.task_variant || variantForCandidate(row.id).id;
    const sessionId = row.session_id || `session-${row.id}`;
    const createdAt = row.created_at || new Date().toISOString();
    const candidateEvents = JSON.parse(row.events || "[]");
    const candidatePrompts = JSON.parse(row.ai_prompts || "[]");
    const candidateViva = JSON.parse(row.viva || "[]");
    const liveCheck = row.live_check ? JSON.parse(row.live_check) : null;
    const requirementChangeSeen = Boolean(liveCheck?.requirement_change_seen);
    insertSession.run(sessionId, row.id, createdAt, row.consented_at || createdAt, taskVariant,
      row.extra_time ? 1 : 0, requirementChangeSeen ? 1 : 0,
      requirementChangeSeen ? createdAt : null);
    db.prepare(`UPDATE candidates SET session_id=?,task_variant=?,consented_at=COALESCE(consented_at,?)
      WHERE id=?`).run(sessionId, taskVariant, createdAt, row.id);
    candidateEvents.forEach((event, index) => {
      const [minutes = 0, seconds = 0] = String(event.time || "00:00").split(":").map(Number);
      const timestamp = new Date(Date.parse(createdAt) + (minutes * 60 + seconds) * 1000).toISOString();
      const { time: _time, ...payload } = event;
      insertProcessEvent.run(`${sessionId}:event:${index}`, sessionId, event.type || "edit", timestamp, JSON.stringify(payload));
    });
    candidatePrompts.forEach((prompt, index) => insertAiPrompt.run(
      `${sessionId}:ai:${index}`, sessionId, prompt.prompt || "", prompt.response || "",
      prompt.seeded_mistake ? 1 : 0, prompt.caught ? 1 : 0, prompt.edited_after ? 1 : 0,
      prompt.verified ? 1 : 0, createdAt,
    ));
    candidateViva.forEach((item, index) => {
      const legacyScore = Number(item.score);
      const score = Number.isFinite(legacyScore) && legacyScore > 10
        ? Math.round(legacyScore / 10 * 10) / 10
        : Number.isFinite(legacyScore) ? legacyScore : null;
      insertVivaQa.run(`${sessionId}:viva:${index}`, sessionId, index, item.question || "",
        item.answer || "", score, item.feedback || "");
    });
    if (liveCheck) insertLiveCheck.run(sessionId,
      Number(liveCheck.passed) || 0, Number(liveCheck.total) || 0,
      Number(liveCheck.duration_seconds) || 0, Number(liveCheck.focus_changes) || 0,
      Number(liveCheck.blur_events) || 0, JSON.stringify(liveCheck.idle_periods || []),
      JSON.stringify(liveCheck));
    if (row.credential_id && row.verdict === "Verified skill") insertCredential.run(
      row.credential_id, row.id, createdAt, JSON.stringify(["Code reasoning", "Edge-case handling"]),
      "Verified using task work, candidate-consented process evidence, viva reasoning, and a live skill check.",
    );
  }
});
migrateLegacyEvidence();

function detectsCorrection(code) {
  return /\bObject\.create\s*\(\s*null\s*\)|\bObject\.hasOwn\s*\(|\bhasOwnProperty\s*\.\s*call\s*\(|\bnew\s+Map\s*\(/.test(code);
}

function persistPromptRows(sessionId, prompts) {
  const findPrompt = db.prepare("SELECT id FROM ai_prompts WHERE session_id = ? AND prompt = ?");
  const updatePrompt = db.prepare(`UPDATE ai_prompts SET answer=?,seeded_mistake=?,caught=?,edited_after=?,verified=?
    WHERE id=?`);
  return prompts.map((prompt) => {
    const existing = findPrompt.get(sessionId, prompt.prompt);
    if (existing) {
      updatePrompt.run(prompt.response || "", prompt.seeded_mistake ? 1 : 0,
        prompt.caught ? 1 : 0, prompt.edited_after ? 1 : 0, prompt.verified ? 1 : 0, existing.id);
      return { ...prompt, id: existing.id };
    } else {
      const id = randomUUID();
      insertAiPrompt.run(id, sessionId, prompt.prompt, prompt.response || "",
        prompt.seeded_mistake ? 1 : 0, prompt.caught ? 1 : 0,
        prompt.edited_after ? 1 : 0, prompt.verified ? 1 : 0, new Date().toISOString());
      return { ...prompt, id };
    }
  });
}

function resolvePromptEvidence(sessionId, prompts, code) {
  const findById = db.prepare("SELECT * FROM ai_prompts WHERE id = ? AND session_id = ?");
  const findByText = db.prepare("SELECT * FROM ai_prompts WHERE session_id = ? AND prompt = ?");
  const result = prompts.map((prompt) => {
    const stored = prompt.id
      ? findById.get(prompt.id, sessionId)
      : findByText.get(sessionId, prompt.prompt);
    const seededMistake = Boolean(stored?.seeded_mistake);
    const corrected = seededMistake && detectsCorrection(code);
    return {
      ...prompt,
      id: stored?.id || prompt.id,
      response: stored?.answer || prompt.response || "",
      verified: stored ? Boolean(stored.verified) : Boolean(prompt.verified),
      seeded_mistake: seededMistake,
      caught: Boolean(stored?.caught || corrected),
      edited_after: Boolean(stored?.edited_after || corrected),
      summary: stored?.seeded_mistake
        ? "Demo assistant suggestion contains a seeded object-key mistake; review whether the candidate verified or corrected it."
        : prompt.summary || "Assistant response available as context for the reviewer.",
    };
  });
  const included = new Set(result.map((prompt) => prompt.id).filter(Boolean));
  const storedRows = db.prepare("SELECT * FROM ai_prompts WHERE session_id = ?").all(sessionId);
  for (const stored of storedRows) {
    if (included.has(stored.id)) continue;
    const corrected = Boolean(stored.seeded_mistake && detectsCorrection(code));
    result.push({
      id: stored.id,
      prompt: stored.prompt,
      response: stored.answer,
      verified: Boolean(stored.verified),
      seeded_mistake: Boolean(stored.seeded_mistake),
      caught: Boolean(stored.caught || corrected),
      edited_after: Boolean(stored.edited_after || corrected),
      summary: stored.seeded_mistake
        ? "Demo assistant suggestion contains a seeded object-key mistake; review whether the candidate verified or corrected it."
        : "Assistant response available as context for the reviewer.",
    });
  }
  return result;
}

function persistEventRows(sessionId, events) {
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId);
  if (!session) throw new Error("Assessment session not found while saving process events.");
  for (const [index, event] of events.entries()) {
    let timestamp = event.timestamp;
    if (typeof timestamp !== "string" || !Number.isFinite(Date.parse(timestamp))) {
      const [minutes = 0, seconds = 0] = String(event.time || "00:00").split(":").map(Number);
      timestamp = new Date(Date.parse(session.started_at) + (minutes * 60 + seconds) * 1000).toISOString();
    }
    const id = typeof event.id === "string" && event.id.length <= 100
      ? event.id
      : `${sessionId}:submitted:${index}:${randomUUID()}`;
    const payload = event.payload && typeof event.payload === "object"
      ? event.payload
      : { detail: event.detail || event.type, count: event.count || 1, characters: event.characters || 0 };
    insertProcessEvent.run(id, sessionId, event.type, timestamp, JSON.stringify(payload));
  }
}

const retentionDays = process.env.DATA_RETENTION_DAYS === undefined ? 0 : Number(process.env.DATA_RETENTION_DAYS);
if (!Number.isFinite(retentionDays) || retentionDays < 0 || retentionDays > 36500) {
  throw new Error("DATA_RETENTION_DAYS must be a number from 0 to 36500.");
}
if (retentionDays > 0) {
  const purgeExpiredCandidates = () => {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const statement = db.prepare(`DELETE FROM candidates
      WHERE id NOT IN (${demos.map(() => "?").join(",")}) AND created_at < ?`);
    const result = statement.run(...demos.map((demo) => demo.id), cutoff);
    if (result.changes) console.log(`Removed ${result.changes} expired candidate record(s).`);
  };
  purgeExpiredCandidates();
  setInterval(purgeExpiredCandidates, 24 * 60 * 60 * 1000).unref();
}

const app = express();
app.use(express.json({ limit: "1mb" }));
const parseCandidate = (row) => {
  if (!row) return row;
  const parsed = {
    ...row, events: JSON.parse(row.events), ai_prompts: JSON.parse(row.ai_prompts),
    viva: JSON.parse(row.viva), flags: JSON.parse(row.flags),
    flag_details: JSON.parse(row.flag_details || "[]"),
    live_check: row.live_check ? JSON.parse(row.live_check) : null,
  };
  const computed = scoreCandidate({
    viva: parsed.viva,
    events: parsed.events,
    aiPrompts: parsed.ai_prompts,
    liveCheck: parsed.live_check,
    durationSeconds: row.duration_seconds,
    vivaText: parsed.viva.map((item) => item.answer || "").join(" "),
  }).components;
  return {
    ...parsed,
    scoring_components: row.scoring_components && row.scoring_components !== "{}"
      ? JSON.parse(row.scoring_components)
      : computed,
  };
};

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.get("/api/scoring-config", (_req, res) => res.json(scoringConfig));
app.get("/api/candidates", (_req, res) => {
  const rows = db.prepare("SELECT * FROM candidates ORDER BY created_at DESC").all();
  res.json(rows.map(parseCandidate));
});
app.get("/api/candidates/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM candidates WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Candidate not found" });
  res.json(parseCandidate(row));
});
app.get("/api/verify/:credentialId", (req, res) => {
  const credentialId = String(req.params.credentialId || "").trim();
  if (!credentialId) return res.status(400).json({ error: "A credential ID is required." });
  const row = db.prepare("SELECT * FROM candidates WHERE credential_id = ?").get(credentialId);
  if (!row) return res.status(404).json({ error: "Credential not found." });
  res.json(parseCandidate(row));
});
app.get("/api/credentials/:credentialId", (req, res) => {
  const row = db.prepare(`SELECT c.*, cr.issued_date, cr.skills, cr.evidence_summary
    FROM credentials cr JOIN candidates c ON c.id = cr.candidate_id
    WHERE cr.credential_id = ?`).get(String(req.params.credentialId || "").trim());
  if (!row) return res.status(404).json({ error: "Credential not found." });
  res.json({
    candidate: parseCandidate(row),
    credential: {
      credential_id: row.credential_id,
      issued_date: row.issued_date,
      skills: JSON.parse(row.skills),
      evidence_summary: row.evidence_summary,
    },
  });
});

app.post("/api/consent", (req, res) => {
  const { name, email = "", consent, extra_time = false } = req.body ?? {};
  if (typeof name !== "string" || !name.trim() || name.trim().length > 120 ||
      typeof email !== "string" || email.length > 254 ||
      (email !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) || consent !== true ||
      typeof extra_time !== "boolean") {
    return res.status(400).json({ error: "A valid name and explicit consent are required to start a session." });
  }
  const candidateId = randomUUID();
  const sessionId = randomUUID();
  const now = new Date().toISOString();
  const taskVariant = variantForCandidate(candidateId);
  const code = `function groupBy${taskVariant.field[0].toUpperCase()}${taskVariant.field.slice(1)}(items) {\n  return items.reduce((groups, item) => {\n    const value = item.${taskVariant.field};\n    (groups[value] ??= []).push(item);\n    return groups;\n  }, {});\n}`;
  const createSession = db.transaction(() => {
    db.prepare(`INSERT INTO candidates
      (id,name,role,email,score,verdict,status,created_at,duration_seconds,keystrokes,code,events,ai_prompts,viva,flags,credential_id,session_id,task_variant,consented_at,extra_time)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      candidateId, name.trim(), "Software Engineer", email.trim(), 0, "Needs review", "In progress",
      now, 0, 0, code, "[]", "[]", "[]", "[]", null, sessionId, taskVariant.id, now, extra_time ? 1 : 0,
    );
    db.prepare(`INSERT INTO sessions
      (id,candidate_id,started_at,consented_at,task_variant,extra_time)
      VALUES (?,?,?,?,?,?)`).run(sessionId, candidateId, now, now, taskVariant.id, extra_time ? 1 : 0);
  });
  createSession();
  res.status(201).json({
    candidate_id: candidateId,
    session_id: sessionId,
    consented_at: now,
    task_variant: taskVariant,
    requirement_change_delay_ms: requirementChangeDelay,
  });
});

app.get("/api/sessions/:sessionId/task", (req, res) => {
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: "Assessment session not found." });
  const taskVariant = taskVariants.find((variant) => variant.id === session.task_variant);
  if (!taskVariant) return res.status(500).json({ error: "The session task variant is unavailable." });
  res.json({ task_variant: taskVariant });
});

app.get("/api/sessions/:sessionId/requirement-change", (req, res) => {
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: "Assessment session not found." });
  const dueAt = Date.parse(session.started_at) + requirementChangeDelay;
  const fired = Boolean(session.requirement_change_at) || Date.now() >= dueAt;
  if (fired && !session.requirement_change_at) {
    const now = new Date().toISOString();
    const markRequirement = db.transaction(() => {
      db.prepare("UPDATE sessions SET requirement_change_at = ? WHERE id = ? AND requirement_change_at IS NULL").run(now, session.id);
      insertProcessEvent.run(randomUUID(), session.id, "requirement_change", now, JSON.stringify({
        detail: "A new task requirement was introduced.",
        requirement: "Also handle records with missing values for the selected field.",
      }));
    });
    markRequirement();
  }
  res.json({
    fired,
    acknowledged: Boolean(session.requirement_change_seen),
    scheduled_at: new Date(dueAt).toISOString(),
    delay_ms: requirementChangeDelay,
    message: fired ? "Also handle records with missing values for the selected field." : null,
  });
});

app.post("/api/sessions/:sessionId/requirement-change", (req, res) => {
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: "Assessment session not found." });
  if (!session.requirement_change_at) return res.status(409).json({ error: "The requirement update has not fired yet." });
  db.prepare("UPDATE sessions SET requirement_change_seen = 1 WHERE id = ?").run(session.id);
  res.json({ acknowledged: true });
});

app.post("/api/sessions/:sessionId/events", (req, res) => {
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: "Assessment session not found." });
  const { events } = req.body ?? {};
  const allowedTypes = new Set(["edit", "paste", "tab", "blur", "idle", "run", "requirement_change"]);
  if (!Array.isArray(events) || events.length < 1 || events.length > 100 ||
      events.some((event) => !event || typeof event !== "object" || !allowedTypes.has(event.type) ||
        typeof event.timestamp !== "string" || !Number.isFinite(Date.parse(event.timestamp)) ||
        event.id !== undefined && (typeof event.id !== "string" || event.id.length < 1 || event.id.length > 100) ||
        event.payload !== undefined && (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload) ||
          JSON.stringify(event.payload).length > 5000))) {
    return res.status(400).json({ error: "Event batch is invalid; send 1–100 timestamped events." });
  }
  const candidate = db.prepare("SELECT * FROM candidates WHERE id = ?").get(session.candidate_id);
  const persistedEvents = db.transaction(() => {
    for (const event of events) {
      const payload = JSON.stringify(event.payload || {});
      const eventId = event.id || randomUUID();
      const inserted = insertProcessEvent.run(eventId, session.id, event.type, event.timestamp, payload);
      if (!inserted.changes) continue;
      const elapsedSeconds = Math.max(0, Math.floor((Date.parse(event.timestamp) - Date.parse(session.started_at)) / 1000));
      const legacyEvent = {
        type: event.type,
        time: `${String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")}:${String(elapsedSeconds % 60).padStart(2, "0")}`,
        detail: String(event.payload?.detail || event.type.replaceAll("_", " ")),
        count: Math.max(1, Number(event.payload?.count) || 1),
        characters: Math.max(0, Number(event.payload?.characters) || 0),
      };
      const storedEvents = JSON.parse(candidate.events || "[]");
      storedEvents.push(legacyEvent);
      db.prepare("UPDATE candidates SET events = ? WHERE id = ?").run(JSON.stringify(storedEvents), candidate.id);
    }
  });
  persistedEvents();
  res.status(202).json({ accepted: events.length });
});

app.post("/api/assessment", (req, res) => {
  const { name, email = "", code, events = [], ai_prompts = [], duration_seconds = 0, keystrokes = 0, consent, session_id } = req.body ?? {};
  if (consent !== true || typeof name !== "string" || !name.trim() || name.trim().length > 120 ||
      typeof email !== "string" || email.length > 254 || typeof code !== "string" || code.length > 100000) {
    return res.status(400).json({ error: "Explicit consent, a valid name, and code are required." });
  }
  const allowedTypes = new Set(["edit", "paste", "tab", "blur", "idle", "run", "requirement_change"]);
  const validEvents = Array.isArray(events) && events.length <= 5000 && events.every((event) =>
    event && typeof event === "object" && allowedTypes.has(event.type) &&
    (event.timestamp === undefined || typeof event.timestamp === "string" && Number.isFinite(Date.parse(event.timestamp))) &&
    (event.payload === undefined || event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)));
  const validPrompts = Array.isArray(ai_prompts) && ai_prompts.length <= 100 && ai_prompts.every((item) =>
    item && typeof item === "object" && typeof item.prompt === "string" && item.prompt.trim().length <= 2000 &&
    (item.response === undefined || typeof item.response === "string" && item.response.length <= 10000) &&
    (item.verified === undefined || typeof item.verified === "boolean"));
  if (!validEvents || !validPrompts ||
      !Number.isFinite(Number(duration_seconds)) || Number(duration_seconds) < 0 || Number(duration_seconds) > 86400 ||
      !Number.isFinite(Number(keystrokes)) || Number(keystrokes) < 0 || Number(keystrokes) > 1000000) {
    return res.status(400).json({ error: "Assessment activity data is invalid." });
  }
  if (session_id !== undefined) {
    const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(session_id);
    if (!session || session.candidate_id !== db.prepare("SELECT id FROM candidates WHERE session_id = ?").get(session_id)?.id) {
      return res.status(404).json({ error: "Consented assessment session not found." });
    }
    const candidate = db.prepare("SELECT * FROM candidates WHERE id = ?").get(session.candidate_id);
    if (candidate.name !== name.trim()) return res.status(409).json({ error: "Candidate details do not match this session." });
    const prompts = resolvePromptEvidence(session.id, ai_prompts, code);
    const persistedPrompts = persistPromptRows(session.id, prompts);
    persistEventRows(session.id, events);
    db.prepare(`UPDATE candidates SET email=?,code=?,duration_seconds=?,keystrokes=?,ai_prompts=?,status='Viva in progress'
      ,events=? WHERE id=?`).run(email.trim(), code, Number(duration_seconds), Number(keystrokes),
      JSON.stringify(persistedPrompts), JSON.stringify(events), candidate.id);
    const updated = db.prepare("SELECT * FROM candidates WHERE id = ?").get(candidate.id);
    return res.status(200).json({ id: updated.id, candidate: parseCandidate(updated) });
  }

  const id = randomUUID();
  const sessionId = randomUUID();
  const now = new Date().toISOString();
  const taskVariant = variantForCandidate(id);
  const prompts = ai_prompts.map((prompt) => ({
    ...prompt,
    seeded_mistake: false,
    caught: false,
    edited_after: false,
  }));
  const insertAssessment = db.transaction(() => {
    db.prepare(`INSERT INTO candidates
      (id,name,role,email,score,verdict,status,created_at,duration_seconds,keystrokes,code,events,ai_prompts,viva,flags,credential_id,session_id,task_variant,consented_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, name.trim(), "Software Engineer", email.trim(), 0, "Needs review", "In progress", now,
      Number(duration_seconds), Number(keystrokes), code, JSON.stringify(events), JSON.stringify(prompts),
      "[]", "[]", null, sessionId, taskVariant.id, now,
    );
    db.prepare(`INSERT INTO sessions (id,candidate_id,started_at,consented_at,task_variant)
      VALUES (?,?,?,?,?)`).run(sessionId, id, now, now, taskVariant.id);
    const persistedPrompts = persistPromptRows(sessionId, prompts);
    persistEventRows(sessionId, events);
    db.prepare("UPDATE candidates SET ai_prompts=?,events=? WHERE id=?").run(JSON.stringify(persistedPrompts), JSON.stringify(events), id);
  });
  insertAssessment();
  res.status(201).json({ id, session_id: sessionId, candidate: parseCandidate(db.prepare("SELECT * FROM candidates WHERE id = ?").get(id)) });
});

function baseQuestions(taskVariant, requirementChangeSeen) {
  const field = taskVariant?.field || "selected property";
  return [
    `Walk through your approach to grouping records by ${field}. Which decision mattered most?`,
    "What happens to time and memory use if the input doubles in size?",
    `What would break if a record has no ${field}, or uses a special object key?`,
    requirementChangeSeen
      ? "How did the new missing-value requirement change what you tested or implemented?"
      : "What would you test next if the task added a new input requirement?",
    "Which edge case would you test first, and why?",
  ];
}
function demoAnswerScore(question, answer) {
  const text = answer.toLowerCase();
  const hasReasoning = /\b(because|therefore|trade-?off|alternative|so that|in order to)\b/.test(text);
  const hasComplexity = /\b(linear|quadratic|o\(|complexity|memory|space|time)\b/.test(text);
  const hasEdgeCase = /\b(empty|null|undefined|missing|duplicate|boundary|invalid|edge case)\b/.test(text);
  const hasSpecificity = /\b(array|object|property|reduce|loop|set|accumulator|group|return|reference)\b/.test(text);
  const asksWhy = /\b(why|approach|choose|chosen)\b/.test(question.toLowerCase());
  const asksSize = /\b(doubled|size|complexity|scale)\b/.test(question.toLowerCase());
  const asksEdge = /\b(edge|empty|missing|non-array|handle|test)\b/.test(question.toLowerCase());
  let score = 25 + (hasReasoning ? 15 : 0) + (hasComplexity ? 20 : 0) +
    (hasEdgeCase ? 20 : 0) + (hasSpecificity ? 15 : 0) +
    (asksWhy && hasReasoning ? 10 : 0) + (asksSize && hasComplexity ? 10 : 0) +
    (asksEdge && hasEdgeCase ? 10 : 0);
  score = Math.min(95, score);
  const feedback = hasComplexity && hasEdgeCase
    ? "The answer connects implementation behavior with complexity and edge cases."
    : hasSpecificity
      ? "The answer refers to relevant implementation details; consider explaining tradeoffs or edge cases further."
      : "The answer would benefit from a clearer connection to the code and a concrete example.";
  return { score, feedback };
}
async function askModel(messages, fallback) {
  const key = process.env.LLM_API_KEY;
  if (!key) return fallback;
  const base = (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: process.env.LLM_MODEL || "gpt-4o-mini", messages, temperature: 0.2 }),
  });
  if (!response.ok) throw new Error(`LLM request failed (${response.status})`);
  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("LLM response did not contain a message.");
  return content;
}

app.post("/api/candidates/:id/questions", async (req, res) => {
  const row = db.prepare("SELECT * FROM candidates WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Candidate not found" });
  const session = db.prepare("SELECT * FROM sessions WHERE candidate_id = ?").get(row.id);
  const taskVariant = taskVariants.find((variant) => variant.id === session?.task_variant);
  const questionsFallback = baseQuestions(taskVariant, Boolean(session?.requirement_change_seen));
  try {
    const raw = await askModel([
      { role: "system", content: "Create exactly 5 concise, friendly oral-defense questions about the candidate's actual code. Return only a JSON array of strings. Cover approach, complexity if input doubles, a relevant edge case, response to the requirement change, and what to test next. Do not infer misconduct." },
      { role: "user", content: `Task: ${req.body?.task || taskVariant?.description || "Implement the given coding task."}\nCode:\n${row.code}` },
    ], JSON.stringify(questionsFallback));
    let questions;
    try { questions = JSON.parse(raw); } catch {
      if (process.env.LLM_API_KEY) return res.status(502).json({ error: "The AI returned invalid viva questions. Please try again." });
      questions = questionsFallback;
    }
    if (!Array.isArray(questions) || questions.length !== 5 || questions.some((question) => typeof question !== "string" || !question.trim())) {
      if (process.env.LLM_API_KEY) return res.status(502).json({ error: "The AI returned an invalid viva question format. Please try again." });
      questions = questionsFallback;
    }
    const viva = questions.slice(0, 5).map((question) => ({ question: String(question), answer: "", score: null, feedback: "" }));
    db.prepare("UPDATE candidates SET viva = ?, status = 'Viva in progress' WHERE id = ?").run(JSON.stringify(viva), row.id);
    if (session) {
      db.prepare("DELETE FROM viva_qas WHERE session_id = ?").run(session.id);
      viva.forEach((item, index) => insertVivaQa.run(randomUUID(), session.id, index, item.question, "", null, ""));
    }
    res.json({ questions: viva });
  } catch (error) {
    res.status(502).json({ error: error.message || "Could not create viva questions." });
  }
});

app.post("/api/candidates/:id/answer", async (req, res) => {
  const row = db.prepare("SELECT * FROM candidates WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Candidate not found" });
  const { index, answer } = req.body ?? {};
  const viva = JSON.parse(row.viva);
  if (!Number.isInteger(index) || !viva[index] || typeof answer !== "string" || !answer.trim() || answer.length > 10000) {
    return res.status(400).json({ error: "A valid question and answer are required." });
  }
  try {
    const rubric = `Score the answer from 0 to 10 for demonstrated understanding, not writing style. Return JSON only: {"score": number, "feedback": "one sentence"}.`;
    const fallbackScore = demoAnswerScore(viva[index].question, answer.trim());
    let result;
    const raw = await askModel([
      { role: "system", content: rubric },
      { role: "user", content: `Code:\n${row.code}\nQuestion: ${viva[index].question}\nAnswer: ${answer}` },
    ], JSON.stringify({ score: Math.round(fallbackScore.score / 10 * 10) / 10, feedback: fallbackScore.feedback }));
    try { result = JSON.parse(raw); } catch {
      if (process.env.LLM_API_KEY) return res.status(502).json({ error: "The AI returned an invalid score format. Please try again." });
      result = { score: Math.round(fallbackScore.score / 10 * 10) / 10, feedback: fallbackScore.feedback };
    }
    if (typeof result.score !== "number" || !Number.isFinite(result.score) ||
        typeof result.feedback !== "string" || result.feedback.length > 500) {
      if (process.env.LLM_API_KEY) return res.status(502).json({ error: "The AI returned an invalid score format. Please try again." });
      result = { score: Math.round(fallbackScore.score / 10 * 10) / 10, feedback: fallbackScore.feedback };
    }
    const scoreOutOfTen = Math.round(Math.max(0, Math.min(10, result.score)) * 10) / 10;
    const session = db.prepare("SELECT * FROM sessions WHERE candidate_id = ?").get(row.id);
    viva[index] = { ...viva[index], answer: answer.trim(), score: Math.round(scoreOutOfTen * 10), feedback: result.feedback };
    db.prepare("UPDATE candidates SET viva = ? WHERE id = ?").run(JSON.stringify(viva), row.id);
    if (session) db.prepare(`INSERT INTO viva_qas (id,session_id,question_index,question,answer,score,reason)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(session_id,question_index) DO UPDATE SET
      answer=excluded.answer,score=excluded.score,reason=excluded.reason`).run(
      randomUUID(), session.id, index, viva[index].question, viva[index].answer, scoreOutOfTen, viva[index].feedback,
    );
    res.json({ answer: viva[index], score_10: scoreOutOfTen, reason: viva[index].feedback });
  } catch (error) {
    res.status(502).json({ error: error.message || "Could not score this answer." });
  }
});

app.post(["/api/candidates/:id/live-check", "/api/sessions/:id/live-check"], (req, res) => {
  const sessionRoute = req.path.includes("/sessions/");
  const session = sessionRoute ? db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id) : null;
  if (sessionRoute && !session) return res.status(404).json({ error: "Assessment session not found." });
  const candidateId = session?.candidate_id || req.params.id;
  const row = db.prepare("SELECT * FROM candidates WHERE id = ?").get(candidateId);
  if (!row) return res.status(404).json({ error: "Candidate not found" });
  const viva = JSON.parse(row.viva);
  if (viva.length === 0 || viva.some((answer) => answer.score === null)) {
    return res.status(400).json({ error: "Please finish the viva before starting the live check." });
  }
  const { passed, total, attempts, duration_seconds, focus_changes, selected_fix, requirement_change_seen,
    blur_events = 0, idle_periods = [] } = req.body ?? {};
  const validInteger = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
  if (!validInteger(passed, 0, 4) || total !== 4 || !validInteger(attempts, 1, 100) ||
      !validInteger(duration_seconds, 0, 3600) || !validInteger(focus_changes, 0, 100) ||
      !validInteger(blur_events, 0, 100) || !Array.isArray(idle_periods) || idle_periods.length > 100 ||
      idle_periods.some((seconds) => !validInteger(seconds, 1, 86400)) ||
      typeof requirement_change_seen !== "boolean" ||
      !["null-prototype", "validate-key", "plain-object"].includes(selected_fix)) {
    return res.status(400).json({ error: "Live check results are invalid." });
  }
  const liveCheck = {
    score: Math.round(passed / total * 100),
    passed,
    total,
    attempts,
    duration_seconds,
    focus_changes,
    blur_events,
    idle_periods,
    selected_fix,
    requirement_change_seen,
  };
  db.prepare("UPDATE candidates SET live_check = ?, status = 'Live check complete' WHERE id = ?")
    .run(JSON.stringify(liveCheck), row.id);
  const candidateSession = session || db.prepare("SELECT * FROM sessions WHERE candidate_id = ?").get(row.id);
  if (candidateSession) {
    db.prepare(`INSERT INTO live_checks
      (session_id,tests_passed,tests_total,time_used,tab_switches,blur_events,idle_periods,evidence)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET
      tests_passed=excluded.tests_passed,tests_total=excluded.tests_total,time_used=excluded.time_used,
      tab_switches=excluded.tab_switches,blur_events=excluded.blur_events,
      idle_periods=excluded.idle_periods,evidence=excluded.evidence`).run(
      candidateSession.id, passed, total, duration_seconds, focus_changes, blur_events,
      JSON.stringify(idle_periods), JSON.stringify(liveCheck),
    );
  }
  res.json({ live_check: liveCheck });
});

app.post("/api/candidates/:id/complete", (req, res) => {
  const row = db.prepare("SELECT * FROM candidates WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Candidate not found" });
  if (["Verified", "Review", "Low confidence"].includes(row.status)) return res.json(parseCandidate(row));
  const viva = JSON.parse(row.viva);
  if (viva.length === 0 || viva.some((item) => item.score === null)) return res.status(400).json({ error: "Please answer every viva question first." });
  const liveCheck = row.live_check ? JSON.parse(row.live_check) : null;
  if (!liveCheck) return res.status(400).json({ error: "Please complete the live skill check first." });
  const events = JSON.parse(row.events);
  const ai = JSON.parse(row.ai_prompts);
  const result = scoreCandidate({
    viva,
    events,
    aiPrompts: ai,
    liveCheck,
    durationSeconds: row.duration_seconds,
    vivaText: viva.map((item) => item.answer || "").join(" "),
  });
  const credential = result.verdict === "Verified skill" ? `sp-${randomUUID().slice(0, 12)}` : null;
  const flagDetails = result.flags;
  const flags = flagDetails.map((flag) => `${flag.key}: ${flag.evidence}`);
  const status = result.verdict === "Verified skill" ? "Verified" : result.verdict === "Needs review" ? "Review" : "Low confidence";
  db.prepare(`UPDATE candidates SET score=?,verdict=?,status=?,viva=?,flags=?,flag_details=?,
    credential_id=?,verdict_reason=?,ai_text_note=?,scoring_components=? WHERE id=?`)
    .run(result.score, result.verdict, status, JSON.stringify(viva), JSON.stringify(flags),
      JSON.stringify(flagDetails), credential, result.verdictReason, result.aiTextNote,
      JSON.stringify(result.components), row.id);
  const session = db.prepare("SELECT * FROM sessions WHERE candidate_id = ?").get(row.id);
  if (session) {
    db.prepare("UPDATE sessions SET completed_at = ? WHERE id = ?").run(new Date().toISOString(), session.id);
    if (credential) db.prepare(`INSERT INTO credentials
      (credential_id,candidate_id,issued_date,skills,evidence_summary) VALUES (?,?,?,?,?)`).run(
      credential, row.id, new Date().toISOString(), JSON.stringify(["Code reasoning", "Edge-case handling"]),
      result.verdictReason,
    );
  }
  res.json(parseCandidate(db.prepare("SELECT * FROM candidates WHERE id = ?").get(row.id)));
});

app.post("/api/assistant", async (req, res) => {
  const { prompt, code } = req.body ?? {};
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 2000 ||
      typeof code !== "string" || code.length > 100000) {
    return res.status(400).json({ error: "Enter a valid prompt and code sample." });
  }
  try {
    const answer = await askModel([
      { role: "system", content: "You are a learning assistant. Explain concepts and give hints, not a complete submission. Be concise." },
      { role: "user", content: `Candidate code:\n${code || "(empty)"}\n\nQuestion: ${prompt}` },
    ], "Try breaking the task into smaller cases. What should happen for empty input, repeated values, and boundary values? Explain your reasoning before changing the code.");
    res.json({ answer });
  } catch (error) {
    res.status(502).json({ error: error.message || "Assistant unavailable." });
  }
});

app.post("/api/sessions/:sessionId/assistant", async (req, res) => {
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: "Assessment session not found." });
  const { prompt } = req.body ?? {};
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 2000) {
    return res.status(400).json({ error: "Enter a prompt of 1–2000 characters." });
  }
  const candidate = db.prepare("SELECT * FROM candidates WHERE id = ?").get(session.candidate_id);
  const taskVariant = taskVariants.find((variant) => variant.id === session.task_variant);
  const seed = [...`${session.id}:${prompt}`].reduce((sum, character) => (sum * 31 + character.charCodeAt(0)) >>> 0, 7);
  const seededMistake = !process.env.LLM_API_KEY && seed % 2 === 0;
  const mockAnswer = seededMistake
    ? `A concise pattern is to initialize with a regular object, then use (groups[value] ??= []).push(item). That handles every string key consistently; try a special key such as __proto__ to check it.`
    : `Start by grouping one record at a time using the task's ${taskVariant.field} field. Think through what a missing value should mean, then test an empty input and a special object key before deciding whether your accumulator is safe.`;
  try {
    const answer = await askModel([
      { role: "system", content: "You are a concise learning assistant. Give hints and explanations, not a full solution. Avoid judging the candidate." },
      { role: "user", content: `Task: ${taskVariant.description}\nCandidate code:\n${candidate.code}\n\nQuestion: ${prompt}` },
    ], mockAnswer);
    const item = {
      prompt: prompt.trim(),
      response: answer,
      verified: false,
      seeded_mistake: seededMistake,
      caught: false,
      edited_after: false,
      summary: seededMistake
        ? "Demo assistant suggestion contains a seeded object-key mistake; review whether the candidate verified or corrected it."
        : "Assistant provided a task-specific hint for the candidate to evaluate.",
    };
    const prompts = JSON.parse(candidate.ai_prompts || "[]");
    const [persistedPrompt] = persistPromptRows(session.id, [item]);
    prompts.push(persistedPrompt);
    db.prepare("UPDATE candidates SET ai_prompts=? WHERE id=?").run(JSON.stringify(prompts), candidate.id);
    res.json({ answer, seeded_mistake: seededMistake, prompt: persistedPrompt });
  } catch (error) {
    res.status(502).json({ error: error.message || "Assistant unavailable." });
  }
});

app.patch("/api/sessions/:sessionId/ai-prompts/:promptId", (req, res) => {
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: "Assessment session not found." });
  const { verified } = req.body ?? {};
  if (typeof verified !== "boolean") return res.status(400).json({ error: "verified must be true or false." });
  const update = db.prepare("UPDATE ai_prompts SET verified = ? WHERE id = ? AND session_id = ?")
    .run(verified ? 1 : 0, req.params.promptId, session.id);
  if (!update.changes) return res.status(404).json({ error: "Assistant prompt not found." });
  const candidate = db.prepare("SELECT * FROM candidates WHERE id = ?").get(session.candidate_id);
  const prompts = JSON.parse(candidate.ai_prompts || "[]");
  const prompt = db.prepare("SELECT prompt FROM ai_prompts WHERE id = ?").get(req.params.promptId);
  const item = prompts.find((entry) => entry.prompt === prompt.prompt);
  if (item) item.verified = verified;
  db.prepare("UPDATE candidates SET ai_prompts=? WHERE id=?").run(JSON.stringify(prompts), candidate.id);
  res.json({ verified });
});

app.use((error, _req, res, _next) => {
  if (error?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Request body must contain valid JSON." });
  }
  console.error("API request failed:", error);
  res.status(500).json({ error: "The server could not complete this request." });
});

const port = Number(process.env.PORT || 3001);
app.listen(port, () => console.log(`SkillProof API listening on http://localhost:${port}`));
