-- 0008 Records framework (ADR-0014, slice S4b): the columns and tables the generic
-- record API needs for the first record types (site, person, user_account,
-- role_assignment, requirement_instance).
--
--   * row_version on every mutable business table, set to 1 on insert and incremented on
--     every update by the existing public.set_row_meta() trigger (ADR-0014 section 2.3).
--     Tables without the column are unaffected. The API sends it as the ETag and requires
--     If-Match on every change; a stale version is 409 version_conflict.
--   * archived_by and archive_reason next to archived_at (soft delete only, section 2.4).
--     archive_reason is free text (PII class; the audit diff keeps its length and a keyed
--     digest only, ADR-0008 section 5).
--   * public.saved_view: private or role-shared list views (section 6). A saved view never
--     widens access: it is evaluated with the viewer's permissions.
--   * Index on audit.audit_event (organization_id, target_table, target_id, occurred_at)
--     for record history (section 2.6).
--   * Indexes so every sortable or filterable record field leads an index after
--     organization_id (section 1; checked against pg_indexes in the db tests).
--   * Audit actions generated from the record type registry
--     (packages/domain/src/generated/record-audit-actions.ts) and the saved-view actions.
--
-- Reversal (development only): DROP TABLE public.saved_view; DROP the indexes below;
--   ALTER TABLE ... DROP COLUMN row_version, archived_by, archive_reason; restore 0001's
--   public.set_row_meta(); DELETE FROM audit.action_registry WHERE action IN (the actions below).

-- ---------------------------------------------------------------------------
-- set_row_meta(): now also owns row_version where the table has it
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_row_meta() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
  v_new   jsonb := to_jsonb(NEW);
  v_old   jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
    NEW.created_by := v_actor;
    -- A caller cannot choose the starting version.
    IF v_new ? 'row_version' THEN
      NEW := jsonb_populate_record(NEW, jsonb_build_object('row_version', 1));
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
  END IF;
  NEW.updated_at := now();
  NEW.updated_by := v_actor;
  RETURN NEW;
END
$$;

-- ---------------------------------------------------------------------------
-- Row version and archive columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.organization
  ADD COLUMN row_version    integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  ADD COLUMN archived_by    uuid,
  ADD COLUMN archive_reason text,
  ADD CONSTRAINT organization_archive_fields CHECK (archived_at IS NOT NULL OR (archived_by IS NULL AND archive_reason IS NULL));

ALTER TABLE public.site
  ADD COLUMN row_version    integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  ADD COLUMN archived_by    uuid,
  ADD COLUMN archive_reason text,
  ADD CONSTRAINT site_archive_fields CHECK (archived_at IS NOT NULL OR (archived_by IS NULL AND archive_reason IS NULL));

ALTER TABLE public.person
  ADD COLUMN row_version    integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  ADD COLUMN archived_by    uuid,
  ADD COLUMN archive_reason text,
  ADD CONSTRAINT person_archive_fields CHECK (archived_at IS NOT NULL OR (archived_by IS NULL AND archive_reason IS NULL));

ALTER TABLE public.user_account
  ADD COLUMN row_version    integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  ADD COLUMN archived_by    uuid,
  ADD COLUMN archive_reason text,
  ADD CONSTRAINT user_account_archive_fields CHECK (archived_at IS NOT NULL OR (archived_by IS NULL AND archive_reason IS NULL));

-- role_assignment has no archive: a grant is revoked, never archived (0001).
ALTER TABLE public.role_assignment
  ADD COLUMN row_version    integer NOT NULL DEFAULT 1 CHECK (row_version >= 1);

ALTER TABLE public.requirement_instance
  ADD COLUMN row_version    integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  ADD COLUMN archived_by    uuid,
  ADD COLUMN archive_reason text,
  ADD CONSTRAINT requirement_instance_archive_fields CHECK (archived_at IS NOT NULL OR (archived_by IS NULL AND archive_reason IS NULL));

ALTER TABLE public.task
  ADD COLUMN row_version    integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  ADD COLUMN archived_by    uuid,
  ADD COLUMN archive_reason text,
  ADD CONSTRAINT task_archive_fields CHECK (archived_at IS NOT NULL OR (archived_by IS NULL AND archive_reason IS NULL));

-- ---------------------------------------------------------------------------
-- Indexes for sortable and filterable record fields (organization_id leads)
-- ---------------------------------------------------------------------------

CREATE INDEX site_org_name_idx       ON public.site (organization_id, name);
CREATE INDEX site_org_type_idx       ON public.site (organization_id, site_type);
CREATE INDEX site_org_tz_idx         ON public.site (organization_id, time_zone);
CREATE INDEX site_org_valid_from_idx ON public.site (organization_id, valid_from);
CREATE INDEX site_org_valid_to_idx   ON public.site (organization_id, valid_to);

