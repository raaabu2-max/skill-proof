import test from "node:test";
import assert from "node:assert/strict";
import { adaptScenarioQuestions, skillMcqFallback, validateMcqQuestions } from "./mcq-content.js";

test("Adapt MCQs cover all four workplace challenges with four options and explanations", () => {
  assert.equal(adaptScenarioQuestions.length, 8);
  assert.deepEqual(
    [...new Set(adaptScenarioQuestions.map(({ scenario }) => scenario.split(" — ")[0]))],
    ["AI and Job Anxiety", "Human–AI Collaboration", "Inclusive Workplaces", "Workforce Planning for Employers"],
  );
  assert.equal(validateMcqQuestions(adaptScenarioQuestions, 8), true);
});

test("Skill fallback questions use the selected task and always have one valid answer key", () => {
  const questions = skillMcqFallback({ id: "group-by-status", title: "Group tickets by status", field: "status" }, "javascript");
  assert.equal(questions.length, 5);
  assert.ok(questions.some(({ question }) => question.includes("__proto__")));
  assert.equal(validateMcqQuestions(questions, 5), true);
  for (const question of questions) {
    assert.equal(question.options.length, 4);
    assert.equal(question.options.filter(({ id }) => id === question.correctOption).length, 1);
    assert.ok(question.explanation.trim());
  }
});

test("Skill fallback questions are relevant to practical domains", () => {
  const questions = skillMcqFallback({ title: "Launch a local campaign" }, "marketing");
  assert.ok(questions.some(({ question }) => question.toLowerCase().includes("campaign")));
  assert.equal(validateMcqQuestions(questions, 5), true);
});

test("Skill fallback content exists for every configured domain", () => {
  const task = { id: "group-by-category", title: "Configured task", field: "category" };
  for (const domain of ["javascript", "python", "sql", "marketing", "accounting"]) {
    assert.equal(validateMcqQuestions(skillMcqFallback(task, domain), 5), true, domain);
  }
});
