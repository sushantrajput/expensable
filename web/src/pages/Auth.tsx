import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { Logo } from "../ui";

export default function Auth({ mode }: { mode: "login" | "signup" }) {
  const nav = useNavigate();
  const [form, setForm] = useState({ name: "", company: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/api/auth/${mode}`, { body: form });
      nav("/app");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.1fr_1fr]">
      <section className="bg-ink text-white px-8 py-10 lg:px-14 lg:py-14 flex flex-col">
        <div className="[&_a]:text-white">
          <Logo />
        </div>
        <div className="my-auto py-12 max-w-xl">
          <h1 className="text-[2.6rem] lg:text-[3.4rem] leading-[1.02] font-extrabold tracking-tight">
            “Can I expense this?” answered before anyone asks finance.
          </h1>
          <p className="mt-6 text-lg text-white/75 leading-relaxed max-w-lg">
            Describe your expense policy to Claude in plain words. Expensable turns it into a live page where your team
            checks any expense in seconds, and records who has read each version.
          </p>
          <ol className="mt-10 space-y-4 text-white/85">
            {[
              ["Tell Claude your rules", "“Meals up to ₹1,500 a day, hotels ₹6k a night, no alcohol.”"],
              ["Review and publish", "Change any limit here, then publish to your team’s link."],
              ["Your team checks expenses", "The same answer every time, and finance can see what people ask."],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-4">
                <span className="mt-0.5 w-7 h-7 shrink-0 rounded-full border border-white/30 grid place-items-center text-sm font-semibold">
                  {i + 1}
                </span>
                <span>
                  <span className="font-semibold text-white">{t}</span>
                  <span className="block text-white/60">{d}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
        <p className="text-white/40 text-sm">There’s no AI inside Expensable. Your own Claude does the writing.</p>
      </section>

      <section className="flex items-center justify-center px-6 py-12">
        <form onSubmit={submit} className="w-full max-w-sm">
          <h2 className="text-2xl font-bold tracking-tight">{mode === "login" ? "Log in" : "Create your workspace"}</h2>
          <p className="text-mute mt-1 mb-7">
            {mode === "login" ? (
              <>
                New here?{" "}
                <Link to="/signup" className="text-cobalt font-semibold">
                  Create a workspace
                </Link>
              </>
            ) : (
              <>
                Already have one?{" "}
                <Link to="/login" className="text-cobalt font-semibold">
                  Log in
                </Link>
              </>
            )}
          </p>

          <div className="space-y-4">
            {mode === "signup" && (
              <>
                <label className="block">
                  <span className="text-sm font-medium">Your name</span>
                  <input className="field mt-1" value={form.name} onChange={set("name")} required autoComplete="name" />
                </label>
                <label className="block">
                  <span className="text-sm font-medium">Company</span>
                  <input className="field mt-1" value={form.company} onChange={set("company")} required placeholder="Acme Labs" />
                </label>
              </>
            )}
            <label className="block">
              <span className="text-sm font-medium">Work email</span>
              <input className="field mt-1" type="email" value={form.email} onChange={set("email")} required autoComplete="email" />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Password</span>
              <input
                className="field mt-1"
                type="password"
                value={form.password}
                onChange={set("password")}
                required
                minLength={6}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </label>
          </div>

          {error && <p className="mt-4 text-sm text-bad">{error}</p>}

          <button className="btn btn-primary w-full mt-6 py-2.5" disabled={busy}>
            {busy ? "One moment…" : mode === "login" ? "Log in" : "Create workspace"}
          </button>

          {mode === "login" && (
            <div className="mt-8 rounded-lg border border-dashed border-line p-4 text-sm text-ink-soft">
              Just trying it out? Use the demo workspace.
              <button
                type="button"
                className="block mt-2 text-cobalt font-semibold"
                onClick={() => setForm({ ...form, email: "demo@expensable.app", password: "demo1234" })}
              >
                Fill in the demo login
              </button>
            </div>
          )}
        </form>
      </section>
    </div>
  );
}
