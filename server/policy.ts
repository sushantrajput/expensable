import { randomUUID, randomBytes } from "node:crypto";
import { q, one, pool } from "./db.js";

export type Rule = {
  id: string;
  category: string;
  allowed: boolean;
  limit: number | null; // hard cap per unit; anything above is not reimbursed
  unit: string; // "per expense", "per night", "per day", "per person", "per month"
  approval_above: number | null; // above this, get pre-approval first
  approver: string; // who approves, e.g. "Finance lead"
  receipt_above: number | null; // above this, a receipt is required (0 = always)
  notes: string;
};

export type Section = { id: string; heading: string; body: string };

export type PolicyRow = {
  id: string;
  workspace_id: string;
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
  created_at: string;
  updated_at: string;
  published_at: string | null;
};

export type Snapshot = Pick<PolicyRow, "title" | "summary" | "currency" | "contact" | "rules" | "sections">;

const shortId = () => randomBytes(4).toString("hex");

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

function str(v: unknown, max = 2000): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export function normalizeRule(input: any): Rule {
  return {
    id: str(input?.id, 40) || shortId(),
    category: str(input?.category, 80) || "Untitled category",
    allowed: input?.allowed === false || input?.allowed === "false" ? false : true,
    limit: num(input?.limit),
    unit: str(input?.unit, 40) || "per expense",
    approval_above: num(input?.approval_above),
    approver: str(input?.approver, 80),
    receipt_above: num(input?.receipt_above),
    notes: str(input?.notes, 1000),
  };
}

export function normalizeSection(input: any): Section {
  return {
    id: str(input?.id, 40) || shortId(),
    heading: str(input?.heading, 120) || "Untitled section",
    body: str(input?.body, 8000),
  };
}

export function normalizeCurrency(c: unknown): string {
  const s = str(c, 8).toUpperCase();
  return /^[A-Z]{3}$/.test(s) ? s : "INR";
}

export function formatMoney(amount: number, currency: string) {
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

// ---------------------------------------------------------------------------
// The checker. Plain rules, no AI: the same question always gets the same answer.
// ---------------------------------------------------------------------------
export type Verdict = "allowed" | "needs_approval" | "over_limit" | "not_allowed" | "not_covered";

export type CheckResult = {
  verdict: Verdict;
  title: string;
  message: string;
  receipt_required: boolean;
  reimbursable_amount: number;
  category: string;
  rule: Rule | null;
};

export function findRule(rules: Rule[], category: string): Rule | null {
  const c = category.trim().toLowerCase();
  if (!c) return null;
  return (
    rules.find((r) => r.id === category) ||
    rules.find((r) => r.category.toLowerCase() === c) ||
    rules.find((r) => r.category.toLowerCase().includes(c) || c.includes(r.category.toLowerCase())) ||
    null
  );
}

export function checkExpense(snap: Snapshot, category: string, amount: number): CheckResult {
  const rule = findRule(snap.rules, category);
  const m = (n: number) => formatMoney(n, snap.currency);
  const contact = snap.contact || "finance";

  if (!rule) {
    return {
      verdict: "not_covered",
      title: "Not covered by this policy",
      message: `“${category}” isn't in the policy yet. Check with ${contact} before you spend.`,
      receipt_required: false,
      reimbursable_amount: 0,
      category,
      rule: null,
    };
  }

  // receipt_above = 0 means "always keep the receipt"
  const receipt = rule.receipt_above !== null && (rule.receipt_above === 0 || amount > rule.receipt_above);
  const base = { category: rule.category, rule, receipt_required: rule.allowed ? receipt : false };

  if (!rule.allowed) {
    return {
      ...base,
      verdict: "not_allowed",
      title: "Not reimbursable",
      message: rule.notes || `${rule.category} isn't covered by company policy.`,
      reimbursable_amount: 0,
    };
  }

  if (rule.limit !== null && amount > rule.limit) {
    return {
      ...base,
      verdict: "over_limit",
      title: "Over the limit",
      message: `The limit for ${rule.category} is ${m(rule.limit)} ${rule.unit}. Only ${m(rule.limit)} will be reimbursed. The other ${m(amount - rule.limit)} is on you.`,
      reimbursable_amount: rule.limit,
    };
  }

  if (rule.approval_above !== null && amount > rule.approval_above) {
    return {
      ...base,
      verdict: "needs_approval",
      title: "Get approval first",
      message: `Anything above ${m(rule.approval_above)} ${rule.unit} needs pre-approval from ${rule.approver || "your manager"} before you spend.`,
      reimbursable_amount: amount,
    };
  }

  return {
    ...base,
    verdict: "allowed",
    title: "Yes, you can expense this",
    message:
      rule.limit !== null
        ? `You're within the ${m(rule.limit)} ${rule.unit} limit for ${rule.category}.`
        : `${rule.category} is covered by the policy.`,
    reimbursable_amount: amount,
  };
}

// ---------------------------------------------------------------------------
// Data access, shared by the REST API and the MCP server.
// ---------------------------------------------------------------------------
function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "policy"
  );
}

