/**
 * Tenant provisioning (ADR-0002 section 9): Florida only (decision D4), two Florida
 * time zones, app_platform acting only through reviewed functions.
 */
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { GULF_FIXTURE } from '../seed/fixtures.js';
import {
  attempt,
  connect,
  describeDb,
  expectPgError,
  inRollback,
  need,
  setTenant,
} from './helpers.js';

function orgInput(overrides: Record<string, unknown> = {}) {
  return {
    legal_name: 'Probe Test Health Center',
    award_type: 'section330',
    sub_programs: ['CHC'],
    time_zone: 'America/New_York',
    address_line1: '1 Probe Street',
    city: 'Tampa',
    state: 'FL',
    postal_code: '33602',
    is_test_record: true,
    ...overrides,
  };
}

function siteInput(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Probe Site',
    address_line1: '1 Probe Street',
    city: 'Tampa',
    state: 'FL',
    postal_code: '33602',
    time_zone: 'America/New_York',
    ...overrides,
  };
}

describeDb('provisioning (Florida only, decision D4)', () => {
  let platform: pg.Client;
  let admin: pg.Client;
  let tenantsBefore: number;

  const provision = (org: object, sites: object[]) =>
    attempt(platform, () =>
      platform.query<{ id: string }>(
        `SELECT platform.provision_organization($1::jsonb, $2::jsonb, 'provisioning test')::text AS id`,
        [JSON.stringify(org), JSON.stringify(sites)],
      ),
    );

  beforeAll(async () => {
    const c = need();
    platform = await connect(c.platformUrl);
    admin = await connect(c.adminUrl);
    tenantsBefore = (await platform.query('SELECT * FROM platform.list_tenants()')).rowCount ?? 0;
  });

  afterAll(async () => {
    await Promise.all([platform?.end(), admin?.end()]);
  });

  it('lists tenants for fan-out with ids and time zones only', async () => {
    const { rows, fields } = await platform.query('SELECT * FROM platform.list_tenants()');
    expect(fields.map((f) => f.name)).toEqual(['organization_id', 'time_zone', 'status']);
    const c = need();
    expect(rows).toEqual(
      expect.arrayContaining([
        {
          organization_id: c.tenants.xyz.organizationId,
          time_zone: 'America/New_York',
          status: 'active',
        },
        {
          organization_id: c.tenants.gulf.organizationId,
          time_zone: 'America/Chicago',
          status: 'active',
        },
      ]),
    );
  });

  it('rejects an organization outside Florida', async () => {
    await inRollback(platform, async () => {
      const message = await expectPgError(
        provision(orgInput({ state: 'GA', city: 'Atlanta', postal_code: '30303' }), [siteInput()]),
        '23514',
      );
      expect(message).toMatch(/Florida only/);
    });
  });

  it('rejects a site outside Florida (FX-ORG-OOS: a Georgia site)', async () => {
    await inRollback(platform, async () => {
      const message = await expectPgError(
        provision(orgInput(), [
          siteInput(),
          siteInput({
            name: 'Valdosta Annex',
            city: 'Valdosta',
            state: 'GA',
            postal_code: '31601',
          }),
        ]),
        '23514',
      );
      expect(message).toMatch(/Florida only.*Valdosta Annex/);
    });
  });

  it('rejects a time zone other than America/New_York or America/Chicago', async () => {
    await inRollback(platform, async () => {
      await expectPgError(
        provision(orgInput(), [siteInput({ time_zone: 'America/Los_Angeles' })]),
        '23514',
      );
      await expectPgError(
        provision(orgInput({ time_zone: 'America/Denver' }), [siteInput()]),
        '23514',
      );
      await expectPgError(provision(orgInput({ time_zone: 'US/Eastern' }), [siteInput()]), '23514');
    });
  });

  it('rejects a non-Florida ZIP and an unknown award type through the table constraints', async () => {
    await inRollback(platform, async () => {
      await expectPgError(provision(orgInput({ postal_code: '30303' }), [siteInput()]), '23514');
      await expectPgError(provision(orgInput(), [siteInput({ postal_code: '10001' })]), '23514');
      await expectPgError(
        provision(orgInput({ award_type: 'section_330' }), [siteInput()]),
        '23514',
      );
    });
  });

  it('persists nothing from a rejected provisioning', async () => {
    const after = (await platform.query('SELECT * FROM platform.list_tenants()')).rowCount;
    expect(after).toBe(tenantsBefore);
  });

  it('enforces Florida on every later write, not only at provisioning', async () => {
    const c = need();
    const user = await connect(c.appUserUrl);
    try {
      await inRollback(user, async () => {
        await setTenant(user, c.tenants.xyz.organizationId);
        const site = c.tenants.xyz.siteIds.S1;
        await expectPgError(
          attempt(user, () =>
            user.query(`UPDATE public.site SET state = 'GA' WHERE id = $1`, [site]),
          ),
          '23514',
        );
        await expectPgError(
          attempt(user, () =>
            user.query(`UPDATE public.site SET postal_code = '30303' WHERE id = $1`, [site]),
          ),
          '23514',
        );
        await expectPgError(
          attempt(user, () =>
            user.query(`UPDATE public.site SET time_zone = 'America/Denver' WHERE id = $1`, [site]),
          ),
          '23514',
        );
        await expectPgError(
          attempt(user, () =>
            user.query(`UPDATE public.organization SET state = 'AL' WHERE id = $1`, [
              c.tenants.xyz.organizationId,
            ]),
          ),
          '23514',
        );
        await expectPgError(
          attempt(user, () =>
            user.query(
              `INSERT INTO public.site (organization_id, name, address_line1, city, state, postal_code, time_zone)
               VALUES ($1, 'Mobile Annex', '1 Bay St', 'Mobile', 'AL', '36602', 'America/Chicago')`,
              [c.tenants.xyz.organizationId],
            ),
          ),
          '23514',
        );
      });
    } finally {
      await user.end();
    }
  });

  it('provisions a Florida tenant with a genesis event first, both time zones allowed', async () => {
    // Run as app_platform on the admin connection so the result can be inspected, then roll back.
    await inRollback(admin, async () => {
      await admin.query('SET LOCAL ROLE app_platform');
      await admin.query(
        `SELECT set_config('app.actor_id', '', true), set_config('app.request_id', $1, true)`,
        [randomUUID()],
      );
      const id = randomUUID();
      const { rows } = await admin.query<{ id: string }>(
        `SELECT platform.provision_organization($1::jsonb, $2::jsonb, 'provisioning test')::text AS id`,
        [
          JSON.stringify(orgInput({ id, award_type: 'lookalike', is_public_agency: true })),
          JSON.stringify([
            siteInput({ name: 'Tampa' }),
            siteInput({
              name: 'Panama City',
              city: 'Panama City',
              postal_code: '32401',
              time_zone: 'America/Chicago',
            }),
          ]),
        ],
      );
      expect(rows[0]?.id).toBe(id);
      await admin.query('RESET ROLE');

      const events = await admin.query<{
        chain_seq: string;
        action: string;
        reason: string | null;
        prev_hash: string;
      }>(
        `SELECT chain_seq, action, reason, encode(prev_hash, 'hex') AS prev_hash
         FROM audit.audit_event WHERE organization_id = $1 ORDER BY chain_seq`,
        [id],
      );
      expect(events.rows.map((e) => e.action)).toEqual([
        'audit.genesis',
        'site.create',
        'site.create',
        'organization.provision',
      ]);
      expect(events.rows[0]).toMatchObject({ chain_seq: '1', prev_hash: '0'.repeat(64) });
      expect(events.rows[0]?.reason).toMatch(/provisioned/);
      const verify = await admin.query(`SELECT ok FROM audit.verify_chain($1)`, [id]);
      expect(verify.rows[0]).toEqual({ ok: true });
      const org = await admin.query(
        `SELECT award_type, is_public_agency, state FROM public.organization WHERE id = $1`,
        [id],
      );
      expect(org.rows[0]).toEqual({ award_type: 'lookalike', is_public_agency: true, state: 'FL' });
    });
  });

  it('refuses provisioning to app_user and duplicate provisioning of an existing tenant', async () => {
    const c = need();
    const user = await connect(c.appUserUrl);
    try {
      await expectPgError(
        user.query(`SELECT platform.provision_organization('{}'::jsonb, '[]'::jsonb)`),
        '42501',
      );
    } finally {
      await user.end();
    }
    await inRollback(platform, async () => {
      await expectPgError(
        provision(
          orgInput({
            id: c.tenants.gulf.organizationId,
            legal_name: GULF_FIXTURE.organization.legalName,
          }),
          [siteInput()],
        ),
        '23505',
      );
    });
  });
});
