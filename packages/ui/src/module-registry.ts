/**
 * The module registry: the code form of docs/product/module-map.md, and the single
 * source for the launcher, the module bar, breadcrumbs, and page permissions.
 *
 * Change docs/product/module-map.md first, then this file. A test
 * (module-registry.test.ts) parses the module map and fails when they disagree.
 */
import type { ModuleId, Permission } from '@deemed/domain';
import type { I18nKey } from '@deemed/i18n';

/** Lucide icon names (kebab-case, as written in the module map). See icons.tsx. */
export type LucideIconName =
  // Module icons (module map "Icon" column)
  | 'layout-dashboard'
  | 'shield-check'
  | 'badge-check'
  | 'id-card'
  | 'scan-search'
  | 'landmark'
  | 'map-pin'
  | 'file-signature'
  | 'wallet'
  | 'umbrella'
  | 'activity'
  | 'heart-handshake'
  | 'graduation-cap'
  | 'list-checks'
  | 'user-round-check'
  | 'settings'
  // Page icons
  | 'list-todo'
  | 'newspaper'
  | 'calendar-days'
  | 'clipboard-check'
  | 'folder-open'
  | 'flag'
  | 'clipboard-list'
  | 'bell-ring'
  | 'users'
  | 'stethoscope'
  | 'calendar-clock'
  | 'gavel'
  | 'square-kanban'
  | 'hand-coins'
  | 'refresh-cw'
  | 'file-text'
  | 'user-search'
  | 'history'
  | 'users-round'
  | 'notebook-pen'
  | 'stamp'
  | 'scale'
  | 'book-open'
  | 'heart-pulse'
  | 'network'
  | 'file-diff'
  | 'clock'
  | 'handshake'
  | 'percent'
  | 'receipt'
  | 'piggy-bank'
  | 'chart-column'
  | 'search-check'
  | 'shield-alert'
  | 'siren'
  | 'radar'
  | 'chart-line'
  | 'target'
  | 'message-square-text'
  | 'message-square-warning'
  | 'trending-up'
  | 'library'
  | 'circle-check'
  | 'inbox'
  | 'workflow'
  | 'user-round'
  | 'pen-line'
  | 'building'
  | 'plug'
  | 'book-marked'
  | 'scroll-text';

export type ReleaseStatus = 'mvp' | 'next' | 'planned';

export type PageEntry = {
  id: string;
  name: I18nKey;
  route: string;
  icon: LucideIconName;
  /**
   * `<module>:read` for pages that list the module's records, `<module>:read_own`
   * for pages that show only the signed-in person's own records (My tasks, My
   * profile, board packets). `read` implies `read_own` for navigation.
   */
  permission: Permission;
};

export type ModuleEntry = {
  /** One of the module ids in @deemed/domain MODULES (same order as the module map). */
  id: ModuleId;
  name: I18nKey;
  description: I18nKey;
  icon: LucideIconName;
  status: ReleaseStatus;
  requirementChapters: number[];
  pages: PageEntry[];
};

/** CM chapters 3–21: the module map's "All" and "Ch. 3–21". */
const ALL_CHAPTERS = Array.from({ length: 19 }, (_, i) => i + 3);

