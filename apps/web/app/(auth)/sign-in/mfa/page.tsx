import type { Metadata } from 'next';
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
  const locale = await getLocale();
  if (authMode() === 'api') {
    const pending = await hasPendingSignIn();
    const params = await searchParams;
    if (pending && params.setup === '1') {
      const code = typeof params.code === 'string' ? params.code : undefined;
      return <ApiMfaSetup locale={locale} {...(code ? { initialCode: code } : {})} />;
    }
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
