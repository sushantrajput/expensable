import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

const needsSsl =
  process.env.PGSSL === "true" ||
  (/sslmode=require/.test(connectionString) && !/localhost|127\.0\.0\.1|\/tmp/.test(connectionString));

export const pool = new pg.Pool({
  connectionString,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

export async function q<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}

export async function one<T = any>(text: string, params: unknown[] = []): Promise<T | undefined> {
  const rows = await q<T>(text, params);
  return rows[0];
}

export async function migrate() {
  await pool.query(`
    create table if not exists workspaces (
      id uuid primary key,
      name text not null,
      mcp_key text not null unique,
      created_at timestamptz not null default now()
    );

    create table if not exists users (
      id uuid primary key,
      workspace_id uuid not null references workspaces(id) on delete cascade,
      email text not null unique,
      name text not null,
      password_hash text not null,
      created_at timestamptz not null default now()
    );

    create table if not exists sessions (
      token text primary key,
      user_id uuid not null references users(id) on delete cascade,
      created_at timestamptz not null default now()
    );

    -- A policy row holds the working draft. Every publish snapshots it into policy_versions,
    -- and employees only ever see the latest published snapshot.
    create table if not exists policies (
      id uuid primary key,
      workspace_id uuid not null references workspaces(id) on delete cascade,
      slug text not null unique,
      title text not null,
      summary text not null default '',
      currency text not null default 'INR',
      contact text not null default '',
      rules jsonb not null default '[]',
      sections jsonb not null default '[]',
      version int not null default 0,
      draft_dirty boolean not null default true,
      created_via text not null default 'app',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      published_at timestamptz
    );

    create table if not exists policy_versions (
      policy_id uuid not null references policies(id) on delete cascade,
      version int not null,
      snapshot jsonb not null,
      change_note text not null default '',
      published_via text not null default 'app',
      published_at timestamptz not null default now(),
      primary key (policy_id, version)
    );

    create table if not exists acknowledgements (
      id uuid primary key,
      policy_id uuid not null references policies(id) on delete cascade,
      version int not null,
      name text not null,
      email text not null,
      created_at timestamptz not null default now(),
      unique (policy_id, version, email)
    );

    create table if not exists checks (
      id uuid primary key,
      policy_id uuid not null references policies(id) on delete cascade,
      version int not null,
      category text not null,
      amount numeric not null,
      verdict text not null,
      source text not null default 'page',
      created_at timestamptz not null default now()
    );

    create index if not exists checks_policy_idx on checks(policy_id, created_at desc);
    create index if not exists acks_policy_idx on acknowledgements(policy_id, created_at desc);
    create index if not exists policies_ws_idx on policies(workspace_id, updated_at desc);
  `);
}
