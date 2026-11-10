import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { api, ApiError, money, type Me, type Rule, type Verdict } from "./api";

export function Logo({ to = "/" }: { to?: string }) {
  return (
    <Link to={to} className="inline-flex items-center gap-2 font-extrabold text-[1.15rem] tracking-tight text-ink">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="7" fill="#2B3FD6" />
        <path d="M9 17l4.5 4.5L23 11" stroke="white" strokeWidth="3.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Expensable
    </Link>
  );
}

export const verdictStyle: Record<Verdict, { fg: string; bg: string; stamp: string }> = {
  allowed: { fg: "text-ok", bg: "bg-ok-wash", stamp: "Covered" },
  needs_approval: { fg: "text-warn", bg: "bg-warn-wash", stamp: "Ask first" },
  over_limit: { fg: "text-bad", bg: "bg-bad-wash", stamp: "Over limit" },
  not_allowed: { fg: "text-bad", bg: "bg-bad-wash", stamp: "Not covered" },
  not_covered: { fg: "text-unknown", bg: "bg-unknown-wash", stamp: "Ask finance" },
};

export function ruleTerms(r: Rule, currency: string): string[] {
  if (!r.allowed) return ["Not reimbursable"];
  const out: string[] = [];
  out.push(r.limit !== null ? `Up to ${money(r.limit, currency)} ${r.unit}` : "No fixed cap");
  if (r.approval_above !== null)
    out.push(
      r.approval_above === 0
        ? `Always needs approval from ${r.approver || "your manager"}`
        : `Approval from ${r.approver || "your manager"} above ${money(r.approval_above, currency)}`
    );
  if (r.receipt_above !== null)
    out.push(r.receipt_above === 0 ? "Receipt always" : `Receipt above ${money(r.receipt_above, currency)}`);
  return out;
}

export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  const nav = useNavigate();
  useEffect(() => {
    api<Me>("/api/me")
      .then(setMe)
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) nav("/login", { replace: true });
      });
  }, [nav]);
  return me;
}

export function AppShell({ children, me }: { children: ReactNode; me: Me | null }) {
  const nav = useNavigate();
  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" });
    nav("/login");
  };
  const link = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-1.5 rounded-md text-sm font-medium ${isActive ? "bg-white text-ink shadow-[0_0_0_1px_var(--color-line)]" : "text-ink-soft hover:text-ink"}`;
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-paper/90 backdrop-blur sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-5 h-14 flex items-center gap-6">
          <Logo to="/app" />
          <nav className="flex items-center gap-1">
            <NavLink to="/app" end className={link}>
              Policies
            </NavLink>
            <NavLink to="/app/connect" className={link}>
              Connect Claude
            </NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            {me && <span className="text-mute hidden sm:inline">{me.workspace}</span>}
            <button className="btn btn-text text-sm" onClick={logout}>
              Log out
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-5 py-8">{children}</main>
    </div>
  );
}

export function CopyButton({ text, label = "Copy", className = "btn btn-ghost" }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}

export function StatusPill({ version, dirty }: { version: number; dirty: boolean }) {
  if (version === 0)
    return <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full bg-unknown-wash text-unknown">Draft</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full bg-ok-wash text-ok">
      <span className="w-1.5 h-1.5 rounded-full bg-ok" />
      Live v{version}
      {dirty && <span className="text-warn font-semibold">· unpublished edits</span>}
    </span>
  );
}

export function ClaudeMark() {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-cobalt bg-cobalt-wash px-1.5 py-0.5 rounded">
      via Claude
    </span>
  );
}

/** Renders policy section text: keeps line breaks, turns "- " lines into bullets. */
export function Prose({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) {
      blocks.push(
        <ul key={blocks.length} className="list-disc pl-5 space-y-1">
          {list.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      );
      list = [];
    }
  };
  text.split("\n").forEach((line) => {
    const t = line.trim();
    if (/^[-*•]\s+/.test(t)) list.push(t.replace(/^[-*•]\s+/, ""));
    else {
      flush();
      if (t) blocks.push(<p key={blocks.length}>{t}</p>);
    }
  });
  flush();
  return <div className="space-y-2 text-ink-soft leading-relaxed">{blocks}</div>;
}
