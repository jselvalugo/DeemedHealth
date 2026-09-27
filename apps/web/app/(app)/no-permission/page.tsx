import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { t } from '@deemed/i18n';
import { homeRoute } from '@deemed/ui';
import { getCurrentUser, getLocale } from '../../../lib/session';
import { NoPermissionView } from '../views';

export async function generateMetadata(): Promise<Metadata> {
  return { title: t(await getLocale(), 'noPermission.title') };
}

export default async function NoPermissionPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');
  const locale = await getLocale();
  return <NoPermissionView locale={locale} homeHref={homeRoute(user.permissions)} />;
}
