'use client';

import Link from 'next/link';
import { KeyRound } from 'lucide-react';
import { useActionState } from 'react';
import { t, type Locale } from '@deemed/i18n';
import { Alert, Button, Card, Input, buttonClasses, textLinkClasses } from '@deemed/ui';
import { ERROR_MESSAGES, IDLE, fieldError, type AuthFormState } from '../../../../lib/auth-types';
import { FormError, OrDivider, SignInHeading, useFocusOnError } from '../form-bits';

type Action = (prev: AuthFormState, form: FormData) => Promise<AuthFormState>;

export type MfaActions = { code: Action; passkey: () => Promise<AuthFormState> };

/** Second step (ADR-0006 §3): passkey (preferred) or authenticator code. No SMS/email OTP. */
export function MfaForm({
  locale,
  expired,
  actions,
}: {
  locale: Locale;
  /** No sign-in in progress (or it timed out): show the "start again" state. */
  expired: boolean;
  actions: MfaActions;
}) {
  const tr = (k: Parameters<typeof t>[1], v?: Parameters<typeof t>[2]) => t(locale, k, v);
  const [codeState, codeAction, codePending] = useActionState(actions.code, IDLE);
  const [keyState, keyAction, keyPending] = useActionState(actions.passkey, IDLE);
  const codeRef = useFocusOnError(codeState, 'code');
  const codeErr = fieldError(codeState, 'code');
  const timedOut =
    expired ||
    (codeState.status === 'error' && codeState.code === 'expired') ||
    (keyState.status === 'error' && keyState.code === 'expired');

  if (timedOut) {
    return (
      <Card className="p-6 sm:p-8">
        <SignInHeading title={tr('mfa.expired.title')} />
        <Alert tone="warn" title={tr('mfa.expired.title')}>
          {tr('mfa.expired.body')}
        </Alert>
        <Link href="/sign-in" className={buttonClasses({ fullWidth: true, className: 'mt-6' })}>
          {tr('mfa.startAgain')}
        </Link>
      </Card>
    );
  }

  return (
    <Card className="p-6 sm:p-8">
      <SignInHeading title={tr('mfa.title')} body={tr('mfa.body')} />

      <form action={keyAction}>
        <FormError state={keyState} locale={locale} />
        <Button
          type="submit"
          size="lg"
          fullWidth
          className="mt-2"
          icon={<KeyRound aria-hidden="true" size={20} strokeWidth={1.75} />}
          loading={keyPending}
          loadingLabel={tr('mfa.verifying')}
        >
          {tr('mfa.passkey')}
        </Button>
        <p className="mt-2 text-center text-sm text-gray-500">{tr('mfa.passkeyHint')}</p>
      </form>

      <OrDivider label={tr('signIn.or')} />

      <form action={codeAction} noValidate>
        <div className="flex flex-col gap-4">
          <FormError state={codeState} locale={locale} />
          <Input
            ref={codeRef}
            id="code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            spellCheck={false}
            className="[&_input]:font-mono [&_input]:tracking-[0.3em]"
            label={tr('mfa.code.label')}
            hint={tr('mfa.code.hint')}
            error={codeErr ? tr(ERROR_MESSAGES[codeErr]) : undefined}
            required
          />
          <Button
            type="submit"
            variant="secondary"
            fullWidth
            loading={codePending}
            loadingLabel={tr('mfa.verifying')}
          >
            {tr('mfa.verify')}
          </Button>
        </div>
      </form>

      <p className="mt-6 text-center text-sm">
        <Link href="/sign-in/recovery" className={textLinkClasses}>
          {tr('mfa.lost')}
        </Link>
      </p>
    </Card>
  );
}
