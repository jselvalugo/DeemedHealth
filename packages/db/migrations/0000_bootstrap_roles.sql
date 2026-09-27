-- dh:run-as admin
--
-- 0000 Bootstrap: database roles, schemas, and default privileges.
-- ADR-0002 section 3 (roles), ADR-0008 section 1, ADR-0011 section 3 (the complete role list).
--
-- Runs as the migration admin (the only file that does). Every later migration
-- runs with SET LOCAL ROLE app_owner, so app_owner owns every object.
--
-- Login roles are created WITHOUT a password. Each environment attaches credentials
-- from the secrets manager (ADR-0007); no password is ever written in a migration.
--
--   app_owner        login  owns schemas, tables, functions. Migrations only; never runtime.
--   app_user         login  the only runtime role (api, worker). NOBYPASSRLS, no DDL, no
--                           DELETE on business tables, SELECT only on the audit schema:
--                           audit rows are added only through audit.append_event.
--   app_platform     login  cross-tenant platform jobs. No table privileges at all: it acts
--                           only through reviewed SECURITY DEFINER functions.
--   audit_writer     none   owns audit.append_event and audit.chain_head; nobody connects.
--   audit_retention  login  retention job only (ADR-0008 section 8). Its partition
--                           privileges arrive with the retention job migration.
--
-- Reversal: roles are cluster-wide and may be shared by other databases, so this
-- file is not reversed automatically. Manual: DROP OWNED BY each role, then DROP ROLE.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('app_owner', true), ('app_user', true), ('app_platform', true),
      ('audit_writer', false), ('audit_retention', true)) AS t(name, can_login)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = r.name) THEN
      EXECUTE format('CREATE ROLE %I', r.name);
    END IF;
    -- Re-assert the attributes even when the role already existed.
    EXECUTE format('ALTER ROLE %I %s NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
                   r.name, CASE WHEN r.can_login THEN 'LOGIN' ELSE 'NOLOGIN' END);
  END LOOP;
END
$$;

-- The migrator must be able to SET ROLE app_owner.
GRANT app_owner TO CURRENT_USER;

-- app_owner may hand ownership to audit_writer (ALTER ... OWNER TO) but does not
-- inherit its privileges (PostgreSQL 16 grant options).
GRANT audit_writer TO app_owner WITH INHERIT FALSE, SET TRUE;

-- Database-level privileges: nobody but the named roles connects; nobody but the
-- migrator creates schemas or temporary tables.
DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_user, app_platform, audit_retention', current_database());
  EXECUTE format('GRANT CONNECT, CREATE ON DATABASE %I TO app_owner', current_database());
END
$$;

-- public holds the tenant business tables.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO app_owner;
GRANT USAGE ON SCHEMA public TO app_user, app_platform;

CREATE SCHEMA IF NOT EXISTS audit AUTHORIZATION app_owner;
CREATE SCHEMA IF NOT EXISTS platform AUTHORIZATION app_owner;
REVOKE ALL ON SCHEMA audit, platform FROM PUBLIC;
GRANT USAGE ON SCHEMA audit TO app_user, app_platform, audit_writer, audit_retention;
GRANT USAGE ON SCHEMA platform TO app_platform;

-- Functions are EXECUTE-able by PUBLIC by default in PostgreSQL. Turn that off
-- for everything app_owner creates (audit_writer only receives ownership of
-- objects app_owner created, so their ACLs come from here); grants are explicit.
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
