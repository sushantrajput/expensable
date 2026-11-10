export type Rule = {
  id: string;
  category: string;
  allowed: boolean;
  limit: number | null;
  unit: string;
  approval_above: number | null;
  approver: string;
  receipt_above: number | null;
  notes: string;
};
export type Section = { id: string; heading: string; body: string };
export type Version = { version: number; change_note: string; published_via: string; published_at: string };
export type Policy = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  currency: string;
  contact: string;
  rules: Rule[];
  sections: Section[];
  version: number;
  draft_dirty: boolean;
  created_via: string;
  updated_at: string;
  published_at: string | null;
  versions: Version[];
};
export type PolicyListItem = Omit<Policy, "rules" | "sections" | "versions" | "contact"> & {
  rule_count: number;
  acks_current: number;
  checks_total: number;
};
export type PublicPolicy = {
  slug: string;
  version: number;
  published_at: string;
  company: string;
  title: string;
  summary: string;
  currency: string;
  contact: string;
  rules: Rule[];
  sections: Section[];
};
export type Verdict = "allowed" | "needs_approval" | "over_limit" | "not_allowed" | "not_covered";
export type CheckResult = {
  verdict: Verdict;
  title: string;
  message: string;
  receipt_required: boolean;
  reimbursable_amount: number;
  category: string;
};
export type Me = { name: string; email: string; workspace: string; mcp_url: string };

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method || (opts.body ? "POST" : "GET"),
    headers: opts.body ? { "content-type": "application/json" } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || "Something went wrong");
  return data as T;
}

export function money(amount: number | null | undefined, currency: string) {
  if (amount === null || amount === undefined) return "";
  try {
    return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

export function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
