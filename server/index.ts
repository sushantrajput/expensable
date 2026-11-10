import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { migrate, one, q } from "./db.js";
import {
  createAccount,
  createSession,
  newMcpKey,
  requireUser,
  verifyPassword,
  workspaceFromMcpKey,
  type AuthedUser,
} from "./auth.js";
import {
  addAck,
  checkExpense,
  createPolicy,
  deletePolicy,
  getActivity,
  getPolicy,
  getPublished,
  getVersions,
  listPolicies,
  logCheck,
  publishPolicy,
  updatePolicy,
} from "./policy.js";
import { buildMcpServer } from "./mcp.js";
import { seedDemo } from "./seed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

const baseUrl = (req: express.Request) =>
  (process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");

const userOf = (req: express.Request) => (req as any).user as AuthedUser;

const wrap =
  (fn: (req: express.Request, res: express.Response) => Promise<any>) =>
  (req: express.Request, res: express.Response) =>
    fn(req, res).catch((e) => {
      console.error(e);
      res.status(500).json({ error: "Something went wrong" });
    });

app.get("/health", (_req, res) => res.json({ ok: true }));

// ---------------------------------------------------------------- auth
app.post(
  "/api/auth/signup",
  wrap(async (req, res) => {
    const { name, email, password, company } = req.body || {};
    if (!name || !email || !password || !company) return res.status(400).json({ error: "All fields are required" });
    if (String(password).length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
    if (await one(`select 1 from users where email = $1`, [String(email).toLowerCase()]))
      return res.status(409).json({ error: "That email already has an account. Log in instead." });
    const userId = await createAccount({
      name: String(name).trim(),
      email: String(email).trim(),
      password: String(password),
      company: String(company).trim(),
    });
    await createSession(res, userId);
    res.json({ ok: true });
  })
);

app.post(
  "/api/auth/login",
  wrap(async (req, res) => {
    const { email, password } = req.body || {};
    const u = await one<{ id: string; password_hash: string }>(`select id, password_hash from users where email = $1`, [
      String(email || "").toLowerCase().trim(),
    ]);
    if (!u || !verifyPassword(String(password || ""), u.password_hash))
      return res.status(401).json({ error: "Wrong email or password" });
    await createSession(res, u.id);
    res.json({ ok: true });
  })
);

app.post(
  "/api/auth/logout",
  wrap(async (req, res) => {
    if (req.cookies?.sid) await q(`delete from sessions where token = $1`, [req.cookies.sid]);
    res.clearCookie("sid");
    res.json({ ok: true });
  })
);

app.get(
  "/api/me",
  requireUser,
  wrap(async (req, res) => {
    const u = userOf(req);
    res.json({
      name: u.name,
      email: u.email,
      workspace: u.workspace_name,
      mcp_url: `${baseUrl(req)}/mcp/${u.mcp_key}`,
    });
  })
);

app.post(
  "/api/workspace/rotate-key",
  requireUser,
  wrap(async (req, res) => {
    const u = userOf(req);
    const key = newMcpKey();
    await q(`update workspaces set mcp_key = $2 where id = $1`, [u.workspace_id, key]);
    res.json({ mcp_url: `${baseUrl(req)}/mcp/${key}` });
  })
);

// ---------------------------------------------------------------- policies (finance side)
app.get(
  "/api/policies",
  requireUser,
  wrap(async (req, res) => res.json(await listPolicies(userOf(req).workspace_id)))
);

app.post(
  "/api/policies",
  requireUser,
  wrap(async (req, res) => {
    const p = await createPolicy(userOf(req).workspace_id, req.body || {}, "app");
    res.json(p);
  })
);

app.get(
  "/api/policies/:id",
  requireUser,
  wrap(async (req, res) => {
    const p = await getPolicy(userOf(req).workspace_id, String(req.params.id));
    if (!p) return res.status(404).json({ error: "Not found" });
    res.json({ ...p, versions: await getVersions(p.id) });
  })
);

app.put(
  "/api/policies/:id",
  requireUser,
  wrap(async (req, res) => {
    const p = await updatePolicy(userOf(req).workspace_id, String(req.params.id), req.body || {});
    if (!p) return res.status(404).json({ error: "Not found" });
    res.json({ ...p, versions: await getVersions(p.id) });
  })
);

app.post(
  "/api/policies/:id/publish",
  requireUser,
  wrap(async (req, res) => {
    const p = await publishPolicy(userOf(req).workspace_id, String(req.params.id), String(req.body?.note || ""), "app");
    if (!p) return res.status(404).json({ error: "Not found" });
    res.json({ ...p, versions: await getVersions(p.id) });
  })
);

app.delete(
  "/api/policies/:id",
  requireUser,
  wrap(async (req, res) => {
    await deletePolicy(userOf(req).workspace_id, String(req.params.id));
    res.json({ ok: true });
  })
);

app.get(
  "/api/policies/:id/activity",
  requireUser,
  wrap(async (req, res) => {
    const p = await getPolicy(userOf(req).workspace_id, String(req.params.id));
    if (!p) return res.status(404).json({ error: "Not found" });
    res.json(await getActivity(p.id));
  })
);

// ---------------------------------------------------------------- public (employee side)
app.get(
  "/api/public/:slug",
  wrap(async (req, res) => {
    const pub = await getPublished(String(req.params.slug));
    if (!pub) return res.status(404).json({ error: "This policy isn't published yet." });
    res.json({
      slug: pub.slug,
      version: pub.version,
      published_at: pub.published_at,
      company: pub.workspace_name,
      ...pub.snapshot,
    });
  })
);

app.post(
  "/api/public/:slug/check",
  wrap(async (req, res) => {
    const pub = await getPublished(String(req.params.slug));
    if (!pub) return res.status(404).json({ error: "Not found" });
    const amount = Number(req.body?.amount);
    const category = String(req.body?.category || "").slice(0, 120);
    if (!category || !Number.isFinite(amount) || amount < 0)
      return res.status(400).json({ error: "Pick a category and enter an amount" });
    const result = checkExpense(pub.snapshot, category, amount);
    await logCheck(pub.policy_id, pub.version, result, amount, "page");
    res.json(result);
  })
);

app.post(
  "/api/public/:slug/ack",
  wrap(async (req, res) => {
    const pub = await getPublished(String(req.params.slug));
    if (!pub) return res.status(404).json({ error: "Not found" });
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim();
    if (!name || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Enter your name and work email" });
    await addAck(pub.policy_id, pub.version, name, email);
    res.json({ ok: true, version: pub.version });
  })
);

// ---------------------------------------------------------------- MCP (Claude side)
// Each workspace gets a private MCP URL. Stateless Streamable HTTP: a new server per request.
app.post(
  "/mcp/:key",
  wrap(async (req, res) => {
    const ws = await workspaceFromMcpKey(String(req.params.key));
    if (!ws) {
      return res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unknown Expensable MCP link. Copy your link from Expensable → Connect Claude." },
        id: null,
      });
    }
    const server = buildMcpServer(ws, baseUrl(req));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  })
);

const methodNotAllowed = (_req: express.Request, res: express.Response) =>
  res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
app.get("/mcp/:key", methodNotAllowed);
app.delete("/mcp/:key", methodNotAllowed);

// ---------------------------------------------------------------- web app
const webDir = path.resolve(__dirname, "../web");
if (fs.existsSync(webDir)) {
  app.use(express.static(webDir, { index: false, maxAge: "1h" }));
  app.get(/^(?!\/api|\/mcp).*/, (_req, res) => res.sendFile(path.join(webDir, "index.html")));
}

const port = Number(process.env.PORT || 3000);
migrate()
  .then(seedDemo)
  .then(() => app.listen(port, "0.0.0.0", () => console.log(`Expensable listening on :${port}`)))
  .catch((e) => {
    console.error("Startup failed", e);
    process.exit(1);
  });
