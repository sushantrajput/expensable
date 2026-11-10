import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { one, q } from "./db.js";

export type AuthedUser = {
  id: string;
  email: string;
  name: string;
  workspace_id: string;
  workspace_name: string;
  mcp_key: string;
};

export function hashPassword(pw: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pw, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(pw: string, stored: string) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const test = scryptSync(pw, salt, 64);
  const known = Buffer.from(hash, "hex");
  return known.length === test.length && timingSafeEqual(known, test);
}

export const newMcpKey = () => `exp_${randomBytes(18).toString("base64url")}`;

export async function createAccount(input: { name: string; email: string; password: string; company: string }) {
  const wsId = randomUUID();
  const userId = randomUUID();
  await q(`insert into workspaces (id, name, mcp_key) values ($1,$2,$3)`, [wsId, input.company, newMcpKey()]);
  await q(`insert into users (id, workspace_id, email, name, password_hash) values ($1,$2,$3,$4,$5)`, [
    userId,
    wsId,
    input.email.toLowerCase(),
    input.name,
    hashPassword(input.password),
  ]);
  return userId;
}

export async function createSession(res: Response, userId: string) {
  const token = randomBytes(32).toString("base64url");
  await q(`insert into sessions (token, user_id) values ($1,$2)`, [token, userId]);
  res.cookie("sid", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 24 * 30,
  });
}

export async function userFromToken(token: string | undefined): Promise<AuthedUser | undefined> {
  if (!token) return undefined;
  return one<AuthedUser>(
    `select u.id, u.email, u.name, u.workspace_id, w.name as workspace_name, w.mcp_key
       from sessions s join users u on u.id = s.user_id join workspaces w on w.id = u.workspace_id
      where s.token = $1 and s.created_at > now() - interval '30 days'`,
    [token]
  );
}

export async function requireUser(req: Request, res: Response, next: NextFunction) {
  const user = await userFromToken(req.cookies?.sid);
  if (!user) return res.status(401).json({ error: "Please log in" });
  (req as any).user = user;
  next();
}

export async function workspaceFromMcpKey(key: string) {
  return one<{ id: string; name: string }>(`select id, name from workspaces where mcp_key = $1`, [key]);
}
