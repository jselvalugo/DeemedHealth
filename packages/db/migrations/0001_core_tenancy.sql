-- 0001 Core shared entities (Phase 1, slice S2) with their RLS policies.
-- ADR-0002 (tenancy and RLS), ADR-0006 (identity), ADR-0011 (organization_id and
-- app.organization_id naming), docs/data/erd.md, docs/security/data-classification.md.
--
-- Rules applied to every table in this file:
--   * Tenant tables carry organization_id uuid NOT NULL (organization itself is keyed
--     by id), ENABLE + FORCE ROW LEVEL SECURITY, and one policy that reads
--     current_setting('app.organization_id') WITHOUT missing_ok, so a query with no
--     tenant context raises instead of silently returning nothing.
--   * Child rows reference parents through composite (organization_id, id) foreign
--     keys. Foreign-key checks bypass RLS, so a plain id FK would let tenant A point
--     at (and probe for) tenant B's rows; the composite key makes that impossible.
--   * Business records soft-delete through archived_at. app_user has no DELETE
--     privilege anywhere; hard deletes belong to the retention job only.
--   * No SSN column exists anywhere (decision D1).
--
-- Reversal (development only; never in production because it destroys data):
--   DROP VIEW public.v_active_role_assignment; DROP TABLE public.approval, public.task,
--   public.requirement_instance, public.role_assignment, public.role, public.user_account,
--   public.person, public.site, public.organization; DROP FUNCTION the public.* functions below.

-- ---------------------------------------------------------------------------
-- Shared trigger functions
-- ---------------------------------------------------------------------------

-- Stamps created_*/updated_* from the transaction's actor context (set by
-- withTenant) and forbids moving a row to another tenant or changing its id.
CREATE FUNCTION public.set_row_meta() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
    NEW.created_by := v_actor;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id
       OR (to_jsonb(NEW) ->> 'organization_id') IS DISTINCT FROM (to_jsonb(OLD) ->> 'organization_id') THEN
      RAISE EXCEPTION '%.%: id and organization_id are immutable', TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_at := OLD.created_at;
    NEW.created_by := OLD.created_by;
  END IF;
  NEW.updated_at := now();
  NEW.updated_by := v_actor;
  RETURN NEW;
END
$$;

-- ---------------------------------------------------------------------------
-- organization (the tenant)
-- ---------------------------------------------------------------------------

CREATE TABLE public.organization (
  id                uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  legal_name        text        NOT NULL CHECK (length(btrim(legal_name)) BETWEEN 1 AND 300),
  award_type        text        NOT NULL CHECK (award_type IN ('section330', 'lookalike')),
  sub_programs      text[]      NOT NULL DEFAULT '{}'
                    CHECK (sub_programs <@ ARRAY['CHC', 'MHC', 'HCH', 'PHPC']::text[]),
  grant_number      text,
  npi               text        CHECK (npi ~ '^[12][0-9]{9}$'),
  time_zone         text        NOT NULL CHECK (time_zone IN ('America/New_York', 'America/Chicago')),
  is_public_agency  boolean     NOT NULL DEFAULT false,
  address_line1     text        NOT NULL,
  address_line2     text,
  city              text        NOT NULL,
  -- Florida only (decision D4): the state is fixed and the ZIP must be a Florida ZIP.
  state             text        NOT NULL DEFAULT 'FL' CHECK (state = 'FL'),
  postal_code       text        NOT NULL CHECK (postal_code ~ '^3[2-4][0-9]{3}(-[0-9]{4})?$'),
  is_test_record    boolean     NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid,
  archived_at       timestamptz
);

CREATE TRIGGER organization_row_meta BEFORE INSERT OR UPDATE ON public.organization
  FOR EACH ROW EXECUTE FUNCTION public.set_row_meta();

ALTER TABLE public.organization ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.organization
  USING (id = current_setting('app.organization_id')::uuid)
  WITH CHECK (id = current_setting('app.organization_id')::uuid);

