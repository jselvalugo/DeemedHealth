import { describe, expect, it } from 'vitest';
import nextConfig from '../next.config';
import { AUTH_PAGE_SOURCES, headerRules } from './security-headers';

const referrer = (headers: { key: string; value: string }[]) =>
  headers.find((h) => h.key === 'Referrer-Policy')?.value;

describe('security headers', () => {
  it('send no Referer from the sign-in pages (security re-review N2)', async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toEqual(headerRules());
    // The global rule first; the sign-in rules after it, so they win in Next.js.
    expect(rules[0]?.source).toBe('/:path*');
    expect(referrer(rules[0]!.headers)).toBe('strict-origin-when-cross-origin');
    const auth = rules.slice(1);
    expect(auth.map((r) => r.source)).toEqual([...AUTH_PAGE_SOURCES]);
    for (const rule of auth) expect(referrer(rule.headers)).toBe('no-referrer');
    expect(AUTH_PAGE_SOURCES).toContain('/sign-in/:path*');
  });
});