export const MODULES: readonly ModuleEntry[] = [
  {
    id: 'command-center',
    name: 'module.command-center.name',
    description: 'module.command-center.description',
    icon: 'layout-dashboard',
    status: 'mvp',
    requirementChapters: ALL_CHAPTERS,
    pages: [
      {
        id: 'overview',
        name: 'page.command-center.overview',
        route: '/',
        icon: 'layout-dashboard',
        permission: 'command-center:read',
      },
      {
        id: 'priorities',
        name: 'page.command-center.priorities',
        route: '/priorities',
        icon: 'list-todo',
        permission: 'command-center:read',
      },
      {
        id: 'briefs',
        name: 'page.command-center.briefs',
        route: '/briefs',
        icon: 'newspaper',
        permission: 'command-center:read',
      },
      {
        id: 'calendar',
        name: 'page.command-center.calendar',
        route: '/calendar',
        icon: 'calendar-days',
        permission: 'command-center:read',
      },
    ],
  },
  {
    id: 'readiness',
    name: 'module.readiness.name',
    description: 'module.readiness.description',
    icon: 'shield-check',
    status: 'mvp',
    requirementChapters: ALL_CHAPTERS,
    pages: [
      {
        id: 'requirements',
        name: 'page.readiness.requirements',
        route: '/readiness',
        icon: 'clipboard-check',
        permission: 'readiness:read',
      },
      {
        id: 'evidence',
        name: 'page.readiness.evidence',
        route: '/readiness/evidence',
        icon: 'folder-open',
        permission: 'readiness:read',
      },
      {
        id: 'findings',
        name: 'page.readiness.findings',
        route: '/readiness/findings',
        icon: 'flag',
        permission: 'readiness:read',
      },
      {
        id: 'osv',
        name: 'page.readiness.osv',
        route: '/readiness/osv',
        icon: 'clipboard-list',
        permission: 'readiness:read',
      },
      {
        id: 'policy-updates',
        name: 'page.readiness.policy-updates',
        route: '/readiness/policy-updates',
        icon: 'bell-ring',
        permission: 'readiness:read',
      },
    ],
  },
  {
    id: 'providers',
    name: 'module.providers.name',
    description: 'module.providers.description',
    icon: 'badge-check',
    status: 'mvp',
    requirementChapters: [5, 21],
    pages: [
      {
        id: 'providers',
        name: 'page.providers.providers',
        route: '/providers',
        icon: 'users',
        permission: 'providers:read',
      },
      {
        id: 'credentialing',
        name: 'page.providers.credentialing',
        route: '/providers/credentialing',
        icon: 'badge-check',
        permission: 'providers:read',
      },
      {
        id: 'privileging',
        name: 'page.providers.privileging',
        route: '/providers/privileging',
        icon: 'stethoscope',
        permission: 'providers:read',
      },
      {
        id: 'expirations',
        name: 'page.providers.expirations',
        route: '/providers/expirations',
        icon: 'calendar-clock',
        permission: 'providers:read',
      },
      {
        id: 'committee',
        name: 'page.providers.committee',
        route: '/providers/committee',
        icon: 'gavel',
        permission: 'providers:read',
      },
    ],
  },
  {
    id: 'enrollment',
    name: 'module.enrollment.name',
    description: 'module.enrollment.description',
    icon: 'id-card',
    status: 'mvp',
    requirementChapters: [16],
    pages: [
      {
        id: 'board',
        name: 'page.enrollment.board',
        route: '/enrollment',
        icon: 'square-kanban',
        permission: 'enrollment:read',
      },
      {
        id: 'payers',
        name: 'page.enrollment.payers',
        route: '/enrollment/payers',
        icon: 'hand-coins',
        permission: 'enrollment:read',
      },
      {
        id: 'revalidations',
        name: 'page.enrollment.revalidations',
        route: '/enrollment/revalidations',
        icon: 'refresh-cw',
        permission: 'enrollment:read',
      },
      {
        id: 'applications',
        name: 'page.enrollment.applications',
        route: '/enrollment/applications',
        icon: 'file-text',
        permission: 'enrollment:read',
      },
    ],
  },
  {
    id: 'screening',
    name: 'module.screening.name',
    description: 'module.screening.description',
    icon: 'scan-search',
    status: 'mvp',
    // Also 2 CFR 180 (suspension and debarment); that citation lives in the catalog.
    requirementChapters: [5, 12, 13],
    pages: [
      {
        id: 'runs',
        name: 'page.screening.runs',
        route: '/screening',
        icon: 'scan-search',
        permission: 'screening:read',
      },
      {
        id: 'matches',
        name: 'page.screening.matches',
        route: '/screening/matches',
        icon: 'user-search',
        permission: 'screening:read',
      },
      {
        id: 'history',
        name: 'page.screening.history',
        route: '/screening/history',
        icon: 'history',
        permission: 'screening:read',
      },
    ],
  },
  {
    id: 'governance',
    name: 'module.governance.name',
    description: 'module.governance.description',
    icon: 'landmark',
    status: 'mvp',
    requirementChapters: [11, 13, 19, 20],
    pages: [
      {
        id: 'board',
        name: 'page.governance.board',
        route: '/governance/board',
        icon: 'users-round',
        permission: 'governance:read',
      },
      {
        id: 'meetings',
        name: 'page.governance.meetings',
        route: '/governance/meetings',
        icon: 'notebook-pen',
        permission: 'governance:read_own',
      },
      {
        id: 'approvals',
        name: 'page.governance.approvals',
        route: '/governance/approvals',
        icon: 'stamp',
        permission: 'governance:read',
      },
      {
        id: 'coi',
        name: 'page.governance.coi',
        route: '/governance/coi',
        icon: 'scale',
        permission: 'governance:read',
      },
      {
        id: 'policies',
        name: 'page.governance.policies',
        route: '/governance/policies',
        icon: 'book-open',
        permission: 'governance:read',
      },
    ],
  },
  {
    id: 'scope',
    name: 'module.scope.name',
    description: 'module.scope.description',
    icon: 'map-pin',
    status: 'next',
    requirementChapters: [4, 6, 7, 8],
    pages: [
      {
        id: 'services',
        name: 'page.scope.services',
        route: '/scope/services',
        icon: 'heart-pulse',
        permission: 'scope:read',
      },
      {
        id: 'sites',
        name: 'page.scope.sites',
        route: '/scope/sites',
        icon: 'map-pin',
        permission: 'scope:read',
      },
      {
        id: 'activities',
        name: 'page.scope.activities',
        route: '/scope/activities',
        icon: 'network',
        permission: 'scope:read',
      },
      {
        id: 'changes',
        name: 'page.scope.changes',
        route: '/scope/changes',
        icon: 'file-diff',
        permission: 'scope:read',
      },
      {
        id: 'hours',
        name: 'page.scope.hours',
        route: '/scope/hours',
        icon: 'clock',
        permission: 'scope:read',
      },
    ],
  },
  {
    id: 'contracts',
    name: 'module.contracts.name',
    description: 'module.contracts.description',
    icon: 'file-signature',
    status: 'next',
    requirementChapters: [12, 14],
    pages: [
      {
        id: 'contracts',
        name: 'page.contracts.contracts',
        route: '/contracts',
        icon: 'file-text',
        permission: 'contracts:read',
      },
      {
        id: 'subawards',
        name: 'page.contracts.subawards',
        route: '/contracts/subawards',
        icon: 'hand-coins',
        permission: 'contracts:read',
      },
      {
        id: 'collaborations',
        name: 'page.contracts.collaborations',
        route: '/contracts/collaborations',
        icon: 'handshake',
        permission: 'contracts:read',
      },
      {
        id: 'renewals',
        name: 'page.contracts.renewals',
        route: '/contracts/renewals',
        icon: 'refresh-cw',
        permission: 'contracts:read',
      },
    ],
  },
  {
    id: 'finance',
    name: 'module.finance.name',
    description: 'module.finance.description',
    icon: 'wallet',
    status: 'next',
    requirementChapters: [9, 15, 16, 17],
    pages: [
      {
        id: 'sfdp',
        name: 'page.finance.sfdp',
        route: '/finance/sfdp',
        icon: 'percent',
        permission: 'finance:read',
      },
      {
        id: 'billing',
        name: 'page.finance.billing',
        route: '/finance/billing',
        icon: 'receipt',
        permission: 'finance:read',
      },
      {
        id: 'budget',
        name: 'page.finance.budget',
        route: '/finance/budget',
        icon: 'piggy-bank',
        permission: 'finance:read',
      },
      {
        id: 'grants',
        name: 'page.finance.grants',
        route: '/finance/grants',
        icon: 'chart-column',
        permission: 'finance:read',
      },
      {
        id: 'audit',
        name: 'page.finance.audit',
        route: '/finance/audit',
        icon: 'search-check',
        permission: 'finance:read',
      },
    ],
  },
  {
    id: 'ftca',
    name: 'module.ftca.name',
    description: 'module.ftca.description',
    icon: 'umbrella',
    status: 'mvp',
    requirementChapters: [21],
    pages: [
      {
        id: 'deeming',
        name: 'page.ftca.deeming',
        route: '/ftca',
        icon: 'umbrella',
        permission: 'ftca:read',
      },
      {
        id: 'risk',
        name: 'page.ftca.risk',
        route: '/ftca/risk',
        icon: 'shield-alert',
        permission: 'ftca:read',
      },
      {
        id: 'incidents',
        name: 'page.ftca.incidents',
        route: '/ftca/incidents',
        icon: 'siren',
        permission: 'ftca:read',
      },
      {
        id: 'claims',
        name: 'page.ftca.claims',
        route: '/ftca/claims',
        icon: 'scale',
        permission: 'ftca:read',
      },
      {
        id: 'tracking',
        name: 'page.ftca.tracking',
        route: '/ftca/tracking',
        icon: 'radar',
        permission: 'ftca:read',
      },
    ],
  },
  {
    id: 'quality',
    name: 'module.quality.name',
    description: 'module.quality.description',
    icon: 'activity',
    status: 'next',
    requirementChapters: [3, 10, 18],
    pages: [
      {
        id: 'plan',
        name: 'page.quality.plan',
        route: '/quality',
        icon: 'clipboard-list',
        permission: 'quality:read',
      },
      {
        id: 'measures',
        name: 'page.quality.measures',
        route: '/quality/measures',
        icon: 'chart-line',
        permission: 'quality:read',
      },
      {
        id: 'peer-review',
        name: 'page.quality.peer-review',
        route: '/quality/peer-review',
        icon: 'users',
        permission: 'quality:read',
      },
      {
        id: 'uds',
        name: 'page.quality.uds',
        route: '/quality/uds',
        icon: 'chart-column',
        permission: 'quality:read',
      },
      {
        id: 'needs-assessment',
        name: 'page.quality.needs-assessment',
        route: '/quality/needs-assessment',
        icon: 'target',
        permission: 'quality:read',
      },
    ],
  },
  {
    id: 'experience',
    name: 'module.experience.name',
    description: 'module.experience.description',
    icon: 'heart-handshake',
    status: 'next',
    requirementChapters: [10, 19],
    pages: [
      {
        id: 'surveys',
        name: 'page.experience.surveys',
        route: '/experience/surveys',
        icon: 'message-square-text',
        permission: 'experience:read',
      },
      {
        id: 'grievances',
        name: 'page.experience.grievances',
        route: '/experience/grievances',
        icon: 'message-square-warning',
        permission: 'experience:read',
      },
      {
        id: 'trends',
        name: 'page.experience.trends',
        route: '/experience/trends',
        icon: 'trending-up',
        permission: 'experience:read',
      },
    ],
  },
  {
    id: 'learning',
    name: 'module.learning.name',
    description: 'module.learning.description',
    icon: 'graduation-cap',
    status: 'next',
    requirementChapters: [5, 21],
    pages: [
      {
        id: 'catalog',
        name: 'page.learning.catalog',
        route: '/learning',
        icon: 'library',
        permission: 'learning:read_own',
      },
      {
        id: 'assignments',
        name: 'page.learning.assignments',
        route: '/learning/assignments',
        icon: 'clipboard-list',
        permission: 'learning:read',
      },
      {
        id: 'completions',
        name: 'page.learning.completions',
        route: '/learning/completions',
        icon: 'circle-check',
        permission: 'learning:read',
      },
    ],
  },
  {
    id: 'tasks',
    name: 'module.tasks.name',
    description: 'module.tasks.description',
    icon: 'list-checks',
    status: 'mvp',
    requirementChapters: ALL_CHAPTERS,
    pages: [
      {
        id: 'mine',
        name: 'page.tasks.mine',
        route: '/tasks',
        icon: 'list-checks',
        permission: 'tasks:read_own',
      },
      {
        id: 'team',
        name: 'page.tasks.team',
        route: '/tasks/team',
        icon: 'inbox',
        permission: 'tasks:read',
      },
      {
        id: 'workflows',
        name: 'page.tasks.workflows',
        route: '/tasks/workflows',
        icon: 'workflow',
        permission: 'tasks:read',
      },
      {
        id: 'approvals',
        name: 'page.tasks.approvals',
        route: '/tasks/approvals',
        icon: 'stamp',
        permission: 'tasks:read',
      },
    ],
  },
  {
    id: 'self-service',
    name: 'module.self-service.name',
    description: 'module.self-service.description',
    icon: 'user-round-check',
    status: 'next',
    requirementChapters: [5, 13],
    pages: [
      {
        id: 'profile',
        name: 'page.self-service.profile',
        route: '/me',
        icon: 'user-round',
        permission: 'self-service:read_own',
      },
      {
        id: 'documents',
        name: 'page.self-service.documents',
        route: '/me/documents',
        icon: 'folder-open',
        permission: 'self-service:read_own',
      },
      {
        id: 'attestations',
        name: 'page.self-service.attestations',
        route: '/me/attestations',
        icon: 'pen-line',
        permission: 'self-service:read_own',
      },
    ],
  },
  {
    id: 'admin',
    name: 'module.admin.name',
    description: 'module.admin.description',
    icon: 'settings',
    status: 'mvp',
    requirementChapters: [],
    pages: [
      {
        id: 'users',
        name: 'page.admin.users',
        route: '/admin/users',
        icon: 'users',
        permission: 'admin:read',
      },
      {
        id: 'org',
        name: 'page.admin.org',
        route: '/admin/org',
        icon: 'building',
        permission: 'admin:read',
      },
      {
        id: 'integrations',
        name: 'page.admin.integrations',
        route: '/admin/integrations',
        icon: 'plug',
        permission: 'admin:read',
      },
      {
        id: 'catalog',
        name: 'page.admin.catalog',
        route: '/admin/catalog',
        icon: 'book-marked',
        permission: 'admin:read',
      },
      {
        id: 'audit',
        name: 'page.admin.audit',
        route: '/admin/audit',
        icon: 'scroll-text',
        permission: 'admin:read',
      },
      {
        id: 'support-access',
        name: 'page.admin.supportAccess',
        route: '/admin/support-access',
        icon: 'shield-check',
        // Page visibility needs admin:read; approving or revoking a grant is an
        // action the API checks separately (ADR-0012 §6).
        permission: 'admin:read',
      },
    ],
  },
];