-- Organizations are created only by platform.provision_organization (0003).
GRANT SELECT, UPDATE ON public.organization TO app_user;

-- ---------------------------------------------------------------------------
-- site (links to Form 5B)
-- ---------------------------------------------------------------------------

CREATE TABLE public.site (
  id               uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  uuid        NOT NULL REFERENCES public.organization (id),
  name             text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  form_5b_site_id  text,
  site_type        text        NOT NULL DEFAULT 'service_delivery'
                   CHECK (site_type IN ('service_delivery', 'administrative', 'mobile', 'intermittent', 'seasonal', 'other')),
  address_line1    text        NOT NULL,
  address_line2    text,
  city             text        NOT NULL,
  state            text        NOT NULL DEFAULT 'FL' CHECK (state = 'FL'),
  postal_code      text        NOT NULL CHECK (postal_code ~ '^3[2-4][0-9]{3}(-[0-9]{4})?$'),
  -- Florida has two zones: Eastern, and Central for the western Panhandle.
  time_zone        text        NOT NULL CHECK (time_zone IN ('America/New_York', 'America/Chicago')),
  valid_from       date        NOT NULL DEFAULT current_date,
  valid_to         date,
  is_test_record   boolean     NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid,
  archived_at      timestamptz,
  CONSTRAINT site_valid_range CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT site_org_id_key UNIQUE (organization_id, id),
  CONSTRAINT site_form_5b_key UNIQUE (organization_id, form_5b_site_id)
);

CREATE TRIGGER site_row_meta BEFORE INSERT OR UPDATE ON public.site
  FOR EACH ROW EXECUTE FUNCTION public.set_row_meta();

ALTER TABLE public.site ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.site
  USING (organization_id = current_setting('app.organization_id')::uuid)
  WITH CHECK (organization_id = current_setting('app.organization_id')::uuid);

GRANT SELECT, INSERT, UPDATE ON public.site TO app_user;

-- ---------------------------------------------------------------------------
-- person: one row per human (staff, provider, board member, contractor contact,
-- external auditor). NO SSN COLUMN (decision D1): people are matched on name,
-- DOB, NPI, and license number.
-- ---------------------------------------------------------------------------

