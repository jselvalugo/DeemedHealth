import type { Metadata } from 'next';
import { isProduction } from '@deemed/domain';
import { t } from '@deemed/i18n';
import { verifyMfaCode, verifyPasskey } from '../../../../lib/auth-stub';
import { getLocale, hasPendingSignIn } from '../../../../lib/session';
import { MfaForm } from './mfa-form';

export async function generateMetadata(): Promise<Metadata> {
  return { title: t(await getLocale(), 'mfa.title') };
}

export default async function MfaPage() {
  const locale = await getLocale();
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