/**
 * Auth routes (module map "Auth routes (outside the shell)"). Not navigation:
 * never shown in the launcher or module bar.
 */
export const AUTH_ROUTES = {
  signIn: '/sign-in',
  mfa: '/sign-in/mfa',
  recovery: '/sign-in/recovery',
  noPermission: '/no-permission',
} as const;

/** Release statuses that appear in the launcher and module bar. `planned` does not. */
export const LAUNCHER_STATUSES: readonly ReleaseStatus[] = ['mvp', 'next'];

export type PermissionSet = ReadonlySet<Permission> | readonly Permission[];

function has(perms: PermissionSet, p: Permission): boolean {
  return perms instanceof Set ? perms.has(p) : (perms as readonly Permission[]).includes(p);
}

/**
 * Whether the page appears in navigation for these permissions. A `read_own` page
 * is also visible with the module's `read`. This decides what the launcher shows,
 * not what the API returns (the API enforces RBAC and record rules).
 */
export function canViewPage(page: PageEntry, perms: PermissionSet): boolean {
  if (has(perms, page.permission)) return true;
  const [module, verb] = page.permission.split(':') as [ModuleId, string];
  return verb === 'read_own' && has(perms, `${module}:read`);
}

/**
 * The modules a user can navigate to: launcher statuses only, each with just the
 * pages the user may open. Modules with no permitted page are left out.
 */
