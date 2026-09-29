-- 0006 Sign-in throttling runs on the database clock (security re-review N3).
--
--   * auth.throttle_fail took the caller's time (p_now), so a caller could move its own
--     window or lock by passing any timestamp. It now takes no time argument and uses
--     now(): the window, the lock, and its expiry all come from the database clock.
--   * auth.throttle_read also reports `locked`, computed against the same clock, so the
--     application never compares a stored lock with its own (possibly fake) clock.
--     Tests that need a lock to run out age the rows instead of moving a fake clock.
--
-- Policy unchanged (THROTTLE_POLICY in packages/auth; a db test keeps them in step):
-- 15-minute window; account 5 free failures then 60 s, ip 30 free then 900 s, doubling
-- up to 3600 s.
--
-- Reversal (development only): DROP FUNCTION auth.throttle_fail(bytea, text),
--   auth.throttle_read(bytea[]); re-create 0005's auth.throttle_fail(bytea, text,
--   timestamptz) and 0004's auth.throttle_read(bytea[]) with their grants.

DROP FUNCTION auth.throttle_fail(bytea, text, timestamptz);

CREATE FUNCTION auth.throttle_fail(p_key bytea, p_scope text)
RETURNS TABLE (failures integer, locked_until timestamptz, locked_now boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c_window constant interval := interval '15 minutes';
  v_now    constant timestamptz := now();
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
  IF p_key IS NULL OR octet_length(p_key) <> 32 THEN
    RAISE EXCEPTION 'throttle_fail: bad arguments' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO platform.auth_throttle AS t (key_hash, scope, failures, window_started_at, locked_until, updated_at)
  VALUES (p_key, p_scope, 1, v_now, NULL, v_now)
  ON CONFLICT (key_hash) DO UPDATE SET
    failures = CASE WHEN v_now - t.window_started_at > c_window
                         AND (t.locked_until IS NULL OR t.locked_until <= v_now)
                    THEN 1 ELSE t.failures + 1 END,
    window_started_at = CASE WHEN v_now - t.window_started_at > c_window
                                  AND (t.locked_until IS NULL OR t.locked_until <= v_now)
                             THEN v_now ELSE t.window_started_at END,
    locked_until = CASE WHEN v_now - t.window_started_at > c_window
                             AND (t.locked_until IS NULL OR t.locked_until <= v_now)
                        THEN NULL ELSE t.locked_until END,
    updated_at = v_now
  RETURNING t.failures, t.locked_until INTO v_fails, v_lock;

  IF v_fails > v_free THEN
    v_lock := v_now + make_interval(secs => least(v_base * power(2, least(v_fails - v_free - 1, 16)), v_max));
    UPDATE platform.auth_throttle SET locked_until = v_lock WHERE key_hash = p_key;
    RETURN QUERY SELECT v_fails, v_lock, true;
  ELSE
    RETURN QUERY SELECT v_fails, v_lock, false;
  END IF;
END
$$;

DROP FUNCTION auth.throttle_read(bytea[]);

CREATE FUNCTION auth.throttle_read(p_keys bytea[])
RETURNS TABLE (key_hash bytea, scope text, failures integer, window_started_at timestamptz,
               locked_until timestamptz, locked boolean)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT t.key_hash, t.scope, t.failures, t.window_started_at, t.locked_until,
         coalesce(t.locked_until > now(), false)
  FROM platform.auth_throttle t WHERE t.key_hash = ANY (p_keys)
$$;

REVOKE ALL ON FUNCTION auth.throttle_fail(bytea, text), auth.throttle_read(bytea[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.throttle_fail(bytea, text), auth.throttle_read(bytea[]) TO app_user;
