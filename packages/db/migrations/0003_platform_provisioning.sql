-- 0003 Platform provisioning (ADR-0002 sections 3, 8, 9; names per ADR-0011).
--
-- app_platform has no table privileges. It acts only through the SECURITY DEFINER
-- functions below (reviewed by security-privacy-officer):
--   platform.provision_organization  create a tenant, its sites, and its audit genesis
--   platform.list_tenants            the tenant list for scheduled fan-out (ids only)
--   audit.ensure_partitions          (0002) create audit partitions ahead of time
--
-- Florida only (decision D4): the organization and every site must be in FL, and every
-- site's time zone must be America/New_York or America/Chicago. The table CHECK
-- constraints in 0001 enforce the same rules for any other writer.
--
-- Not yet enforced here: FL-D2 (an award type cannot be provisioned until its catalog
-- entries are verified). That gate needs the catalog tables (ADR-0003) and lands with them.
--
-- Reversal (development only): DROP FUNCTION platform.list_tenants(),
--   platform.provision_organization(jsonb, jsonb, text); DROP TABLE platform.tenant.

-- Cross-tenant registry. Not a tenant table: no runtime role can read it directly.
CREATE TABLE platform.tenant (
  organization_id  uuid        NOT NULL PRIMARY KEY REFERENCES public.organization (id),
  status           text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'offboarding')),
  time_zone        text        NOT NULL CHECK (time_zone IN ('America/New_York', 'America/Chicago')),
  is_test_record   boolean     NOT NULL,
  provisioned_at   timestamptz NOT NULL DEFAULT now(),
  provisioned_by   text        NOT NULL
);

-- RLS on with no policy: only the owner (through the definer functions) sees rows.
ALTER TABLE platform.tenant ENABLE ROW LEVEL SECURITY;

