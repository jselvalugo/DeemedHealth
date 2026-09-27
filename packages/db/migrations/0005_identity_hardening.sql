-- 0005 Identity hardening after the S3 security review, and product decisions D15/D16.
--
--   * auth.enrollment_token: single-use, expiring token (hash only) required to enroll a
--     first MFA factor. Issued by an administrator's MFA reset or an invitation and
--     delivered out of band; a password alone can no longer enroll a factor.
--   * auth.throttle_fail: one atomic INSERT ... ON CONFLICT DO UPDATE per failure, so
--     concurrent failures are all counted. The lockout policy lives here (same numbers as
--     THROTTLE_POLICY in packages/auth; a db test keeps them in step). app_user loses
--     auth.throttle_write (arbitrary values); auth.throttle_clear resets account keys only.
--   * auth_factor_guard: a changed TOTP step must strictly increase (the application
--     also consumes a step with a conditional UPDATE, so two requests cannot both win).
--   * D15: the org_admin role is the "Health center administrator".
--   * D16: executive approval areas are confirmed by the product owner.
--
-- Reversal (development only): DROP TABLE auth.enrollment_token; DROP FUNCTION
--   auth.throttle_fail(bytea, text, timestamptz); restore 0004's auth_factor_guard,
--   throttle_clear, and grants; UPDATE the role and approval_area rows back.

INSERT INTO audit.action_registry (action, category, description) VALUES
  ('mfa.enrollment_issued', 'auth', 'Single-use MFA enrollment token issued');

-- ---------------------------------------------------------------------------
-- D15 and D16
-- ---------------------------------------------------------------------------

UPDATE public.role
SET name_en = 'Health center administrator',
    name_es = 'Administrador del centro de salud',
    description_en = 'Administration: users and roles, organization and sites, integrations, support access. No compliance module data.'
WHERE key = 'org_admin';

UPDATE public.approval_area SET status = 'confirmed', description_en = CASE key
  WHEN 'clinical'   THEN 'Clinical (CMO): credentialing and privileging, FTCA and risk, quality, patient experience, training'
  WHEN 'finance'    THEN 'Finance (CFO): finance and grants, contracts, scope of project'
  WHEN 'operations' THEN 'Operations (COO or CEO): enrollment, screening, workflows, self-service'
  WHEN 'governance' THEN 'Governance, staff side (CEO): board support and HRSA readiness; the board itself approves board matters'
  ELSE description_en END;

-- ---------------------------------------------------------------------------
-- auth.enrollment_token
-- ---------------------------------------------------------------------------

CREATE TABLE auth.enrollment_token (
  id               uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  uuid        NOT NULL REFERENCES public.organization (id),
  user_account_id  uuid        NOT NULL,
  token_hash       bytea       NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  purpose          text        NOT NULL CHECK (purpose IN ('invite', 'mfa_reset')),
  created_at       timestamptz NOT NULL,
  expires_at       timestamptz NOT NULL,
  consumed_at      timestamptz,
  revoked_at       timestamptz,
  issued_by        uuid,
  CONSTRAINT enrollment_token_user_fk FOREIGN KEY (organization_id, user_account_id)
    REFERENCES public.user_account (organization_id, id),
  CONSTRAINT enrollment_token_window CHECK (expires_at > created_at AND expires_at <= created_at + interval '7 days')
);

CREATE INDEX enrollment_token_user_idx ON auth.enrollment_token (organization_id, user_account_id)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

-- Single use: once consumed or revoked, a token never changes again.
CREATE FUNCTION auth.enrollment_token_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF OLD.consumed_at IS NOT NULL OR OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'enrollment token % is spent', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.user_account_id IS DISTINCT FROM OLD.user_account_id OR NEW.token_hash IS DISTINCT FROM OLD.token_hash
     OR NEW.purpose IS DISTINCT FROM OLD.purpose OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.issued_by IS DISTINCT FROM OLD.issued_by THEN
    RAISE EXCEPTION 'enrollment tokens are never edited, only consumed or revoked' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER enrollment_token_guard BEFORE UPDATE ON auth.enrollment_token
  FOR EACH ROW EXECUTE FUNCTION auth.enrollment_token_guard();

