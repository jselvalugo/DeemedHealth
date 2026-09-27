'use client';

import Link from 'next/link';
import { useActionState, useEffect, useRef, useState } from 'react';
import { t, type Locale } from '@deemed/i18n';
import { Alert, Button, Card, Input, textLinkClasses } from '@deemed/ui';
import { ERROR_MESSAGES, IDLE, fieldError, type AuthFormState } from '../../../lib/auth-types';
import { FormError, OrDivider, SignInHeading, useFocusOnError } from './form-bits';

export type SignInNotice = 'expired' | 'signed-out';

type Action = (prev: AuthFormState, form: FormData) => Promise<AuthFormState>;

export type SignInActions = {
  start: Action;
  password: Action;
  sso: Action;
};

/**
 * Sign-in step 1 (email) and step 2 (SSO or password). Server actions are passed
 * in so the form can be tested and previewed without a server.
 */
export function SignInForm({
  locale,
  notice,
  showDemoHint,
  actions,
}: {
  locale: Locale;
  notice: SignInNotice | undefined;
  showDemoHint: boolean;
  actions: SignInActions;
}) {
  const tr = (k: Parameters<typeof t>[1], v?: Parameters<typeof t>[2]) => t(locale, k, v);
  const [emailState, emailAction, emailPending] = useActionState(actions.start, IDLE);
  const [pwState, pwAction, pwPending] = useActionState(actions.password, IDLE);
  const [ssoState, ssoAction, ssoPending] = useActionState(actions.sso, IDLE);
  const [editingEmail, setEditingEmail] = useState(false);
  const emailRef = useFocusOnError(emailState, 'email');
  const pwRef = useFocusOnError(pwState, 'password');

  const method = emailState.status === 'method' && !editingEmail ? emailState : undefined;
  const methodRef = useRef<HTMLDivElement>(null);
  const onMethodStep = Boolean(method);
  useEffect(() => {
    // The email field disappears on step 2; keep focus in the form, not on <body>.
    if (onMethodStep) methodRef.current?.focus();
    else if (editingEmail) emailRef.current?.focus();
  }, [onMethodStep, editingEmail, emailRef]);
  const emailErr = fieldError(emailState, 'email');
  const pwErr = fieldError(pwState, 'password');

  return (
    <Card className="p-6 sm:p-8">
      <SignInHeading title={tr('signIn.title')} />

      {notice && !method && (
        <Alert tone="info" title={tr('signIn.notice.title')} className="mb-6">
          {tr(notice === 'expired' ? 'signIn.notice.expired' : 'signIn.notice.signedOut')}
        </Alert>
      )}

      {!method ? (
        <form action={emailAction} noValidate onSubmit={() => setEditingEmail(false)}>
          <div className="flex flex-col gap-4">
            <FormError state={emailState} locale={locale} />
            <Input
              ref={emailRef}
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              inputMode="email"
              spellCheck={false}
              label={tr('signIn.email.label')}
              defaultValue={emailState.status === 'method' ? emailState.email : undefined}
              error={emailErr ? tr(ERROR_MESSAGES[emailErr]) : undefined}
              required
            />
            <Button
              type="submit"
              fullWidth
              loading={emailPending}
              loadingLabel={tr('signIn.checking')}
            >
              {tr('signIn.continue')}
            </Button>
          </div>
        </form>
      ) : (
        <div>
          <div
            ref={methodRef}
            tabIndex={-1}
            className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-control bg-gray-25 px-3 py-2 text-sm outline-none"
          >
            <span className="min-w-0 break-all text-gray-900">
              {tr('signIn.signingInAs', { email: method.email })}
            </span>
            <button type="button" onClick={() => setEditingEmail(true)} className={textLinkClasses}>
              {tr('signIn.changeEmail')}
            </button>
          </div>

          {method.sso && (
            <form action={ssoAction}>
              <input type="hidden" name="email" value={method.email} />
              <FormError state={ssoState} locale={locale} />
              <Button
                type="submit"
                fullWidth
                size="lg"
                className="mt-2"
                loading={ssoPending}
                loadingLabel={tr('signIn.checking')}
              >
                {tr('signIn.sso')}
              </Button>
              <p className="mt-2 text-center text-sm text-gray-500">{tr('signIn.ssoHint')}</p>
            </form>
          )}

          {method.sso && <OrDivider label={tr('signIn.or')} />}

          <form action={pwAction} noValidate>
            <div className="flex flex-col gap-4">
              <FormError state={pwState} locale={locale} />
              {/* Lets password managers pair the saved email with this password. */}
              <input type="hidden" name="email" value={method.email} autoComplete="username" />
              <Input
                ref={pwRef}
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                label={tr('signIn.password.label')}
                error={pwErr ? tr(ERROR_MESSAGES[pwErr]) : undefined}
                required
              />
              <Button
                type="submit"
                variant="secondary"
                fullWidth
                loading={pwPending}
                loadingLabel={tr('signIn.checking')}
              >
                {tr('signIn.password.submit')}
              </Button>
            </div>
          </form>
        </div>
      )}

      <p className="mt-6 text-center text-sm">
        <Link href="/sign-in/recovery" className={textLinkClasses}>
          {tr('signIn.cantSignIn')}
        </Link>
      </p>

      {showDemoHint && (
        <p className="mt-4 rounded-control bg-preview-bg px-3 py-2 text-sm text-preview-fg">
          {tr('signIn.demo')}
        </p>
      )}
    </Card>
  );
}
