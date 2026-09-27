-- 0004 Identity: local credentials, MFA factors, pending sign-ins, sessions, sign-in
-- throttling, and executive approval areas (Phase 1 slice S3).
-- ADR-0006 (identity, MFA, sessions), ADR-0010 section 6 (packages/auth), ADR-0002 and
-- ADR-0011 (tenancy names), ADR-0008 (audit actions).
--
-- Tenant tables (auth schema): organization_id NOT NULL, ENABLE + FORCE RLS, one policy
-- on app.organization_id without missing_ok, composite foreign keys, no DELETE for
-- app_user. Tokens are never stored: only their SHA-256 (32 bytes).
--
-- Global table: public.approval_area (read-only to app_user).
-- Platform tables: platform.login_directory and platform.auth_throttle. No runtime role
-- reads them; app_user reaches them only through the reviewed SECURITY DEFINER
-- functions auth.resolve_login, auth.throttle_read, auth.throttle_write, auth.throttle_clear.
--
-- "No session without MFA" is also enforced here: auth.session requires a verified,
-- unrevoked factor of the user whose kind matches mfa_method.
--
-- Reversal (development only): DROP SCHEMA auth CASCADE; DROP TABLE platform.auth_throttle,
--   platform.login_directory; DROP FUNCTION platform.sync_login_directory();
--   ALTER TABLE public.role_assignment DROP COLUMN approval_area; DROP TABLE public.approval_area;
--   DELETE FROM audit.action_registry WHERE action IN (the actions below).

-- ---------------------------------------------------------------------------
-- Audit actions (packages/domain AUDIT_ACTIONS)
-- ---------------------------------------------------------------------------

INSERT INTO audit.action_registry (action, category, description) VALUES
  ('session.revoked',  'auth', 'Session revoked (sign-out elsewhere, MFA reset, deprovisioning)'),
  ('session.rotated',  'auth', 'Session token rotated after a privilege change'),
  ('account.locked',   'auth', 'Sign-in temporarily locked after repeated failures'),
  ('access.denied',    'auth', 'Request denied by the authorization policy (read or navigation)'),
  ('access.view',      'auth', 'Record viewed by a role whose every view is logged (auditor)');

-- ---------------------------------------------------------------------------
-- Executive approval areas (GLOBAL reference data). PROPOSED mapping, pending
-- confirmation by the product owner; same values as PROPOSED_APPROVAL_AREAS in
-- @deemed/domain (a db test keeps them in step).
-- ---------------------------------------------------------------------------

CREATE TABLE public.approval_area (
  key             text    NOT NULL PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  modules         text[]  NOT NULL CHECK (cardinality(modules) > 0),
  description_en  text    NOT NULL,
  status          text    NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'confirmed'))
);

INSERT INTO public.approval_area (key, modules, description_en) VALUES
  ('clinical',   ARRAY['providers', 'ftca', 'quality', 'experience', 'learning'], 'Clinical (CMO): credentialing, FTCA and risk, quality, patient experience, training'),
  ('finance',    ARRAY['finance', 'contracts', 'scope'], 'Finance (CFO): finance and grants, contracts, scope of project'),
  ('operations', ARRAY['enrollment', 'screening', 'tasks', 'self-service'], 'Operations (COO): enrollment, screening, workflows'),
  ('governance', ARRAY['governance', 'readiness'], 'Governance (CEO): board matters and HRSA readiness');

GRANT SELECT ON public.approval_area TO app_user;

-- An executive grant names its approval area; other roles never carry one.
ALTER TABLE public.role_assignment
  ADD COLUMN approval_area text REFERENCES public.approval_area (key),
  ADD CONSTRAINT role_assignment_area_executive_only CHECK (approval_area IS NULL OR role_key = 'executive');

