'use client';

/**
 * The S1 sign-in forms wired to apps/api (phase-1 plan S3). The browser talks to
 * /api/auth/* on the same origin, so session cookies stay HttpOnly and are set by the
 * API itself. A session exists only after a second factor: the password step always
 * continues to /sign-in/mfa (or to first-time setup).
 */
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { KeyRound } from 'lucide-react';
import { useActionState, useState } from 'react';
import { t, type Locale } from '@deemed/i18n';
import { Button, Card, Input } from '@deemed/ui';
import type { ApiErrorCode, LoginResponse, TotpEnrollmentResponse } from '@deemed/domain';
import { apiPost } from '../../../lib/api-browser';
import {
  ERROR_MESSAGES,
  IDLE,
  fieldError,
  type AuthErrorCode,
  type AuthFormState,
} from '../../../lib/auth-types';
import { compactCode, validateEmail, validateTotp } from '../../../lib/auth-validate';
import { FormError, OrDivider, SignInHeading, useFocusOnError } from './form-bits';
import { MfaForm } from './mfa/mfa-form';
import { RecoveryForm } from './recovery/recovery-form';
import { SignInForm, type SignInNotice } from './sign-in-form';

/** Where the browser goes next; replaced in tests. */
export const navigation = { go: (url: string) => window.location.assign(url) };

function field(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === 'string' ? v : '';
}

function errorFor(code: ApiErrorCode | 'network', step: 'password' | 'code'): AuthFormState {
  const map: Partial<Record<ApiErrorCode | 'network', AuthErrorCode>> = {
    invalid_credentials: 'invalid_credentials',
    bad_request: step === 'password' ? 'invalid_credentials' : 'code_invalid',
    too_many_attempts: 'locked',
    invalid_code: 'code_invalid',
    session_expired: 'expired',
    unauthenticated: 'expired',
    enrollment_token_invalid: 'enrollment_invalid',
  };
  const mapped = map[code] ?? 'unexpected';
  return mapped === 'code_invalid'
    ? { status: 'error', code: mapped, field: 'code' }
    : { status: 'error', code: mapped };
}

// ---------------------------------------------------------------------------
// Step 1: email and password
// ---------------------------------------------------------------------------

