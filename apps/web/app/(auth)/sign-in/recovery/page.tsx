import type { Metadata } from 'next';
import { t } from '@deemed/i18n';
import { redeemRecoveryCode } from '../../../../lib/auth-stub';
import { authMode } from '../../../../lib/auth-mode';
import { getLocale } from '../../../../lib/session';
import { ApiRecoveryForm } from '../api-forms';
import { RecoveryForm } from './recovery-form';

export async function generateMetadata(): Promise<Metadata> {
  return { title: t(await getLocale(), 'recovery.title') };
}

export default async function RecoveryPage() {
  const locale = await getLocale();
  if (authMode() === 'api') return <ApiRecoveryForm locale={locale} />;
  return <RecoveryForm locale={locale} action={redeemRecoveryCode} />;
}