-- Same rules as 0001, plus: approval_area is fixed at grant time too.
CREATE OR REPLACE FUNCTION public.role_assignment_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_role public.role;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v_role FROM public.role WHERE key = NEW.role_key;
    IF FOUND AND v_role.requires_expiry THEN
      IF NEW.expires_at IS NULL THEN
        RAISE EXCEPTION 'role % requires an expiry date', NEW.role_key USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.expires_at - NEW.valid_from > v_role.max_duration THEN
        RAISE EXCEPTION 'role % may be granted for at most %', NEW.role_key, v_role.max_duration
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'role_assignment % is revoked and can no longer change', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.user_account_id IS DISTINCT FROM OLD.user_account_id
     OR NEW.role_key IS DISTINCT FROM OLD.role_key
     OR NEW.site_id IS DISTINCT FROM OLD.site_id
     OR NEW.valid_from IS DISTINCT FROM OLD.valid_from
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.grant_reason IS DISTINCT FROM OLD.grant_reason
     OR NEW.approval_area IS DISTINCT FROM OLD.approval_area THEN
    RAISE EXCEPTION 'role_assignment is never edited in place; revoke it and grant a new one'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

-- ---------------------------------------------------------------------------
-- auth schema
-- ---------------------------------------------------------------------------

CREATE SCHEMA auth AUTHORIZATION app_owner;
REVOKE ALL ON SCHEMA auth FROM PUBLIC;
GRANT USAGE ON SCHEMA auth TO app_user;

-- Local account password (ADR-0006 rule 2). Argon2id PHC string only; never plaintext.
CREATE TABLE auth.local_credential (
  id               uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  uuid        NOT NULL REFERENCES public.organization (id),
  user_account_id  uuid        NOT NULL,
  password_hash    text        NOT NULL CHECK (password_hash LIKE '$argon2id$%' AND length(password_hash) BETWEEN 60 AND 300),
  password_set_at  timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid,
  CONSTRAINT local_credential_user_fk FOREIGN KEY (organization_id, user_account_id)
    REFERENCES public.user_account (organization_id, id),
  CONSTRAINT local_credential_user_key UNIQUE (organization_id, user_account_id)
);

CREATE TRIGGER local_credential_row_meta BEFORE INSERT OR UPDATE ON auth.local_credential
  FOR EACH ROW EXECUTE FUNCTION public.set_row_meta();

ALTER TABLE auth.local_credential ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.local_credential FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON auth.local_credential
  USING (organization_id = current_setting('app.organization_id')::uuid)
  WITH CHECK (organization_id = current_setting('app.organization_id')::uuid);

GRANT SELECT, INSERT, UPDATE ON auth.local_credential TO app_user;

-- MFA factors (ADR-0006 rule 3): passkeys (WebAuthn) and TOTP only. No SMS, no email.
CREATE TABLE auth.auth_factor (
  id                      uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id         uuid        NOT NULL REFERENCES public.organization (id),
  user_account_id         uuid        NOT NULL,
  kind                    text        NOT NULL CHECK (kind IN ('totp', 'passkey')),
  label                   text        NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 100),
  -- TOTP: field-encrypted secret (AES-256-GCM envelope) and the last accepted time step (replay guard).
  totp_secret_enc         bytea,
  totp_last_step          bigint,
  -- Passkey: credential id (base64url), COSE public key, signature counter, transports.
  webauthn_credential_id  text,
  webauthn_public_key     bytea,
  webauthn_counter        bigint,
  webauthn_transports     text[],
  verified_at             timestamptz,
  last_used_at            timestamptz,
  revoked_at              timestamptz,
  revoke_reason           text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid,
  CONSTRAINT auth_factor_user_fk FOREIGN KEY (organization_id, user_account_id)
    REFERENCES public.user_account (organization_id, id),
  CONSTRAINT auth_factor_totp_shape CHECK (kind <> 'totp' OR totp_secret_enc IS NOT NULL),
  CONSTRAINT auth_factor_passkey_shape CHECK (
    kind <> 'passkey' OR (webauthn_credential_id IS NOT NULL AND webauthn_public_key IS NOT NULL
                          AND webauthn_counter IS NOT NULL AND verified_at IS NOT NULL)),
  CONSTRAINT auth_factor_revoke_reason CHECK (revoke_reason IS NULL OR revoked_at IS NOT NULL),
  CONSTRAINT auth_factor_org_id_key UNIQUE (organization_id, id),
  CONSTRAINT auth_factor_org_user_id_key UNIQUE (organization_id, user_account_id, id)
);

CREATE UNIQUE INDEX auth_factor_credential_key ON auth.auth_factor (organization_id, webauthn_credential_id)
  WHERE webauthn_credential_id IS NOT NULL;
