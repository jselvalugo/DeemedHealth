import { afterEach, describe, expect, it, vi } from 'vitest';

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
  }),
}));

const { demoRecords, demoStepUpTotp } = await import('./records-demo-actions');

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
  jar.clear();
});

describe('records demo server actions (non-production only)', () => {
  it('answer nothing in production or when a database is configured', async () => {
    jar.set('dh_demo_session', 'demo-compliance');
    process.env.DH_ENV = 'production';
    expect(await demoRecords({ op: 'list', type: 'site', query: {} })).toMatchObject({
      code: 'not_configured',
    });
    expect(await demoStepUpTotp('000000')).toMatchObject({ code: 'not_configured' });
    process.env.DH_ENV = 'development';
    process.env.DATABASE_URL = 'postgres://app@db/dh';
    expect(await demoRecords({ op: 'list', type: 'site', query: {} })).toMatchObject({
      code: 'not_configured',
    });
  });

  it('need a demo session, validate input, and keep changes in the journal cookie', async () => {
    process.env.DH_ENV = 'development';
    delete process.env.DATABASE_URL;
    expect(await demoRecords({ op: 'list', type: 'site', query: {} })).toMatchObject({
      code: 'unauthenticated',
    });
    jar.set('dh_demo_session', 'demo-compliance');
    expect(await demoRecords({ op: 'drop_table', type: 'site' })).toMatchObject({
      code: 'bad_request',
    });
    const S4 = 'd0000001-0002-4000-8000-000000000004';
    const res = await demoRecords({
      op: 'update',
      type: 'site',
      id: S4,
      version: 1,
      fields: { city: 'Kissimmee', postalCode: '34741' },
    });
    expect(res.ok).toBe(true);
    expect(jar.get('dh_demo_records')).toBeTruthy();
    const again = await demoRecords({ op: 'get', type: 'site', id: S4 });
    expect(again).toMatchObject({ ok: true, data: { record: { rowVersion: 2 } } });
  });

  it('step-up accepts only the demo code', async () => {
    process.env.DH_ENV = 'development';
    delete process.env.DATABASE_URL;
    jar.set('dh_demo_session', 'demo-compliance');
    expect(await demoStepUpTotp('123456')).toMatchObject({ code: 'invalid_code' });
    expect(jar.has('dh_demo_stepup')).toBe(false);
    expect(await demoStepUpTotp('000000')).toEqual({ ok: true, data: null });
    expect(jar.has('dh_demo_stepup')).toBe(true);
  });
});
