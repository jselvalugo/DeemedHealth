-- 0007 Second-factor guesses are reserved before they are evaluated (security re-review N1).
--
--   Before, a wrong code was counted after it was checked, so many guesses sent at once
--   all passed the "not locked" check before any failure was recorded. Now each guess
--   first reserves a failure:
--
--   * auth.throttle_reserve(key, scope): under a row lock, refuses (allowed = false,
--     nothing counted) while the key is locked; otherwise counts one failure exactly as
--     auth.throttle_fail does (and may lock the key) and allows the guess. Concurrent
--     reservations serialize on the row, so at most the free failures plus one guess are
--     evaluated per lock window. A successful sign-in or step-up clears the account key.
--   * The per-sign-in budget (auth.login_attempt.failed_mfa_count < 5) is reserved the
--     same way by the application, with one conditional UPDATE under RLS.
--
-- Reversal (development only): DROP FUNCTION auth.throttle_reserve(bytea, text).

CREATE FUNCTION auth.throttle_reserve(p_key bytea, p_scope text)
RETURNS TABLE (allowed boolean, failures integer, locked_now boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_lock  timestamptz;
  v_fails integer;
BEGIN
  IF p_key IS NULL OR octet_length(p_key) <> 32 OR p_scope IS NULL
     OR p_scope NOT IN ('account', 'ip') THEN
    RAISE EXCEPTION 'throttle_reserve: bad arguments' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Make sure the row exists, then hold it for the rest of the transaction.
  INSERT INTO platform.auth_throttle (key_hash, scope, failures, window_started_at, locked_until, updated_at)
  VALUES (p_key, p_scope, 0, now(), NULL, now())
  ON CONFLICT (key_hash) DO NOTHING;
  SELECT t.locked_until, t.failures INTO v_lock, v_fails
  FROM platform.auth_throttle t WHERE t.key_hash = p_key FOR UPDATE;

  IF v_lock IS NOT NULL AND v_lock > now() THEN
    RETURN QUERY SELECT false, v_fails, false;
    RETURN;
  END IF;
  RETURN QUERY SELECT true, f.failures, f.locked_now FROM auth.throttle_fail(p_key, p_scope) f;
END
$$;

REVOKE ALL ON FUNCTION auth.throttle_reserve(bytea, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.throttle_reserve(bytea, text) TO app_user;
