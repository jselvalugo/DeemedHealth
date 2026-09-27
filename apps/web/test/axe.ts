// Test helpers (excluded from the package build by tsconfig "exclude").
import axe from 'axe-core';

/**
 * Run axe on a DOM subtree and return a readable list of violations. jsdom has no
 * layout, so color-contrast is disabled here; contrast is checked on the token
 * pairs in tokens.test.ts instead.
 */
export async function axeViolations(root: Element = document.body): Promise<string[]> {
  const results = await axe.run(root, {
    rules: { 'color-contrast': { enabled: false } },
  });
  return results.violations.map(
    (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`,
  );
}
