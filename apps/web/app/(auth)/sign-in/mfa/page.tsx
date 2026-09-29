import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { isProduction } from '@deemed/domain';
import { t } from '@deemed/i18n';
import { verifyMfaCode, verifyPasskey } from '../../../../lib/auth-stub';
import { authMode } from '../../../../lib/auth-mode';
import { getLocale, hasPendingSignIn } from '../../../../lib/session';
import { ApiMfaForm, ApiMfaSetup } from '../api-forms';
import { MfaForm } from './mfa-form';

export async function generateMetadata(): Promise<Metadata> {
  return { title: t(await getLocale(), 'mfa.title') };
}

export default async function MfaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // The setup code is typed, never taken from the URL (history, logs, Referer). A link
  // that still carries one comes back to the same step without it; the value is ignored.
  if (params.code !== undefined) {
    redirect(params.setup === '1' ? '/sign-in/mfa?setup=1' : '/sign-in/mfa');
  }
  const locale = await getLocale();
  if (authMode() === 'api') {
    const pending = await hasPendingSignIn();
    if (pending && params.setup === '1') return <ApiMfaSetup locale={locale} />;
    return <ApiMfaForm locale={locale} expired={!pending} />;
  }
  // In production the stubs answer "not implemented", so show the form rather than
  // an "expired" state that could never be resolved.
  const expired = !isProduction(process.env.DH_ENV) && !(await hasPendingSignIn());
  return (
    <MfaForm
      locale={locale}
      expired={expired}
      actions={{ code: verifyMfaCode, passkey: verifyPasskey }}
    />
  );
}
