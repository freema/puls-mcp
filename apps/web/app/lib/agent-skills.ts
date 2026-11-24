/**
 * Single source of truth for the agent-skills discovery index.
 * Each entry maps to a SKILL.md file under
 * apps/web/public/.well-known/agent-skills/<name>/SKILL.md
 *
 * The index route hashes each file at request time so the published sha256
 * always matches the served content (avoids drift if a skill is edited but
 * the index isn't regenerated).
 */

export interface SkillEntry {
  name: string;
  type: 'workflow' | 'tool';
  description: string;
}

export const SKILLS: SkillEntry[] = [
  {
    name: 'order-summary',
    type: 'workflow',
    description:
      "List, filter and summarize e-shop orders for a given period — totals, status breakdown, and top customers.",
  },
  {
    name: 'low-stock-alert',
    type: 'workflow',
    description:
      'Surface e-shop products at or below a stock threshold and recommend which to reorder first.',
  },
  {
    name: 'top-products-report',
    type: 'workflow',
    description:
      'Generate a top-selling products report for a date range, broken down by units and revenue.',
  },
  {
    name: 'customer-lookup',
    type: 'tool',
    description:
      'Find an e-shop customer by email, phone or name and return their full purchase history.',
  },
  {
    name: 'daily-shop-pulse',
    type: 'workflow',
    description:
      "One-shot operational briefing — yesterday's revenue, order count, top sellers and any low-stock items.",
  },
  {
    name: 'sales-period-comparison',
    type: 'workflow',
    description:
      'Compare revenue, orders and AOV between two date ranges (e.g. this week vs. last week).',
  },
];
