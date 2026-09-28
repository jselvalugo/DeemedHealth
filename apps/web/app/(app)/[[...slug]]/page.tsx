import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getRecordType } from '@deemed/domain';
import { t } from '@deemed/i18n';
import {
  MODULES,
  RECORD_NAV,
  canViewPage,
  findRoute,
  homeRoute,
  listActionsFor,
  matchRecordRoute,
  type RouteMatch,
} from '@deemed/ui';
import { modulesFromNavigation } from '../../../lib/navigation';
import { getCurrentUser, getLocale, getNavigation } from '../../../lib/session';
import { RecordListScreen, RecordScreen } from '../records-view';
import { ModulePlaceholder, NoPermissionView } from '../views';

type Params = {
  params: Promise<{ slug?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function routeOf(slug: string[] | undefined): string {
  return `/${(slug ?? []).map(encodeURIComponent).join('/')}`;
}

/**
 * The registry page a route belongs to: an exact page, or the page that hosts a record
 * list or record (`/admin/role-assignments`, `/admin/org/<uuid>`; ADR-0014 section 3).
 */
function resolve(
  route: string,
): (RouteMatch & { record?: ReturnType<typeof matchRecordRoute> }) | undefined {
  const record = matchRecordRoute(route);
  if (record) {
    const module = MODULES.find((m) => m.id === record.entry.module);
    const page = module?.pages.find((p) => p.id === record.entry.pageId);
    if (module && page) return { module, page, record };
  }
  return findRoute(route);
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const found = resolve(routeOf((await params).slug));
  if (!found) return {};
  const locale = await getLocale();
  const name = found.record ? t(locale, found.record.entry.plural) : t(locale, found.page.name);
  return { title: `${name} · ${t(locale, found.module.name)}` };
}

/**
 * Every page in the module registry (docs/product/module-map.md) resolves here. Record
 * list and record routes render the records components; other pages show the module
 * placeholder until their module ships. Unknown routes 404; routes the user's roles do
 * not include show the "no permission" state at the same URL.
 */
export default async function RegistryPage({ params, searchParams }: Params) {
  const found = resolve(routeOf((await params).slug));
  if (!found) notFound();
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');
  const locale = await getLocale();
  // With the real API, the page list is the one /api/me/navigation allowed (roles can
  // exclude pages their module permission would cover, e.g. D15's administrator).
  const nav = await getNavigation();
  const allowedModules = nav ? modulesFromNavigation(nav) : null;
  const home = allowedModules ? allowedModules[0]?.pages[0]?.route : homeRoute(user.permissions);
  const canView = allowedModules
    ? allowedModules.some((m) => m.pages.some((p) => p.route === found.page.route))
    : canViewPage(found.page, user.permissions);

  const record = found.record;
  const pageName =
    record && !record.id ? t(locale, record.entry.plural) : t(locale, found.page.name);
  if (!canView || (record && !user.permissions.has(record.entry.readPermission))) {
    // Home ("/") falls through to the first page this user can open.
    if (found.page.route === '/' && home && home !== '/') redirect(home);
    return <NoPermissionView locale={locale} pageName={pageName} homeHref={home} />;
  }

  const moduleName = t(locale, found.module.name);
  if (record) {
    const entry = record.entry;
    if (record.id) {
      return (
        <RecordScreen
          key={record.id}
          typeId={entry.recordType}
          id={record.id}
          moduleName={moduleName}
          listHref={entry.listRoute}
        />
      );
    }
    const def = getRecordType(entry.recordType);
    const siblings = RECORD_NAV.filter(
      (e) =>
        e.module === entry.module &&
        e.pageId === entry.pageId &&
        user.permissions.has(e.readPermission),
    ).map((e) => ({
      label: t(locale, e.plural),
      href: e.listRoute,
      current: e.recordType === entry.recordType,
    }));
    const query = await searchParams;
    return (
      <RecordListScreen
        // A new type (or a new "?new=1" from the launcher) starts a fresh table.
        key={`${entry.recordType}:${query.new === '1' ? 'new' : 'list'}`}
        typeId={entry.recordType}
        actions={listActionsFor(def, user.permissions)}
        initialCreate={query.new === '1'}
        eyebrow={t(locale, 'records.eyebrow', { module: moduleName, tenant: user.tenant.name })}
        title={t(locale, found.page.name)}
        description={t(locale, found.module.description)}
        siblings={siblings}
        locale={locale}
      />
    );
  }

  return (
    <ModulePlaceholder
      locale={locale}
      module={found.module}
      page={found.page}
      tenantName={user.tenant.name}
      userFirstName={user.name.split(' ')[0] ?? user.name}
      perms={user.permissions}
    />
  );
}
