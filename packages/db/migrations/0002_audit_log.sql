-- 0002 Audit log (ADR-0008, names per ADR-0011): append-only, per-tenant SHA-256 hash
-- chain, monthly partitions.
--
-- What this file guarantees:
--   * audit.audit_event is written only by audit.append_event (SECURITY DEFINER, owned by
--     audit_writer). app_user has SELECT only on the audit schema; it cannot INSERT
--     directly (the caller would then choose chain_seq and hashes), UPDATE, DELETE, or
--     TRUNCATE.
--   * A trigger rejects UPDATE, DELETE, and TRUNCATE for every role, the owner included.
--   * One hash chain per organization: row_hash = SHA-256(prev_hash || canonical_bytes(row)),
--     canonical form = RFC 8785 (JCS) JSON of every column except row_hash. The TypeScript
--     canonicalizer in packages/domain/src/audit-canonical.ts must produce the same bytes;
--     the integration tests compare the two on every stored row.
--   * Writes are serialized per tenant with pg_advisory_xact_lock(hashtext('audit:' || org)).
--   * Category rules from ADR-0008 section 4 (the same table as AUDIT_CATEGORY_REQUIREMENTS
--     in @deemed/domain) are enforced here too, so no writer can skip them: target for
--     mutation/reveal/approval/permission, diff for successful mutation/permission, reason
--     for reveal/system (including the genesis row), IP and user agent for auth, a human
--     actor for approval, and on_behalf_of for service actors.
--   * Monthly range partitions in UTC, created three months ahead; no DEFAULT partition,
--     so an insert with no partition fails loudly.
--   * RLS is forced; the policy reads current_setting('app.organization_id').
--
-- The hash uses the built-in sha256(bytea) (PostgreSQL 11+), byte-identical to
-- pgcrypto's digest(..., 'sha256') named in ADR-0008, without adding an extension.
--
-- Canonical-form limits (enforced by audit.jcs and the TypeScript canonicalizer alike, so
-- both always agree): object keys in diff/metadata match ^[A-Za-z0-9_.:-]+$, and numbers
-- are 0 or have 1e-6 <= |n| < 1e21 with at most 15 significant digits.
--
-- Reversal: none. Dropping the audit log destroys evidence; it is removed only by the
-- retention job, partition by partition (ADR-0008 section 8).

-- ---------------------------------------------------------------------------
-- Registry of allowed actions (global reference data)
-- ---------------------------------------------------------------------------

