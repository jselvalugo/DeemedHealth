import Link from 'next/link';
import { t, type Locale, type MessageKey } from '@deemed/i18n';
import {
  Badge,
  EmptyState,
  HowItWorks,
  LinkArrow,
  PageHeader,
  buttonClasses,
  findRoute,
  textLinkClasses,
  type ModuleEntry,
  type PageEntry,
  type PermissionSet,
  canViewPage,
  type Step,
} from '@deemed/ui';

const STEPS: { title: MessageKey; body: MessageKey; route: string; planned?: boolean }[] = [
  { title: 'howItWorks.step1.title', body: 'howItWorks.step1.body', route: '/admin/org' },
  { title: 'howItWorks.step2.title', body: 'howItWorks.step2.body', route: '/readiness' },
  { title: 'howItWorks.step3.title', body: 'howItWorks.step3.body', route: '/readiness/evidence' },
  { title: 'howItWorks.step4.title', body: 'howItWorks.step4.body', route: '/tasks' },
  {
    title: 'howItWorks.step5.title',
    body: 'howItWorks.step5.body',
    route: '/readiness/osv',
    planned: true,
  },
];

/** "How Deemed Health works": links only to pages this user can open. */
function steps(locale: Locale, perms: PermissionSet): Step[] {
  return STEPS.map((s) => {
    const target = findRoute(s.route);
    const allowed = target && canViewPage(target.page, perms);
    const pageName = target ? t(locale, target.page.name) : '';
    return {
      title: t(locale, s.title),
      body: t(locale, s.body),
      planned: s.planned ?? false,
      link:
        allowed && !s.planned ? (
          <Link href={s.route} className={textLinkClasses}>
            {t(locale, 'howItWorks.open', { page: pageName })}
            <LinkArrow />
          </Link>
        ) : undefined,
    };
  });
}

/** Placeholder for every registry page until its module ships (Phase 1 slice S1). */
export function ModulePlaceholder({
  locale,
  module,
  page,
  tenantName,
  userFirstName,
  perms,
}: {
  locale: Locale;
  module: ModuleEntry;
  page: PageEntry;
  tenantName: string;
  userFirstName: string;
  perms: PermissionSet;
}) {
  const moduleName = t(locale, module.name);
  const pageName = t(locale, page.name);
  const isHome = page.route === '/';
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={t(locale, 'placeholder.eyebrow', { module: moduleName, tenant: tenantName })}
        title={isHome ? t(locale, 'home.greeting', { name: userFirstName }) : pageName}
        display={isHome}
        description={t(locale, module.description)}
        actions={
          <Badge status="info">
            {`${t(locale, 'placeholder.release')}: ${t(locale, module.status === 'mvp' ? 'release.mvp' : 'release.next')}`}
          </Badge>
        }
      />
      <HowItWorks
        title={t(locale, 'howItWorks.title')}
        steps={steps(locale, perms)}
        plannedLabel={t(locale, 'status.planned')}
      />
      <EmptyState
        title={t(locale, 'placeholder.empty.title')}
        body={t(locale, 'placeholder.empty.body', { page: pageName, module: moduleName })}
      />
    </div>
  );
}

/** "No permission" state: explains why and where to go, never a dead end. */
export function NoPermissionView({
  locale,
  pageName,
  homeHref,
}: {
  locale: Locale;
  pageName?: string | undefined;
  homeHref: string | undefined;
}) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 py-4">
      <div>
        <Badge status="neutral">{t(locale, 'noPermission.badge')}</Badge>
      </div>
      <EmptyState
        icon="lock"
        headingLevel={1}
        title={t(locale, 'noPermission.title')}
        body={
          pageName
            ? t(locale, 'noPermission.body', { page: pageName })
            : t(locale, 'noPermission.bodyGeneric')
        }
        action={
          homeHref ? (
            <Link href={homeHref} className={buttonClasses()}>
              {t(locale, 'noPermission.home')}
            </Link>
          ) : undefined
        }
      />
    </div>
  );
}