CREATE INDEX auth_factor_user_idx ON auth.auth_factor (organization_id, user_account_id);

-- Factors are never edited back: verification and revocation are one-way, and the
-- identity of a factor (owner, kind, secret, credential) never changes.
CREATE FUNCTION auth.auth_factor_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'auth_factor % is revoked and can no longer change', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.user_account_id IS DISTINCT FROM OLD.user_account_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.totp_secret_enc IS DISTINCT FROM OLD.totp_secret_enc
     OR NEW.webauthn_credential_id IS DISTINCT FROM OLD.webauthn_credential_id
     OR NEW.webauthn_public_key IS DISTINCT FROM OLD.webauthn_public_key
     OR (OLD.verified_at IS NOT NULL AND NEW.verified_at IS DISTINCT FROM OLD.verified_at)
     OR (OLD.totp_last_step IS NOT NULL AND (NEW.totp_last_step IS NULL OR NEW.totp_last_step < OLD.totp_last_step)) THEN
    RAISE EXCEPTION 'auth_factor identity, verification, and TOTP step are one-way' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER auth_factor_guard BEFORE UPDATE ON auth.auth_factor
  FOR EACH ROW EXECUTE FUNCTION auth.auth_factor_guard();
CREATE TRIGGER auth_factor_row_meta BEFORE INSERT OR UPDATE ON auth.auth_factor
  FOR EACH ROW EXECUTE FUNCTION public.set_row_meta();

ALTER TABLE auth.auth_factor ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.auth_factor FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON auth.auth_factor
  USING (organization_id = current_setting('app.organization_id')::uuid)
  WITH CHECK (organization_id = current_setting('app.organization_id')::uuid);

GRANT SELECT, INSERT, UPDATE ON auth.auth_factor TO app_user;

-- A sign-in between the password and the second factor (10 minutes at most).
CREATE TABLE auth.login_attempt (
  id                    uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id       uuid        NOT NULL REFERENCES public.organization (id),
  user_account_id       uuid        NOT NULL,
  token_hash            bytea       NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  created_at            timestamptz NOT NULL,
  expires_at            timestamptz NOT NULL,
  password_verified_at  timestamptz NOT NULL,
  webauthn_challenge    text,
  failed_mfa_count      integer     NOT NULL DEFAULT 0 CHECK (failed_mfa_count >= 0),
  consumed_at           timestamptz,
  ip_address            inet,
  user_agent            text,
  CONSTRAINT login_attempt_user_fk FOREIGN KEY (organization_id, user_account_id)
    REFERENCES public.user_account (organization_id, id),
  CONSTRAINT login_attempt_window CHECK (expires_at > created_at AND expires_at <= created_at + interval '10 minutes')
);

ALTER TABLE auth.login_attempt ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.login_attempt FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON auth.login_attempt
  USING (organization_id = current_setting('app.organization_id')::uuid)
  WITH CHECK (organization_id = current_setting('app.organization_id')::uuid);

GRANT SELECT, INSERT, UPDATE ON auth.login_attempt TO app_user;

-- Server-side sessions (ADR-0006 rule 4, ADR-0010 section 6): 15-minute idle (tenant may
-- shorten, never lengthen), 12-hour absolute, one tenant per session.
CREATE TABLE auth.session (
  id                    uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id       uuid        NOT NULL REFERENCES public.organization (id),
  user_account_id       uuid        NOT NULL,
  token_hash            bytea       NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  issued_at             timestamptz NOT NULL,
  last_seen_at          timestamptz NOT NULL,
  absolute_expires_at   timestamptz NOT NULL,
  idle_timeout_seconds  integer     NOT NULL DEFAULT 900 CHECK (idle_timeout_seconds BETWEEN 60 AND 900),
  mfa_method            text        NOT NULL CHECK (mfa_method IN ('totp', 'passkey')),
  mfa_factor_id         uuid        NOT NULL,
  mfa_at                timestamptz NOT NULL,
  reauth_at             timestamptz NOT NULL,
  reauth_challenge      text,
  rotate_required       boolean     NOT NULL DEFAULT false,
  rotated_at            timestamptz,
  revoked_at            timestamptz,
  revoke_reason         text        CHECK (revoke_reason IN ('logout', 'idle', 'absolute', 'mfa_reset', 'deprovisioned', 'admin', 'replaced')),
  ip_address            inet,
  user_agent            text,
  CONSTRAINT session_user_fk FOREIGN KEY (organization_id, user_account_id)
    REFERENCES public.user_account (organization_id, id),
  CONSTRAINT session_factor_fk FOREIGN KEY (organization_id, user_account_id, mfa_factor_id)
    REFERENCES auth.auth_factor (organization_id, user_account_id, id),
  CONSTRAINT session_absolute_limit CHECK (absolute_expires_at > issued_at AND absolute_expires_at <= issued_at + interval '12 hours'),
  CONSTRAINT session_revoke_pair CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL))
);