CREATE TABLE audit.action_registry (
  action       text NOT NULL PRIMARY KEY CHECK (action ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  category     text NOT NULL
               CHECK (category IN ('auth', 'mutation', 'reveal', 'export', 'approval', 'permission', 'integration', 'system')),
  description  text NOT NULL
);

-- Seeded from AUDIT_ACTIONS in @deemed/domain (S0), plus three S2 actions marked below
-- that must be added to that list when the branches meet.
INSERT INTO audit.action_registry (action, category, description) VALUES
  ('session.login',                        'auth',        'Signed in'),
  ('session.login_failed',                 'auth',        'Sign-in failed'),
  ('session.logout',                       'auth',        'Signed out'),
  ('session.expired',                      'auth',        'Session expired (idle or absolute)'),
  ('session.reauth',                       'auth',        'Re-authenticated for a sensitive action'),
  ('mfa.enrolled',                         'auth',        'MFA factor enrolled'),
  ('mfa.challenge',                        'auth',        'MFA challenge answered'),
  ('mfa.reset',                            'auth',        'MFA reset by an administrator'),
  ('scim.user_provisioned',                'auth',        'User provisioned via SCIM'),
  ('scim.user_deprovisioned',              'auth',        'User deprovisioned via SCIM'),
  ('breakglass.activated',                 'auth',        'Break-glass account used'),
  ('organization.update',                  'mutation',    'Organization settings changed'),
  ('site.create',                          'mutation',    'Site created'),
  ('site.update',                          'mutation',    'Site changed'),
  ('site.archive',                         'mutation',    'Site archived'),
  ('person.create',                        'mutation',    'Person created'),
  ('person.update',                        'mutation',    'Person changed'),
  ('person.archive',                       'mutation',    'Person archived'),
  ('user_account.create',                  'mutation',    'User account created'),
  ('user_account.deactivate',              'mutation',    'User account deactivated'),
  ('requirement_instance.create',          'mutation',    'Requirement applied to a subject'),  -- S2 addition
  ('requirement_instance.update',          'mutation',    'Requirement instance status or owner changed'),
  ('requirement_instance.mark_not_applicable', 'mutation', 'Requirement instance marked not applicable, with reason'),
  ('evidence.create',                      'mutation',    'Evidence record created'),
  ('evidence.archive',                     'mutation',    'Evidence record archived'),
  ('evidence_version.create',              'mutation',    'Evidence version added'),
  ('evidence_link.create',                 'mutation',    'Evidence linked to a requirement'),
  ('evidence_link.close',                  'mutation',    'Evidence link ended'),
  ('task.create',                          'mutation',    'Task created'),
  ('task.update',                          'mutation',    'Task changed'),
  ('task.complete',                        'mutation',    'Task completed'),
  ('workflow_run.start',                   'mutation',    'Workflow started'),
  ('import.commit',                        'mutation',    'Import run committed (summary event)'),
  ('person.reveal_dob',                    'reveal',      'Date of birth shown in clear text'),
  ('person.reveal_home_address',           'reveal',      'Home address shown in clear text'),
  ('provider_profile.reveal_dea_number',   'reveal',      'DEA number shown in clear text'),
  ('evidence.download',                    'reveal',      'Evidence file downloaded'),
  ('report.export',                        'export',      'Report exported'),
  ('audit.export',                         'export',      'Audit log exported'),
  ('approval.decide',                      'approval',    'Workflow approval recorded'),
  ('privilege_set.approve',                'approval',    'Privilege set approved'),
  ('committee_decision.record',            'approval',    'Committee decision recorded'),
  ('attestation.sign',                     'approval',    'Attestation signed'),
  ('role.grant',                           'permission',  'Role granted'),
  ('role.revoke',                          'permission',  'Role revoked'),
  ('site_scope.change',                    'permission',  'Site scope changed'),
  ('auditor_access.grant',                 'permission',  'Time-boxed auditor access granted'),
  ('auditor_access.expired',               'permission',  'Auditor access expired'),
  ('screening_run.complete',               'integration', 'Exclusion screening run finished'),
  ('screening_run.failed',                 'integration', 'Exclusion screening run failed'),
  ('license_sync.complete',                'integration', 'License sync finished'),
  ('license_sync.failed',                  'integration', 'License sync failed'),
  ('audit.genesis',                        'system',      'First event of an organization chain'),
  ('audit.annotation',                     'system',      'Correction note on an earlier event'),
  ('audit.verification_run',               'system',      'Hash chain verified'),
  ('audit.anchor',                         'system',      'Chain head anchored externally'),
  ('retention.checkpoint',                 'system',      'Retention checkpoint written'),
  ('retention.hard_delete',                'system',      'Partition dropped at retention'),
  ('legal_hold.set',                       'system',      'Legal hold set'),
  ('legal_hold.release',                   'system',      'Legal hold released'),
  ('key.rotated',                          'system',      'Encryption key rotated'),
  ('catalog_release.applied',              'system',      'Catalog release applied'),
  ('organization.provision',               'system',      'Tenant provisioned by the platform'),  -- S2 addition
  ('seed.load',                            'system',      'Synthetic seed data loaded (non-production only)');  -- S2 addition

-- ---------------------------------------------------------------------------
-- audit_event (partitioned by month on occurred_at, UTC boundaries)
-- ---------------------------------------------------------------------------

CREATE TABLE audit.audit_event (
  id               uuid        NOT NULL,
  organization_id  uuid        NOT NULL,
  chain_seq        bigint      NOT NULL CHECK (chain_seq >= 1),
  occurred_at      timestamptz NOT NULL,
  category         text        NOT NULL
                   CHECK (category IN ('auth', 'mutation', 'reveal', 'export', 'approval', 'permission', 'integration', 'system')),
  action           text        NOT NULL REFERENCES audit.action_registry (action),
  outcome          text        NOT NULL CHECK (outcome IN ('success', 'denied', 'failure')),
  actor_type       text        NOT NULL CHECK (actor_type IN ('user', 'service', 'integration', 'system', 'break_glass')),
  actor_person_id  uuid,
  actor_user_id    uuid,
  actor_label      text        NOT NULL CHECK (length(actor_label) BETWEEN 1 AND 200),
  on_behalf_of_id  uuid,
  session_id       uuid,
  request_id       uuid,
  ip_address       inet,
  user_agent       text,
  site_id          uuid,
  target_table     text,
  target_id        uuid,
  requirement_ids  text[],
  reason           text,
  diff             jsonb,
  metadata         jsonb       NOT NULL DEFAULT '{}',
  schema_version   smallint    NOT NULL,
  prev_hash        bytea       NOT NULL CHECK (octet_length(prev_hash) = 32),
  row_hash         bytea       NOT NULL CHECK (octet_length(row_hash) = 32),
  PRIMARY KEY (organization_id, occurred_at, id),
  UNIQUE (organization_id, chain_seq, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE INDEX audit_event_target_idx   ON audit.audit_event (organization_id, target_table, target_id);
CREATE INDEX audit_event_actor_idx    ON audit.audit_event (organization_id, actor_person_id, occurred_at);
CREATE INDEX audit_event_category_idx ON audit.audit_event (organization_id, category, occurred_at);

ALTER TABLE audit.audit_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.audit_event FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit.audit_event
  USING (organization_id = current_setting('app.organization_id')::uuid)
  WITH CHECK (organization_id = current_setting('app.organization_id')::uuid);

-- Append-only, for every role including the owner (second line of defense after grants).
CREATE FUNCTION audit.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION '%.% is append-only: % is not allowed', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER audit_event_append_only BEFORE UPDATE OR DELETE ON audit.audit_event
  FOR EACH ROW EXECUTE FUNCTION audit.forbid_mutation();
CREATE TRIGGER audit_event_no_truncate BEFORE TRUNCATE ON audit.audit_event
  FOR EACH STATEMENT EXECUTE FUNCTION audit.forbid_mutation();

-- ---------------------------------------------------------------------------
-- chain_head: the latest (chain_seq, row_hash) per organization. Re-derivable from
-- audit_event, so it is bookkeeping rather than evidence. Owned by audit_writer
-- (ADR-0011); only append_event moves it.
-- ---------------------------------------------------------------------------

CREATE TABLE audit.chain_head (
  organization_id  uuid        NOT NULL PRIMARY KEY,
  chain_seq        bigint      NOT NULL CHECK (chain_seq >= 1),
  row_hash         bytea       NOT NULL CHECK (octet_length(row_hash) = 32),
  updated_at       timestamptz NOT NULL
);

ALTER TABLE audit.chain_head ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.chain_head FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit.chain_head
  USING (organization_id = current_setting('app.organization_id')::uuid)
  WITH CHECK (organization_id = current_setting('app.organization_id')::uuid);

CREATE TRIGGER chain_head_no_delete BEFORE DELETE ON audit.chain_head
  FOR EACH ROW EXECUTE FUNCTION audit.forbid_mutation();
CREATE TRIGGER chain_head_no_truncate BEFORE TRUNCATE ON audit.chain_head
  FOR EACH STATEMENT EXECUTE FUNCTION audit.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Monthly partitions
-- ---------------------------------------------------------------------------

-- Creates the current UTC month's partition and the next p_months_ahead months.
-- Each partition gets RLS forced with no policy (direct partition access sees nothing),
-- no privileges for runtime roles, and its own TRUNCATE guard (statement triggers on the
-- parent do not fire for a TRUNCATE aimed at a partition). Returns partitions created.
CREATE FUNCTION audit.ensure_partitions(p_months_ahead integer DEFAULT 3) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_first  date := date_trunc('month', (now() AT TIME ZONE 'UTC'))::date;
  v_start  date;
  v_name   text;
  v_made   integer := 0;
BEGIN
  IF p_months_ahead IS NULL OR p_months_ahead < 0 OR p_months_ahead > 24 THEN
    RAISE EXCEPTION 'p_months_ahead must be between 0 and 24' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  FOR i IN 0 .. p_months_ahead LOOP
    v_start := (v_first + make_interval(months => i))::date;
    v_name := 'audit_event_' || to_char(v_start, 'YYYY_MM');
    CONTINUE WHEN to_regclass('audit.' || v_name) IS NOT NULL;
    EXECUTE format(
      'CREATE TABLE audit.%I PARTITION OF audit.audit_event FOR VALUES FROM (%L) TO (%L)',
      v_name, v_start::text || ' 00:00:00+00',
      (v_start + interval '1 month')::date::text || ' 00:00:00+00');
    EXECUTE format('ALTER TABLE audit.%I ENABLE ROW LEVEL SECURITY', v_name);
    EXECUTE format('ALTER TABLE audit.%I FORCE ROW LEVEL SECURITY', v_name);
    EXECUTE format('REVOKE ALL ON audit.%I FROM PUBLIC', v_name);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE TRUNCATE ON audit.%I FOR EACH STATEMENT EXECUTE FUNCTION audit.forbid_mutation()',
      v_name || '_no_truncate', v_name);
    v_made := v_made + 1;
  END LOOP;
  RETURN v_made;
END
$$;

REVOKE ALL ON FUNCTION audit.ensure_partitions(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.ensure_partitions(integer) TO app_platform;

SELECT audit.ensure_partitions(3);

-- ---------------------------------------------------------------------------
-- Canonical serialization (RFC 8785 JCS subset, see limits in the header)
-- ---------------------------------------------------------------------------

-- JSON string literal. PostgreSQL's escaping of text (\" \\ \b \f \n \r \t, other
-- control characters as lowercase \u00xx, everything else literal UTF-8) is exactly
-- what ECMAScript JSON.stringify produces for well-formed Unicode.
CREATE FUNCTION audit.jcs_string(p text) RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$ SELECT CASE WHEN p IS NULL THEN 'null' ELSE to_json(p)::text END $$;

CREATE FUNCTION audit.jcs(p jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_out    text;
  v_key    text;
  v_val    jsonb;
  v_first  boolean := true;
  v_num    numeric;
  v_digits text;
BEGIN
  IF p IS NULL THEN
    RETURN 'null';
  END IF;
  CASE jsonb_typeof(p)
    WHEN 'object' THEN
      v_out := '{';
      FOR v_key, v_val IN SELECT e.key, e.value FROM jsonb_each(p) e ORDER BY e.key COLLATE "C" LOOP
        IF v_key !~ '^[A-Za-z0-9_.:-]+$' THEN
          RAISE EXCEPTION 'audit canonical form: object key % is not allowed', to_json(v_key)::text
            USING ERRCODE = 'invalid_parameter_value';
        END IF;
        IF NOT v_first THEN v_out := v_out || ','; END IF;
        v_first := false;
        v_out := v_out || to_json(v_key)::text || ':' || audit.jcs(v_val);
      END LOOP;
      RETURN v_out || '}';
    WHEN 'array' THEN
      v_out := '[';
      FOR v_val IN SELECT e.value FROM jsonb_array_elements(p) WITH ORDINALITY e(value, n) ORDER BY e.n LOOP
        IF NOT v_first THEN v_out := v_out || ','; END IF;
        v_first := false;
        v_out := v_out || audit.jcs(v_val);
      END LOOP;
      RETURN v_out || ']';
    WHEN 'string' THEN
      RETURN to_json(p #>> '{}')::text;
    WHEN 'number' THEN
      v_num := (p #>> '{}')::numeric;
      IF v_num = 0 THEN
        RETURN '0';
      END IF;
      v_digits := trim(both '0' from replace(trim_scale(abs(v_num))::text, '.', ''));
      IF abs(v_num) >= 1e21 OR abs(v_num) < 1e-6 OR length(v_digits) > 15 THEN
        RAISE EXCEPTION 'audit canonical form: number % is outside the supported range', v_num
          USING ERRCODE = 'invalid_parameter_value';
      END IF;
      RETURN trim_scale(v_num)::text;
    WHEN 'boolean' THEN
      RETURN p #>> '{}';
    ELSE
      RETURN 'null';
  END CASE;
END
$$;

-- Canonical text of an event: every column except row_hash, keys in sorted order.
-- Type rules (ADR-0008 section 2): uuid lowercase; timestamptz RFC 3339 UTC with
-- microseconds; bytea lowercase hex; inet in its standard output form (abbrev: no /32 or
-- /128 on a host address); NULL as null.
CREATE FUNCTION audit.canonical_text(e audit.audit_event) RETURNS text
LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT '{'
    || '"action":'          || audit.jcs_string(e.action)
    || ',"actor_label":'     || audit.jcs_string(e.actor_label)
    || ',"actor_person_id":' || audit.jcs_string(e.actor_person_id::text)
    || ',"actor_type":'      || audit.jcs_string(e.actor_type)
    || ',"actor_user_id":'   || audit.jcs_string(e.actor_user_id::text)
    || ',"category":'        || audit.jcs_string(e.category)
    || ',"chain_seq":'       || e.chain_seq::text
    || ',"diff":'            || audit.jcs(e.diff)
    || ',"id":'              || audit.jcs_string(e.id::text)
    || ',"ip_address":'      || audit.jcs_string(abbrev(e.ip_address))
    || ',"metadata":'        || audit.jcs(e.metadata)
    || ',"occurred_at":'     || audit.jcs_string(to_char(e.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
    || ',"on_behalf_of_id":' || audit.jcs_string(e.on_behalf_of_id::text)
    || ',"organization_id":' || audit.jcs_string(e.organization_id::text)
    || ',"outcome":'         || audit.jcs_string(e.outcome)
    || ',"prev_hash":'       || audit.jcs_string(encode(e.prev_hash, 'hex'))
    || ',"reason":'          || audit.jcs_string(e.reason)
    || ',"request_id":'      || audit.jcs_string(e.request_id::text)
    || ',"requirement_ids":' || audit.jcs(to_jsonb(e.requirement_ids))
    || ',"schema_version":'  || e.schema_version::text
    || ',"session_id":'      || audit.jcs_string(e.session_id::text)
    || ',"site_id":'         || audit.jcs_string(e.site_id::text)
    || ',"target_id":'       || audit.jcs_string(e.target_id::text)
    || ',"target_table":'    || audit.jcs_string(e.target_table)
    || ',"user_agent":'      || audit.jcs_string(e.user_agent)
    || '}'
$$;

CREATE FUNCTION audit.compute_row_hash(e audit.audit_event) RETURNS bytea
LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $$ SELECT sha256(e.prev_hash || convert_to(audit.canonical_text(e), 'UTF8')) $$;

-- Time-ordered UUID (version 7) from a timestamp; PostgreSQL 16 has no built-in.
CREATE FUNCTION audit.uuid_v7(p_ts timestamptz) RETURNS uuid
LANGUAGE sql VOLATILE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT encode(
    set_bit(set_bit(
      overlay(uuid_send(gen_random_uuid())
              PLACING substring(int8send(floor(extract(epoch FROM p_ts) * 1000)::bigint) FROM 3)
              FROM 1 FOR 6),
      52, 1), 53, 1),
    'hex')::uuid
$$;

-- ---------------------------------------------------------------------------
-- The single writer
-- ---------------------------------------------------------------------------

-- Internal: validate, lock, read head, build, hash, insert, move head.
-- actor_user_id and request_id always come from the transaction (app.actor_id,
-- app.request_id, set by withTenant), never from the caller.
CREATE FUNCTION audit.write_event(
  p_organization_id  uuid,
  p_category         text,
  p_action           text,
  p_outcome          text,
  p_actor_type       text,
  p_actor_label      text,
  p_actor_person_id  uuid,
  p_on_behalf_of_id  uuid,
  p_target_table     text,
  p_target_id        uuid,
  p_site_id          uuid,
  p_requirement_ids  text[],
  p_reason           text,
  p_diff             jsonb,
  p_metadata         jsonb,
  p_ip_address       inet,
  p_user_agent       text,
  p_session_id       uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c_schema_version constant smallint := 1;
  v_ev        audit.audit_event;
  v_head_seq  bigint;
  v_head_hash bytea;
  v_category  text;
  v_outcome   text := coalesce(p_outcome, 'success');
  v_actor_id  uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
  v_reason    text := nullif(btrim(p_reason), '');
BEGIN
  SELECT r.category INTO v_category FROM audit.action_registry r WHERE r.action = p_action;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'audit action % is not registered', p_action USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_category <> p_category THEN
    RAISE EXCEPTION 'audit action % belongs to category %, not %', p_action, v_category, p_category
      USING ERRCODE = 'check_violation';
  END IF;

  -- Actor consistency: human actors are the transaction's app.actor_id; others have none.
  IF p_actor_type IN ('user', 'break_glass') AND v_actor_id IS NULL THEN
    RAISE EXCEPTION 'a % actor needs app.actor_id in the transaction', p_actor_type USING ERRCODE = 'check_violation';
  END IF;
  IF p_actor_type NOT IN ('user', 'break_glass') AND v_actor_id IS NOT NULL THEN
    RAISE EXCEPTION 'a % actor cannot carry a user app.actor_id', p_actor_type USING ERRCODE = 'check_violation';
  END IF;

  -- ADR-0008 section 4 category rules (mirrors AUDIT_CATEGORY_REQUIREMENTS).
  IF p_category IN ('mutation', 'reveal', 'approval', 'permission')
     AND (p_target_table IS NULL OR p_target_id IS NULL) THEN
    RAISE EXCEPTION '% events need a target', p_category USING ERRCODE = 'check_violation';
  END IF;
  IF p_category IN ('mutation', 'permission') AND v_outcome = 'success' AND p_diff IS NULL THEN
    RAISE EXCEPTION '% events need a diff', p_category USING ERRCODE = 'check_violation';
  END IF;
  IF p_category IN ('reveal', 'system') AND v_reason IS NULL THEN
    RAISE EXCEPTION '% events need a reason', p_category USING ERRCODE = 'check_violation';
  END IF;
  IF p_category = 'auth' AND (p_ip_address IS NULL OR p_user_agent IS NULL) THEN
    RAISE EXCEPTION 'auth events need an IP address and user agent' USING ERRCODE = 'check_violation';
  END IF;
  IF v_outcome = 'denied' AND p_category NOT IN ('auth', 'mutation', 'reveal', 'export', 'approval', 'permission') THEN
    RAISE EXCEPTION '% events are not logged as denied', p_category USING ERRCODE = 'check_violation';
  END IF;
  -- Product principle 2: only humans approve.
  IF p_category = 'approval' AND p_actor_type <> 'user' THEN
    RAISE EXCEPTION 'approval events are produced by human users only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_actor_type = 'service' AND p_on_behalf_of_id IS NULL THEN
    RAISE EXCEPTION 'service actions record the human they act for' USING ERRCODE = 'check_violation';
  END IF;

  -- Decision D1 defense in depth: nothing SSN-shaped enters the log.
  IF concat_ws(' ', p_reason, p_user_agent, p_actor_label, p_diff::text, p_metadata::text)
     ~ '(^|[^0-9-])[0-9]{3}-[0-9]{2}-[0-9]{4}([^0-9-]|$)' THEN
    RAISE EXCEPTION 'audit event rejected: SSN-shaped value (decision D1)' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('audit:' || p_organization_id::text));

  SELECT h.chain_seq, h.row_hash INTO v_head_seq, v_head_hash
  FROM audit.chain_head h WHERE h.organization_id = p_organization_id;

  IF p_action = 'audit.genesis' THEN
    IF FOUND THEN
      RAISE EXCEPTION 'organization % already has a genesis event', p_organization_id USING ERRCODE = 'unique_violation';
    END IF;
    v_ev.chain_seq := 1;
    v_ev.prev_hash := decode(repeat('00', 32), 'hex');
  ELSE
    IF NOT FOUND THEN
      RAISE EXCEPTION 'organization % has no genesis event', p_organization_id USING ERRCODE = 'foreign_key_violation';
    END IF;
    v_ev.chain_seq := v_head_seq + 1;
    v_ev.prev_hash := v_head_hash;
  END IF;

  v_ev.occurred_at     := clock_timestamp();
  v_ev.id              := audit.uuid_v7(v_ev.occurred_at);
  v_ev.organization_id := p_organization_id;
  v_ev.category        := p_category;
  v_ev.action          := p_action;
  v_ev.outcome         := v_outcome;
  v_ev.actor_type      := p_actor_type;
  v_ev.actor_person_id := p_actor_person_id;
  v_ev.actor_user_id   := v_actor_id;
  v_ev.actor_label     := p_actor_label;
  v_ev.on_behalf_of_id := p_on_behalf_of_id;
  v_ev.session_id      := p_session_id;
  v_ev.request_id      := nullif(current_setting('app.request_id', true), '')::uuid;
  v_ev.ip_address      := p_ip_address;
  v_ev.user_agent      := p_user_agent;
  v_ev.site_id         := p_site_id;
  v_ev.target_table    := p_target_table;
  v_ev.target_id       := p_target_id;
  v_ev.requirement_ids := p_requirement_ids;
  v_ev.reason          := v_reason;
  v_ev.diff            := p_diff;
  v_ev.metadata        := coalesce(p_metadata, '{}'::jsonb);
  v_ev.schema_version  := c_schema_version;
  v_ev.row_hash        := audit.compute_row_hash(v_ev);

  INSERT INTO audit.audit_event SELECT v_ev.*;

  INSERT INTO audit.chain_head AS h (organization_id, chain_seq, row_hash, updated_at)
  VALUES (p_organization_id, v_ev.chain_seq, v_ev.row_hash, v_ev.occurred_at)
  ON CONFLICT (organization_id) DO UPDATE
    SET chain_seq = EXCLUDED.chain_seq, row_hash = EXCLUDED.row_hash, updated_at = EXCLUDED.updated_at;

  RETURN v_ev.id;
END
$$;

-- Public entry point for app_user. The organization argument must equal the
-- transaction's tenant (ADR-0008 section 6).
CREATE FUNCTION audit.append_event(
  p_organization_id  uuid,
  p_category         text,
  p_action           text,
  p_actor_type       text,
  p_actor_label      text,
  p_outcome          text   DEFAULT 'success',
  p_actor_person_id  uuid   DEFAULT NULL,
  p_on_behalf_of_id  uuid   DEFAULT NULL,
  p_target_table     text   DEFAULT NULL,
  p_target_id        uuid   DEFAULT NULL,
  p_site_id          uuid   DEFAULT NULL,
  p_requirement_ids  text[] DEFAULT NULL,
  p_reason           text   DEFAULT NULL,
  p_diff             jsonb  DEFAULT NULL,
  p_metadata         jsonb  DEFAULT '{}',
  p_ip_address       inet   DEFAULT NULL,
  p_user_agent       text   DEFAULT NULL,
  p_session_id       uuid   DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_organization_id IS DISTINCT FROM current_setting('app.organization_id')::uuid THEN
    RAISE EXCEPTION 'audit.append_event: organization does not match the transaction tenant'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_action = 'audit.genesis' THEN
    RAISE EXCEPTION 'audit.genesis is written only by tenant provisioning' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN audit.write_event(p_organization_id, p_category, p_action, p_outcome, p_actor_type,
    p_actor_label, p_actor_person_id, p_on_behalf_of_id, p_target_table, p_target_id, p_site_id,
    p_requirement_ids, p_reason, p_diff, p_metadata, p_ip_address, p_user_agent, p_session_id);
END
$$;

-- ---------------------------------------------------------------------------
-- Verification (runs as the caller, under RLS: a tenant verifies only its own chain)
-- ---------------------------------------------------------------------------

CREATE FUNCTION audit.verify_chain(p_organization_id uuid)
RETURNS TABLE (ok boolean, events_checked bigint, first_bad_seq bigint, detail text)
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_row      audit.audit_event;
  v_prev     bytea := decode(repeat('00', 32), 'hex');
  v_expected bigint := 1;
  v_head     audit.chain_head;
BEGIN
  FOR v_row IN
    SELECT * FROM audit.audit_event WHERE organization_id = p_organization_id ORDER BY chain_seq
  LOOP
    IF v_row.chain_seq <> v_expected THEN
      RETURN QUERY SELECT false, v_expected - 1, v_expected, 'gap in chain_seq';
      RETURN;
    END IF;
    IF v_expected = 1 AND v_row.action <> 'audit.genesis' THEN
      RETURN QUERY SELECT false, 0::bigint, 1::bigint, 'chain does not start with audit.genesis';
      RETURN;
    END IF;
    IF v_row.prev_hash <> v_prev THEN
      RETURN QUERY SELECT false, v_expected - 1, v_expected, 'prev_hash does not match the previous row_hash';
      RETURN;
    END IF;
    IF audit.compute_row_hash(v_row) <> v_row.row_hash THEN
      RETURN QUERY SELECT false, v_expected - 1, v_expected, 'row_hash does not match the row content';
      RETURN;
    END IF;
    v_prev := v_row.row_hash;
    v_expected := v_expected + 1;
  END LOOP;

  IF v_expected = 1 THEN
    RETURN QUERY SELECT false, 0::bigint, 1::bigint, 'no events';
    RETURN;
  END IF;
  SELECT * INTO v_head FROM audit.chain_head WHERE organization_id = p_organization_id;
  IF NOT FOUND OR v_head.chain_seq <> v_expected - 1 OR v_head.row_hash <> v_prev THEN
    RETURN QUERY SELECT false, v_expected - 1, v_expected, 'chain_head does not match the last event';
    RETURN;
  END IF;
  RETURN QUERY SELECT true, v_expected - 1, NULL::bigint, NULL::text;
END
$$;

-- ---------------------------------------------------------------------------
-- Ownership and privileges
-- ---------------------------------------------------------------------------

-- audit_writer adds rows. Non-owner RLS applies to its audit_event inserts, and forced
-- RLS to chain_head once it owns it, so its writes must match the transaction tenant.
GRANT SELECT, INSERT ON audit.audit_event TO audit_writer;
GRANT SELECT ON audit.action_registry TO audit_writer;
GRANT EXECUTE ON FUNCTION audit.jcs_string(text), audit.jcs(jsonb), audit.canonical_text(audit.audit_event),
  audit.compute_row_hash(audit.audit_event), audit.uuid_v7(timestamptz) TO audit_writer;

-- app_user: read its own tenant's log and head, append through the function, verify.
GRANT SELECT ON audit.audit_event, audit.chain_head, audit.action_registry TO app_user;
GRANT EXECUTE ON FUNCTION audit.verify_chain(uuid), audit.canonical_text(audit.audit_event),
  audit.compute_row_hash(audit.audit_event), audit.jcs(jsonb), audit.jcs_string(text) TO app_user;

REVOKE ALL ON FUNCTION audit.write_event(uuid, text, text, text, text, text, uuid, uuid, text, uuid, uuid, text[], text, jsonb, jsonb, inet, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION audit.append_event(uuid, text, text, text, text, text, uuid, uuid, text, uuid, uuid, text[], text, jsonb, jsonb, inet, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.append_event(uuid, text, text, text, text, text, uuid, uuid, text, uuid, uuid, text[], text, jsonb, jsonb, inet, text, uuid) TO app_user;

-- Hand the writer function, the entry point, and chain_head to audit_writer (ADR-0011).
-- A new owner needs CREATE on the schema; grant it only for the transfer.
GRANT CREATE ON SCHEMA audit TO audit_writer;
ALTER FUNCTION audit.write_event(uuid, text, text, text, text, text, uuid, uuid, text, uuid, uuid, text[], text, jsonb, jsonb, inet, text, uuid) OWNER TO audit_writer;
ALTER FUNCTION audit.append_event(uuid, text, text, text, text, text, uuid, uuid, text, uuid, uuid, text[], text, jsonb, jsonb, inet, text, uuid) OWNER TO audit_writer;
ALTER TABLE audit.chain_head OWNER TO audit_writer;
REVOKE CREATE ON SCHEMA audit FROM audit_writer;

-- Provisioning (owned by app_owner) writes the genesis event through write_event. The
-- grant must come from the new owner: ALTER OWNER rewrites the old owner's own ACL entry.
SET LOCAL ROLE audit_writer;
GRANT EXECUTE ON FUNCTION audit.write_event(uuid, text, text, text, text, text, uuid, uuid, text, uuid, uuid, text[], text, jsonb, jsonb, inet, text, uuid) TO app_owner;
SET LOCAL ROLE app_owner;
