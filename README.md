# Expensable

**The expense policy your team can check.** Finance describes the rules to their own Claude. Expensable turns them into a live policy page where every employee can ask "Can I expense this?" and get the same answer every time. The app also records who has read each version.

There is no AI inside Expensable. Claude does the thinking and writing through MCP. Expensable saves, edits, versions, hosts and answers.

| Claude does | Expensable does |
| --- | --- |
| Turns "meals up to ₹1,500, no alcohol…" (or an old policy PDF) into structured rules | Saves the policy as an editable draft with versions |
| Rewrites limits when asked ("raise hotels to 7k") | Publishes it to a public employee link |
| Reads activity and suggests policy changes | Answers employees' expense checks with a fixed rule engine |
| | Records who acknowledged which version and what people ask about |

## Try it

- **App:** `https://<your-railway-domain>`
- **Demo login:** `demo@expensable.app` / `demo1234`. You can also create your own workspace in about 10 seconds.

## Connect Claude (about a minute)

1. Log in and open **Connect Claude**. Copy your private connector link, which looks like `https://<domain>/mcp/exp_…`.
2. In Claude (web or desktop): **Settings → Connectors → Add custom connector**. Name it `Expensable`, paste the link into **Remote MCP server URL** and click **Add**.
3. In a new chat, check that Expensable is turned on in the tools menu, then ask:

   > Use Expensable to create our travel & expense policy. We're a 40-person startup in Bangalore. Meals up to ₹1,500 a day when travelling, hotels up to ₹6,000 a night (my approval above ₹4,500), economy flights only and anything above ₹15,000 needs my approval. Cabs up to ₹800 a trip. No alcohol, ever. Receipts for anything above ₹500. Claims within 30 days. Questions go to Priya in finance.

4. The policy appears in **Policies** within a few seconds. Edit any limit, publish, then open the employee page.

Claude Code: `claude mcp add --transport http expensable https://<domain>/mcp/exp_…`

### MCP tools

| Tool | What it does |
| --- | --- |
| `create_policy` | Create a policy (rules and sections) as a draft, or publish it straight away |
| `list_policies` / `get_policy` | Read policies, including edits finance made in the app |
| `update_policy` | Replace fields or whole lists in the draft |
| `set_rule` / `remove_rule` | Change one category ("raise meals to ₹2,000") |
| `publish_policy` | Publish the draft as a new version, with a change note |
| `check_expense` | Run the same fixed rule check employees get |
| `get_policy_activity` | See who acknowledged which version, what people ask about and gaps in the policy |

## How it works

- **Stack:** Node + Express + TypeScript, React + Vite + Tailwind, Postgres. One service plus one database.
- **MCP:** Streamable HTTP, stateless, at `POST /mcp/:key`. Each workspace has its own private key, which can be replaced from the Connect page.
- **Drafts vs. versions:** edits (from the app or Claude) change the draft. Publishing snapshots it into `policy_versions`, and employees only see the latest snapshot.
- **Checker** (`server/policy.ts → checkExpense`): `not allowed` → `over limit` → `needs approval` → `allowed`, plus a receipt flag. Free-text questions that match no category are logged as "not covered", so finance (and Claude) can see what the policy is missing.
- **No AI keys anywhere.** `grep -ri "openai\|anthropic" server web` finds nothing.

## Run locally

```bash
npm install
DATABASE_URL=postgres://… npm run dev        # API + MCP on :3000
npx vite                                     # web on :5173 (proxies /api, /mcp)
```

## Deploy on Render

1. Create a free Postgres database on Neon and copy its connection string.
2. In Render, choose **New → Blueprint**, pick this repo and paste the connection string into `DATABASE_URL`. `render.yaml` sets the build, start and health check.
3. Open the Render URL. The demo account is created on first boot. To change it, set `DEMO_EMAIL`, `DEMO_PASSWORD` and `DEMO_MCP_KEY`.