export function ApiSignInForm({
  locale,
  notice,
}: {
  locale: Locale;
  notice: SignInNotice | undefined;
}) {
  return (
    <SignInForm
      locale={locale}
      notice={notice}
      showDemoHint={false}
      actions={{
        start: async (_prev, form) => {
          const email = field(form, 'email').trim();
          const invalid = validateEmail(email);
          if (invalid) return { status: 'error', code: invalid, field: 'email' };
          // Single sign-on (OIDC) is a follow-up; local accounts only for now.
          return { status: 'method', email, sso: false };
        },
        password: async (_prev, form) => {
          const password = field(form, 'password');
          if (!password) return { status: 'error', code: 'password_required', field: 'password' };
          const res = await apiPost<LoginResponse>('/api/auth/login', {
            email: field(form, 'email'),
            password,
          });
          if (!res.ok) return errorFor(res.code, 'password');
          navigation.go(res.data.next === 'mfa_enroll' ? '/sign-in/mfa?setup=1' : '/sign-in/mfa');
          return IDLE;
        },
        sso: async () => ({ status: 'not_implemented' }),
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Step 2: second factor
// ---------------------------------------------------------------------------

async function passkeyLogin(): Promise<AuthFormState> {
  const options = await apiPost<Parameters<typeof startAuthentication>[0]['optionsJSON']>(
    '/api/auth/mfa/passkey/options',
  );
  if (!options.ok) return errorFor(options.code, 'code');
  let response: unknown;
  try {
    response = await startAuthentication({ optionsJSON: options.data });
  } catch {
    return { status: 'error', code: 'unexpected' };
  }
  const done = await apiPost('/api/auth/mfa/passkey/verify', { response });
  if (!done.ok) return errorFor(done.code, 'code');
  navigation.go('/');
  return IDLE;
}

export function ApiMfaForm({ locale, expired }: { locale: Locale; expired: boolean }) {
  return (
    <MfaForm
      locale={locale}
      expired={expired}
      actions={{
        code: async (_prev, form) => {
          const code = compactCode(field(form, 'code'));
          const invalid = validateTotp(code);
          if (invalid) return { status: 'error', code: invalid, field: 'code' };
          const res = await apiPost('/api/auth/mfa/totp/verify', { code });
          if (!res.ok) return errorFor(res.code, 'code');
          navigation.go('/');
          return IDLE;
        },
        passkey: passkeyLogin,
      }}
    />
  );
}

/** First sign-in: the user must set up a passkey (preferred) or an authenticator app. */
export function ApiMfaSetup({ locale, initialCode }: { locale: Locale; initialCode?: string }) {
  const tr = (k: Parameters<typeof t>[1]) => t(locale, k);
  const [secret, setSecret] = useState<string | null>(null);
  // The single-use setup code an administrator sent (invitation or MFA reset). A link
  // may carry it as ?code=; otherwise the person types it.
  const [enrollmentToken, setEnrollmentToken] = useState(initialCode ?? '');

  const [keyState, keyAction, keyPending] = useActionState(async (): Promise<AuthFormState> => {
    const options = await apiPost<Parameters<typeof startRegistration>[0]['optionsJSON']>(
      '/api/auth/mfa/passkey/enroll/options',
      { enrollmentToken },
    );
    if (!options.ok) return errorFor(options.code, 'code');
    let response: unknown;
    try {
      response = await startRegistration({ optionsJSON: options.data });
    } catch {
      return { status: 'error', code: 'unexpected' };
    }
    const done = await apiPost('/api/auth/mfa/passkey/enroll/verify', {
      enrollmentToken,
      response,
    });
    if (!done.ok) return errorFor(done.code, 'code');
    navigation.go('/');
    return IDLE;
  }, IDLE);

  const [startState, startAction, startPending] = useActionState(
    async (): Promise<AuthFormState> => {
      const res = await apiPost<TotpEnrollmentResponse>('/api/auth/mfa/totp/enroll', {
        enrollmentToken,
      });
      if (!res.ok) return errorFor(res.code, 'code');
      setSecret(res.data.secret);
      return IDLE;
    },
    IDLE,
  );

  const [codeState, codeAction, codePending] = useActionState(
    async (_prev: AuthFormState, form: FormData): Promise<AuthFormState> => {
      const code = compactCode(field(form, 'code'));
      const invalid = validateTotp(code);
      if (invalid) return { status: 'error', code: invalid, field: 'code' };
      const res = await apiPost('/api/auth/mfa/totp/enroll/verify', { code, enrollmentToken });
      if (!res.ok) return errorFor(res.code, 'code');
      navigation.go('/');
      return IDLE;
    },
    IDLE,
  );
  const codeRef = useFocusOnError(codeState, 'code');
  const codeErr = fieldError(codeState, 'code');

  return (
    <Card className="p-6 sm:p-8">
      <SignInHeading title={tr('mfa.setup.title')} body={tr('mfa.setup.body')} />
      <Input
        id="enrollment-code"
        name="enrollmentToken"
        type="text"
        autoComplete="off"
        spellCheck={false}
        className="mb-6 [&_input]:font-mono"
        label={tr('mfa.setup.token.label')}
        hint={tr('mfa.setup.token.hint')}
        value={enrollmentToken}
        onChange={(e) => setEnrollmentToken(e.target.value.trim())}
        required
      />
      <form action={keyAction}>
        <FormError state={keyState} locale={locale} />
        <Button
          type="submit"
          size="lg"
          fullWidth
          icon={<KeyRound aria-hidden="true" size={20} strokeWidth={1.75} />}
          loading={keyPending}
          loadingLabel={tr('mfa.verifying')}
        >
          {tr('mfa.setup.passkey')}
        </Button>
        <p className="mt-2 text-center text-sm text-gray-500">{tr('mfa.setup.passkeyHint')}</p>
      </form>
      <OrDivider label={tr('signIn.or')} />
      {secret === null ? (
        <form action={startAction}>
          <FormError state={startState} locale={locale} />
          <Button
            type="submit"
            variant="secondary"
            fullWidth
            loading={startPending}
            loadingLabel={tr('mfa.verifying')}
          >
            {tr('mfa.setup.totp')}
          </Button>
        </form>
      ) : (
        <form action={codeAction} noValidate>
          <div className="flex flex-col gap-4">
            <FormError state={codeState} locale={locale} />
            <div>
              <p className="text-sm font-medium text-gray-900">{tr('mfa.setup.secret.label')}</p>
              <p
                className="mt-1 break-all rounded-control bg-gray-25 px-3 py-2 font-mono text-sm"
                data-testid="totp-secret"
              >
                {secret}
              </p>
              <p className="mt-1 text-sm text-gray-500">{tr('mfa.setup.secret.hint')}</p>
            </div>
            <Input
              ref={codeRef}
              id="code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              spellCheck={false}
              label={tr('mfa.code.label')}
              error={codeErr ? tr(ERROR_MESSAGES[codeErr]) : undefined}
              required
            />
            <Button
              type="submit"
              fullWidth
              loading={codePending}
              loadingLabel={tr('mfa.verifying')}
            >
              {tr('mfa.setup.submit')}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

/** Recovery codes do not exist yet in apps/api: point people to their administrator. */
export function ApiRecoveryForm({ locale }: { locale: Locale }) {
  return (
    <RecoveryForm
      locale={locale}
      action={async (_prev, form) => {
        const invalid = validateEmail(field(form, 'email'));
        if (invalid) return { status: 'error', code: invalid, field: 'email' };
        return { status: 'error', code: 'recovery_unavailable' };
      }}
    />
  );
}
