-- OAuth 2.1 provider and JWKS tables, for the MCP endpoint.
--
-- Every table and column below is derived from the plugins' own schema
-- (`getSchema` over `jwt()` and `mcp()` from better-auth 1.7.2), not written
-- by hand. `@better-auth/cli generate` cannot produce these: its latest
-- release is 1.4.x and knows nothing about the OAuth provider plugin, which
-- is why 0001's "regenerate with the CLI" note does not extend here.
--
-- `src/server/authSchema.test.ts` checks this file against that same schema on
-- every test run, so a library upgrade that adds a column fails there rather
-- than at runtime in production. Regenerate rather than editing by hand.

create table "jwks" (
  "id" text not null primary key,
  "publicKey" text not null,
  "privateKey" text not null,
  "createdAt" date not null,
  "expiresAt" date,
  "alg" text,
  "crv" text
);

create table "oauthClient" (
  "id" text not null primary key,
  "clientId" text not null unique,
  "clientSecret" text,
  "clientDiscoveryId" text,
  "disabled" integer,
  "skipConsent" integer,
  "enableEndSession" integer,
  "subjectType" text,
  "scopes" text,
  "clientCredentialsScopes" text,
  "userId" text references "user" ("id"),
  "createdAt" date,
  "updatedAt" date,
  "name" text,
  "uri" text,
  "icon" text,
  "contacts" text,
  "tos" text,
  "policy" text,
  "softwareId" text,
  "softwareVersion" text,
  "softwareStatement" text,
  "redirectUris" text not null,
  "postLogoutRedirectUris" text,
  "backchannelLogoutUri" text,
  "backchannelLogoutSessionRequired" integer,
  "tokenEndpointAuthMethod" text,
  "applicationType" text,
  "jwks" text,
  "jwksUri" text,
  "grantTypes" text,
  "responseTypes" text,
  "requirePKCE" integer,
  "dpopBoundAccessTokens" integer,
  "referenceId" text,
  "metadata" text
);

create table "oauthResource" (
  "id" text not null primary key,
  "identifier" text not null unique,
  "name" text not null,
  "accessTokenTtl" integer,
  "refreshTokenTtl" integer,
  "signingAlgorithm" text,
  "signingKeyId" text,
  "allowedScopes" text,
  "customClaims" text,
  "dpopBoundAccessTokensRequired" integer,
  "disabled" integer,
  "createdAt" date,
  "updatedAt" date,
  "policyVersion" integer,
  "metadata" text
);

create table "oauthClientResource" (
  "id" text not null primary key,
  "clientId" text not null references "oauthClient" ("clientId") on delete cascade,
  "resourceId" text not null references "oauthResource" ("identifier") on delete cascade,
  "metadata" text,
  "createdAt" date
);

create unique index "oauthClientResource_clientId_resourceId_uidx" on "oauthClientResource" ("clientId", "resourceId");

create table "oauthRefreshToken" (
  "id" text not null primary key,
  "token" text not null unique,
  "clientId" text not null references "oauthClient" ("clientId"),
  "sessionId" text references "session" ("id") on delete set null,
  "userId" text not null references "user" ("id"),
  "referenceId" text,
  "authorizationCodeId" text,
  "resources" text,
  "requestedUserInfoClaims" text,
  "expiresAt" date,
  "createdAt" date,
  "revoked" date,
  "rotatedAt" date,
  "rotationReplayResponse" text,
  "rotationReplayExpiresAt" date,
  "authTime" date,
  "confirmation" text,
  "scopes" text not null
);

create table "oauthAccessToken" (
  "id" text not null primary key,
  "token" text unique,
  "clientId" text not null references "oauthClient" ("clientId"),
  "sessionId" text references "session" ("id") on delete set null,
  "userId" text references "user" ("id"),
  "referenceId" text,
  "authorizationCodeId" text,
  "resources" text,
  "requestedUserInfoClaims" text,
  "refreshId" text references "oauthRefreshToken" ("id"),
  "expiresAt" date,
  "createdAt" date,
  "revoked" date,
  "confirmation" text,
  "scopes" text not null
);

create table "oauthConsent" (
  "id" text not null primary key,
  "clientId" text not null references "oauthClient" ("clientId"),
  "userId" text references "user" ("id"),
  "referenceId" text,
  "resources" text,
  "requestedUserInfoClaims" text,
  "scopes" text not null,
  "createdAt" date,
  "updatedAt" date
);

create table "oauthClientAssertion" (
  "id" text not null primary key,
  "expiresAt" date not null
);

-- Not declared by the plugins, added for the same reason 0001 adds
-- session_userId_idx: consent is looked up by owner on every authorization,
-- and tokens are listed by owner to revoke them.
create index "oauthConsent_userId_idx" on "oauthConsent" ("userId");
create index "oauthAccessToken_userId_idx" on "oauthAccessToken" ("userId");
create index "oauthRefreshToken_userId_idx" on "oauthRefreshToken" ("userId");
