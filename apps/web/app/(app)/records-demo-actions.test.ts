import { afterEach, describe, expect, it, vi } from 'vitest';

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

const { demoRecords, demoStepUpTotp, demoStepUpPasskey } = await import('./records-demo-actions');

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
  jar.clear();
});

const S4 = 'd0000001-0002-4000-8000-000000000004';
const RAMAN = 'd0000001-0003-4000-8000-000000000006';
const reveal = {
  op: 'reveal',
  type: 'person',
  id: RAMAN,
  field: 'dob',
  body: { reasonCode: 'data_correction' },
};

function demoEnv() {
  process.env.DH_ENV = 'development';
  delete process.env.DATABASE_URL;
}

describe('records demo server actions (non-production only)', () => {
  it('answer nothing in production, with an unknown or missing DH_ENV, or with a database', async () => {
    jar.set('dh_demo_session', 'demo-compliance');
    delete process.env.DATABASE_URL;
    for (const value of ['production', 'prod', 'qa', undefined]) {
      if (value === undefined) delete process.env.DH_ENV;
      else process.env.DH_ENV = value;
      expect(
        await demoRecords({ op: 'list', type: 'site', query: {} }),
        String(value),
      ).toMatchObject({ code: 'not_configured' });
      expect(await demoStepUpTotp('000000'), String(value)).toMatchObject({
        code: 'not_configured',
      });
      expect(await demoStepUpPasskey(), String(value)).toMatchObject({ code: 'not_configured' });
    }
    expect(jar.has('dh_demo_stepup')).toBe(false);
    process.env.DH_ENV = 'development';
    process.env.DATABASE_URL = 'postgres://app@db/dh';
    expect(await demoRecords({ op: 'list', type: 'site', query: {} })).toMatchObject({
      code: 'not_configured',
    });
  });

  it('need a demo session, validate input, and keep changes in the signed journal', async () => {
    demoEnv();
    expect(await demoRecords({ op: 'list', type: 'site', query: {} })).toMatchObject({
      code: 'unauthenticated',
    });
    jar.set('dh_demo_session', 'demo-compliance');
    expect(await demoRecords({ op: 'drop_table', type: 'site' })).toMatchObject({
      code: 'bad_request',
    });
    const res = await demoRecords({
      op: 'update',
      type: 'site',
      id: S4,
      version: 1,
      fields: { city: 'Kissimmee', postalCode: '34741' },
    });
    expect(res.ok).toBe(true);
    const cookie = jar.get('dh_demo_records') ?? '';
    expect(cookie).toContain('.');
    const again = await demoRecords({ op: 'get', type: 'site', id: S4 });
    expect(again).toMatchObject({ ok: true, data: { record: { rowVersion: 2 } } });
  });

  it('drop a tampered journal and start again from the seed (finding M1)', async () => {
    demoEnv();
    jar.set('dh_demo_session', 'demo-compliance');
    await demoRecords({
      op: 'update',
      type: 'site',
      id: S4,
      version: 1,
      fields: { city: 'Kissimmee', postalCode: '34741' },
    });
    const [payload, mac] = (jar.get('dh_demo_records') ?? '').split('.') as [string, string];
    const edited = Buffer.from(
      Buffer.from(payload, 'base64url').toString('utf8').replace('Kissimmee', 'Tampa'),
    ).toString('base64url');
    jar.set('dh_demo_records', `${edited}.${mac}`);
    const got = await demoRecords({ op: 'get', type: 'site', id: S4 });
    expect(got).toMatchObject({
      ok: true,
      data: { record: { rowVersion: 1, fields: { city: 'Orlando' } } },
    });
    expect(jar.has('dh_demo_records')).toBe(false);
  });

  it('do not replay another user’s journal (finding M1)', async () => {
    demoEnv();
    jar.set('dh_demo_session', 'demo-compliance');
    await demoRecords({
      op: 'update',
      type: 'site',
      id: S4,
      version: 1,
      fields: { city: 'Kissimmee', postalCode: '34741' },
    });
    // Same browser, different demo user: the journal was signed for the first one.
    jar.set('dh_demo_session', 'demo-coordinator');
    await demoRecords({ op: 'list', type: 'site', query: {} });
    expect(jar.has('dh_demo_records')).toBe(false);
  });

  it('step-up accepts only the demo code, and does not survive a user switch (finding M3)', async () => {
    demoEnv();
    jar.set('dh_demo_session', 'demo-compliance');
    expect(await demoStepUpTotp('123456')).toMatchObject({ code: 'invalid_code' });
    expect(jar.has('dh_demo_stepup')).toBe(false);
    expect(await demoRecords(reveal)).toMatchObject({ code: 'reauth_required' });
    expect(await demoStepUpTotp('000000')).toEqual({ ok: true, data: null });
    expect(jar.get('dh_demo_stepup')).toMatch(/^demo-compliance:\d+\./);
    expect(await demoRecords(reveal)).toMatchObject({ ok: true, data: { value: '1985-03-14' } });

    // A step-up confirmed by another user in the same browser does not count.
    jar.delete('dh_demo_stepup');
    jar.set('dh_demo_session', 'demo-coordinator');
    expect(await demoStepUpTotp('000000')).toEqual({ ok: true, data: null });
    jar.set('dh_demo_session', 'demo-compliance');
    expect(await demoRecords(reveal)).toMatchObject({ code: 'reauth_required' });

    // A hand-written step-up (right user, fresh time, no valid MAC) does not count either.
    jar.set('dh_demo_stepup', `demo-compliance:${Date.now()}`);
    expect(await demoRecords(reveal)).toMatchObject({ code: 'reauth_required' });
    jar.set('dh_demo_stepup', `demo-compliance:${Date.now()}.forged`);
    expect(await demoRecords(reveal)).toMatchObject({ code: 'reauth_required' });
  });

  it('journal a reveal with its reason code only (finding L4)', async () => {
    demoEnv();
    jar.set('dh_demo_session', 'demo-compliance');
    await demoStepUpTotp('000000');
    const res = await demoRecords({
      ...reveal,
      body: { reasonCode: 'other', note: 'Checking the file for the board' },
    });
    expect(res.ok).toBe(true);
    const payload = (jar.get('dh_demo_records') ?? '').split('.')[0] ?? '';
    const text = Buffer.from(payload, 'base64url').toString('utf8');
    expect(text).toContain('"reasonCode":"other"');
    expect(text).not.toContain('Checking the file');
  });
});
