import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { isProduction } from '@deemed/domain';
import { t } from '@deemed/i18n';
import { signInWithPassword, signInWithSso, startSignIn } from '../../../lib/auth-stub';
import { authMode } from '../../../lib/auth-mode';
import { getCurrentUser, getLocale } from '../../../lib/session';
import { ApiSignInForm } from './api-forms';
import { SignInForm, type SignInNotice } from './sign-in-form';

export async function generateMetadata(): Promise<Metadata> {
  return { title: t(await getLocale(), 'signIn.title') };
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (await getCurrentUser()) redirect('/');
  const { reason } = await searchParams;
  const locale = await getLocale();
  const known: SignInNotice | undefined =
    reason === 'expired' || reason === 'signed-out' ? reason : undefined;
  if (authMode() === 'api') return <ApiSignInForm locale={locale} notice={known} />;
  return (
    <SignInForm
      locale={locale}
      notice={known}
      showDemoHint={!isProduction(process.env.DH_ENV)}
      actions={{ start: startSignIn, password: signInWithPassword, sso: signInWithSso }}
    />
  );
}
