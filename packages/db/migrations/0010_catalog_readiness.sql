-- 0010 Catalog releases, the job queue, and readiness (phase-1 plan S4; ADR-0003 rules 3,
-- 4, 5, 7, 8; ADR-0001 job queue; ADR-0011 roles).
--
-- Catalog (schema catalog, global, read-only to tenants):
--   * catalog.database_profile says whether this database is production or non-production.
--     It is set once, by the migration job (app_owner), and never changes. With no profile,
--     nothing can be published (fail closed).
--   * catalog.catalog_release, catalog.requirement, catalog.requirement_version hold the
--     published bundles, keyed by catalog_version. Released rows are immutable: a trigger
--     rejects UPDATE, DELETE, and TRUNCATE for every role, the owner included.
--   * catalog.publish_release (SECURITY DEFINER, EXECUTE for app_platform only) loads a
--     compiled bundle. It refuses a bundle whose channel differs from the database's, a
--     non-verified entry in a production bundle, an edited release, and a version that is
--     not greater than the last one. Republishing identical content is a no-op.
--   * Constraint requirement_version_production_verified: a production row must be
--     verified. The release channel is carried into each row through a composite foreign
--     key, so no writer (not even the owner) can store a draft in a production release.
--
-- Job queue (schema platform; ADR-0001: enqueue is transactional with the change):
--   * platform.job rows are written by public.enqueue_job (app_user, inside the tenant
--     transaction; the tenant comes from app.organization_id) or platform.enqueue_job
--     (app_platform fan-out). A queued job with the same queue, tenant, and singleton key
--     is coalesced. platform.claim_jobs / complete_job / fail_job (app_platform) drain it:
--     leases make a crashed run resumable, and every job row is its own run record.
--   * Payloads carry ids only, never personal data.
--
-- Readiness (tenant tables, forced RLS):
--   * requirement_instance gains not_assessed, the catalog release it was evaluated under,
--     the reason codes, and who marked it not applicable. Marking "not applicable" needs a
--     human actor (product principle 2: AI never attests).
--   * tenant_parameter: a health center's value for a bounded catalog parameter, with a
--     reason. Bounds come from the catalog and are checked by the service.
--   * readiness_fact: dated evidence facts the engine reads (document, completion,
--     expiration, approval, change). Recorded by a person or an integration, never by a
--     service (AI) actor; corrected only by retraction.
--   * readiness_snapshot: insert-only, pinned to the catalog release it was computed under.
--
-- Reversal (development only): DROP TABLE public.readiness_snapshot, public.readiness_fact,
--   public.tenant_parameter, platform.job, catalog.requirement_version, catalog.requirement,
--   catalog.catalog_release, catalog.database_profile; DROP SCHEMA catalog; restore the 0001
--   status check; DROP the columns added to requirement_instance; DROP the functions below;
--   DELETE the audit actions below.

-- ---------------------------------------------------------------------------
-- catalog schema
-- ---------------------------------------------------------------------------

CREATE SCHEMA catalog AUTHORIZATION app_owner;
REVOKE ALL ON SCHEMA catalog FROM PUBLIC;
GRANT USAGE ON SCHEMA catalog TO app_user, app_platform;

CREATE TABLE catalog.database_profile (
  singleton  boolean     NOT NULL DEFAULT true PRIMARY KEY CHECK (singleton),
  channel    text        NOT NULL CHECK (channel IN ('production', 'non_production')),
  set_at     timestamptz NOT NULL DEFAULT now(),
  set_by     text        NOT NULL CHECK (length(btrim(set_by)) BETWEEN 1 AND 200)
);

CREATE TABLE catalog.catalog_release (
  id                    uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  catalog_version       text        NOT NULL UNIQUE
                        CHECK (catalog_version ~ '^(0|[1-9][0-9]{0,8})[.](0|[1-9][0-9]{0,8})[.](0|[1-9][0-9]{0,8})$'),
  channel               text        NOT NULL CHECK (channel IN ('production', 'non_production')),
  bundle_format         smallint    NOT NULL CHECK (bundle_format = 1),
  content_hash          text        NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  source_register_hash  text        NOT NULL CHECK (source_register_hash ~ '^[0-9a-f]{64}$'),
  entry_count           integer     NOT NULL CHECK (entry_count >= 0),
  sources               jsonb       NOT NULL CHECK (jsonb_typeof(sources) = 'array'),
  changeset             jsonb       NOT NULL CHECK (jsonb_typeof(changeset) = 'array'),
  published_at          timestamptz NOT NULL DEFAULT now(),
  published_by          text        NOT NULL CHECK (length(btrim(published_by)) BETWEEN 1 AND 200),
  CONSTRAINT catalog_release_id_channel_key UNIQUE (id, channel)
);