CREATE INDEX session_user_idx ON auth.session (organization_id, user_account_id) WHERE revoked_at IS NULL;

-- No session without a second factor: the factor must be the user's own, verified,
-- not revoked, and of the kind the session claims; the account must be active.
CREATE FUNCTION auth.session_requires_mfa() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  PERFORM 1 FROM auth.auth_factor f
  WHERE f.organization_id = NEW.organization_id AND f.id = NEW.mfa_factor_id
    AND f.user_account_id = NEW.user_account_id AND f.kind = NEW.mfa_method
    AND f.verified_at IS NOT NULL AND f.revoked_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'a session needs a verified, unrevoked second factor of the user (ADR-0006 rule 3)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM 1 FROM public.user_account u
  WHERE u.organization_id = NEW.organization_id AND u.id = NEW.user_account_id
    AND u.status = 'active' AND u.archived_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'a session needs an active user account' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NULL;
END
$$;

-- After insert, only activity, step-up, rotation, and a one-way revoke may change.
CREATE FUNCTION auth.session_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'session % is revoked and can no longer change', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.user_account_id IS DISTINCT FROM OLD.user_account_id
     OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
     OR NEW.absolute_expires_at IS DISTINCT FROM OLD.absolute_expires_at
     OR NEW.idle_timeout_seconds > OLD.idle_timeout_seconds
     OR NEW.mfa_method IS DISTINCT FROM OLD.mfa_method
     OR NEW.mfa_factor_id IS DISTINCT FROM OLD.mfa_factor_id
     OR NEW.mfa_at IS DISTINCT FROM OLD.mfa_at
     OR NEW.last_seen_at < OLD.last_seen_at
     OR NEW.reauth_at < OLD.reauth_at THEN
    RAISE EXCEPTION 'session identity, lifetime, and MFA facts cannot change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

-- AFTER, so the RLS check on the new row runs first (a cross-tenant insert fails on RLS).
CREATE TRIGGER session_requires_mfa AFTER INSERT ON auth.session
  FOR EACH ROW EXECUTE FUNCTION auth.session_requires_mfa();
CREATE TRIGGER session_guard BEFORE UPDATE ON auth.session
  FOR EACH ROW EXECUTE FUNCTION auth.session_guard();

ALTER TABLE auth.session ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.session FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON auth.session
  USING (organization_id = current_setting('app.organization_id')::uuid)
  WITH CHECK (organization_id = current_setting('app.organization_id')::uuid);

GRANT SELECT, INSERT, UPDATE ON auth.session TO app_user;

-- ---------------------------------------------------------------------------
-- Sign-in directory (platform): which tenant a login email belongs to. Maintained
-- by a trigger on public.user_account; read only through auth.resolve_login.
-- ---------------------------------------------------------------------------

CREATE TABLE platform.login_directory (
  organization_id  uuid        NOT NULL REFERENCES public.organization (id),
  user_account_id  uuid        NOT NULL,
  email_lower      text        NOT NULL,
  is_active        boolean     NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_account_id)
);
CREATE INDEX login_directory_email_idx ON platform.login_directory (email_lower);

