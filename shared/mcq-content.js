const options = (items) => items.map((text, index) => ({ id: String.fromCharCode(65 + index), text }));

export function skillMcqFallback(taskVariant, domain) {
  const field = taskVariant?.field || "selected field";
  const taskName = taskVariant?.title || taskVariant?.taskTitle || "the selected task";

  if (domain === "python") return [
    {
      question: `For ${taskName}, what is the safest first step when normalizing contact rows?`,
      options: options(["Validate and normalize each field while retaining rows that meet the task rules.", "Delete every row with any blank value before inspecting it.", "Convert every value to a string and assume it is valid.", "Keep only the first row because duplicates may exist."]),
      correctOption: "A",
      explanation: "A careful cleanup applies explicit validation and normalization rules without discarding potentially valid records by default.",
    },
    {
      question: "How should repeated contacts be handled in a reliable cleanup?",
      options: options(["Remove all repeated names, even when their email addresses differ.", "Use a documented identity rule, such as a normalized email, and preserve an audit of removed duplicates.", "Keep whichever row appears first without checking its fields.", "Merge every row with a similar-looking name automatically."]),
      correctOption: "B",
      explanation: "Deduplication needs a clear identity rule and traceability so distinct people are not accidentally merged.",
    },
    {
      question: "Which check best verifies that valid records survive the cleanup?",
      options: options(["Confirm the function returned a list.", "Compare a few expected normalized rows, plus missing and repeated-value cases.", "Check only that the output has fewer rows than the input.", "Confirm that no output value is an empty string."]),
      correctOption: "B",
      explanation: "Representative expected-output checks cover both normal transformations and the edge cases named in the task.",
    },
    {
      question: "If the extract grows from n rows to 2n rows, what should a straightforward single-pass cleanup do?",
      options: options(["Roughly twice the row-processing work, or O(n).", "The same work, because row count does not affect a loop.", "Four times the work, or O(n²), even with one pass.", "Half the work because normalization removes rows."]),
      correctOption: "A",
      explanation: "A single pass over each row scales linearly with the number of rows.",
    },
    {
      question: "A source row has a missing email. What is the best treatment?",
      options: options(["Invent an email so every record has the same shape.", "Apply the stated validation rule and report or retain the row according to that rule.", "Silently replace it with the previous row's email.", "Drop the row before recording that it was missing."]),
      correctOption: "B",
      explanation: "Missing data should be handled transparently according to the task's validation policy, not fabricated or silently lost.",
    },
  ];

  if (domain === "sql") return [
    {
      question: `For ${taskName}, what prevents one customer with several activity rows from being counted more than once in a cohort?`,
      options: options(["COUNT(DISTINCT customer_id) at the cohort/month grain.", "COUNT(*) after joining every activity row.", "SUM(customer_id) grouped only by month.", "Remove the cohort grouping and count all rows."]),
      correctOption: "A",
      explanation: "The task asks for active customers, so each customer must be counted once at the requested cohort and month grain.",
    },
    {
      question: "What should you verify before joining cohort and activity data?",
      options: options(["That the join keys and row grain do not multiply customer records unexpectedly.", "That every table has the same number of rows.", "That the query uses SELECT *.", "That dates are ordered alphabetically."]),
      correctOption: "A",
      explanation: "Join cardinality and grain determine whether the result is duplicated or misattributed.",
    },
    {
      question: "How should a monthly result be checked for a cohort with no activity in a month?",
      options: options(["Confirm the intended zero/absent-month behavior and include a calendar spine if zero months must appear.", "Assume GROUP BY will invent missing months.", "Replace the count with a count of all customers.", "Remove the month column."]),
      correctOption: "A",
      explanation: "SQL aggregation cannot return groups that have no input rows; a calendar spine is needed when those months must be shown.",
    },
    {
      question: "How does a well-indexed single aggregation usually scale as activity rows increase?",
      options: options(["It still processes more rows; the work is generally at least proportional to input size.", "It becomes constant-time regardless of input size.", "It always grows exactly as n squared.", "It becomes faster because customer IDs repeat."]),
      correctOption: "A",
      explanation: "An aggregation must read the relevant input rows; indexes can help access paths but do not make the input size irrelevant.",
    },
    {
      question: "Which test is most useful for the cohort query?",
      options: options(["A customer with multiple activity rows and a cohort/month with no activity.", "Only a table containing one customer and one row.", "A query that returns any non-empty result.", "A test that checks column names but not counts."]),
      correctOption: "A",
      explanation: "Those cases directly exercise double-counting and missing-month behavior described by the task.",
    },
  ];

  if (domain === "marketing") return [
    {
      question: `For ${taskName}, what makes the campaign audience actionable?`,
      options: options(["A defined audience need and a clear reason the offer is relevant to it.", "The largest possible audience, regardless of fit.", "A channel list without a target group.", "A budget split chosen before the campaign objective."]),
      correctOption: "A",
      explanation: "Audience fit connects the campaign objective to the message and channel choices.",
    },
    {
      question: "How should a limited campaign budget be allocated?",
      options: options(["Set a reasoned test allocation, protect the core objective, and adjust using performance evidence.", "Spend the entire budget on the channel with the most impressions.", "Split equally across every channel without considering the audience.", "Use the budget only after the campaign ends."]),
      correctOption: "A",
      explanation: "A justified allocation links spend to the audience and objective and can be revised using results.",
    },
    {
      question: "Which measure best evaluates whether a campaign met its objective?",
      options: options(["A relevant outcome measure, such as qualified visits or conversions, alongside reach.", "Reach alone for every campaign objective.", "The number of channels used.", "The amount of budget spent."]),
      correctOption: "A",
      explanation: "Reach is useful context, but the primary metric should reflect the outcome the campaign was meant to achieve.",
    },
    {
      question: "What is a useful way to test an early campaign assumption?",
      options: options(["Run a small, measurable test and compare results against a stated baseline.", "Wait until all budget is spent before reviewing any signal.", "Change the audience, message, and channel at once with no tracking.", "Treat a single positive comment as proof of impact."]),
      correctOption: "A",
      explanation: "A bounded test with a baseline makes it easier to learn which decision affected the outcome.",
    },
    {
      question: "If a channel underperforms, what is the best next step?",
      options: options(["Check tracking and audience fit, then adjust the channel mix while preserving the objective.", "Increase its budget automatically because it has low results.", "Ignore the data until the campaign ends.", "Replace the objective with whichever metric is highest."]),
      correctOption: "A",
      explanation: "Validate the signal first, then make a targeted adjustment tied to the original goal.",
    },
  ];

  if (domain === "accounting") return [
    {
      question: `For ${taskName}, what is the sound first step when a ledger and statement do not agree?`,
      options: options(["Trace the difference to transaction-level source evidence and timing.", "Post a balancing adjustment immediately.", "Write off the difference because it is inconvenient.", "Change the opening balance to force agreement."]),
      correctOption: "A",
      explanation: "A discrepancy should be traced to its source and timing before any supported adjustment is recorded.",
    },
    {
      question: "A transaction appears in the source statement but not the ledger. What should happen?",
      options: options(["Verify its period, amount, and supporting document, then document the proposed treatment.", "Post it without checking the date or source.", "Delete the matching statement line.", "Assume it is a timing difference and ignore it."]),
      correctOption: "A",
      explanation: "The source document, period, and amount must support the reconciliation treatment.",
    },
    {
      question: "How can you reduce mistakes when comparing transaction lists?",
      options: options(["Use stable references and compare dates, amounts, and transaction IDs with a documented tolerance.", "Compare only rounded totals.", "Sort by description and assume adjacent lines match.", "Ignore duplicate-looking transactions."]),
      correctOption: "A",
      explanation: "Multiple fields and stable references help distinguish genuine matches from similar-looking transactions.",
    },
    {
      question: "Which item belongs in a useful reconciliation report?",
      options: options(["Opening balance, checked transactions, supported discrepancies, adjustments, and closing balance.", "Only the final balance.", "A list of unexplained differences without sources.", "A note that the totals look close."]),
      correctOption: "A",
      explanation: "A concise audit trail makes the reconciliation reproducible and reviewable.",
    },
    {
      question: "When should a difference be written off?",
      options: options(["Only under an applicable policy with evidence and appropriate approval.", "Whenever two totals differ.", "Whenever a transaction is late.", "Whenever the amount is difficult to trace."]),
      correctOption: "A",
      explanation: "Write-offs require an applicable policy and supporting evidence, not convenience.",
    },
  ];

  const specialKeyQuestion = taskVariant?.id === "group-by-status"
    ? "The sample includes the status '__proto__'. Which accumulator is safe for this key?"
    : `Which accumulator choice is safest when grouping ${field} values, including unusual keys?`;
  return [
    {
      question: `For ${taskName}, what should the grouping function produce?`,
      options: options([`A collection where every input record appears in the group for its ${field} value.`, `Only the first record for each ${field}.`, "A total count with no records retained.", `A new array containing only records with a common ${field}.`]),
      correctOption: "A",
      explanation: `The task is to group, not discard, the records; each record must remain associated with its ${field} value.`,
    },
    {
      question: `A record has no ${field}. What is the best behavior for this task?`,
      options: options(["Keep it in a consistent missing-value group or documented bucket.", "Silently remove it from the result.", `Reuse the previous record's ${field}.`, "Throw it away because the field is optional."]),
      correctOption: "A",
      explanation: "The task explicitly requires a deliberate, consistent treatment for missing field values.",
    },
    {
      question: specialKeyQuestion,
      options: options(["Use a Map or a null-prototype object, with safe handling when reading keys.", "Use a normal object and assume every key is an ordinary word.", "Convert all keys to their array index.", "Skip keys that are not present on Object.prototype."]),
      correctOption: "A",
      explanation: "A Map or null-prototype object avoids inherited-property collisions such as '__proto__'.",
    },
    {
      question: "What is the expected time complexity of a single-pass grouping operation?",
      options: options(["O(n) expected time for n records, with storage proportional to the output.", "O(1), independent of the number of records.", "O(n²) in every implementation.", "O(log n) because each record belongs to one group."]),
      correctOption: "A",
      explanation: "A single pass visits each record once; the output also stores the grouped records.",
    },
    {
      question: "Which verification best matches the grouping task?",
      options: options(["Check ordinary, missing, repeated, and unusual-key values and confirm every input record is retained.", "Check only that the output is an object.", "Run the function once with an empty list and stop.", "Check only that the first group has one record."]),
      correctOption: "A",
      explanation: "These cases test the stated task contract and the edge cases most likely to break grouping behavior.",
    },
  ];
}