CREATE TABLE public.person (
  id                uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id   uuid        NOT NULL REFERENCES public.organization (id),
  given_name        text        NOT NULL CHECK (length(btrim(given_name)) BETWEEN 1 AND 100),
  family_name       text        NOT NULL CHECK (length(btrim(family_name)) BETWEEN 1 AND 100),
  preferred_name    text,
  work_email        text        CHECK (work_email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  -- Field-encrypted (ADR-0007): AES-256-GCM envelope under the tenant key.
  -- The blind index is a keyed HMAC used for screening matches; never plaintext.
  dob_enc           bytea,
  dob_bidx          bytea       CHECK (octet_length(dob_bidx) = 32),
  home_address_enc  bytea,
  npi               text        CHECK (npi ~ '^1[0-9]{9}$'),
  is_test_record    boolean     NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid,
  archived_at       timestamptz,
  CONSTRAINT person_dob_bidx_needs_value CHECK (dob_bidx IS NULL OR dob_enc IS NOT NULL),
  CONSTRAINT person_org_id_key UNIQUE (organization_id, id)
);

CREATE UNIQUE INDEX person_org_npi_active_key ON public.person (organization_id, npi)
  WHERE npi IS NOT NULL AND archived_at IS NULL;
CREATE INDEX person_org_dob_bidx_idx ON public.person (organization_id, dob_bidx)
  WHERE dob_bidx IS NOT NULL;

CREATE TRIGGER person_row_meta BEFORE INSERT OR UPDATE ON public.person
  FOR EACH ROW EXECUTE FUNCTION public.set_row_meta();

ALTER TABLE public.person ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.person
  USING (organization_id = current_setting('app.organization_id')::uuid)
  WITH CHECK (organization_id = current_setting('app.organization_id')::uuid);

GRANT SELECT, INSERT, UPDATE ON public.person TO app_user;

-- ---------------------------------------------------------------------------
-- user_account: the sign-in identity (ADR-0006) for a person.
-- Uniqueness is per tenant so a unique violation cannot reveal another tenant's users.
-- ---------------------------------------------------------------------------

CREATE TABLE public.user_account (
  id                uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id   uuid        NOT NULL REFERENCES public.organization (id),
  person_id         uuid        NOT NULL,
  idp_issuer        text        NOT NULL,
  idp_subject       text        NOT NULL,
  login_email       text        NOT NULL CHECK (login_email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  status            text        NOT NULL DEFAULT 'invited'
                    CHECK (status IN ('invited', 'active', 'suspended', 'deprovisioned')),
  mfa_enrolled_at   timestamptz,
  last_login_at     timestamptz,
  is_test_record    boolean     NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid,
  archived_at       timestamptz,
  CONSTRAINT user_account_person_fk FOREIGN KEY (organization_id, person_id)
    REFERENCES public.person (organization_id, id),
  CONSTRAINT user_account_org_id_key UNIQUE (organization_id, id),
  CONSTRAINT user_account_org_id_person_key UNIQUE (organization_id, id, person_id),
  CONSTRAINT user_account_idp_key UNIQUE (organization_id, idp_issuer, idp_subject)
);

CREATE UNIQUE INDEX user_account_org_email_key ON public.user_account (organization_id, lower(login_email));

CREATE TRIGGER user_account_row_meta BEFORE INSERT OR UPDATE ON public.user_account
  FOR EACH ROW EXECUTE FUNCTION public.set_row_meta();

ALTER TABLE public.user_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_account FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.user_account
  USING (organization_id = current_setting('app.organization_id')::uuid)
  WITH CHECK (organization_id = current_setting('app.organization_id')::uuid);

GRANT SELECT, INSERT, UPDATE ON public.user_account TO app_user;

-- ---------------------------------------------------------------------------
-- role: GLOBAL reference data (no organization_id), read-only to app_user.
-- Default roles from docs/product/module-map.md. ES names pending ux-content-writer review.
-- ---------------------------------------------------------------------------

CREATE TABLE public.role (
  key              text     NOT NULL PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  name_en          text     NOT NULL,
  name_es          text     NOT NULL,
  description_en   text     NOT NULL,
  is_read_only     boolean  NOT NULL DEFAULT false,
  requires_expiry  boolean  NOT NULL DEFAULT false,
  max_duration     interval,
  CONSTRAINT role_expiry_needs_duration CHECK (NOT requires_expiry OR max_duration IS NOT NULL)
);

INSERT INTO public.role (key, name_en, name_es, description_en, is_read_only, requires_expiry, max_duration) VALUES
  ('org_admin',                 'Organization administrator',  'Administrador de la organización',    'Manages users, roles, sites, and health center settings.', false, false, NULL),
  ('executive',                 'Executive',                   'Ejecutivo',                           'All modules, read. Approvals in their area.', false, false, NULL),
  ('compliance_officer',        'Compliance officer',          'Oficial de cumplimiento',             'All modules, full access.', false, false, NULL),
  ('credentialing_coordinator', 'Credentialing coordinator',   'Coordinador de credenciales',         'Providers, Enrollment, Screening, Learning, Tasks.', false, false, NULL),
  ('board_liaison',             'Board liaison',               'Enlace con la junta directiva',       'Governance, Readiness (read), Tasks.', false, false, NULL),
  ('board_member',              'Board member',                'Miembro de la junta directiva',       'Self-Service, Governance (their packets, read-only).', true, false, NULL),
  ('qi_risk_manager',           'QI / Risk manager',           'Gerente de calidad y riesgos',        'FTCA & Risk, Quality, Patient Experience, Tasks.', false, false, NULL),
  ('finance',                   'Finance',                     'Finanzas',                            'Finance & Grants, Contracts, Scope (read), Tasks.', false, false, NULL),
  ('staff_provider',            'Staff / provider',            'Personal / proveedor',                'Self-Service, Learning, My tasks.', false, false, NULL),
  -- ADR-0006: auditor access requires an end date, max 30 days, renewable.
  ('auditor',                   'Auditor (time-boxed)',        'Auditor (por tiempo limitado)',       'Read-only, the evidence library, and exports. Every view is logged.', true, true, interval '30 days');

GRANT SELECT ON public.role TO app_user;

-- ---------------------------------------------------------------------------
-- role_assignment: a role granted to a user, optionally limited to one site
-- (site_id NULL = all sites) and optionally expiring. Never edited in place:
-- a change is a revoke plus a new row, so "who could do what on date X" stays answerable.
-- ---------------------------------------------------------------------------

CREATE TABLE public.role_assignment (
  id                uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id   uuid        NOT NULL REFERENCES public.organization (id),
  user_account_id   uuid        NOT NULL,
  role_key          text        NOT NULL REFERENCES public.role (key),
  site_id           uuid,
  valid_from        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz,
  grant_reason      text,
  revoked_at        timestamptz,
  revoked_by        uuid,
  revoke_reason     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid,
  CONSTRAINT role_assignment_user_fk FOREIGN KEY (organization_id, user_account_id)
    REFERENCES public.user_account (organization_id, id),
  CONSTRAINT role_assignment_site_fk FOREIGN KEY (organization_id, site_id)
    REFERENCES public.site (organization_id, id),
  CONSTRAINT role_assignment_expiry_after_start CHECK (expires_at IS NULL OR expires_at > valid_from),
  -- revoked_by stays NULL when a service actor (SCIM deprovisioning) revokes.
  CONSTRAINT role_assignment_revoke_reason_needs_revoke CHECK (revoke_reason IS NULL OR revoked_at IS NOT NULL),
  CONSTRAINT role_assignment_org_id_key UNIQUE (organization_id, id)
);

CREATE INDEX role_assignment_user_idx ON public.role_assignment (organization_id, user_account_id);

-- Enforces the role's expiry rule on insert, and on update allows only the
-- one-way revoke (revoked_at/revoked_by/revoke_reason from NULL to a value).
CREATE FUNCTION public.role_assignment_guard() RETURNS trigger
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
     OR NEW.grant_reason IS DISTINCT FROM OLD.grant_reason THEN
    RAISE EXCEPTION 'role_assignment is never edited in place; revoke it and grant a new one'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER role_assignment_guard AFTER INSERT OR UPDATE ON public.role_assignment
  FOR EACH ROW EXECUTE FUNCTION public.role_assignment_guard();
CREATE TRIGGER role_assignment_row_meta BEFORE INSERT OR UPDATE ON public.role_assignment
  FOR EACH ROW EXECUTE FUNCTION public.set_row_meta();

ALTER TABLE public.role_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_assignment FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.role_assignment
  USING (organization_id = current_setting('app.organization_id')::uuid)
  WITH CHECK (organization_id = current_setting('app.organization_id')::uuid);

GRANT SELECT, INSERT, UPDATE ON public.role_assignment TO app_user;

-- Assignments in force right now. security_invoker keeps the caller's RLS.
CREATE VIEW public.v_active_role_assignment WITH (security_invoker = true) AS
  SELECT ra.*
  FROM public.role_assignment ra
  WHERE ra.revoked_at IS NULL
    AND ra.valid_from <= now()
    AND (ra.expires_at IS NULL OR ra.expires_at > now());

GRANT SELECT ON public.v_active_role_assignment TO app_user;

-- ---------------------------------------------------------------------------
-- requirement_instance (minimal): a catalog requirement applied to a subject.
-- The FK to requirement_version arrives with the catalog tables (ADR-0003).
-- ---------------------------------------------------------------------------

CREATE TABLE public.requirement_instance (
  id                      uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id         uuid        NOT NULL REFERENCES public.organization (id),
  requirement_id          text        NOT NULL CHECK (requirement_id ~ '^[A-Z0-9]+(-[A-Za-z0-9&]+)+$'),
  requirement_version_id  uuid,
  subject_type            text        NOT NULL CHECK (subject_type IN ('organization', 'site', 'person')),
  subject_id              uuid        NOT NULL,
  site_id                 uuid,
  owner_person_id         uuid,
  status                  text        NOT NULL DEFAULT 'missing'
                          CHECK (status IN ('met', 'due_soon', 'overdue', 'missing', 'not_applicable')),
  not_applicable_reason   text,
  next_due_on             date,
  status_computed_at      timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid,
  archived_at             timestamptz,
  CONSTRAINT requirement_instance_site_fk FOREIGN KEY (organization_id, site_id)
    REFERENCES public.site (organization_id, id),
  CONSTRAINT requirement_instance_owner_fk FOREIGN KEY (organization_id, owner_person_id)
    REFERENCES public.person (organization_id, id),
  -- "Not applicable" always carries its own reason (catalog NotApplicableRecord).
  CONSTRAINT requirement_instance_na_reason CHECK (
    (status = 'not_applicable') = (not_applicable_reason IS NOT NULL AND length(btrim(not_applicable_reason)) > 0)),
  CONSTRAINT requirement_instance_org_id_key UNIQUE (organization_id, id)
);

CREATE INDEX requirement_instance_subject_idx
  ON public.requirement_instance (organization_id, subject_type, subject_id);

-- Polymorphic subject integrity (ERD note): the subject must exist in the same tenant.
-- Runs AFTER the row passes RLS, as the calling role, so it sees only this tenant.
CREATE FUNCTION public.requirement_instance_subject_check() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.subject_type = 'organization' THEN
    IF NEW.subject_id <> NEW.organization_id THEN
      RAISE EXCEPTION 'organization subject must be the owning organization' USING ERRCODE = 'foreign_key_violation';
    END IF;
  ELSIF NEW.subject_type = 'site' THEN
    PERFORM 1 FROM public.site WHERE organization_id = NEW.organization_id AND id = NEW.subject_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'site subject % not found in this organization', NEW.subject_id USING ERRCODE = 'foreign_key_violation';
    END IF;
  ELSIF NEW.subject_type = 'person' THEN
    PERFORM 1 FROM public.person WHERE organization_id = NEW.organization_id AND id = NEW.subject_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'person subject % not found in this organization', NEW.subject_id USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER requirement_instance_subject_check AFTER INSERT OR UPDATE ON public.requirement_instance
  FOR EACH ROW EXECUTE FUNCTION public.requirement_instance_subject_check();
CREATE TRIGGER requirement_instance_row_meta BEFORE INSERT OR UPDATE ON public.requirement_instance
  FOR EACH ROW EXECUTE FUNCTION public.set_row_meta();

ALTER TABLE public.requirement_instance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.requirement_instance FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.requirement_instance
  USING (organization_id = current_setting('app.organization_id')::uuid)
  WITH CHECK (organization_id = current_setting('app.organization_id')::uuid);

GRANT SELECT, INSERT, UPDATE ON public.requirement_instance TO app_user;

-- ---------------------------------------------------------------------------
-- task (minimal). workflow_run_id arrives with the workflow tables.
-- ---------------------------------------------------------------------------

CREATE TABLE public.task (
  id                       uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id          uuid        NOT NULL REFERENCES public.organization (id),
  requirement_instance_id  uuid,
  site_id                  uuid,
  assignee_person_id       uuid,
  title                    text        NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 300),
  due_on                   date,
  status                   text        NOT NULL DEFAULT 'open'
                           CHECK (status IN ('open', 'in_progress', 'blocked', 'done', 'cancelled')),
  completed_at             timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  updated_by               uuid,
  archived_at              timestamptz,
  CONSTRAINT task_requirement_instance_fk FOREIGN KEY (organization_id, requirement_instance_id)
    REFERENCES public.requirement_instance (organization_id, id),
  CONSTRAINT task_site_fk FOREIGN KEY (organization_id, site_id)
    REFERENCES public.site (organization_id, id),
  CONSTRAINT task_assignee_fk FOREIGN KEY (organization_id, assignee_person_id)
    REFERENCES public.person (organization_id, id),
  CONSTRAINT task_done_has_completed_at CHECK ((status = 'done') = (completed_at IS NOT NULL)),
  CONSTRAINT task_org_id_key UNIQUE (organization_id, id)
);

CREATE INDEX task_assignee_idx ON public.task (organization_id, assignee_person_id, status);

CREATE TRIGGER task_row_meta BEFORE INSERT OR UPDATE ON public.task
  FOR EACH ROW EXECUTE FUNCTION public.set_row_meta();

ALTER TABLE public.task ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.task
  USING (organization_id = current_setting('app.organization_id')::uuid)
  WITH CHECK (organization_id = current_setting('app.organization_id')::uuid);

GRANT SELECT, INSERT, UPDATE ON public.task TO app_user;

-- ---------------------------------------------------------------------------
-- approval (minimal): a human decision. Insert-only for app_user; a correction is
-- a new approval row. AI never approves (product principle 2): the inserting
-- transaction's actor must be a human user and must be the approver.
-- ---------------------------------------------------------------------------

CREATE TABLE public.approval (
  id                        uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id           uuid        NOT NULL REFERENCES public.organization (id),
  task_id                   uuid,
  subject_type              text        NOT NULL CHECK (subject_type ~ '^[a-z][a-z0-9_]*$'),
  subject_id                uuid        NOT NULL,
  approver_person_id        uuid        NOT NULL,
  approver_user_account_id  uuid        NOT NULL,
  decision                  text        NOT NULL CHECK (decision IN ('approved', 'rejected')),
  comment                   text,
  requirement_ids           text[]      NOT NULL DEFAULT '{}',
  decided_at                timestamptz NOT NULL DEFAULT now(),
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  updated_by                uuid,
  CONSTRAINT approval_task_fk FOREIGN KEY (organization_id, task_id)
    REFERENCES public.task (organization_id, id),
  -- The approver's user account must belong to the approver person.
  CONSTRAINT approval_approver_fk FOREIGN KEY (organization_id, approver_user_account_id, approver_person_id)
    REFERENCES public.user_account (organization_id, id, person_id),
  CONSTRAINT approval_org_id_key UNIQUE (organization_id, id)
);

CREATE INDEX approval_subject_idx ON public.approval (organization_id, subject_type, subject_id);

CREATE FUNCTION public.approval_human_only() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  -- app.actor_id holds a user_account id only for human sessions (withTenant leaves it
  -- empty for service, integration, and system actors such as the AI assistant).
  IF nullif(current_setting('app.actor_id', true), '')::uuid IS DISTINCT FROM NEW.approver_user_account_id THEN
    RAISE EXCEPTION 'an approval must be recorded by the approving human user in their own session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM 1 FROM public.user_account u
  WHERE u.organization_id = NEW.organization_id AND u.id = NEW.approver_user_account_id
    AND u.status = 'active' AND u.archived_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the approver''s user account is not active' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER approval_human_only AFTER INSERT ON public.approval
  FOR EACH ROW EXECUTE FUNCTION public.approval_human_only();
CREATE TRIGGER approval_row_meta BEFORE INSERT ON public.approval
  FOR EACH ROW EXECUTE FUNCTION public.set_row_meta();

ALTER TABLE public.approval ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.approval
  USING (organization_id = current_setting('app.organization_id')::uuid)
  WITH CHECK (organization_id = current_setting('app.organization_id')::uuid);

GRANT SELECT, INSERT ON public.approval TO app_user;
