import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const TOKENS = 'packages/ui/src/tokens.css';
const SCAN = ['packages/ui/src', 'apps/web/app', 'apps/web/lib'];
const HEX = /#[0-9a-fA-F]{3,8}\b/g;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

const tokens = readFileSync(join(root, TOKENS), 'utf8');

/** Resolve a token to its hex value, following var(--dh-…) references. */
function token(name: string): string {
  const m = new RegExp(`--dh-${name}:\\s*([^;]+);`).exec(tokens);
  if (!m) throw new Error(`token --dh-${name} is not defined`);
  const value = m[1]!.trim();
  const ref = /^var\(--dh-([\w-]+)\)$/.exec(value);
  if (ref) return token(ref[1]!);
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`token --dh-${name} is not a hex color`);
  return value;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

describe('design tokens', () => {
  it('keeps hex colors in tokens.css only', () => {
    const offenders: string[] = [];
    for (const dir of SCAN) {
      for (const file of files(join(root, dir))) {
        const rel = relative(root, file);
        if (rel === TOKENS || !/\.(tsx?|css)$/.test(rel)) continue;
        // Only this test file names hex patterns (in regexes, not as colors).
        if (rel.endsWith('tokens.test.ts')) continue;
        const text = readFileSync(file, 'utf8');
        if (HEX.test(text)) offenders.push(rel);
        HEX.lastIndex = 0;
      }
    }
    expect(offenders).toEqual([]);
  });

  // WCAG 2.1 AA: 4.5:1 for text, 3:1 for glyphs and UI boundaries.
  it.each([
    ['status-ok-text', 'status-ok-bg', 4.5],
    ['status-warn-text', 'status-warn-bg', 4.5],
    ['status-critical-text', 'status-critical-bg', 4.5],
    ['blue-600', 'blue-50', 4.5],
    ['gray-700', 'gray-50', 4.5],
    ['preview-fg', 'preview-bg', 4.5],
    ['gray-500', 'white', 4.5],
    ['gray-500', 'gray-25', 4.5],
    ['teal-700', 'white', 4.5],
    ['navy-900', 'white', 4.5],
    ['white', 'navy-700', 4.5],
    ['status-warn-icon', 'status-warn-bg', 3],
    ['status-critical-icon', 'status-critical-bg', 3],
    ['status-ok-icon', 'status-ok-bg', 3],
    ['status-info-icon', 'status-info-bg', 3],
    ['status-neutral-icon', 'status-neutral-bg', 3],
    ['gray-500', 'gray-50', 3],
    ['sky-500', 'navy-900', 3],
    ['teal-400', 'navy-700', 3],
    ['navy-900', 'white', 3], // focus ring inner band on white
  ])('%s on %s meets %s:1', (fg, bg, min) => {
    expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(min);
  });
});
