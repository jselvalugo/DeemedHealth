import type { NavigationResponse } from '@deemed/domain';
import { MODULES, type ModuleEntry } from '@deemed/ui';

/**
 * Registry modules (names, icons, order) restricted to what /api/me/navigation allows,
 * so the launcher hides exactly what the API denies. Unknown ids are ignored.
 */
export function modulesFromNavigation(
  nav: NavigationResponse,
  modules: readonly ModuleEntry[] = MODULES,
): ModuleEntry[] {
  const allowed = new Map(nav.modules.map((m) => [m.id, new Set(m.pages.map((p) => p.route))]));
  return modules
    .filter((m) => allowed.has(m.id))
    .map((m) => ({ ...m, pages: m.pages.filter((p) => allowed.get(m.id)?.has(p.route)) }))
    .filter((m) => m.pages.length > 0);
}
