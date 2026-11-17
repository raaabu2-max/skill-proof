// Track definitions are intentionally data-only so the server can expose them to
// clients and new assessment variants can be added without editing route logic.
export const tracksConfig = Object.freeze({
  version: 1,

  // These shares combine completed track scores into the existing Authenticity
  // Score. Missing tracks are excluded and the remaining shares are normalized.
  trackWeights: Object.freeze({
    "problem-solver": 0.3,
    skill: 0.4,
    adapt: 0.3,
  }),

  // Domains are shared vocabulary; each track below opts into supported domains.
  domains: Object.freeze({
    javascript: Object.freeze({ id: "javascript", title: "JavaScript", kind: "coding" }),
    python: Object.freeze({ id: "python", title: "Python", kind: "coding" }),
    sql: Object.freeze({ id: "sql", title: "SQL", kind: "coding" }),
    marketing: Object.freeze({ id: "marketing", title: "Marketing", kind: "practical" }),
    accounting: Object.freeze({ id: "accounting", title: "Accounting", kind: "practical" }),
  }),

  tracks: Object.freeze({
    "problem-solver": Object.freeze({
      id: "problem-solver",
      title: "Problem Solver",
      description: "Find, explain, and fix hidden bugs in a messy mini-project.",
      domains: Object.freeze(["javascript", "sql"]),
      tasks: Object.freeze([
        Object.freeze({
          id: "broken-mini-project",
          domain: "javascript",
          title: "Broken order summary",
          description: "Trace the order summary, explain the hidden defects, and repair it against the failing tests.",
          variants: Object.freeze([
            Object.freeze({
              id: "broken-order-summary-01",
              seed: 1101,
              title: "Order summary: rounding and empty carts",
              description: "Find the rounding and empty-cart defects before fixing the failing checks.",
              starter: "function summarizeOrder(items, taxRate) {\n  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);\n  return { subtotal, total: subtotal + taxRate };\n}",
              hiddenBugs: Object.freeze(["tax rate is added as a fixed amount", "currency total is not rounded", "empty input is not handled explicitly"]),
              failingTests: Object.freeze(["tax is calculated from subtotal", "total is rounded to cents", "empty cart returns a zero summary"]),
            }),
            Object.freeze({
              id: "broken-order-summary-02",
              seed: 1102,
              title: "Order summary: discounts and invalid quantities",
              description: "Explain the discount and quantity edge cases, then make the failing checks pass.",
              starter: "function summarizeOrder(items, discount) {\n  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);\n  return total - discount;\n}",
              hiddenBugs: Object.freeze(["discount is not bounded by the subtotal", "zero and negative quantities are not validated", "money values accumulate without rounding"]),
              failingTests: Object.freeze(["discount cannot create a negative total", "invalid quantities are rejected", "currency total is rounded consistently"]),
            }),
          ]),
        }),
        Object.freeze({
          id: "broken-query",
          domain: "sql",
          title: "Broken reporting query",
          description: "Find a join and aggregation defect in a reporting query and explain the correction.",
          variants: Object.freeze([
            Object.freeze({
              id: "broken-query-01",
              seed: 1201,
              title: "Monthly revenue report",
              description: "Repair a query that duplicates revenue and mishandles empty months.",
              starter: "SELECT month, SUM(amount) AS revenue FROM orders JOIN order_items USING (order_id) GROUP BY month;",
              hiddenBugs: Object.freeze(["join fan-out duplicates order-level amounts", "months with no orders are omitted"]),
              failingTests: Object.freeze(["revenue is not duplicated by item count", "empty months remain in the report"]),
            }),
          ]),
        }),
      ]),
      // Signal weights within this track sum to one. AI-use quality is neutral
      // unless evidence shows how suggestions were checked or corrected.
      signals: Object.freeze({
        viva: Object.freeze({ weight: 0.25, weakBelow: 45, authenticityComponent: "viva", description: "Bug explanation and reasoning." }),
        process: Object.freeze({ weight: 0.2, weakBelow: 45, authenticityComponent: "process", description: "Iterative investigation and repair." }),
        aiUsage: Object.freeze({ weight: 0.15, weakBelow: 45, authenticityComponent: "aiUsage", description: "Evaluation of assistant suggestions." }),
        liveCheck: Object.freeze({ weight: 0.35, weakBelow: 45, authenticityComponent: "liveCheck", description: "Failing checks repaired and verified." }),
        timeAndPaste: Object.freeze({ weight: 0.05, weakBelow: 45, authenticityComponent: "timeAndPaste", description: "Time and paste evidence in context." }),
      }),
    }),

    skill: Object.freeze({
      id: "skill",
      title: "Skill",
      description: "Build a practical task in a chosen domain and defend your approach in an AI viva.",
      domains: Object.freeze(["javascript", "python", "sql", "marketing", "accounting"]),
      tasks: Object.freeze([
        Object.freeze({
          id: "group-records",
          domain: "javascript",
          title: "Group records by field",
          description: "Group records by a selected field, account for missing values, then explain your choices.",
          variants: Object.freeze([
            Object.freeze({
              id: "group-by-region",
              seed: 2101,
              title: "Group records by region",
              description: "Complete groupByRegion(records). Group every record by its region, including records with a missing region.",
              field: "region",
              dataset: Object.freeze([{ region: "north", name: "A" }, { region: "south", name: "B" }, { name: "C" }]),
              thresholds: Object.freeze({ minEditEvents: 3, maxPasteCharacters: 500 }),
            }),
            Object.freeze({
              id: "group-by-status",
              seed: 2102,
              title: "Group tickets by status",
              description: "Complete groupByStatus(tickets). Keep every ticket and account for empty values and special object keys.",
              field: "status",
              dataset: Object.freeze([{ status: "open", id: 1 }, { status: "closed", id: 2 }, { status: "__proto__", id: 3 }]),
              thresholds: Object.freeze({ minEditEvents: 3, maxPasteCharacters: 500 }),
            }),
            Object.freeze({
              id: "group-by-category",
              seed: 2103,
              title: "Group products by category",
              description: "Complete groupByCategory(products). Group categories and decide how to represent missing category values.",
              field: "category",
              dataset: Object.freeze([{ category: "books", sku: "B1" }, { category: "tools", sku: "T1" }, { sku: "U1" }]),
              thresholds: Object.freeze({ minEditEvents: 3, maxPasteCharacters: 500 }),
            }),
          ]),
        }),
        Object.freeze({
          id: "python-data-cleanup",
          domain: "python",
          title: "Clean a data extract",
          description: "Normalize a small data extract and explain handling for missing and repeated values.",
          variants: Object.freeze([
            Object.freeze({ id: "python-cleanup-01", seed: 2201, title: "Normalize contact rows", description: "Clean names and email fields while preserving valid records.", starter: "def clean_contacts(rows):\n    return rows" }),
          ]),
        }),
        Object.freeze({
          id: "sql-cohort-analysis",
          domain: "sql",
          title: "Analyze a customer cohort",
          description: "Write a query that summarizes a cohort and explain its joins and edge cases.",
          variants: Object.freeze([
            Object.freeze({ id: "sql-cohort-01", seed: 2301, title: "Monthly cohort retention", description: "Calculate monthly retention without double-counting customers.", starter: "SELECT cohort_month, activity_month, COUNT(DISTINCT customer_id) AS active_customers\nFROM activity\nGROUP BY cohort_month, activity_month;" }),
          ]),
        }),
        Object.freeze({
          id: "marketing-campaign",
          domain: "marketing",
          title: "Plan a campaign",
          description: "Create a channel plan for a defined audience and justify the success measures.",
          variants: Object.freeze([
            Object.freeze({ id: "marketing-campaign-01", seed: 2401, title: "Launch a local campaign", description: "Propose a concise campaign plan with audience, channels, budget split, and measurable outcomes.", starter: "Audience:\nChannels:\nBudget:\nSuccess measures:" }),
          ]),
        }),
        Object.freeze({
          id: "accounting-reconciliation",
          domain: "accounting",
          title: "Reconcile a ledger",
          description: "Reconcile a small ledger, identify discrepancies, and explain the adjustments.",
          variants: Object.freeze([
            Object.freeze({ id: "accounting-reconcile-01", seed: 2501, title: "Reconcile a monthly ledger", description: "Compare a ledger to a statement, document discrepancies, and propose supported adjustments.", starter: "Opening balance:\nTransactions checked:\nDiscrepancies:\nAdjustments:\nClosing balance:" }),
          ]),
        }),
      ]),
      // Skill tasks emphasize the deliverable and its oral defense while
      // retaining process and thoughtful AI use as contextual evidence.
      signals: Object.freeze({
        viva: Object.freeze({ weight: 0.3, weakBelow: 45, authenticityComponent: "viva", description: "Explanation of choices, trade-offs, and edge cases." }),
        process: Object.freeze({ weight: 0.15, weakBelow: 45, authenticityComponent: "process", description: "Development or practical work process." }),
        aiUsage: Object.freeze({ weight: 0.15, weakBelow: 45, authenticityComponent: "aiUsage", description: "Evaluation of optional assistant suggestions." }),
        liveCheck: Object.freeze({ weight: 0.3, weakBelow: 45, authenticityComponent: "liveCheck", description: "Quality and verification of the practical result." }),
        timeAndPaste: Object.freeze({ weight: 0.1, weakBelow: 45, authenticityComponent: "timeAndPaste", description: "Time and paste evidence in context." }),
      }),
    }),

    adapt: Object.freeze({
      id: "adapt",
      title: "Adapt",
      description: "Respond to a changing requirement and verify subtly incorrect assistant advice.",
      domains: Object.freeze(["javascript", "marketing", "accounting"]),
      tasks: Object.freeze([
        Object.freeze({
          id: "adapt-grouping",
          domain: "javascript",
          title: "Adapt a grouping task",
          description: "Complete a grouping task, adapt to a changed missing-value requirement, and verify assistant advice.",
          variants: Object.freeze([
            Object.freeze({
              id: "adapt-grouping-01",
              seed: 3101,
              title: "Missing values arrive mid-task",
              description: "Group records, then update the solution when missing values must remain visible.",
              starter: "function groupRecords(items) {\n  return items.reduce((groups, item) => groups, {});\n}",
              requirementChange: "Missing values must be grouped under an explicit '(unknown)' label.",
              seededAssistantMistakes: Object.freeze(["Filtering out missing values is equivalent to grouping them.", "A regular object safely accepts every possible string key."]),
            }),
          ]),
        }),
        Object.freeze({
          id: "adapt-campaign",
          domain: "marketing",
          title: "Adapt a campaign plan",
          description: "Revise a campaign after a budget or audience change and verify a questionable recommendation.",
          variants: Object.freeze([
            Object.freeze({
              id: "adapt-campaign-01",
              seed: 3201,
              title: "Budget reduced mid-campaign",
              description: "Revise channel allocation after a budget reduction without losing the core objective.",
              requirementChange: "Reduce the available budget by 30% while preserving the target audience.",
              seededAssistantMistakes: Object.freeze(["Scale every channel budget by the same amount regardless of performance.", "Reach alone is a sufficient success measure."]),
            }),
          ]),
        }),
        Object.freeze({
          id: "adapt-ledger",
          domain: "accounting",
          title: "Adapt a reconciliation",
          description: "Reconcile a changed transaction and verify an assistant's proposed adjustment.",
          variants: Object.freeze([
            Object.freeze({
              id: "adapt-ledger-01",
              seed: 3301,
              title: "Late transaction discovered",
              description: "Update the reconciliation after an additional transaction is identified.",
              requirementChange: "A late transaction must be included in the period and supported by source evidence.",
              seededAssistantMistakes: Object.freeze(["Post the adjustment without checking its source document.", "A timing difference should always be written off."]),
            }),
          ]),
        }),
      ]),
      // Adaptability and careful verification matter here; simply using AI is
      // not a weak signal and does not reduce the AI-use component.
      signals: Object.freeze({
        viva: Object.freeze({ weight: 0.2, weakBelow: 45, authenticityComponent: "viva", description: "Reasoning about the changed requirement." }),
        process: Object.freeze({ weight: 0.2, weakBelow: 45, authenticityComponent: "process", description: "Response and iteration after the change." }),
        aiUsage: Object.freeze({ weight: 0.25, weakBelow: 45, authenticityComponent: "aiUsage", description: "Detection, checking, and correction of assistant mistakes." }),
        liveCheck: Object.freeze({ weight: 0.25, weakBelow: 45, authenticityComponent: "liveCheck", description: "Verification of the adapted output." }),
        timeAndPaste: Object.freeze({ weight: 0.1, weakBelow: 45, authenticityComponent: "timeAndPaste", description: "Time and paste evidence in context." }),
      }),
    }),
  }),
});

// Keep lookup helpers small and deterministic so APIs and scoring always use
// the same supported track/domain/task combinations.
export function getTrack(trackId) {
  return tracksConfig.tracks[trackId] || null;
}

export function getTrackVariants(trackId, domain) {
  const track = getTrack(trackId);
  if (!track || !track.domains.includes(domain)) return [];
  return track.tasks
    .filter((task) => task.domain === domain)
    .flatMap((task) => task.variants.map((variant) => ({ ...variant, taskId: task.id, taskTitle: task.title })));
}

export function findTrackVariant(trackId, domain, variantId) {
  return getTrackVariants(trackId, domain).find((variant) => variant.id === variantId) || null;
}

export function chooseTrackVariant(trackId, domain, seed = 0) {
  const variants = getTrackVariants(trackId, domain);
  if (!variants.length) return null;
  const safeSeed = Number.isSafeInteger(seed) ? Math.abs(seed) : 0;
  return variants[safeSeed % variants.length];
}