ALTER TABLE auth.enrollment_token ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.enrollment_token FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON auth.enrollment_token
  USING (organization_id = current_setting('app.organization_id')::uuid)
  WITH CHECK (organization_id = current_setting('app.organization_id')::uuid);

GRANT SELECT, INSERT, UPDATE ON auth.enrollment_token TO app_user;

-- ---------------------------------------------------------------------------
-- TOTP steps strictly increase
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION auth.auth_factor_guard() RETURNS trigger
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
     OR (OLD.totp_last_step IS NOT NULL AND NEW.totp_last_step IS DISTINCT FROM OLD.totp_last_step
         AND (NEW.totp_last_step IS NULL OR NEW.totp_last_step <= OLD.totp_last_step)) THEN
    RAISE EXCEPTION 'auth_factor identity, verification, and TOTP step are one-way' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

-- ---------------------------------------------------------------------------
-- Atomic throttling
-- ---------------------------------------------------------------------------

-- One failure for one key, counted atomically; returns the state after it. Policy:
-- 15-minute window; past the free failures each failure locks the key, doubling up to
-- the cap (account: 5 free, 60 s base; ip: 30 free, 900 s base; cap 3600 s).
-- p_now is the caller's clock (injected in tests); it only moves the window.
CREATE FUNCTION auth.throttle_fail(p_key bytea, p_scope text, p_now timestamptz)
RETURNS TABLE (failures integer, locked_until timestamptz, locked_now boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c_window constant interval := interval '15 minutes';
  v_free   integer;
  v_base   integer;
  v_max    constant integer := 3600;
  v_fails  integer;
  v_lock   timestamptz;
BEGIN
  IF p_scope = 'account' THEN v_free := 5;  v_base := 60;
  ELSIF p_scope = 'ip'   THEN v_free := 30; v_base := 900;
  ELSE RAISE EXCEPTION 'unknown throttle scope' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_key IS NULL OR octet_length(p_key) <> 32 OR p_now IS NULL THEN
    RAISE EXCEPTION 'throttle_fail: bad arguments' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO platform.auth_throttle AS t (key_hash, scope, failures, window_started_at, locked_until, updated_at)
  VALUES (p_key, p_scope, 1, p_now, NULL, now())
  ON CONFLICT (key_hash) DO UPDATE SET
    failures = CASE WHEN p_now - t.window_started_at > c_window
                         AND (t.locked_until IS NULL OR t.locked_until <= p_now)
                    THEN 1 ELSE t.failures + 1 END,
    window_started_at = CASE WHEN p_now - t.window_started_at > c_window
                                  AND (t.locked_until IS NULL OR t.locked_until <= p_now)
                             THEN p_now ELSE t.window_started_at END,
    locked_until = CASE WHEN p_now - t.window_started_at > c_window
                             AND (t.locked_until IS NULL OR t.locked_until <= p_now)
                        THEN NULL ELSE t.locked_until END,
    updated_at = now()
  RETURNING t.failures, t.locked_until INTO v_fails, v_lock;

  IF v_fails > v_free THEN
    v_lock := p_now + make_interval(secs => least(v_base * power(2, least(v_fails - v_free - 1, 16)), v_max));
    UPDATE platform.auth_throttle SET locked_until = v_lock WHERE key_hash = p_key;
    RETURN QUERY SELECT v_fails, v_lock, true;
  ELSE
    RETURN QUERY SELECT v_fails, v_lock, false;
  END IF;
END
$$;

-- After a successful sign-in only the account key resets; IP keys run out on their own.
CREATE OR REPLACE FUNCTION auth.throttle_clear(p_key bytea) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  UPDATE platform.auth_throttle SET failures = 0, locked_until = NULL, updated_at = now()
  WHERE key_hash = p_key AND scope = 'account'
$$;

REVOKE ALL ON FUNCTION auth.throttle_write(bytea, text, integer, timestamptz, timestamptz) FROM app_user;
REVOKE ALL ON FUNCTION auth.throttle_fail(bytea, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.throttle_fail(bytea, text, timestamptz) TO app_user;
