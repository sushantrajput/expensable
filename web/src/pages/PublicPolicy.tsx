import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { api, money, type CheckResult, type PublicPolicy as P } from "../api";
import { Logo, Prose, ruleTerms, verdictStyle } from "../ui";

const OTHER = "__other__";

function store(key: string, value?: string) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {}
  return null;
}

export default function PublicPolicy() {
  const { slug } = useParams();
  const [p, setP] = useState<P | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    api<P>(`/api/public/${slug}`)
      .then((d) => {
        setP(d);
        document.title = `${d.title} · ${d.company}`;
      })
      .catch(() => setMissing(true));
  }, [slug]);

  if (missing)
    return (
      <div className="min-h-screen grid place-items-center px-6 text-center">
        <div>
          <h1 className="text-2xl font-bold">This policy isn’t published</h1>
          <p className="text-mute mt-2">Check the link with your finance team.</p>
        </div>
      </div>
    );
  if (!p) return <div className="min-h-screen" />;

  const allowed = p.rules.filter((r) => r.allowed);
  const never = p.rules.filter((r) => !r.allowed);
  const published = new Date(p.published_at).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="min-h-screen">
      <header className="border-b border-line">
        <div className="max-w-5xl mx-auto px-5 h-14 flex items-center justify-between text-sm">
          <span className="font-bold">{p.company}</span>
          <a href="#acknowledge" className="text-cobalt font-semibold">
            Acknowledge policy
          </a>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-5">
        <section className="pt-12 pb-10 max-w-3xl">
          <p className="text-mute text-sm">
            Version {p.version}, published {published}
          </p>
          <h1 className="mt-2 text-[2.4rem] sm:text-[3rem] leading-[1.05] font-extrabold tracking-tight">{p.title}</h1>
          {p.summary && <p className="mt-4 text-lg text-ink-soft leading-relaxed">{p.summary}</p>}
        </section>

        <Checker p={p} />

        <section className="py-14 grid md:grid-cols-[200px_1fr] gap-x-10 gap-y-4">
          <h2 className="text-xl font-bold">The rules</h2>
          <div>
            <ul className="divide-y divide-line border-y border-line">
              {allowed.map((r) => (
                <li key={r.id} className="py-4 grid sm:grid-cols-[180px_1fr] gap-x-6 gap-y-1">
                  <span className="font-semibold">{r.category}</span>
                  <span>
                    <span className="text-ink tnum">{ruleTerms(r, p.currency).join(". ")}.</span>
                    {r.notes && <span className="block text-mute text-sm mt-0.5">{r.notes}</span>}
                  </span>
                </li>
              ))}
            </ul>
            {never.length > 0 && (
              <div className="mt-8">
                <h3 className="font-semibold text-bad">Never reimbursed</h3>
                <ul className="mt-2 space-y-2">
                  {never.map((r) => (
                    <li key={r.id} className="flex gap-3">
                      <span className="mt-2 w-1.5 h-1.5 rounded-full bg-bad shrink-0" />
                      <span>
                        <span className="font-semibold">{r.category}</span>
                        {r.notes && <span className="text-mute">. {r.notes}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {p.sections.map((s) => (
            <div key={s.id} className="contents">
              <h2 className="text-xl font-bold mt-8 md:mt-6">{s.heading}</h2>
              <div className="md:mt-6 max-w-2xl">
                <Prose text={s.body} />
              </div>
            </div>
          ))}
        </section>

        <Acknowledge p={p} />
      </main>

      <footer className="border-t border-line mt-16">
        <div className="max-w-5xl mx-auto px-5 py-6 flex flex-wrap gap-4 items-center justify-between text-sm text-mute">
          <span>{p.contact ? `Questions? Ask ${p.contact}.` : "Questions? Ask your finance team."}</span>
          <span className="flex items-center gap-2 [&_a]:text-sm [&_a]:font-semibold [&_a]:text-mute">
            Hosted on <Logo />
          </span>
        </div>
      </footer>
    </div>
  );
}

function Checker({ p }: { p: P }) {
  const [category, setCategory] = useState(p.rules.find((r) => r.allowed)?.id || OTHER);
  const [other, setOther] = useState("");
  const [amount, setAmount] = useState("");
  const [result, setResult] = useState<(CheckResult & { amount: number; at: Date; key: number }) | null>(null);
  const [error, setError] = useState("");
  const rule = p.rules.find((r) => r.id === category);

  const check = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    const amt = Number(amount.replace(/[^0-9.]/g, ""));
    if (!amount || !Number.isFinite(amt)) return setError("Enter an amount.");
    const cat = category === OTHER ? other.trim() : rule!.category;
    if (!cat) return setError("Tell us what the expense is.");
    try {
      const r = await api<CheckResult>(`/api/public/${p.slug}/check`, { body: { category: cat, amount: amt } });
      setResult({ ...r, amount: amt, at: new Date(), key: Date.now() });
    } catch (err: any) {
      setError(err.message);
    }
  };

  const symbol = money(0, p.currency).replace(/[0-9.,\s]/g, "");

  return (
    <section className="grid md:grid-cols-[1.15fr_1fr] gap-8 items-start">
      <form onSubmit={check} className="bg-ink text-white rounded-2xl p-6 sm:p-8">
        <h2 className="text-2xl font-bold">Can I expense this?</h2>
        <p className="text-white/60 mt-1">Check before you spend. You get an answer straight from the policy.</p>

        <label className="block mt-6">
          <span className="text-sm font-medium text-white/80">What is it?</span>
          <select className="field mt-1.5" value={category} onChange={(e) => setCategory(e.target.value)}>
            {p.rules.map((r) => (
              <option key={r.id} value={r.id}>
                {r.category}
              </option>
            ))}
            <option value={OTHER}>Something else…</option>
          </select>
        </label>
        {category === OTHER && (
          <input
            className="field mt-2"
            placeholder="e.g. Co-working day pass"
            value={other}
            onChange={(e) => setOther(e.target.value)}
            aria-label="Describe the expense"
          />
        )}

        <label className="block mt-4">
          <span className="text-sm font-medium text-white/80">
            How much?{rule && rule.unit !== "per expense" ? ` (${rule.unit})` : ""}
          </span>
          <div className="relative mt-1.5">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-mute">{symbol}</span>
            <input
              className="field pl-8 tnum text-lg"
              inputMode="decimal"
              placeholder="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        </label>

        {error && <p className="mt-3 text-sm text-[#ffb4a8]">{error}</p>}
        <button className="btn btn-primary w-full mt-6 py-3 text-base">Check</button>
      </form>

      <div aria-live="polite">
        {result ? (
          <Receipt key={result.key} p={p} r={result} />
        ) : (
          <div className="rounded-2xl border-2 border-dashed border-line p-8 text-center text-mute min-h-64 grid place-items-center">
            <p>
              Pick what you’re spending on and how much.
              <br />
              Your answer appears here.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function Receipt({ p, r }: { p: P; r: CheckResult & { amount: number; at: Date } }) {
  const v = verdictStyle[r.verdict];
  const unit = r.verdict !== "not_covered" ? p.rules.find((x) => x.category === r.category)?.unit : undefined;
  const Row = ({ k, val }: { k: string; val: string }) => (
    <div className="flex gap-2 text-[0.95rem]">
      <span>{k}</span>
      <span className="flex-1 border-b border-dotted border-[#bdbdbd] translate-y-[-5px]" />
      <span className="tnum text-right">{val}</span>
    </div>
  );
  return (
    <div className="receipt print-in max-w-sm mx-auto md:mx-0">
      <div className="text-center">
        <div className="font-bold">{p.company}</div>
        <div className="text-sm text-[#666]">Expense check</div>
        <div className="text-xs text-[#888] mt-0.5">
          {r.at.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}{" "}
          {r.at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>
      <hr className="receipt-rule" />
      <div className="space-y-1.5">
        <Row k="Item" val={r.category} />
        <Row k="Amount" val={`${money(r.amount, p.currency)}${unit && unit !== "per expense" ? ` ${unit}` : ""}`} />
        <Row k="Reimbursed" val={money(r.reimbursable_amount, p.currency)} />
        <Row k="Receipt" val={r.verdict === "not_covered" || r.verdict === "not_allowed" ? "n/a" : r.receipt_required ? "Keep it" : "Not needed"} />
      </div>
      <hr className="receipt-rule" />
      <div className="py-3 text-center">
        <span className={`stamp stamp-in ${v.fg}`}>{v.stamp}</span>
      </div>
      <p className="font-sans font-semibold text-ink mt-2">{r.title}</p>
      <p className="font-sans text-ink-soft text-[0.95rem] leading-relaxed mt-1">{r.message}</p>
      <hr className="receipt-rule" />
      <div className="text-center text-xs text-[#888]">Policy v{p.version}</div>
    </div>
  );
}

function Acknowledge({ p }: { p: P }) {
  const key = `ack:${p.slug}`;
  const [done, setDone] = useState<string | null>(() => {
    const v = store(key);
    return v && v.startsWith(`${p.version}:`) ? v.slice(String(p.version).length + 1) : null;
  });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await api(`/api/public/${p.slug}/ack`, { body: { name, email } });
      store(key, `${p.version}:${name}`);
      setDone(name);
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <section id="acknowledge" className="bg-white rounded-2xl border border-line p-6 sm:p-8 scroll-mt-20">
      {done ? (
        <div className="flex items-center gap-4">
          <span className="w-10 h-10 rounded-full bg-ok-wash text-ok grid place-items-center text-xl font-bold">✓</span>
          <div>
            <h2 className="text-xl font-bold">Thanks, {done.split(" ")[0]}.</h2>
            <p className="text-mute">We’ve recorded that you read version {p.version} of this policy.</p>
          </div>
        </div>
      ) : (
        <form onSubmit={submit}>
          <h2 className="text-xl font-bold">I’ve read this policy</h2>
          <p className="text-mute mt-1">
            Finance asks everyone to confirm they’ve read version {p.version}. It takes five seconds.
          </p>
          <div className="mt-5 grid sm:grid-cols-[1fr_1fr_auto] gap-3">
            <input className="field" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required aria-label="Your name" />
            <input
              className="field"
              type="email"
              placeholder="Work email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              aria-label="Work email"
            />
            <button className="btn btn-primary">Confirm I’ve read it</button>
          </div>
          {error && <p className="mt-3 text-sm text-bad">{error}</p>}
        </form>
      )}
    </section>
  );
}
