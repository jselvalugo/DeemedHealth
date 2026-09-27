import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { t } from '@deemed/i18n';
import { canViewPage, findRoute, homeRoute } from '@deemed/ui';
import { modulesFromNavigation } from '../../../lib/navigation';
import { getCurrentUser, getLocale, getNavigation } from '../../../lib/session';
import { ModulePlaceholder, NoPermissionView } from '../views';

type Params = { params: Promise<{ slug?: string[] }> };

function routeOf(slug: string[] | undefined): string {
  return `/${(slug ?? []).map(encodeURIComponent).join('/')}`;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const found = findRoute(routeOf((await params).slug));
  if (!found) return {};
  const locale = await getLocale();
  return { title: `${t(locale, found.page.name)} · ${t(locale, found.module.name)}` };
}

/**
 * Every page in the module registry (docs/product/module-map.md) resolves here
 * until its module ships. Unknown routes 404; routes the user's roles do not
 * include show the "no permission" state at the same URL.
 */
export default async function RegistryPage({ params }: Params) {
  const found = findRoute(routeOf((await params).slug));
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

  if (!canView) {
    // Home ("/") falls through to the first page this user can open.
    if (found.page.route === '/' && home && home !== '/') redirect(home);
    return (
      <NoPermissionView locale={locale} pageName={t(locale, found.page.name)} homeHref={home} />
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
