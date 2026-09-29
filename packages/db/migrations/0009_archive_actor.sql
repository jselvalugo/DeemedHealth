-- 0009 Who archived a record is the database's fact, not the caller's (security review
-- L5 of S4b, ADR-0014 section 2.4).
--
--   * public.set_row_meta() now also owns archived_by: when archived_at changes it becomes
--     the transaction's actor (app.actor_id) or NULL when the row is restored, and any
--     other change to archived_by is ignored. A caller can no longer name someone else.
--   * Archiving needs a human actor and a reason: archived_by and archive_reason are
--     present exactly when archived_at is. Service and system actors never archive
--     (retention jobs delete through their own role, ADR-0008 section 8).
--   * archived_by references a user account of the same organization (composite key, so
--     the reference cannot point into another tenant). The keys are added NOT VALID: the
--     initial validation query runs under the tables' forced RLS, which needs a tenant
--     context a migration does not have. Every new or changed row is checked by the
--     foreign-key triggers (which bypass RLS); before 0009 only the API wrote archived_by,
--     always as the acting user of the same tenant.
--
-- A new migration rather than an edit of 0008, so a database that already applied 0008
-- keeps a valid checksum.
--
-- Reversal (development only): restore 0008's public.set_row_meta(); for each table below
--   DROP CONSTRAINT <table>_archived_by_fk and <table>_archive_fields, then re-add 0008's
--   <table>_archive_fields check.

CREATE OR REPLACE FUNCTION public.set_row_meta() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor    uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
  v_new      jsonb := to_jsonb(NEW);
  v_old      jsonb;
  v_archived boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
    NEW.created_by := v_actor;
    -- A caller cannot choose the starting version.
    IF v_new ? 'row_version' THEN
      NEW := jsonb_populate_record(NEW, jsonb_build_object('row_version', 1));
    END IF;
    -- A row inserted archived was archived by this actor.
    IF v_new ? 'archived_by' THEN
      NEW := jsonb_populate_record(NEW, jsonb_build_object('archived_by',
        CASE WHEN v_new ->> 'archived_at' IS NULL THEN NULL ELSE v_actor END));
    END IF;
  ELSE
    v_old := to_jsonb(OLD);
    IF NEW.id IS DISTINCT FROM OLD.id
       OR (v_new ->> 'organization_id') IS DISTINCT FROM (v_old ->> 'organization_id') THEN
      RAISE EXCEPTION '%.%: id and organization_id are immutable', TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_at := OLD.created_at;
    NEW.created_by := OLD.created_by;
    -- Every update moves the version on by exactly one, whatever the caller sent.
    IF v_old ? 'row_version' THEN
      NEW := jsonb_populate_record(
        NEW, jsonb_build_object('row_version', (v_old ->> 'row_version')::integer + 1));
    END IF;
    -- archived_by follows archived_at: the actor who archives, NULL on restore, and
    -- otherwise unchanged whatever the caller sent.
    IF v_old ? 'archived_by' THEN
      v_archived := (v_new ->> 'archived_at') IS DISTINCT FROM (v_old ->> 'archived_at');
      NEW := jsonb_populate_record(NEW, jsonb_build_object('archived_by',
        CASE
          WHEN NOT v_archived THEN (v_old ->> 'archived_by')::uuid
          WHEN v_new ->> 'archived_at' IS NULL THEN NULL
          ELSE v_actor
        END));
    END IF;
  END IF;
  NEW.updated_at := now();
  NEW.updated_by := v_actor;
  RETURN NEW;
END
$$;

-- ---------------------------------------------------------------------------
-- Archive fields present together, and archived_by a user of the same tenant
-- ---------------------------------------------------------------------------

ALTER TABLE public.organization
  DROP CONSTRAINT organization_archive_fields,
  ADD CONSTRAINT organization_archive_fields CHECK (
    (archived_at IS NULL) = (archived_by IS NULL) AND (archived_at IS NULL) = (archive_reason IS NULL)),
  ADD CONSTRAINT organization_archived_by_fk FOREIGN KEY (id, archived_by)
    REFERENCES public.user_account (organization_id, id) NOT VALID;

ALTER TABLE public.site
  DROP CONSTRAINT site_archive_fields,
  ADD CONSTRAINT site_archive_fields CHECK (
    (archived_at IS NULL) = (archived_by IS NULL) AND (archived_at IS NULL) = (archive_reason IS NULL)),
  ADD CONSTRAINT site_archived_by_fk FOREIGN KEY (organization_id, archived_by)
    REFERENCES public.user_account (organization_id, id) NOT VALID;

ALTER TABLE public.person
  DROP CONSTRAINT person_archive_fields,
  ADD CONSTRAINT person_archive_fields CHECK (
    (archived_at IS NULL) = (archived_by IS NULL) AND (archived_at IS NULL) = (archive_reason IS NULL)),
  ADD CONSTRAINT person_archived_by_fk FOREIGN KEY (organization_id, archived_by)
    REFERENCES public.user_account (organization_id, id) NOT VALID;

ALTER TABLE public.user_account
  DROP CONSTRAINT user_account_archive_fields,
  ADD CONSTRAINT user_account_archive_fields CHECK (
    (archived_at IS NULL) = (archived_by IS NULL) AND (archived_at IS NULL) = (archive_reason IS NULL)),
  ADD CONSTRAINT user_account_archived_by_fk FOREIGN KEY (organization_id, archived_by)
    REFERENCES public.user_account (organization_id, id) NOT VALID;

ALTER TABLE public.requirement_instance
  DROP CONSTRAINT requirement_instance_archive_fields,
  ADD CONSTRAINT requirement_instance_archive_fields CHECK (
    (archived_at IS NULL) = (archived_by IS NULL) AND (archived_at IS NULL) = (archive_reason IS NULL)),
  ADD CONSTRAINT requirement_instance_archived_by_fk FOREIGN KEY (organization_id, archived_by)
    REFERENCES public.user_account (organization_id, id) NOT VALID;

ALTER TABLE public.task
  DROP CONSTRAINT task_archive_fields,
  ADD CONSTRAINT task_archive_fields CHECK (
    (archived_at IS NULL) = (archived_by IS NULL) AND (archived_at IS NULL) = (archive_reason IS NULL)),
  ADD CONSTRAINT task_archived_by_fk FOREIGN KEY (organization_id, archived_by)
    REFERENCES public.user_account (organization_id, id) NOT VALID;
