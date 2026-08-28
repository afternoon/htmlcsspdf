-- Add `account.issuer`, which better-auth 1.7.2 queries but its schema
-- generator does not emit.
--
-- The generator and the runtime disagree in this version: `@better-auth/cli
-- generate` produces an account table without `issuer`, while the query layer
-- selects it and maintains a unique index on (issuer, accountId). Signing in
-- therefore failed at the point of linking a Google account, with
-- `D1_ERROR: no such column: account.issuer`.
--
-- Declared with a default rather than NOT NULL: existing rows need a value,
-- and SQLite cannot add a NOT NULL column without one.
alter table "account" add column "issuer" text not null default '';

-- The runtime expects this index to exist. Two accounts from the same issuer
-- cannot share an account id.
create unique index if not exists "account_issuer_accountId_idx"
  on "account" ("issuer", "accountId");