export function launcherModules(
  perms: PermissionSet,
  modules: readonly ModuleEntry[] = MODULES,
): ModuleEntry[] {
  return modules
    .filter((m) => LAUNCHER_STATUSES.includes(m.status))
    .map((m) => ({ ...m, pages: m.pages.filter((p) => canViewPage(p, perms)) }))
    .filter((m) => m.pages.length > 0);
}

export function normalizeRoute(pathname: string): string {
  const path = pathname.split(/[?#]/, 1)[0] ?? '/';
  // Trim trailing slashes with a loop, not /\/+$/, which backtracks
  // polynomially on long slash runs (CodeQL js/polynomial-redos).
  let end = path.length;
  while (end > 1 && path.charCodeAt(end - 1) === 47 /* '/' */) end--;
  return end === 0 ? '/' : path.slice(0, end);
}

export type RouteMatch = { module: ModuleEntry; page: PageEntry };

/** The registry page at exactly this route, from any module (any status). */
export function findRoute(
  pathname: string,
  modules: readonly ModuleEntry[] = MODULES,
): RouteMatch | undefined {
  const route = normalizeRoute(pathname);
  for (const module of modules) {
    const page = module.pages.find((p) => p.route === route);
    if (page) return { module, page };
  }
  return undefined;
}

/**
 * The module a pathname belongs to: an exact page match, else the page with the
 * longest route that is a path prefix (so `/providers/123` belongs to Providers).
 */
export function matchModule(
  pathname: string,
  modules: readonly ModuleEntry[] = MODULES,
): RouteMatch | undefined {
  const exact = findRoute(pathname, modules);
  if (exact) return exact;
  const route = normalizeRoute(pathname);
  let best: RouteMatch | undefined;
  for (const module of modules) {
    for (const page of module.pages) {
      if (page.route !== '/' && route.startsWith(`${page.route}/`)) {
        if (!best || page.route.length > best.page.route.length) best = { module, page };
      }
    }
  }
  return best;
}

/** Where "Home" goes for this user: Command Center overview, else their first page. */
export function homeRoute(perms: PermissionSet): string | undefined {
  const modules = launcherModules(perms);
  return modules[0]?.pages[0]?.route;
}

export function allPages(modules: readonly ModuleEntry[] = MODULES): RouteMatch[] {
  return modules.flatMap((module) => module.pages.map((page) => ({ module, page })));
}