-- RLS on with no policy: only the owner (the definer functions) sees rows.
ALTER TABLE platform.login_directory ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION platform.sync_login_directory() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  INSERT INTO platform.login_directory AS d (organization_id, user_account_id, email_lower, is_active, updated_at)
  VALUES (NEW.organization_id, NEW.id, lower(NEW.login_email),
          NEW.status = 'active' AND NEW.archived_at IS NULL, now())
  ON CONFLICT (organization_id, user_account_id) DO UPDATE
    SET email_lower = EXCLUDED.email_lower, is_active = EXCLUDED.is_active, updated_at = EXCLUDED.updated_at;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION platform.sync_login_directory() FROM PUBLIC;

CREATE TRIGGER user_account_login_directory AFTER INSERT OR UPDATE OF login_email, status, archived_at
  ON public.user_account FOR EACH ROW EXECUTE FUNCTION platform.sync_login_directory();

-- Backfill accounts that already exist (seeded development databases), tenant by tenant
-- so forced RLS admits the read.
DO $$
DECLARE
  v_org uuid;
BEGIN
  FOR v_org IN SELECT organization_id FROM platform.tenant LOOP
    PERFORM set_config('app.organization_id', v_org::text, true);
    INSERT INTO platform.login_directory (organization_id, user_account_id, email_lower, is_active)
    SELECT u.organization_id, u.id, lower(u.login_email), u.status = 'active' AND u.archived_at IS NULL
    FROM public.user_account u WHERE u.organization_id = v_org
    ON CONFLICT DO NOTHING;
  END LOOP;
  PERFORM set_config('app.organization_id', '', true);
END
$$;

-- Active accounts for a login email, across tenants. Returns ids only.
CREATE FUNCTION auth.resolve_login(p_email text)
RETURNS TABLE (organization_id uuid, user_account_id uuid)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT d.organization_id, d.user_account_id FROM platform.login_directory d
  JOIN platform.tenant t ON t.organization_id = d.organization_id AND t.status = 'active'
  WHERE d.email_lower = lower(btrim(p_email)) AND d.is_active
  ORDER BY d.organization_id
  LIMIT 10
$$;

-- ---------------------------------------------------------------------------
-- Sign-in throttling (ADR-0006 rule 11, ADR-0010 section 6: Postgres, no Redis).
-- Keys are SHA-256 digests of "account:<email>" or "ip:<prefix>"; no raw email or IP.
-- The lockout policy itself lives in packages/auth; these functions only store state.
-- ---------------------------------------------------------------------------

CREATE TABLE platform.auth_throttle (
  key_hash           bytea       NOT NULL PRIMARY KEY CHECK (octet_length(key_hash) = 32),
  scope              text        NOT NULL CHECK (scope IN ('account', 'ip')),
  failures           integer     NOT NULL CHECK (failures >= 0),
  window_started_at  timestamptz NOT NULL,
  locked_until       timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE platform.auth_throttle ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION auth.throttle_read(p_keys bytea[])
RETURNS TABLE (key_hash bytea, scope text, failures integer, window_started_at timestamptz, locked_until timestamptz)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT t.key_hash, t.scope, t.failures, t.window_started_at, t.locked_until
  FROM platform.auth_throttle t WHERE t.key_hash = ANY (p_keys)
$$;

CREATE FUNCTION auth.throttle_write(
  p_key bytea, p_scope text, p_failures integer, p_window_started_at timestamptz, p_locked_until timestamptz
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  INSERT INTO platform.auth_throttle AS t (key_hash, scope, failures, window_started_at, locked_until, updated_at)
  VALUES (p_key, p_scope, p_failures, p_window_started_at, p_locked_until, now())
  ON CONFLICT (key_hash) DO UPDATE
    SET failures = EXCLUDED.failures, window_started_at = EXCLUDED.window_started_at,
        locked_until = EXCLUDED.locked_until, updated_at = EXCLUDED.updated_at
$$;

CREATE FUNCTION auth.throttle_clear(p_key bytea) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  UPDATE platform.auth_throttle SET failures = 0, locked_until = NULL, updated_at = now() WHERE key_hash = p_key
$$;

REVOKE ALL ON FUNCTION auth.resolve_login(text), auth.throttle_read(bytea[]),
  auth.throttle_write(bytea, text, integer, timestamptz, timestamptz), auth.throttle_clear(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.resolve_login(text), auth.throttle_read(bytea[]),
  auth.throttle_write(bytea, text, integer, timestamptz, timestamptz), auth.throttle_clear(bytea) TO app_user;