export const adaptScenarioQuestions = [
  {
    scenario: "AI and Job Anxiety — A support team is introducing an AI tool that can answer routine questions. The team still handles unusual cases, escalations, and relationship-sensitive conversations.",
    question: "What is the most constructive way for a worker to adapt their role?",
    options: options(["Map which tasks are automated, build skills for exceptions and customer judgment, and review quality during a pilot.", "Assume the whole role will disappear and stop learning its systems.", "Avoid the tool and keep all workflows unchanged.", "Move every customer interaction to AI, including sensitive escalations."]),
    correctOption: "A",
    explanation: "Task-level analysis turns automation risk into a practical reskilling plan while preserving human judgment where it matters.",
  },
  {
    scenario: "AI and Job Anxiety — An analyst finds that AI drafts routine weekly summaries, but managers rely on the analyst to explain exceptions and recommend action.",
    question: "Which development plan best supports the analyst's evolving role?",
    options: options(["Practice checking AI summaries, interpreting exceptions, and communicating evidence-backed recommendations.", "Focus only on typing summaries faster than the AI.", "Delegate all interpretation to the AI without reviewing its sources.", "Treat the time saved as evidence that no new skills are needed."]),
    correctOption: "A",
    explanation: "The plan combines AI review with the human analysis and communication that remain valuable in the role.",
  },
  {
    scenario: "Human–AI Collaboration — A project team uses an approved AI assistant to draft a client update. The draft includes a confident claim that is not in the project notes.",
    question: "What should the employee do before sending the update?",
    options: options(["Verify claims against project sources, correct unsupported content, and take responsibility for the final message.", "Send it because fluent wording means the claim is reliable.", "Ask the assistant to make the claim sound more confident.", "Remove every AI-assisted sentence without checking it."]),
    correctOption: "A",
    explanation: "AI can accelerate drafting, but source-checking and accountability remain with the employee.",
  },
  {
    scenario: "Human–AI Collaboration — A colleague wants to paste identifiable customer records into a public AI chat to summarize complaints.",
    question: "What is the best productive and responsible response?",
    options: options(["Use an approved tool and permitted data, minimize or de-identify information, then review the summary.", "Paste the records because summarization is not a decision.", "Use a personal account so the work tool does not log it.", "Avoid all AI tools, including approved options, without checking policy."]),
    correctOption: "A",
    explanation: "Responsible collaboration follows data policy, minimizes exposure, and validates the result.",
  },
  {
    scenario: "Inclusive Workplaces — A skilled employee is returning after a two-year career break and wants to refresh tools that changed while they were away.",
    question: "Which approach best supports a fair return to work?",
    options: options(["Offer a structured, paid refresh period, a mentor, and a chance to demonstrate current skills.", "Assume the employee's skills are obsolete and reduce their responsibilities indefinitely.", "Require them to prove readiness through unpaid work outside the role.", "Exclude them from training until they catch up alone."]),
    correctOption: "A",
    explanation: "A supported return makes expectations clear and evaluates demonstrated capability rather than penalizing time away.",
  },
  {
    scenario: "Inclusive Workplaces — A new workplace platform is difficult to use with screen readers, and some long-tenured employees have had little time to learn it.",
    question: "What should the employer do?",
    options: options(["Address accessibility with affected users, provide flexible training, and offer equivalent ways to complete the work.", "Tell employees to use a different career path if the tool is difficult.", "Provide one optional video and consider the issue resolved.", "Measure adoption before checking whether everyone can access the platform."]),
    correctOption: "A",
    explanation: "Inclusive implementation combines accessible design, consultation, and training that accommodates different needs and experience.",
  },
  {
    scenario: "Workforce Planning for Employers — An employer expects automation and new regulation to change its services over the next three to five years.",
    question: "What is the strongest way to forecast future roles and skills?",
    options: options(["Use several demand scenarios, map tasks and skill gaps, and review workforce data and assumptions regularly.", "Copy last year's headcount plan and add a fixed percentage.", "Predict one exact job title for every employee now.", "Wait until vacancies arise before considering capability needs."]),
    correctOption: "A",
    explanation: "Scenario planning is more robust than a single-point guess and ties role forecasts to changing tasks and capabilities.",
  },
  {
    scenario: "Workforce Planning for Employers — A forecast shows a growing need for data governance skills and declining demand for one repetitive process.",
    question: "Which action best turns that forecast into a responsible workforce plan?",
    options: options(["Validate the forecast, identify transferable skills, and compare reskilling, hiring, and workflow redesign options.", "Eliminate the current team before assessing transferable experience.", "Hire for every projected role immediately without checking uncertainty.", "Ignore internal skills and rely only on external recruitment."]),
    correctOption: "A",
    explanation: "A credible plan validates assumptions and considers existing talent, development, and operating changes alongside hiring.",
  },
];

export function validateMcqQuestions(value, expectedCount) {
  return Array.isArray(value) && value.length === expectedCount && value.every((question) =>
    question && typeof question === "object" &&
    typeof question.question === "string" && question.question.trim() && question.question.length <= 1000 &&
    (question.scenario === undefined || typeof question.scenario === "string" && question.scenario.length <= 2000) &&
    Array.isArray(question.options) && question.options.length === 4 &&
    question.options.every((option, index) => option && option.id === String.fromCharCode(65 + index) &&
      typeof option.text === "string" && option.text.trim() && option.text.length <= 500) &&
    ["A", "B", "C", "D"].includes(question.correctOption) &&
    typeof question.explanation === "string" && question.explanation.trim() && question.explanation.length <= 1000);
}