CREATE INDEX person_org_family_name_idx ON public.person (organization_id, family_name);

CREATE INDEX user_account_org_person_idx     ON public.user_account (organization_id, person_id);
CREATE INDEX user_account_org_status_idx     ON public.user_account (organization_id, status);
CREATE INDEX user_account_org_last_login_idx ON public.user_account (organization_id, last_login_at);

CREATE INDEX role_assignment_org_role_idx       ON public.role_assignment (organization_id, role_key);
CREATE INDEX role_assignment_org_site_idx       ON public.role_assignment (organization_id, site_id);
CREATE INDEX role_assignment_org_valid_from_idx ON public.role_assignment (organization_id, valid_from);
CREATE INDEX role_assignment_org_expires_idx    ON public.role_assignment (organization_id, expires_at);
CREATE INDEX role_assignment_org_revoked_idx    ON public.role_assignment (organization_id, revoked_at);

CREATE INDEX requirement_instance_org_req_idx    ON public.requirement_instance (organization_id, requirement_id);
CREATE INDEX requirement_instance_org_site_idx   ON public.requirement_instance (organization_id, site_id);
CREATE INDEX requirement_instance_org_owner_idx  ON public.requirement_instance (organization_id, owner_person_id);
CREATE INDEX requirement_instance_org_status_idx ON public.requirement_instance (organization_id, status);
CREATE INDEX requirement_instance_org_due_idx    ON public.requirement_instance (organization_id, next_due_on);

-- Record history (ADR-0014 section 2.6). On the partitioned parent, so every partition
-- (present and future, from audit.ensure_partitions) gets it.
CREATE INDEX audit_event_target_time_idx
  ON audit.audit_event (organization_id, target_table, target_id, occurred_at);

-- ---------------------------------------------------------------------------
-- saved_view: a list view (filters, sort, columns) for one record type
-- ---------------------------------------------------------------------------

CREATE TABLE public.saved_view (
  id                     uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id        uuid        NOT NULL REFERENCES public.organization (id),
  record_type            text        NOT NULL CHECK (record_type ~ '^[a-z][a-z0-9_]*$'),
  owner_user_account_id  uuid        NOT NULL,
  -- No personal data in view names (ADR-0014 section 4.5); the API also rejects SSN-shaped text.
  name                   text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  visibility             text        NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'roles')),
  shared_roles           text[]      NOT NULL DEFAULT '{}',
  query                  jsonb       NOT NULL DEFAULT '{}',
  columns                text[]      NOT NULL DEFAULT '{}',
  row_version            integer     NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid,
  archived_at            timestamptz,
  CONSTRAINT saved_view_owner_fk FOREIGN KEY (organization_id, owner_user_account_id)
    REFERENCES public.user_account (organization_id, id),
  CONSTRAINT saved_view_roles_need_visibility CHECK (visibility = 'roles' OR shared_roles = '{}'),
  CONSTRAINT saved_view_org_id_key UNIQUE (organization_id, id)
);

CREATE INDEX saved_view_org_type_idx ON public.saved_view (organization_id, record_type, owner_user_account_id);

CREATE TRIGGER saved_view_row_meta BEFORE INSERT OR UPDATE ON public.saved_view
  FOR EACH ROW EXECUTE FUNCTION public.set_row_meta();

ALTER TABLE public.saved_view ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_view FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.saved_view
  USING (organization_id = current_setting('app.organization_id')::uuid)
  WITH CHECK (organization_id = current_setting('app.organization_id')::uuid);

GRANT SELECT, INSERT, UPDATE ON public.saved_view TO app_user;

-- ---------------------------------------------------------------------------
-- Audit actions (packages/domain AUDIT_ACTIONS; generated record actions)
-- ---------------------------------------------------------------------------

INSERT INTO audit.action_registry (action, category, description) VALUES
  ('saved_view.create',            'mutation', 'Saved list view created'),
  ('saved_view.update',            'mutation', 'Saved list view changed'),
  ('saved_view.share',             'permission', 'Saved list view shared with roles'),
  ('site.restore',                 'mutation', 'Site restored'),
  ('site.import',                  'mutation', 'Site import run committed (summary event)'),
  ('site.export',                  'export', 'Site list exported'),
  ('person.restore',               'mutation', 'Person restored'),
  ('person.import',                'mutation', 'Person import run committed (summary event)'),
  ('person.export',                'export', 'Person list exported'),
  ('user_account.export',          'export', 'User account list exported'),
  ('role_assignment.export',       'export', 'Role assignment list exported'),
  ('requirement_instance.archive', 'mutation', 'Requirement instance archived'),
  ('requirement_instance.restore', 'mutation', 'Requirement instance restored'),
  ('requirement_instance.export',  'export', 'Requirement instance list exported');
