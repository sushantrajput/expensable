import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, money, timeAgo, type Policy, type Rule, type Section } from "../api";
import { AppShell, ClaudeMark, CopyButton, Prose, StatusPill, ruleTerms, useMe, verdictStyle } from "../ui";

type Tab = "rules" | "sections" | "details" | "activity";
const CURRENCIES = ["INR", "USD", "EUR", "GBP", "SGD", "AED", "AUD", "CAD"];
const UNITS = ["per expense", "per day", "per night", "per trip", "per person", "per month"];
const rid = () => Math.random().toString(16).slice(2, 10);

export default function Editor() {
  const me = useMe();
  const { id } = useParams();
  const nav = useNavigate();
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [draft, setDraft] = useState<Policy | null>(null);
  const [tab, setTab] = useState<Tab>("rules");
  const [save, setSave] = useState<"saved" | "saving" | "pending" | "error">("saved");
  const [publishing, setPublishing] = useState(false);
  const [note, setNote] = useState("");
  const [remoteFlash, setRemoteFlash] = useState(false);
  const pending = useRef(false);
  const saveInFlight = useRef(false);
  const editSeq = useRef(0);
  const timer = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    const p = await api<Policy>(`/api/policies/${id}`);
    setPolicy(p);
    setDraft(p);
  }, [id]);

  useEffect(() => {
    load().catch(() => nav("/app"));
  }, [load, nav]);

  // Pick up changes Claude makes while this page is open.
  const lastSeen = useRef<string | null>(null);
  useEffect(() => {
    if (policy) lastSeen.current = policy.updated_at;
  }, [policy]);
  useEffect(() => {
    const t = setInterval(async () => {
      if (pending.current || saveInFlight.current) return;
      try {
        const p = await api<Policy>(`/api/policies/${id}`);
        if (pending.current || saveInFlight.current) return;
        if (lastSeen.current && p.updated_at !== lastSeen.current) {
          setPolicy(p);
          setDraft(p);
          setRemoteFlash(true);
          setTimeout(() => setRemoteFlash(false), 2500);
        }
      } catch {}
    }, 3000);
    return () => clearInterval(t);
  }, [id]);

  const persist = useCallback(
    async (next: Policy) => {
      const seq = editSeq.current;
      saveInFlight.current = true;
      setSave("saving");
      try {
        const p = await api<Policy>(`/api/policies/${id}`, {
          method: "PUT",
          body: {
            title: next.title,
            summary: next.summary,
            currency: next.currency,
            contact: next.contact,
            rules: next.rules,
            sections: next.sections,
          },
        });
        setPolicy(p);
        if (seq === editSeq.current) setSave("saved");
      } catch {
        setSave("error");
      } finally {
        saveInFlight.current = false;
        if (seq === editSeq.current) pending.current = false;
      }
    },
    [id]
  );

  const update = (patch: Partial<Policy>) => {
    setDraft((d) => {
      const next = { ...d!, ...patch };
      editSeq.current += 1;
      pending.current = true;
      setSave("pending");
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => persist(next), 700);
      return next;
    });
  };

  const publish = async () => {
    window.clearTimeout(timer.current);
    if (pending.current && draft) await persist(draft);
    const p = await api<Policy>(`/api/policies/${id}/publish`, { body: { note } });
    setPolicy(p);
    setDraft(p);
    setPublishing(false);
    setNote("");
  };

  const remove = async () => {
    if (!confirm("Delete this policy? The employee page stops working right away.")) return;
    await api(`/api/policies/${id}`, { method: "DELETE" });
    nav("/app");
  };

  if (!draft || !policy) {
    return (
      <AppShell me={me}>
        <div className="h-64 rounded-xl bg-white/60 animate-pulse" />
      </AppShell>
    );
  }

  const canPublish = policy.version === 0 || policy.draft_dirty;
  const publicUrl = `${location.origin}/p/${policy.slug}`;

  return (
    <AppShell me={me}>
      <Link to="/app" className="text-sm text-mute hover:text-ink">
        ← Policies
      </Link>

      <div className="mt-3 flex flex-wrap items-start gap-4">
        <div className="flex-1 min-w-[280px]">
          <input
            aria-label="Policy title"
            className="field-quiet text-[1.9rem] font-extrabold tracking-tight -ml-2"
            value={draft.title}
            onChange={(e) => update({ title: e.target.value })}
          />
          <div className="flex flex-wrap items-center gap-3 mt-1 text-sm">
            <StatusPill version={policy.version} dirty={policy.draft_dirty} />
            {policy.created_via === "claude" && <ClaudeMark />}
            <span className={`text-mute ${remoteFlash ? "text-cobalt font-medium" : ""}`}>
              {remoteFlash
                ? "Updated from Claude"
                : save === "saving" || save === "pending"
                ? "Saving…"
                : save === "error"
                ? "Couldn’t save. Check your connection."
                : "All changes saved"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {policy.version > 0 && (
            <a className="btn btn-ghost" href={`/p/${policy.slug}`} target="_blank" rel="noreferrer">
              Open employee page
            </a>
          )}
          <button className="btn btn-primary" disabled={!canPublish} onClick={() => setPublishing((v) => !v)}>
            {canPublish ? (policy.version === 0 ? "Publish" : `Publish v${policy.version + 1}`) : "Published"}
          </button>
        </div>
      </div>

      {publishing && (
        <div className="mt-4 bg-white border border-cobalt rounded-xl p-4 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium">
            {policy.version === 0
              ? "Your team will see this policy at its link once it’s published."
              : "Your team will be asked to acknowledge the new version."}
          </span>
          <input
            className="field flex-1 min-w-[220px]"
            placeholder="What changed? (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            autoFocus
          />
          <button className="btn btn-primary" onClick={publish}>
            Publish now
          </button>
          <button className="btn btn-text" onClick={() => setPublishing(false)}>
            Cancel
          </button>
        </div>
      )}

      <div className="mt-6 border-b border-line flex gap-1" role="tablist">
        {(
          [
            ["rules", `Rules (${draft.rules.length})`],
            ["sections", `Sections (${draft.sections.length})`],
            ["details", "Details & sharing"],
            ["activity", "Activity"],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`px-3 py-2.5 text-sm font-semibold border-b-2 -mb-px ${
              tab === t ? "border-cobalt text-ink" : "border-transparent text-mute hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === "rules" && <RulesTab rules={draft.rules} currency={draft.currency} onChange={(rules) => update({ rules })} />}
        {tab === "sections" && <SectionsTab sections={draft.sections} onChange={(sections) => update({ sections })} />}
        {tab === "details" && (
          <div className="grid lg:grid-cols-[1.4fr_1fr] gap-6">
            <div className="bg-white rounded-xl border border-line p-6 space-y-5">
              <label className="block">
                <span className="text-sm font-semibold">Summary for employees</span>
                <textarea
                  className="field mt-1.5 min-h-28"
                  value={draft.summary}
                  onChange={(e) => update({ summary: e.target.value })}
                  placeholder="Who this applies to, and the spirit of it."
                />
              </label>
              <div className="grid sm:grid-cols-2 gap-4">
                <label className="block">
                  <span className="text-sm font-semibold">Currency</span>
                  <select className="field mt-1.5" value={draft.currency} onChange={(e) => update({ currency: e.target.value })}>
                    {CURRENCIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-semibold">Questions go to</span>
                  <input
                    className="field mt-1.5"
                    value={draft.contact}
                    onChange={(e) => update({ contact: e.target.value })}
                    placeholder="Priya (finance@acme.com)"
                  />
                </label>
              </div>
              <button className="text-sm text-bad hover:underline" onClick={remove}>
                Delete this policy
              </button>
            </div>
            <div className="space-y-6">
              <div className="bg-white rounded-xl border border-line p-6">
                <h3 className="font-semibold">Employee link</h3>
                {policy.version > 0 ? (
                  <>
                    <p className="text-sm text-mute mt-1">Share it in Slack, your handbook or your onboarding docs.</p>
                    <div className="mt-3 flex gap-2">
                      <input className="field text-sm" readOnly value={publicUrl} onFocus={(e) => e.target.select()} />
                      <CopyButton text={publicUrl} />
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-mute mt-1">You’ll get a link to share once you publish.</p>
                )}
              </div>
              <div className="bg-white rounded-xl border border-line p-6">
                <h3 className="font-semibold">Version history</h3>
                {policy.versions.length === 0 ? (
                  <p className="text-sm text-mute mt-1">Not published yet.</p>
                ) : (
                  <ul className="mt-3 space-y-3">
                    {policy.versions.map((v) => (
                      <li key={v.version} className="text-sm flex gap-3">
                        <span className="font-bold tnum w-8">v{v.version}</span>
                        <span className="flex-1">
                          {v.change_note || <span className="text-mute">No note</span>}
                          <span className="block text-mute text-xs">
                            {timeAgo(v.published_at)} {v.published_via === "claude" ? "· published from Claude" : ""}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}
        {tab === "activity" && <ActivityTab policyId={policy.id} version={policy.version} currency={policy.currency} />}
      </div>
    </AppShell>
  );
}

function num(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function RulesTab({ rules, currency, onChange }: { rules: Rule[]; currency: string; onChange: (r: Rule[]) => void }) {
  const set = (i: number, patch: Partial<Rule>) => onChange(rules.map((r, j) => (i === j ? { ...r, ...patch } : r)));
  const add = () =>
    onChange([
      ...rules,
      { id: rid(), category: "", allowed: true, limit: null, unit: "per expense", approval_above: null, approver: "", receipt_above: null, notes: "" },
    ]);
  const del = (i: number) => onChange(rules.filter((_, j) => j !== i));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= rules.length) return;
    const next = [...rules];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {rules.length === 0 && (
        <p className="text-mute bg-white rounded-xl border border-dashed border-line p-6">
          No rules yet. Add a category below, or ask Claude to write them.
        </p>
      )}
      {rules.map((r, i) => (
        <div key={r.id} className={`bg-white rounded-xl border border-line p-4 ${!r.allowed ? "border-l-4 border-l-bad" : ""}`}>
          <div className="flex flex-wrap items-center gap-3">
            <input
              aria-label="Category"
              className="field-quiet font-semibold text-lg flex-1 min-w-[200px] -ml-2"
              value={r.category}
              placeholder="Category, e.g. Meals"
              onChange={(e) => set(i, { category: e.target.value })}
            />
            <div className="flex rounded-lg border border-line overflow-hidden text-sm" role="group" aria-label="Reimbursable?">
              <button
                className={`px-3 py-1.5 font-medium ${r.allowed ? "bg-ok-wash text-ok" : "text-mute hover:text-ink"}`}
                onClick={() => set(i, { allowed: true })}
              >
                Reimbursable
              </button>
              <button
                className={`px-3 py-1.5 font-medium border-l border-line ${!r.allowed ? "bg-bad-wash text-bad" : "text-mute hover:text-ink"}`}
                onClick={() => set(i, { allowed: false })}
              >
                Never
              </button>
            </div>
            <div className="flex items-center text-mute">
              <button className="btn btn-text px-1.5" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}>
                ↑
              </button>
              <button className="btn btn-text px-1.5" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === rules.length - 1}>
                ↓
              </button>
              <button className="btn btn-text px-1.5 hover:text-bad" aria-label="Delete rule" onClick={() => del(i)}>
                ✕
              </button>
            </div>
          </div>

          {r.allowed && (
            <div className="mt-3 grid grid-cols-2 md:grid-cols-[1fr_1fr_1fr_1.2fr_1fr] gap-3">
              <label className="block">
                <span className="text-xs font-medium text-mute">Limit</span>
                <input
                  className="field mt-1 tnum"
                  inputMode="decimal"
                  placeholder="No cap"
                  value={r.limit ?? ""}
                  onChange={(e) => set(i, { limit: num(e.target.value) })}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-mute">Applies</span>
                <select className="field mt-1" value={r.unit} onChange={(e) => set(i, { unit: e.target.value })}>
                  {[...new Set([r.unit, ...UNITS])].map((u) => (
                    <option key={u}>{u}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-mute">Approval above</span>
                <input
                  className="field mt-1 tnum"
                  inputMode="decimal"
                  placeholder="Not needed"
                  value={r.approval_above ?? ""}
                  onChange={(e) => set(i, { approval_above: num(e.target.value) })}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-mute">Approved by</span>
                <input
                  className="field mt-1"
                  placeholder="Reporting manager"
                  value={r.approver}
                  onChange={(e) => set(i, { approver: e.target.value })}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-mute">Receipt above</span>
                <input
                  className="field mt-1 tnum"
                  inputMode="decimal"
                  placeholder="Not needed"
                  value={r.receipt_above ?? ""}
                  onChange={(e) => set(i, { receipt_above: num(e.target.value) })}
                />
              </label>
            </div>
          )}
          <input
            className="field-quiet mt-2 text-sm text-ink-soft -ml-2"
            placeholder="Add a note employees will see"
            value={r.notes}
            onChange={(e) => set(i, { notes: e.target.value })}
          />
          <p className="mt-1 text-xs text-mute">Employees see: {ruleTerms(r, currency).join(" · ")}</p>
        </div>
      ))}
      <button className="btn btn-ghost" onClick={add}>
        Add a category
      </button>
    </div>
  );
}

function SectionsTab({ sections, onChange }: { sections: Section[]; onChange: (s: Section[]) => void }) {
  const set = (i: number, patch: Partial<Section>) => onChange(sections.map((s, j) => (i === j ? { ...s, ...patch } : s)));
  return (
    <div className="space-y-4 max-w-3xl">
      <p className="text-sm text-mute">
        Use sections for anything that isn’t a limit: how to claim, deadlines, exceptions. Start a line with “- ” to make a
        bullet.
      </p>
      {sections.map((s, i) => (
        <div key={s.id} className="bg-white rounded-xl border border-line p-4">
          <div className="flex items-center gap-2">
            <input
              className="field-quiet font-semibold text-lg flex-1 -ml-2"
              value={s.heading}
              placeholder="Heading"
              onChange={(e) => set(i, { heading: e.target.value })}
            />
            <button className="btn btn-text hover:text-bad" aria-label="Delete section" onClick={() => onChange(sections.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
          <textarea
            className="field mt-2 min-h-32 text-sm leading-relaxed"
            value={s.body}
            onChange={(e) => set(i, { body: e.target.value })}
          />
        </div>
      ))}
      <button className="btn btn-ghost" onClick={() => onChange([...sections, { id: rid(), heading: "", body: "" }])}>
        Add a section
      </button>
      {sections.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-mute">Preview</summary>
          <div className="mt-3 space-y-5 bg-white rounded-xl border border-line p-6">
            {sections.map((s) => (
              <div key={s.id}>
                <h3 className="font-bold mb-1.5">{s.heading}</h3>
                <Prose text={s.body} />
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

type Activity = {
  acknowledgements: { name: string; email: string; version: number; created_at: string }[];
  recent_checks: { category: string; amount: number; verdict: keyof typeof verdictStyle; source: string; created_at: string }[];
  checks_by_category: { category: string; total: number; allowed: number; needs_approval: number; over_limit: number; not_allowed: number; avg_amount: number }[];
  uncovered_questions: { category: string; total: number; avg_amount: number }[];
};

function ActivityTab({ policyId, version, currency }: { policyId: string; version: number; currency: string }) {
  const [a, setA] = useState<Activity | null>(null);
  useEffect(() => {
    const load = () => api<Activity>(`/api/policies/${policyId}/activity`).then(setA).catch(() => {});
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [policyId]);
  if (!a) return <div className="h-40 rounded-xl bg-white/60 animate-pulse" />;

  const current = a.acknowledgements.filter((x) => x.version === version);
  const people = new Map<string, (typeof a.acknowledgements)[number]>();
  a.acknowledgements.forEach((x) => {
    const prev = people.get(x.email);
    if (!prev || x.version > prev.version) people.set(x.email, x);
  });

  return (
    <div className="grid lg:grid-cols-2 gap-6 items-start">
      <div className="bg-white rounded-xl border border-line p-6">
        <div className="flex items-baseline justify-between">
          <h3 className="font-semibold">Who has read it</h3>
          <span className="text-sm text-mute tnum">
            {current.length} on v{version || "–"}
          </span>
        </div>
        {people.size === 0 ? (
          <p className="text-sm text-mute mt-3">
            Nobody yet. Employees acknowledge the policy at the bottom of the employee page.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {[...people.values()].map((p) => (
              <li key={p.email} className="py-2.5 flex items-center gap-3 text-sm">
                <span className="flex-1">
                  <span className="font-medium">{p.name}</span>
                  <span className="block text-mute text-xs">{p.email}</span>
                </span>
                {p.version === version ? (
                  <span className="text-xs font-semibold text-ok">Read v{p.version}</span>
                ) : (
                  <span className="text-xs font-semibold text-warn">Only read v{p.version}</span>
                )}
                <span className="text-xs text-mute w-20 text-right">{timeAgo(p.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-6">
        <div className="bg-white rounded-xl border border-line p-6">
          <h3 className="font-semibold">What employees check</h3>
          {a.checks_by_category.length === 0 ? (
            <p className="text-sm text-mute mt-3">No checks yet.</p>
          ) : (
            <table className="w-full text-sm mt-3">
              <thead>
                <tr className="text-left text-mute text-xs">
                  <th className="font-medium py-1">Category</th>
                  <th className="font-medium py-1 text-right">Checks</th>
                  <th className="font-medium py-1 text-right">Blocked or capped</th>
                  <th className="font-medium py-1 text-right">Avg amount</th>
                </tr>
              </thead>
              <tbody>
                {a.checks_by_category.map((c) => (
                  <tr key={c.category} className="border-t border-line">
                    <td className="py-2">{c.category}</td>
                    <td className="py-2 text-right tnum">{c.total}</td>
                    <td className="py-2 text-right tnum">{c.over_limit + c.not_allowed + c.needs_approval}</td>
                    <td className="py-2 text-right tnum">{money(c.avg_amount, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {a.uncovered_questions.length > 0 && (
          <div className="bg-white rounded-xl border border-line p-6">
            <h3 className="font-semibold">Not in the policy yet</h3>
            <p className="text-sm text-mute">Employees asked about these. Consider adding them.</p>
            <ul className="mt-3 space-y-1.5 text-sm">
              {a.uncovered_questions.map((u) => (
                <li key={u.category} className="flex justify-between">
                  <span>{u.category}</span>
                  <span className="text-mute tnum">
                    {u.total}× · avg {money(u.avg_amount, currency)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {a.recent_checks.length > 0 && (
          <div className="bg-white rounded-xl border border-line p-6">
            <h3 className="font-semibold">Latest checks</h3>
            <ul className="mt-3 space-y-2 text-sm">
              {a.recent_checks.slice(0, 8).map((c, i) => (
                <li key={i} className="flex items-center gap-3">
                  <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${verdictStyle[c.verdict].bg} ${verdictStyle[c.verdict].fg}`}>
                    {verdictStyle[c.verdict].stamp}
                  </span>
                  <span className="flex-1">
                    {c.category} · <span className="tnum">{money(c.amount, currency)}</span>
                  </span>
                  <span className="text-xs text-mute">
                    {c.source === "claude" ? "Claude, " : ""}
                    {timeAgo(c.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