-- p_actor_label names the platform job or operator for the audit rows (actor type system).
CREATE FUNCTION platform.provision_organization(
  p_organization jsonb,
  p_sites        jsonb,
  p_actor_label  text DEFAULT 'platform provisioning'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c_zones      constant text[] := ARRAY['America/New_York', 'America/Chicago'];
  v_org_id     uuid := coalesce((p_organization ->> 'id')::uuid, gen_random_uuid());
  v_prev       text := current_setting('app.organization_id', true);
  v_label      text := coalesce(nullif(btrim(p_actor_label), ''), 'platform provisioning');
  v_site       jsonb;
  v_site_id    uuid;
  v_site_count integer := 0;
  v_test       boolean := coalesce((p_organization ->> 'is_test_record')::boolean, false);
BEGIN
  IF p_organization IS NULL OR jsonb_typeof(p_organization) <> 'object' THEN
    RAISE EXCEPTION 'provision_organization: organization must be a JSON object' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF coalesce(p_organization ->> 'state', '') <> 'FL' THEN
    RAISE EXCEPTION 'Deemed Health operates in Florida only (decision D4): organization state must be FL'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT (coalesce(p_organization ->> 'time_zone', '') = ANY (c_zones)) THEN
    RAISE EXCEPTION 'organization time zone must be America/New_York or America/Chicago'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_sites IS NULL OR jsonb_typeof(p_sites) <> 'array' OR jsonb_array_length(p_sites) = 0 THEN
    RAISE EXCEPTION 'provision_organization: at least one site is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  FOR v_site IN SELECT value FROM jsonb_array_elements(p_sites) LOOP
    IF coalesce(v_site ->> 'state', '') <> 'FL' THEN
      RAISE EXCEPTION 'Deemed Health operates in Florida only (decision D4): site "%" is not in FL', v_site ->> 'name'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT (coalesce(v_site ->> 'time_zone', '') = ANY (c_zones)) THEN
      RAISE EXCEPTION 'site "%" time zone must be America/New_York or America/Chicago', v_site ->> 'name'
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  -- The new tenant becomes the transaction tenant so forced RLS admits the inserts.
  PERFORM set_config('app.organization_id', v_org_id::text, true);

  INSERT INTO public.organization (
    id, legal_name, award_type, sub_programs, grant_number, npi, time_zone, is_public_agency,
    address_line1, address_line2, city, state, postal_code, is_test_record)
  VALUES (
    v_org_id,
    p_organization ->> 'legal_name',
    p_organization ->> 'award_type',
    coalesce(ARRAY(SELECT jsonb_array_elements_text(p_organization -> 'sub_programs')), '{}'::text[]),
    p_organization ->> 'grant_number',
    p_organization ->> 'npi',
    p_organization ->> 'time_zone',
    coalesce((p_organization ->> 'is_public_agency')::boolean, false),
    p_organization ->> 'address_line1',
    p_organization ->> 'address_line2',
    p_organization ->> 'city',
    p_organization ->> 'state',
    p_organization ->> 'postal_code',
    v_test);

  INSERT INTO platform.tenant (organization_id, time_zone, is_test_record, provisioned_by)
  VALUES (v_org_id, p_organization ->> 'time_zone', v_test, v_label);

  -- Genesis (ADR-0008 section 2): chain_seq 1, prev_hash of 32 zero bytes, with a reason.
  PERFORM audit.write_event(
    v_org_id, 'system', 'audit.genesis', 'success', 'system', v_label, NULL, NULL,
    'organization', v_org_id, NULL, NULL,
    'organization provisioned: start of the audit hash chain',
    NULL,
    jsonb_build_object(
      'organization_id', v_org_id,
      'created_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'schema_version', 1,
      'deployment_id', coalesce(nullif(current_setting('app.deployment_id', true), ''), 'unset')),
    NULL, NULL, NULL);

  FOR v_site IN SELECT value FROM jsonb_array_elements(p_sites) LOOP
    v_site_id := coalesce((v_site ->> 'id')::uuid, gen_random_uuid());
    INSERT INTO public.site (
      id, organization_id, name, form_5b_site_id, site_type, address_line1, address_line2, city,
      state, postal_code, time_zone, valid_from, is_test_record)
    VALUES (
      v_site_id, v_org_id, v_site ->> 'name', v_site ->> 'form_5b_site_id',
      coalesce(v_site ->> 'site_type', 'service_delivery'),
      v_site ->> 'address_line1', v_site ->> 'address_line2', v_site ->> 'city',
      v_site ->> 'state', v_site ->> 'postal_code', v_site ->> 'time_zone',
      coalesce((v_site ->> 'valid_from')::date, current_date), v_test);
    PERFORM audit.write_event(
      v_org_id, 'mutation', 'site.create', 'success', 'system', v_label, NULL, NULL,
      'site', v_site_id, v_site_id, NULL, NULL,
      jsonb_build_object('fields', jsonb_build_object(
        'name', jsonb_build_object('before', NULL, 'after', v_site ->> 'name'),
        'time_zone', jsonb_build_object('before', NULL, 'after', v_site ->> 'time_zone'))),
      '{}'::jsonb, NULL, NULL, NULL);
    v_site_count := v_site_count + 1;
  END LOOP;

  PERFORM audit.write_event(
    v_org_id, 'system', 'organization.provision', 'success', 'system', v_label, NULL, NULL,
    'organization', v_org_id, NULL, NULL,
    'tenant provisioned by the platform',
    NULL,
    jsonb_build_object('site_count', v_site_count, 'is_test_record', v_test,
                       'award_type', p_organization ->> 'award_type'),
    NULL, NULL, NULL);

  PERFORM set_config('app.organization_id', coalesce(v_prev, ''), true);
  RETURN v_org_id;
END
$$;

CREATE FUNCTION platform.list_tenants()
RETURNS TABLE (organization_id uuid, time_zone text, status text)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$ SELECT t.organization_id, t.time_zone, t.status FROM platform.tenant t ORDER BY t.provisioned_at, t.organization_id $$;

REVOKE ALL ON FUNCTION platform.provision_organization(jsonb, jsonb, text), platform.list_tenants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.provision_organization(jsonb, jsonb, text), platform.list_tenants() TO app_platform;
