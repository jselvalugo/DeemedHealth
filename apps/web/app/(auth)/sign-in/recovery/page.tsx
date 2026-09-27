import type { Metadata } from 'next';
import { t } from '@deemed/i18n';
import { redeemRecoveryCode } from '../../../../lib/auth-stub';
import { getLocale } from '../../../../lib/session';
import { RecoveryForm } from './recovery-form';

export async function generateMetadata(): Promise<Metadata> {
  return { title: t(await getLocale(), 'recovery.title') };
}

export default async function RecoveryPage() {
  return <RecoveryForm locale={await getLocale()} action={redeemRecoveryCode} />;
}