-- Stable requirementIds ever published here (ADR-0003 rule 2): never deleted or renamed.
CREATE TABLE catalog.requirement (
  id                text        NOT NULL PRIMARY KEY CHECK (id ~ '^[A-Z0-9]+(-[A-Za-z0-9&]+)+$'),
  jurisdiction      text        NOT NULL CHECK (jurisdiction IN ('federal', 'florida')),
  first_release_id  uuid        NOT NULL REFERENCES catalog.catalog_release (id)
);

CREATE TABLE catalog.requirement_version (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  catalog_release_id  uuid        NOT NULL,
  channel             text        NOT NULL CHECK (channel IN ('production', 'non_production')),
  requirement_id      text        NOT NULL REFERENCES catalog.requirement (id),
  status              text        NOT NULL CHECK (status IN ('draft', 'verified', 'retired')),
  entry_hash          text        NOT NULL CHECK (entry_hash ~ '^[0-9a-f]{64}$'),
  chapter             smallint    CHECK (chapter BETWEEN 1 AND 21),
  layer               text        NOT NULL CHECK (layer IN ('requirement', 'best_practice', 'state_requirement')),
  jurisdiction        text        NOT NULL CHECK (jurisdiction IN ('federal', 'florida')),
  severity            text        NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  title               text        NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 300),
  effective_from      date        NOT NULL,
  effective_to        date,
  entry               jsonb       NOT NULL CHECK (jsonb_typeof(entry) = 'object'),
  CONSTRAINT requirement_version_release_fk FOREIGN KEY (catalog_release_id, channel)
    REFERENCES catalog.catalog_release (id, channel),
  CONSTRAINT requirement_version_release_requirement_key UNIQUE (catalog_release_id, requirement_id),
  CONSTRAINT requirement_version_effective_range CHECK (effective_to IS NULL OR effective_to >= effective_from),
  -- ADR-0003 rule 8: a production release holds verified entries only.
  CONSTRAINT requirement_version_production_verified CHECK (channel <> 'production' OR status = 'verified')
);

CREATE INDEX requirement_version_requirement_idx ON catalog.requirement_version (requirement_id, catalog_release_id);

-- Released versions are never edited (ADR-0003 rule 3), whoever tries. Also used for
-- readiness snapshots (rule 4).
CREATE FUNCTION catalog.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'rows of %.% are immutable: never edited or deleted', TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER catalog_release_immutable BEFORE UPDATE OR DELETE ON catalog.catalog_release
  FOR EACH ROW EXECUTE FUNCTION catalog.forbid_mutation();
CREATE TRIGGER catalog_release_no_truncate BEFORE TRUNCATE ON catalog.catalog_release
  FOR EACH STATEMENT EXECUTE FUNCTION catalog.forbid_mutation();
CREATE TRIGGER requirement_immutable BEFORE UPDATE OR DELETE ON catalog.requirement
  FOR EACH ROW EXECUTE FUNCTION catalog.forbid_mutation();
CREATE TRIGGER requirement_no_truncate BEFORE TRUNCATE ON catalog.requirement
  FOR EACH STATEMENT EXECUTE FUNCTION catalog.forbid_mutation();
CREATE TRIGGER requirement_version_immutable BEFORE UPDATE OR DELETE ON catalog.requirement_version
  FOR EACH ROW EXECUTE FUNCTION catalog.forbid_mutation();
CREATE TRIGGER requirement_version_no_truncate BEFORE TRUNCATE ON catalog.requirement_version
  FOR EACH STATEMENT EXECUTE FUNCTION catalog.forbid_mutation();
CREATE TRIGGER database_profile_immutable BEFORE UPDATE OR DELETE ON catalog.database_profile
  FOR EACH ROW EXECUTE FUNCTION catalog.forbid_mutation();
CREATE TRIGGER database_profile_no_truncate BEFORE TRUNCATE ON catalog.database_profile
  FOR EACH STATEMENT EXECUTE FUNCTION catalog.forbid_mutation();

-- A release's channel must be this database's channel.
CREATE FUNCTION catalog.release_channel_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_channel text;
BEGIN
  SELECT p.channel INTO v_channel FROM catalog.database_profile p;
  IF v_channel IS NULL THEN
    RAISE EXCEPTION 'this database has no catalog channel; the migration job sets it (catalog.set_database_channel)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.channel <> v_channel THEN
    RAISE EXCEPTION 'a % catalog release cannot be loaded into a % database', NEW.channel, v_channel
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER catalog_release_channel_guard BEFORE INSERT ON catalog.catalog_release
  FOR EACH ROW EXECUTE FUNCTION catalog.release_channel_guard();

