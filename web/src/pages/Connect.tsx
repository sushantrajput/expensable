import { useState } from "react";
import { api } from "../api";
import { AppShell, CopyButton, useMe } from "../ui";
import { EXAMPLE_PROMPT } from "./Dashboard";

const PROMPTS = [
  EXAMPLE_PROMPT,
  "Raise the hotel limit in our expense policy to ₹7,000 a night and publish it with a note.",
  "Is a ₹2,400 team lunch OK under our policy?",
  "What are people asking about in our expense policy, and is there anything it doesn’t cover? Suggest changes.",
];

export default function Connect() {
  const me = useMe();
  const [url, setUrl] = useState<string | null>(null);
  const mcpUrl = url || me?.mcp_url || "";

  const rotate = async () => {
    if (!confirm("Create a new link? Claude will stop working with the old link until you update the connector.")) return;
    const r = await api<{ mcp_url: string }>("/api/workspace/rotate-key", { method: "POST" });
    setUrl(r.mcp_url);
  };

  return (
    <AppShell me={me}>
      <div className="max-w-3xl">
        <h1 className="text-3xl font-extrabold tracking-tight">Connect Claude</h1>
        <p className="text-mute mt-1">
          Expensable plugs into your own Claude. Claude does the writing, and Expensable saves and hosts the result.
        </p>

        <div className="mt-8 bg-white rounded-xl border border-line p-6">
          <label className="text-sm font-semibold" htmlFor="mcp">
            Your private connector link
          </label>
          <div className="mt-2 flex gap-2">
            <input id="mcp" className="field font-mono text-sm" readOnly value={mcpUrl} onFocus={(e) => e.target.select()} />
            <CopyButton text={mcpUrl} className="btn btn-primary" />
          </div>
          <p className="text-xs text-mute mt-2">
            Anyone with this link can edit your policies through Claude, so keep it private.{" "}
            <button className="underline hover:text-ink" onClick={rotate}>
              Create a new link
            </button>
          </p>
        </div>

        <h2 className="text-lg font-bold mt-10 mb-3">Add it to Claude</h2>
        <ol className="space-y-3">
          {[
            <>
              In Claude (web or desktop), open <b>Settings → Connectors</b> and choose <b>Add custom connector</b>.
            </>,
            <>
              Name it <b>Expensable</b>, paste the link above into <b>Remote MCP server URL</b>, then click <b>Add</b>.
            </>,
            <>
              In a new chat, open the tools menu and check that <b>Expensable</b> is turned on.
            </>,
            <>Ask for a policy in plain words. It appears in Policies, ready for you to review and publish.</>,
          ].map((step, i) => (
            <li key={i} className="flex gap-4 bg-white rounded-lg border border-line px-4 py-3">
              <span className="w-6 h-6 shrink-0 rounded-full bg-cobalt-wash text-cobalt text-sm font-bold grid place-items-center">
                {i + 1}
              </span>
              <span className="text-ink-soft">{step}</span>
            </li>
          ))}
        </ol>

        <details className="mt-4 text-sm text-ink-soft">
          <summary className="cursor-pointer font-medium text-ink">Using Claude Code instead?</summary>
          <div className="mt-2 flex gap-2">
            <input className="field font-mono text-xs" readOnly value={`claude mcp add --transport http expensable ${mcpUrl}`} />
            <CopyButton text={`claude mcp add --transport http expensable ${mcpUrl}`} />
          </div>
        </details>

        <h2 className="text-lg font-bold mt-10 mb-3">Things to ask Claude</h2>
        <ul className="space-y-2">
          {PROMPTS.map((p) => (
            <li key={p} className="flex items-start gap-3 bg-white rounded-lg border border-line px-4 py-3">
              <p className="text-sm text-ink-soft leading-relaxed flex-1">{p}</p>
              <CopyButton text={p} className="btn btn-text text-sm -my-1" />
            </li>
          ))}
        </ul>
      </div>
    </AppShell>
  );
}
