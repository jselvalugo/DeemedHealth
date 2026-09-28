'use client';

/**
 * Re-authentication (ADR-0006 rule 5). Pages call the API through `useApi()`.
 * When the API answers 401 `reauth_required`, a dialog asks for a passkey or an
 * authenticator code, calls /api/auth/reauth/*, and then retries the original request
 * once. Cancelling returns the original error. `withStepUp` wraps any call that can
 * answer `reauth_required` (the records demo adapter uses it too, with its own
 * step-up adapter; see `stepUp`).
 */
import { startAuthentication } from '@simplewebauthn/browser';
import { KeyRound } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { t, type Locale } from '@deemed/i18n';
import { Alert, Button, Input, Modal } from '@deemed/ui';
import {
  apiPost,
  apiRequest,
  type BrowserResult,
  type RequestOptions,
} from '../../lib/api-browser';
import { compactCode, validateTotp } from '../../lib/auth-validate';

export type Api = {
  post<T = unknown>(path: string, body?: unknown): Promise<BrowserResult<T>>;
  request<T = unknown>(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    options?: RequestOptions,
  ): Promise<BrowserResult<T>>;
  /** Runs a call; on `reauth_required` asks for step-up once and retries once. */
  withStepUp<T>(call: () => Promise<BrowserResult<T>>): Promise<BrowserResult<T>>;
};

/**
 * How the dialog confirms it's you. Defaults to apps/api (`/api/auth/reauth/*`); the
 * non-production demo passes its own (a server action that accepts the demo code).
 */
export type StepUpAdapter = {
  totp(code: string): Promise<BrowserResult<unknown>>;
  passkey(): Promise<BrowserResult<unknown>>;
};

const ApiContext = createContext<Api | null>(null);

export function useApi(): Api {
  const api = useContext(ApiContext);
  if (!api) throw new Error('useApi must be used inside <ApiProvider>');
  return api;
}

export function ApiProvider({
  locale,
  csrfToken,
  children,
  fetchImpl,
  stepUp,
}: {
  locale: Locale;
  csrfToken: string | undefined;
  children: ReactNode;
  /** Tests inject a fake fetch. */
  fetchImpl?: typeof fetch;
  stepUp?: StepUpAdapter | undefined;
}) {
  const [open, setOpen] = useState(false);
  // One dialog and one answer for every request that needs step-up at the same time:
  // concurrent callers share the pending promise, and `finish` resolves all of them.
  const pending = useRef<{ promise: Promise<boolean>; resolve: (ok: boolean) => void } | null>(
    null,
  );

  const askForReauth = useCallback(() => {
    if (pending.current) return pending.current.promise;
    let resolve: (ok: boolean) => void = () => {};
    const promise = new Promise<boolean>((r) => {
      resolve = r;
    });
    pending.current = { promise, resolve };
    setOpen(true);
    return promise;
  }, []);

  const finish = useCallback((ok: boolean) => {
    const current = pending.current;
    pending.current = null;
    setOpen(false);
    current?.resolve(ok);
  }, []);

  const api = useMemo<Api>(() => {
    async function withStepUp<T>(call: () => Promise<BrowserResult<T>>) {
      const first = await call();
      if (first.ok || first.code !== 'reauth_required') return first;
      if (!(await askForReauth())) return first;
      return call();
    }
    return {
      withStepUp,
      post: <T,>(path: string, body?: unknown) =>
        withStepUp(() => apiPost<T>(path, body, csrfToken, fetchImpl)),
      request: <T,>(method: 'GET' | 'POST' | 'PATCH', path: string, options?: RequestOptions) =>
        withStepUp(() => apiRequest<T>(method, path, options, csrfToken, fetchImpl)),
    };
  }, [askForReauth, csrfToken, fetchImpl]);

  return (
    <ApiContext.Provider value={api}>
      {children}
      {open && (
        <ReauthDialog
          locale={locale}
          csrfToken={csrfToken}
          fetchImpl={fetchImpl}
          stepUp={stepUp}
          onDone={() => finish(true)}
          onCancel={() => finish(false)}
        />
      )}
    </ApiContext.Provider>
  );
}

export function ReauthDialog({
  locale,
  csrfToken,
  onDone,
  onCancel,
  fetchImpl,
  stepUp,
}: {
  locale: Locale;
  csrfToken: string | undefined;
  onDone: () => void;
  onCancel: () => void;
  fetchImpl?: typeof fetch | undefined;
  stepUp?: StepUpAdapter | undefined;
}) {
  const tr = (k: Parameters<typeof t>[1]) => t(locale, k);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function withCode(e: React.FormEvent) {
    e.preventDefault();
    const value = compactCode(code);
    const invalid = validateTotp(value);
    if (invalid) {
      setError(tr(invalid === 'code_required' ? 'mfa.code.required' : 'mfa.code.format'));
      return;
    }
    setBusy(true);
    const res = stepUp
      ? await stepUp.totp(value)
      : await apiPost('/api/auth/reauth/totp', { code: value }, csrfToken, fetchImpl);
    setBusy(false);
    if (res.ok) onDone();
    else setError(tr(res.code === 'invalid_code' ? 'mfa.code.invalid' : 'apiError.internal'));
  }

  async function withPasskey() {
    setBusy(true);
    if (stepUp) {
      const res = await stepUp.passkey();
      setBusy(false);
      if (res.ok) onDone();
      else setError(tr('apiError.invalid_code'));
      return;
    }
    const options = await apiPost<Parameters<typeof startAuthentication>[0]['optionsJSON']>(
      '/api/auth/reauth/passkey/options',
      {},
      csrfToken,
      fetchImpl,
    );
    try {
      if (!options.ok) throw new Error(options.code);
      const response = await startAuthentication({ optionsJSON: options.data });
      const res = await apiPost(
        '/api/auth/reauth/passkey/verify',
        { response },
        csrfToken,
        fetchImpl,
      );
      if (!res.ok) throw new Error(res.code);
      onDone();
    } catch {
      setError(tr('apiError.invalid_code'));
    } finally {
      setBusy(false);
    }
  }

  return (
    // A Radix dialog (focus trap, Esc, aria-modal): it also stacks above another open
    // dialog, such as the reveal dialog that asked for the step-up.
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !busy) onCancel();
      }}
      title={tr('reauth.title')}
      description={tr('reauth.body')}
      closeLabel={tr('records.close')}
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        inputRef.current?.focus();
      }}
    >
      {error && (
        <Alert tone="critical" title={tr('signIn.error.title')}>
          {error}
        </Alert>
      )}
      <Button
        type="button"
        fullWidth
        icon={<KeyRound aria-hidden="true" size={20} strokeWidth={1.75} />}
        onClick={withPasskey}
        disabled={busy}
      >
        {tr('reauth.passkey')}
      </Button>
      <form onSubmit={withCode} noValidate className="flex flex-col gap-4">
        <Input
          ref={inputRef}
          id="reauth-code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          label={tr('reauth.code.label')}
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
            {tr('reauth.cancel')}
          </Button>
          <Button type="submit" fullWidth loading={busy} loadingLabel={tr('mfa.verifying')}>
            {tr('reauth.submit')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
