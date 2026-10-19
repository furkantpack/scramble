import { PGlite } from "@electric-sql/pglite";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/proposals/202610100001_canonical_profile_owner_enforcement.sql", "utf8");

const workspaceId = "00000000-0000-4000-8000-000000000001";
const ownerId = "00000000-0000-4000-8000-000000000002";
const nextOwnerId = "00000000-0000-4000-8000-000000000003";
const memberId = "00000000-0000-4000-8000-000000000004";

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select jsonb_build_object('role', coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), ''))
    $$;
    create table public.workspace_members(
      id uuid primary key,
      workspace_id uuid not null,
      user_id uuid not null,
      role text not null
    );
    create table public.companies(
      id uuid primary key,
      workspace_id uuid not null,
      name text not null,
      canonical_profile jsonb,
      profile_confirmed_at timestamptz,
      profile_confirmed_by uuid references auth.users(id)
    );
    alter table public.workspace_members enable row level security;
    alter table public.companies enable row level security;
    insert into auth.users(id) values
      ('${ownerId}'), ('${nextOwnerId}'), ('${memberId}');
    insert into public.workspace_members(id, workspace_id, user_id, role) values
      ('10000000-0000-4000-8000-000000000001', '${workspaceId}', '${ownerId}', 'owner'),
      ('10000000-0000-4000-8000-000000000002', '${workspaceId}', '${nextOwnerId}', 'member'),
      ('10000000-0000-4000-8000-000000000003', '${workspaceId}', '${memberId}', 'member');
    -- Legacy partial state predates the enforcement migration.
    insert into public.companies(id, workspace_id, name, canonical_profile) values
      ('20000000-0000-4000-8000-000000000001', '${workspaceId}', 'Legacy', '{"legacy":true}');
  `);
  await db.exec(migration);
  return db;
}

async function authenticate(db: PGlite, userId: string | null, role = "authenticated") {
  await db.exec(`set request.jwt.claim.sub = '${userId ?? ""}'`);
  await db.exec(`set request.jwt.claim.role = '${role}'`);
}

test("unconfirmed onboarding inserts remain valid while confirmed inserts require an owner", async () => {
  const db = await fixture();
  try {
    await authenticate(db, memberId);
    await db.exec(`insert into public.companies(id, workspace_id, name)
      values ('20000000-0000-4000-8000-000000000002', '${workspaceId}', 'Onboarding')`);
    await assert.rejects(
      db.exec(`insert into public.companies(
        id, workspace_id, name, canonical_profile, profile_confirmed_at, profile_confirmed_by
      ) values (
        '20000000-0000-4000-8000-000000000003', '${workspaceId}', 'Forged', '{}', now(), '${memberId}'
      )`),
      /canonical_profile_owner_required/,
    );

    await authenticate(db, ownerId);
    await db.exec(`insert into public.companies(
      id, workspace_id, name, canonical_profile, profile_confirmed_at, profile_confirmed_by
    ) values (
      '20000000-0000-4000-8000-000000000004', '${workspaceId}', 'Confirmed', '{}', now(), '${ownerId}'
    )`);
  } finally {
    await db.close();
  }
});

test("confirmation states reject partial NULL combinations, including for service_role", async () => {
  const db = await fixture();
  try {
    await authenticate(db, ownerId);
    await assert.rejects(
      db.exec(`insert into public.companies(id, workspace_id, name, canonical_profile)
        values ('20000000-0000-4000-8000-000000000005', '${workspaceId}', 'Partial', '{}')`),
      /canonical_profile_confirmation_state_invalid/,
    );

    await authenticate(db, null, "service_role");
    await assert.rejects(
      db.exec(`insert into public.companies(id, workspace_id, name, canonical_profile, profile_confirmed_at)
        values ('20000000-0000-4000-8000-000000000006', '${workspaceId}', 'Partial service', '{}', now())`),
      /canonical_profile_confirmation_state_invalid/,
    );
  } finally {
    await db.close();
  }
});

test("a newly assigned owner can edit and reconfirm a historic owner's profile", async () => {
  const db = await fixture();
  try {
    await authenticate(db, ownerId);
    await db.exec(`update public.companies set canonical_profile='{"version":1}',
      profile_confirmed_at=now(), profile_confirmed_by='${ownerId}'
      where id='20000000-0000-4000-8000-000000000001'`);
    await db.exec(`update public.workspace_members set role='member' where user_id='${ownerId}';
      update public.workspace_members set role='owner' where user_id='${nextOwnerId}'`);

    await authenticate(db, nextOwnerId);
    await assert.rejects(
      db.exec(`update public.companies set canonical_profile='{"version":2}'
        where id='20000000-0000-4000-8000-000000000001'`),
      /canonical_profile_confirmer_mismatch/,
    );
    await db.exec(`update public.companies set canonical_profile='{"version":2}',
      profile_confirmed_at=now(), profile_confirmed_by='${nextOwnerId}'
      where id='20000000-0000-4000-8000-000000000001'`);
    const result = await db.query<{ profile_confirmed_by: string }>(
      "select profile_confirmed_by from public.companies where id='20000000-0000-4000-8000-000000000001'",
    );
    assert.equal(result.rows[0].profile_confirmed_by, nextOwnerId);
  } finally {
    await db.close();
  }
});

test("non-owners cannot make material protected changes but repeated no-op updates are harmless", async () => {
  const db = await fixture();
  try {
    await authenticate(db, ownerId);
    await db.exec(`update public.companies set canonical_profile='{"version":1}',
      profile_confirmed_at=now(), profile_confirmed_by='${ownerId}'
      where id='20000000-0000-4000-8000-000000000001'`);

    await authenticate(db, memberId);
    await db.exec(`update public.companies set canonical_profile=canonical_profile
      where id='20000000-0000-4000-8000-000000000001'`);
    await assert.rejects(
      db.exec(`update public.companies set canonical_profile='{"version":2}',
        profile_confirmed_at=now(), profile_confirmed_by='${memberId}'
        where id='20000000-0000-4000-8000-000000000001'`),
      /canonical_profile_owner_required/,
    );
  } finally {
    await db.close();
  }
});

test("owners can unconfirm atomically and legacy rows remain ordinarily editable until repaired", async () => {
  const db = await fixture();
  try {
    await authenticate(db, memberId);
    await db.exec(`update public.companies set name='Legacy renamed'
      where id='20000000-0000-4000-8000-000000000001'`);
    await assert.rejects(
      db.exec(`update public.companies set profile_confirmed_at=now()
        where id='20000000-0000-4000-8000-000000000001'`),
      /canonical_profile_confirmation_state_invalid/,
    );

    await authenticate(db, ownerId);
    await db.exec(`update public.companies set canonical_profile='{"repaired":true}',
      profile_confirmed_at=now(), profile_confirmed_by='${ownerId}'
      where id='20000000-0000-4000-8000-000000000001'`);
    await db.exec(`update public.companies set canonical_profile=null,
      profile_confirmed_at=null, profile_confirmed_by=null
      where id='20000000-0000-4000-8000-000000000001'`);
    const result = await db.query<{ canonical_profile: unknown }>(
      "select canonical_profile from public.companies where id='20000000-0000-4000-8000-000000000001'",
    );
    assert.equal(result.rows[0].canonical_profile, null);
  } finally {
    await db.close();
  }
});

test("service_role bypasses ownership but not state consistency and the migration is rerunnable", async () => {
  const db = await fixture();
  try {
    await db.exec(migration);
    await authenticate(db, null, "service_role");
    await db.exec(`update public.companies set canonical_profile='{"service":true}',
      profile_confirmed_at=now(), profile_confirmed_by='${ownerId}'
      where id='20000000-0000-4000-8000-000000000001'`);
    const result = await db.query<{ canonical_profile: { service: boolean } }>(
      "select canonical_profile from public.companies where id='20000000-0000-4000-8000-000000000001'",
    );
    assert.deepEqual(result.rows[0].canonical_profile, { service: true });
  } finally {
    await db.close();
  }
});
