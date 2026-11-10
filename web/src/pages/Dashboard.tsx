import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, timeAgo, type PolicyListItem } from "../api";
import { AppShell, ClaudeMark, CopyButton, StatusPill, useMe } from "../ui";

export const EXAMPLE_PROMPT = `Use Expensable to create our travel & expense policy. We're a 40-person startup in Bangalore. Meals up to ₹1,500 a day when travelling, hotels up to ₹6,000 a night (my approval above ₹4,500), economy flights only and anything above ₹15,000 needs my approval. Cabs up to ₹800 a trip. No alcohol, ever. Receipts for anything above ₹500. Claims within 30 days. Questions go to Priya in finance.`;

export default function Dashboard() {
  const me = useMe();
  const nav = useNavigate();
  const [rows, setRows] = useState<PolicyListItem[] | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const known = useRef<Set<string> | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<PolicyListItem[]>("/api/policies")
        .then((r) => {
          if (!alive) return;
          if (known.current) {
            const added = r.filter((p) => !known.current!.has(p.id)).map((p) => p.id);
            if (added.length) setFresh(new Set(added));
          }
          known.current = new Set(r.map((p) => p.id));
          setRows(r);
        })
        .catch(() => {});
    load();
    // Keep the list live, so a policy Claude creates shows up without a refresh.
    const t = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const newBlank = async () => {
    const p = await api<{ id: string }>("/api/policies", { body: { title: "Untitled expense policy" } });
    nav(`/app/policies/${p.id}`);
  };

  return (
    <AppShell me={me}>
      <div className="flex flex-wrap items-end gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Policies</h1>
          <p className="text-mute mt-1">Policies Claude writes for you show up here, ready to review.</p>
        </div>
        <button className="btn btn-ghost ml-auto" onClick={newBlank}>
          Start a blank policy
        </button>
      </div>

      {rows === null ? (
        <div className="h-40 rounded-xl bg-white/60 animate-pulse" />
      ) : rows.length === 0 ? (
        <Empty mcpUrl={me?.mcp_url} />
      ) : (
        <div className="bg-white rounded-xl border border-line overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-mute border-b border-line">
                <th className="font-medium px-5 py-3">Policy</th>
                <th className="font-medium px-3 py-3">Status</th>
                <th className="font-medium px-3 py-3 text-right">Rules</th>
                <th className="font-medium px-3 py-3 text-right" title="People who acknowledged the live version">
                  Read by
                </th>
                <th className="font-medium px-3 py-3 text-right" title="Expense checks by employees">
                  Checks
                </th>
                <th className="font-medium px-3 py-3">Updated</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className={`border-b border-line last:border-0 hover:bg-paper/60 ${fresh.has(p.id) ? "flash" : ""}`}>
                  <td className="px-5 py-3.5">
                    <Link to={`/app/policies/${p.id}`} className="font-semibold text-ink hover:text-cobalt">
                      {p.title}
                    </Link>
                    <div className="mt-0.5 flex items-center gap-2">{p.created_via === "claude" && <ClaudeMark />}</div>
                  </td>
                  <td className="px-3 py-3.5">
                    <StatusPill version={p.version} dirty={p.draft_dirty} />
                  </td>
                  <td className="px-3 py-3.5 text-right tnum">{p.rule_count}</td>
                  <td className="px-3 py-3.5 text-right tnum">{p.version ? p.acks_current : "–"}</td>
                  <td className="px-3 py-3.5 text-right tnum">{p.checks_total}</td>
                  <td className="px-3 py-3.5 text-mute whitespace-nowrap">{timeAgo(p.updated_at)}</td>
                  <td className="px-5 py-3.5 text-right whitespace-nowrap">
                    {p.version > 0 && (
                      <a href={`/p/${p.slug}`} target="_blank" rel="noreferrer" className="text-ink-soft hover:text-cobalt mr-4">
                        Employee page
                      </a>
                    )}
                    <Link to={`/app/policies/${p.id}`} className="font-semibold text-cobalt">
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}

function Empty({ mcpUrl }: { mcpUrl?: string }) {
  return (
    <div className="bg-white rounded-xl border border-line p-8 grid md:grid-cols-[1fr_1.1fr] gap-8">
      <div>
        <h2 className="text-xl font-bold">Write your first policy with Claude</h2>
        <p className="text-ink-soft mt-2 leading-relaxed">
          Connect Claude once, then describe your rules in your own words. The policy appears on this page while you
          watch.
        </p>
        <Link to="/app/connect" className="btn btn-primary mt-5">
          Connect Claude
        </Link>
        {mcpUrl && <p className="text-xs text-mute mt-3">Takes about a minute. You only do it once.</p>}
      </div>
      <div className="rounded-lg bg-paper p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold">Then try this in Claude</span>
          <CopyButton text={EXAMPLE_PROMPT} className="btn btn-text text-sm" />
        </div>
        <p className="text-sm text-ink-soft leading-relaxed">{EXAMPLE_PROMPT}</p>
      </div>
    </div>
  );
}
