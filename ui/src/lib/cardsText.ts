// Card texts and the job-done budget: pure rules (fidelity check 2). Plugin data is filtered to plain text; the prefix rule (the name is Peeka's) holds.
import { flat, riskOf } from "./plugin";

/** Short title on the peek: the plugin's `shortTitle` if given; otherwise at high risk "... wants to run a high-risk command" -> "... needs approval" (risk is shown separately). */
export function shortApprovalTitle(a: { title: string; risk?: unknown; shortTitle?: unknown }): string {
  const s = flat(a.shortTitle, 80);
  if (s) return s;
  const t = flat(a.title);
  return riskOf(a.risk) === "high" ? t.replace(/\s+wants to run a high-risk\b.*$/i, " needs approval") : t;
}