export async function createPolicy(
  workspaceId: string,
  input: { title?: string; summary?: string; currency?: string; contact?: string; rules?: any[]; sections?: any[] },
  via: "app" | "claude"
): Promise<PolicyRow> {
  const id = randomUUID();
  const title = str(input.title, 120) || "Expense policy";
  const slug = `${slugify(title)}-${randomBytes(2).toString("hex")}`;
  const rules = (input.rules || []).map(normalizeRule);
  const sections = (input.sections || []).map(normalizeSection);
  return (await one<PolicyRow>(
    `insert into policies (id, workspace_id, slug, title, summary, currency, contact, rules, sections, created_via)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
    [
      id,
      workspaceId,
      slug,
      title,
      str(input.summary, 2000),
      normalizeCurrency(input.currency),
      str(input.contact, 120),
      JSON.stringify(rules),
      JSON.stringify(sections),
      via,
    ]
  ))!;
}

export async function getPolicy(workspaceId: string, idOrSlug: string): Promise<PolicyRow | undefined> {
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrSlug);
  return one<PolicyRow>(
    `select * from policies where workspace_id = $1 and ${isUuid ? "id = $2::uuid" : "slug = $2"}`,
    [workspaceId, idOrSlug]
  );
}

export async function updatePolicy(
  workspaceId: string,
  id: string,
  patch: { title?: string; summary?: string; currency?: string; contact?: string; rules?: any[]; sections?: any[] }
): Promise<PolicyRow | undefined> {
  const existing = await getPolicy(workspaceId, id);
  if (!existing) return undefined;
  const next = {
    title: patch.title !== undefined ? str(patch.title, 120) || existing.title : existing.title,
    summary: patch.summary !== undefined ? str(patch.summary, 2000) : existing.summary,
    currency: patch.currency !== undefined ? normalizeCurrency(patch.currency) : existing.currency,
    contact: patch.contact !== undefined ? str(patch.contact, 120) : existing.contact,
    rules: patch.rules !== undefined ? patch.rules.map(normalizeRule) : existing.rules,
    sections: patch.sections !== undefined ? patch.sections.map(normalizeSection) : existing.sections,
  };
  return one<PolicyRow>(
    `update policies set title=$3, summary=$4, currency=$5, contact=$6, rules=$7, sections=$8,
       draft_dirty=true, updated_at=now()
     where workspace_id=$1 and id=$2 returning *`,
    [workspaceId, existing.id, next.title, next.summary, next.currency, next.contact, JSON.stringify(next.rules), JSON.stringify(next.sections)]
  );
}

export async function publishPolicy(workspaceId: string, id: string, note: string, via: "app" | "claude") {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<PolicyRow>(
      `select * from policies where workspace_id=$1 and id=$2 for update`,
      [workspaceId, id]
    );
    const p = rows[0];
    if (!p) {
      await client.query("rollback");
      return undefined;
    }
    const version = p.version + 1;
    const snapshot: Snapshot = {
      title: p.title,
      summary: p.summary,
      currency: p.currency,
      contact: p.contact,
      rules: p.rules,
      sections: p.sections,
    };
    await client.query(
      `insert into policy_versions (policy_id, version, snapshot, change_note, published_via) values ($1,$2,$3,$4,$5)`,
      [p.id, version, JSON.stringify(snapshot), str(note, 300), via]
    );
    const upd = await client.query<PolicyRow>(
      `update policies set version=$2, draft_dirty=false, published_at=now(), updated_at=now() where id=$1 returning *`,
      [p.id, version]
    );
    await client.query("commit");
    return upd.rows[0];
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

export async function deletePolicy(workspaceId: string, id: string) {
  await q(`delete from policies where workspace_id=$1 and id=$2`, [workspaceId, id]);
}

export async function listPolicies(workspaceId: string) {
  return q(
    `select p.id, p.slug, p.title, p.summary, p.currency, p.version, p.draft_dirty, p.created_via,
            p.created_at, p.updated_at, p.published_at,
            jsonb_array_length(p.rules) as rule_count,
            (select count(*)::int from acknowledgements a where a.policy_id = p.id and a.version = p.version) as acks_current,
            (select count(*)::int from checks c where c.policy_id = p.id) as checks_total
       from policies p where p.workspace_id = $1 order by p.updated_at desc`,
    [workspaceId]
  );
}

export async function getVersions(policyId: string) {
  return q(
    `select version, change_note, published_via, published_at from policy_versions where policy_id=$1 order by version desc`,
    [policyId]
  );
}

export async function getPublished(slug: string) {
  return one<{ policy_id: string; version: number; snapshot: Snapshot; published_at: string; workspace_name: string; slug: string }>(
    `select p.id as policy_id, p.slug, v.version, v.snapshot, v.published_at, w.name as workspace_name
       from policies p
       join policy_versions v on v.policy_id = p.id and v.version = p.version
       join workspaces w on w.id = p.workspace_id
      where p.slug = $1`,
    [slug]
  );
}

export async function logCheck(policyId: string, version: number, result: CheckResult, amount: number, source: "page" | "claude") {
  await q(
    `insert into checks (id, policy_id, version, category, amount, verdict, source) values ($1,$2,$3,$4,$5,$6,$7)`,
    [randomUUID(), policyId, version, result.category.slice(0, 120), amount, result.verdict, source]
  );
}

export async function addAck(policyId: string, version: number, name: string, email: string) {
  return one(
    `insert into acknowledgements (id, policy_id, version, name, email) values ($1,$2,$3,$4,$5)
     on conflict (policy_id, version, email) do update set name = excluded.name
     returning *`,
    [randomUUID(), policyId, version, str(name, 120), str(email, 200).toLowerCase()]
  );
}

export async function getActivity(policyId: string) {
  const [acks, checks, byCategory, uncovered] = await Promise.all([
    q(
      `select name, email, version, created_at from acknowledgements where policy_id=$1 order by created_at desc limit 500`,
      [policyId]
    ),
    q(
      `select category, amount::float as amount, verdict, source, version, created_at from checks where policy_id=$1 order by created_at desc limit 200`,
      [policyId]
    ),
    q(
      `select category, count(*)::int as total,
              count(*) filter (where verdict='allowed')::int as allowed,
              count(*) filter (where verdict='needs_approval')::int as needs_approval,
              count(*) filter (where verdict='over_limit')::int as over_limit,
              count(*) filter (where verdict='not_allowed')::int as not_allowed,
              round(avg(amount))::float as avg_amount
         from checks where policy_id=$1 and source='page' and verdict <> 'not_covered'
        group by category order by total desc`,
      [policyId]
    ),
    q(
      `select category, count(*)::int as total, round(avg(amount))::float as avg_amount
         from checks where policy_id=$1 and source='page' and verdict = 'not_covered'
        group by category order by total desc limit 20`,
      [policyId]
    ),
  ]);
  return { acknowledgements: acks, recent_checks: checks, checks_by_category: byCategory, uncovered_questions: uncovered };
}