-- Marks the database once. Idempotent for the same channel; any change is refused.
CREATE FUNCTION catalog.set_database_channel(p_channel text, p_set_by text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_current text;
BEGIN
  IF p_channel IS NULL OR p_channel NOT IN ('production', 'non_production') THEN
    RAISE EXCEPTION 'catalog channel must be production or non_production' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT p.channel INTO v_current FROM catalog.database_profile p;
  IF v_current IS NULL THEN
    INSERT INTO catalog.database_profile (channel, set_by) VALUES (p_channel, coalesce(nullif(btrim(p_set_by), ''), 'migration job'));
    RETURN p_channel;
  END IF;
  IF v_current <> p_channel THEN
    RAISE EXCEPTION 'this database is % and cannot become %', v_current, p_channel USING ERRCODE = 'check_violation';
  END IF;
  RETURN v_current;
END
$$;

-- Loads a compiled bundle (packages/requirements-catalog compileCatalog). Returns the release id.
CREATE FUNCTION catalog.publish_release(p_bundle jsonb, p_published_by text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_channel    text;
  v_version    text := p_bundle ->> 'catalogVersion';
  v_bundle_ch  text := p_bundle ->> 'channel';
  v_hash       text := p_bundle ->> 'contentHash';
  v_existing   catalog.catalog_release;
  v_latest     text;
  v_release_id uuid;
  v_entry      jsonb;
  v_bad        text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('catalog:publish'));
  IF p_bundle IS NULL OR jsonb_typeof(p_bundle) <> 'object' OR jsonb_typeof(p_bundle -> 'entries') <> 'array' THEN
    RAISE EXCEPTION 'publish_release: the bundle must be an object with an entries array' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT p.channel INTO v_channel FROM catalog.database_profile p;
  IF v_channel IS NULL THEN
    RAISE EXCEPTION 'this database has no catalog channel; nothing can be published' USING ERRCODE = 'check_violation';
  END IF;
  IF v_bundle_ch IS DISTINCT FROM v_channel THEN
    RAISE EXCEPTION 'a % bundle cannot be published into a % database', coalesce(v_bundle_ch, 'unknown'), v_channel
      USING ERRCODE = 'check_violation';
  END IF;
  -- ADR-0003 rule 8: the publish job refuses drafts in production (the table constraint
  -- would too; this names the entry).
  IF v_channel = 'production' THEN
    SELECT e ->> 'id' INTO v_bad FROM jsonb_array_elements(p_bundle -> 'entries') e
    WHERE e ->> 'status' IS DISTINCT FROM 'verified' LIMIT 1;
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'production refuses non-verified catalog entry %', v_bad USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  SELECT * INTO v_existing FROM catalog.catalog_release r WHERE r.catalog_version = v_version;
  IF FOUND THEN
    IF v_existing.content_hash = v_hash AND v_existing.channel = v_bundle_ch THEN
      RETURN v_existing.id;  -- the same release again: nothing to do
    END IF;
    RAISE EXCEPTION 'catalog % is already released with other content; released versions are never edited', v_version
      USING ERRCODE = 'unique_violation';
  END IF;
  SELECT r.catalog_version INTO v_latest FROM catalog.catalog_release r
  ORDER BY string_to_array(r.catalog_version, '.')::int[] DESC LIMIT 1;
  IF v_latest IS NOT NULL AND string_to_array(v_version, '.')::int[] <= string_to_array(v_latest, '.')::int[] THEN
    RAISE EXCEPTION 'catalog % must be greater than the last release %', v_version, v_latest USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO catalog.catalog_release (catalog_version, channel, bundle_format, content_hash, source_register_hash,
                                       entry_count, sources, changeset, published_by)
  VALUES (v_version, v_bundle_ch, (p_bundle ->> 'format')::smallint, v_hash, p_bundle ->> 'sourceRegisterHash',
          jsonb_array_length(p_bundle -> 'entries'), coalesce(p_bundle -> 'sources', '[]'::jsonb),
          coalesce(p_bundle -> 'changeset', '[]'::jsonb), coalesce(nullif(btrim(p_published_by), ''), 'catalog publish job'))
  RETURNING id INTO v_release_id;

  FOR v_entry IN SELECT e FROM jsonb_array_elements(p_bundle -> 'entries') e LOOP
    INSERT INTO catalog.requirement (id, jurisdiction, first_release_id)
    VALUES (v_entry ->> 'id', coalesce(v_entry #>> '{appliesTo,jurisdiction}', 'federal'), v_release_id)
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO catalog.requirement_version (catalog_release_id, channel, requirement_id, status, entry_hash, chapter,
                                             layer, jurisdiction, severity, title, effective_from, effective_to, entry)
    VALUES (v_release_id, v_bundle_ch, v_entry ->> 'id', v_entry ->> 'status', v_entry ->> 'entryHash',
            (v_entry ->> 'chapter')::smallint, v_entry ->> 'layer',
            coalesce(v_entry #>> '{appliesTo,jurisdiction}', 'federal'), v_entry ->> 'severity', v_entry ->> 'title',
            (v_entry #>> '{effective,from}')::date, (v_entry #>> '{effective,to}')::date, v_entry - 'entryHash');
  END LOOP;
  RETURN v_release_id;
END
$$;

REVOKE ALL ON FUNCTION catalog.set_database_channel(text, text), catalog.publish_release(jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.publish_release(jsonb, text) TO app_platform;
-- set_database_channel: app_owner only (the migration job).

GRANT SELECT ON catalog.database_profile, catalog.catalog_release, catalog.requirement,
  catalog.requirement_version TO app_user, app_platform;

-- ---------------------------------------------------------------------------
-- Job queue
-- ---------------------------------------------------------------------------

CREATE TABLE platform.job (
  id               uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  queue            text        NOT NULL CHECK (queue ~ '^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)+$'),
  organization_id  uuid        REFERENCES public.organization (id),
  actor_label      text        NOT NULL CHECK (length(btrim(actor_label)) BETWEEN 1 AND 200),
  request_id       uuid,
  payload          jsonb       NOT NULL DEFAULT '{}'
                   CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 8192),
  singleton_key    text        CHECK (singleton_key ~ '^[A-Za-z0-9_.:-]{1,200}$'),
  state            text        NOT NULL DEFAULT 'queued'
                   CHECK (state IN ('queued', 'active', 'completed', 'failed', 'superseded')),
  attempts         integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts     integer     NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 25),
  run_after        timestamptz NOT NULL DEFAULT now(),
  locked_until     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  started_at       timestamptz,
  finished_at      timestamptz,
  last_error_code  text        CHECK (last_error_code ~ '^[A-Za-z0-9_.:-]{1,100}$')
);

-- One queued job per queue, tenant, and singleton key (a burst of changes coalesces).
CREATE UNIQUE INDEX job_singleton_queued_key ON platform.job (queue, organization_id, singleton_key)
  NULLS NOT DISTINCT WHERE state = 'queued' AND singleton_key IS NOT NULL;
CREATE INDEX job_ready_idx ON platform.job (queue, run_after) WHERE state IN ('queued', 'active');

-- RLS on with no policy: only the owner (through the definer functions) sees rows.
ALTER TABLE platform.job ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION platform.insert_job(
  p_organization_id uuid, p_queue text, p_payload jsonb, p_singleton_key text,
  p_run_after timestamptz, p_max_attempts integer, p_actor_label text
) RETURNS uuid
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO platform.job (queue, organization_id, actor_label, request_id, payload, singleton_key, run_after, max_attempts)
  VALUES (p_queue, p_organization_id, coalesce(nullif(btrim(p_actor_label), ''), 'job'),
          nullif(current_setting('app.request_id', true), '')::uuid, coalesce(p_payload, '{}'::jsonb),
          p_singleton_key, coalesce(p_run_after, now()), coalesce(p_max_attempts, 5))
  ON CONFLICT (queue, organization_id, singleton_key) WHERE state = 'queued' AND singleton_key IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT j.id INTO v_id FROM platform.job j
    WHERE j.queue = p_queue AND j.organization_id IS NOT DISTINCT FROM p_organization_id
      AND j.singleton_key = p_singleton_key AND j.state = 'queued';
  END IF;
  RETURN v_id;
END
$$;

-- For app_user, inside the tenant transaction: the job exists only if the change commits.
CREATE FUNCTION public.enqueue_job(
  p_queue          text,
  p_payload        jsonb   DEFAULT '{}',
  p_singleton_key  text    DEFAULT NULL,
  p_actor_label    text    DEFAULT NULL,
  p_run_after      timestamptz DEFAULT NULL,
  p_max_attempts   integer DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  -- No missing_ok: a call without tenant context raises.
  RETURN platform.insert_job(current_setting('app.organization_id')::uuid, p_queue, p_payload, p_singleton_key,
                             p_run_after, p_max_attempts, p_actor_label);
END
$$;

-- For app_platform: fan-out to a tenant (or a platform job with p_organization_id NULL).
CREATE FUNCTION platform.enqueue_job(
  p_organization_id uuid,
  p_queue           text,
  p_payload         jsonb   DEFAULT '{}',
  p_singleton_key   text    DEFAULT NULL,
  p_actor_label     text    DEFAULT NULL,
  p_run_after       timestamptz DEFAULT NULL,
  p_max_attempts    integer DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN platform.insert_job(p_organization_id, p_queue, p_payload, p_singleton_key, p_run_after, p_max_attempts,
                             p_actor_label);
END
$$;

-- Claims up to p_limit ready jobs: queued and due, or active with an expired lease (a run
-- that crashed). A job out of attempts is marked failed instead of claimed.
CREATE FUNCTION platform.claim_jobs(p_queues text[], p_limit integer, p_lease_seconds integer)
RETURNS SETOF platform.job
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  UPDATE platform.job j SET state = 'failed', finished_at = clock_timestamp(), locked_until = NULL,
         last_error_code = coalesce(j.last_error_code, 'lease_expired')
  WHERE j.state = 'active' AND j.locked_until < clock_timestamp() AND j.attempts >= j.max_attempts
    AND j.queue = ANY (p_queues);
  RETURN QUERY
  WITH ready AS (
    SELECT j.id FROM platform.job j
    WHERE j.queue = ANY (p_queues)
      AND ((j.state = 'queued' AND j.run_after <= clock_timestamp())
           OR (j.state = 'active' AND j.locked_until < clock_timestamp()))
    ORDER BY j.run_after, j.created_at, j.id
    LIMIT greatest(1, least(coalesce(p_limit, 10), 100))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE platform.job j
  SET state = 'active', attempts = j.attempts + 1, started_at = clock_timestamp(),
      locked_until = clock_timestamp() + make_interval(secs => greatest(5, least(coalesce(p_lease_seconds, 300), 3600)))
  FROM ready WHERE j.id = ready.id
  RETURNING j.*;
END
$$;

CREATE FUNCTION platform.complete_job(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  UPDATE platform.job SET state = 'completed', finished_at = clock_timestamp(), locked_until = NULL
  WHERE id = p_id AND state = 'active';
  RETURN FOUND;
END
$$;

-- Retries with the given delay while attempts remain, then fails. If a newer queued job with
-- the same singleton key exists, this one is superseded (the newer one does the work).
CREATE FUNCTION platform.fail_job(p_id uuid, p_error_code text, p_retry_after_seconds integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_job platform.job;
BEGIN
  SELECT * INTO v_job FROM platform.job WHERE id = p_id AND state = 'active' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF v_job.attempts >= v_job.max_attempts THEN
    UPDATE platform.job SET state = 'failed', finished_at = clock_timestamp(), locked_until = NULL,
           last_error_code = p_error_code WHERE id = p_id;
    RETURN 'failed';
  END IF;
  BEGIN
    UPDATE platform.job SET state = 'queued', locked_until = NULL, last_error_code = p_error_code,
           run_after = clock_timestamp() + make_interval(secs => greatest(0, least(coalesce(p_retry_after_seconds, 60), 86400)))
    WHERE id = p_id;
  EXCEPTION WHEN unique_violation THEN
    UPDATE platform.job SET state = 'superseded', finished_at = clock_timestamp(), locked_until = NULL,
           last_error_code = p_error_code WHERE id = p_id;
    RETURN 'superseded';
  END;
  RETURN 'queued';
END
$$;

REVOKE ALL ON FUNCTION platform.insert_job(uuid, text, jsonb, text, timestamptz, integer, text),
  public.enqueue_job(text, jsonb, text, text, timestamptz, integer),
  platform.enqueue_job(uuid, text, jsonb, text, text, timestamptz, integer),
  platform.claim_jobs(text[], integer, integer), platform.complete_job(uuid),
  platform.fail_job(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_job(text, jsonb, text, text, timestamptz, integer) TO app_user;
GRANT EXECUTE ON FUNCTION platform.enqueue_job(uuid, text, jsonb, text, text, timestamptz, integer),
  platform.claim_jobs(text[], integer, integer), platform.complete_job(uuid),
  platform.fail_job(uuid, text, integer) TO app_platform;

-- ---------------------------------------------------------------------------
-- requirement_instance: not_assessed, catalog pin, reasons, and who marked N/A
-- ---------------------------------------------------------------------------

ALTER TABLE public.requirement_instance
  DROP CONSTRAINT requirement_instance_status_check,
  ADD CONSTRAINT requirement_instance_status_check
    CHECK (status IN ('met', 'due_soon', 'overdue', 'missing', 'not_applicable', 'not_assessed')),
  ADD COLUMN catalog_release_id  uuid,
  ADD COLUMN status_reasons      jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(status_reasons) = 'array'),
  ADD COLUMN not_applicable_by   uuid,
  ADD COLUMN not_applicable_at   timestamptz,
  -- NOT VALID, as in 0009: the validation query would run under forced RLS without a tenant
  -- context. Every new or changed row is checked by the FK triggers; before 0010 the three
  -- columns were NULL everywhere (catalog_release_id and not_applicable_by are new, and
  -- requirement_version_id had no table to point at).
  ADD CONSTRAINT requirement_instance_release_fk FOREIGN KEY (catalog_release_id)
    REFERENCES catalog.catalog_release (id) NOT VALID,
  ADD CONSTRAINT requirement_instance_version_fk FOREIGN KEY (requirement_version_id)
    REFERENCES catalog.requirement_version (id) NOT VALID,
  ADD CONSTRAINT requirement_instance_na_by_fk FOREIGN KEY (organization_id, not_applicable_by)
    REFERENCES public.user_account (organization_id, id) NOT VALID,
  ADD CONSTRAINT requirement_instance_na_fields CHECK (
    (not_applicable_reason IS NULL) = (not_applicable_at IS NULL)),
  -- A human N/A mark outlives the engine: it stays (reason, by, at) while the catalog does
  -- not honor it, and only a person clears it (clearNotApplicable). So the reason no longer
  -- implies status = 'not_applicable'; status = 'not_applicable' still needs a reason.
  DROP CONSTRAINT requirement_instance_na_reason,
  ADD CONSTRAINT requirement_instance_na_reason CHECK (
    (status <> 'not_applicable' OR not_applicable_reason IS NOT NULL)
    AND (not_applicable_reason IS NULL OR length(btrim(not_applicable_reason)) > 0)),
  -- Set by the recompute job when the effective catalog entry no longer allows N/A: the
  -- mark is kept and flagged for human review (status computed normally).
  ADD COLUMN not_applicable_superseded_at              timestamptz,
  ADD COLUMN not_applicable_superseded_catalog_version text,
  ADD CONSTRAINT requirement_instance_na_superseded CHECK (
    (not_applicable_superseded_at IS NULL) = (not_applicable_superseded_catalog_version IS NULL)
    AND (not_applicable_superseded_at IS NULL OR not_applicable_reason IS NOT NULL));

-- A "not applicable" mark is a human decision (product principle 2). Setting it and
-- clearing it both need a human actor, and the database records who and when from the
-- transaction, whatever the caller sent. No system job (the readiness engine included)
-- can set, change, or clear a mark; it can only flag one as superseded.
CREATE FUNCTION public.requirement_instance_na_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
  v_old   text := CASE WHEN TG_OP = 'UPDATE' THEN OLD.not_applicable_reason END;
BEGIN
  IF NEW.not_applicable_reason IS NOT DISTINCT FROM v_old THEN
    IF TG_OP = 'UPDATE' THEN
      NEW.not_applicable_by := OLD.not_applicable_by;
      NEW.not_applicable_at := OLD.not_applicable_at;
    ELSE
      NEW.not_applicable_by := NULL;
      NEW.not_applicable_at := NULL;
    END IF;
    RETURN NEW;
  END IF;
  -- A blank reason is left to the table's check constraint (23514).
  IF NEW.not_applicable_reason IS NOT NULL AND length(btrim(NEW.not_applicable_reason)) = 0 THEN
    RETURN NEW;
  END IF;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'setting or clearing a not-applicable mark needs a human user' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.not_applicable_reason IS NULL THEN
    NEW.not_applicable_by := NULL;
    NEW.not_applicable_at := NULL;
  ELSE
    NEW.not_applicable_by := v_actor;
    NEW.not_applicable_at := now();
  END IF;
  NEW.not_applicable_superseded_at := NULL;
  NEW.not_applicable_superseded_catalog_version := NULL;
  RETURN NEW;
END
$$;

CREATE TRIGGER requirement_instance_na_guard BEFORE INSERT OR UPDATE ON public.requirement_instance
  FOR EACH ROW EXECUTE FUNCTION public.requirement_instance_na_guard();

CREATE INDEX requirement_instance_org_release_idx ON public.requirement_instance (organization_id, catalog_release_id);

-- ---------------------------------------------------------------------------
-- tenant_parameter
-- ---------------------------------------------------------------------------

CREATE TABLE public.tenant_parameter (
  id               uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  uuid        NOT NULL REFERENCES public.organization (id),
  requirement_id   text        NOT NULL CHECK (requirement_id ~ '^[A-Z0-9]+(-[A-Za-z0-9&]+)+$'),
  parameter_key    text        NOT NULL CHECK (parameter_key ~ '^[a-z][A-Za-z0-9]{0,63}$'),
  value            integer     NOT NULL CHECK (value BETWEEN -100000 AND 100000),
  reason           text        NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
  row_version      integer     NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid,
  CONSTRAINT tenant_parameter_key UNIQUE (organization_id, requirement_id, parameter_key),
  CONSTRAINT tenant_parameter_org_id_key UNIQUE (organization_id, id)
);

CREATE TRIGGER tenant_parameter_row_meta BEFORE INSERT OR UPDATE ON public.tenant_parameter
  FOR EACH ROW EXECUTE FUNCTION public.set_row_meta();

-- Health-center choices are made by people (the value and its reason are audited).
-- AFTER the row passes RLS, so a cross-tenant write fails on RLS first.
CREATE FUNCTION public.tenant_parameter_human_only() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF nullif(current_setting('app.actor_id', true), '') IS NULL THEN
    RAISE EXCEPTION 'a health center parameter is set by a human user' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.requirement_id IS DISTINCT FROM OLD.requirement_id
                           OR NEW.parameter_key IS DISTINCT FROM OLD.parameter_key) THEN
    RAISE EXCEPTION 'tenant_parameter requirement_id and parameter_key are immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER tenant_parameter_human_only AFTER INSERT OR UPDATE ON public.tenant_parameter
  FOR EACH ROW EXECUTE FUNCTION public.tenant_parameter_human_only();

ALTER TABLE public.tenant_parameter ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_parameter FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.tenant_parameter
  USING (organization_id = current_setting('app.organization_id')::uuid)
  WITH CHECK (organization_id = current_setting('app.organization_id')::uuid);

GRANT SELECT, INSERT, UPDATE ON public.tenant_parameter TO app_user;

-- ---------------------------------------------------------------------------
-- readiness_fact
-- ---------------------------------------------------------------------------

CREATE TABLE public.readiness_fact (
  id                       uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id          uuid        NOT NULL REFERENCES public.organization (id),
  requirement_instance_id  uuid        NOT NULL,
  kind                     text        NOT NULL
                           CHECK (kind IN ('document', 'completion', 'expiration', 'approval', 'change')),
  effective_on             date        NOT NULL,
  expires_on               date,
  approval_id              uuid,
  approval_capacity        text        CHECK (approval_capacity IN ('board', 'committee_ratified', 'designated', 'staff')),
  approval_decision        text        CHECK (approval_decision IN ('approved', 'rejected')),
  approval_type_id         text        CHECK (approval_type_id ~ '^[a-z][a-z0-9_]*([.][a-z0-9_*]+)+$'),
  evidence_version_id      uuid,
  recorded_by_type         text        NOT NULL CHECK (recorded_by_type IN ('user', 'break_glass', 'integration')),
  recorded_at              timestamptz NOT NULL DEFAULT now(),
  retracted_at             timestamptz,
  retracted_by             uuid,
  retract_reason           text,
  row_version              integer     NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  updated_by               uuid,
  CONSTRAINT readiness_fact_instance_fk FOREIGN KEY (organization_id, requirement_instance_id)
    REFERENCES public.requirement_instance (organization_id, id),
  CONSTRAINT readiness_fact_approval_fk FOREIGN KEY (organization_id, approval_id)
    REFERENCES public.approval (organization_id, id),
  CONSTRAINT readiness_fact_retracted_by_fk FOREIGN KEY (organization_id, retracted_by)
    REFERENCES public.user_account (organization_id, id),
  CONSTRAINT readiness_fact_expiration_has_date CHECK ((kind = 'expiration') = (expires_on IS NOT NULL)),
  CONSTRAINT readiness_fact_approval_fields CHECK (
    (kind = 'approval') = (approval_capacity IS NOT NULL AND approval_decision IS NOT NULL)),
  CONSTRAINT readiness_fact_retraction CHECK (
    (retracted_at IS NULL) = (retract_reason IS NULL)
    AND (retract_reason IS NULL OR length(btrim(retract_reason)) BETWEEN 1 AND 2000)),
  CONSTRAINT readiness_fact_org_id_key UNIQUE (organization_id, id)
);

CREATE INDEX readiness_fact_instance_idx ON public.readiness_fact (organization_id, requirement_instance_id);

CREATE TRIGGER readiness_fact_row_meta BEFORE INSERT OR UPDATE ON public.readiness_fact
  FOR EACH ROW EXECUTE FUNCTION public.set_row_meta();

-- Facts are recorded by people or integrations, never by a service (AI) actor; the time is
-- the database's. A fact is never edited: the one allowed change is a human retraction.
CREATE FUNCTION public.readiness_fact_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF (NEW.recorded_by_type IN ('user', 'break_glass')) <> (v_actor IS NOT NULL) THEN
      RAISE EXCEPTION 'readiness_fact recorded_by_type % does not match the transaction actor', NEW.recorded_by_type
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.retracted_at IS NOT NULL THEN
      RAISE EXCEPTION 'a new readiness_fact cannot be retracted already' USING ERRCODE = 'check_violation';
    END IF;
    NEW.recorded_at := now();
    RETURN NEW;
  END IF;
  IF OLD.retracted_at IS NOT NULL THEN
    RAISE EXCEPTION 'readiness_fact % is retracted and can no longer change', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['retracted_at', 'retracted_by', 'retract_reason', 'row_version', 'updated_at', 'updated_by'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['retracted_at', 'retracted_by', 'retract_reason', 'row_version', 'updated_at', 'updated_by']) THEN
    RAISE EXCEPTION 'readiness_fact is never edited; retract it and record a new one' USING ERRCODE = 'check_violation';
  END IF;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'retracting evidence needs a human user' USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.retracted_at := now();
  NEW.retracted_by := v_actor;
  RETURN NEW;
END
$$;

CREATE TRIGGER readiness_fact_guard BEFORE INSERT OR UPDATE ON public.readiness_fact
  FOR EACH ROW EXECUTE FUNCTION public.readiness_fact_guard();

ALTER TABLE public.readiness_fact ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.readiness_fact FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.readiness_fact
  USING (organization_id = current_setting('app.organization_id')::uuid)
  WITH CHECK (organization_id = current_setting('app.organization_id')::uuid);

GRANT SELECT, INSERT, UPDATE ON public.readiness_fact TO app_user;

-- ---------------------------------------------------------------------------
-- readiness_snapshot (insert-only, pinned to its catalog release)
-- ---------------------------------------------------------------------------

CREATE TABLE public.readiness_snapshot (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id     uuid        NOT NULL REFERENCES public.organization (id),
  catalog_release_id  uuid        NOT NULL REFERENCES catalog.catalog_release (id),
  catalog_version     text        NOT NULL,
  engine_version      text        NOT NULL CHECK (engine_version ~ '^[0-9]+[.][0-9]+[.][0-9]+$'),
  as_of_date          date        NOT NULL,
  kind                text        NOT NULL CHECK (kind IN ('nightly', 'on_demand')),
  met                 integer     NOT NULL CHECK (met >= 0),
  denominator         integer     NOT NULL CHECK (denominator >= met),
  body                jsonb       NOT NULL CHECK (jsonb_typeof(body) = 'object'),
  computed_at         timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid,
  CONSTRAINT readiness_snapshot_key UNIQUE (organization_id, catalog_release_id, as_of_date, kind),
  CONSTRAINT readiness_snapshot_org_id_key UNIQUE (organization_id, id)
);

CREATE INDEX readiness_snapshot_org_date_idx ON public.readiness_snapshot (organization_id, as_of_date);

CREATE TRIGGER readiness_snapshot_row_meta BEFORE INSERT ON public.readiness_snapshot
  FOR EACH ROW EXECUTE FUNCTION public.set_row_meta();
-- Snapshots are never recomputed silently (ADR-0003 rule 4): no role edits one.
CREATE TRIGGER readiness_snapshot_immutable BEFORE UPDATE OR DELETE ON public.readiness_snapshot
  FOR EACH ROW EXECUTE FUNCTION catalog.forbid_mutation();

ALTER TABLE public.readiness_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.readiness_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.readiness_snapshot
  USING (organization_id = current_setting('app.organization_id')::uuid)
  WITH CHECK (organization_id = current_setting('app.organization_id')::uuid);

GRANT SELECT, INSERT ON public.readiness_snapshot TO app_user;

-- ---------------------------------------------------------------------------
-- Audit actions (same list as BASE_AUDIT_ACTIONS in @deemed/domain)
-- ---------------------------------------------------------------------------

INSERT INTO audit.action_registry (action, category, description) VALUES
  ('requirement_instance.evaluate',             'mutation', 'Readiness status recomputed by the engine (internal readiness)'),
  ('requirement_instance.clear_not_applicable', 'mutation', 'Not applicable mark removed, with reason'),
  ('tenant_parameter.set',                      'mutation', 'Health center value for a catalog parameter set, with reason'),
  ('readiness_fact.record',                     'mutation', 'Readiness evidence fact recorded'),
  ('readiness_fact.retract',                    'mutation', 'Readiness evidence fact retracted, with reason'),
  ('readiness_snapshot.create',                 'system',   'Readiness snapshot stored (internal readiness)');
