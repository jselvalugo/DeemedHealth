'use client';

/**
 * Re-authentication (ADR-0006 rule 5). Pages call the API through `useApi().post()`.
 * When the API answers 401 `reauth_required`, a dialog asks for a passkey or an
 * authenticator code, calls /api/auth/reauth/*, and then retries the original request
 * once. Cancelling returns the original error.
 */
import { startAuthentication } from '@simplewebauthn/browser';
import { KeyRound } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { t, type Locale } from '@deemed/i18n';
import { Alert, Button, Card, Input } from '@deemed/ui';
import { apiPost, type BrowserResult } from '../../lib/api-browser';
import { compactCode, validateTotp } from '../../lib/auth-validate';

type Api = { post<T = unknown>(path: string, body?: unknown): Promise<BrowserResult<T>> };

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
}: {
  locale: Locale;
  csrfToken: string | undefined;
  children: ReactNode;
  /** Tests inject a fake fetch. */
  fetchImpl?: typeof fetch;
}) {
  const [open, setOpen] = useState(false);
  const pending = useRef<((ok: boolean) => void) | null>(null);

  const askForReauth = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        pending.current = resolve;
        setOpen(true);
      }),
    [],
  );

  const finish = useCallback((ok: boolean) => {
    setOpen(false);
    pending.current?.(ok);
    pending.current = null;
  }, []);

  const api: Api = {
    async post<T>(path: string, body?: unknown) {
      const first = await apiPost<T>(path, body, csrfToken, fetchImpl);
      if (first.ok || first.code !== 'reauth_required') return first;
      if (!(await askForReauth())) return first;
      return apiPost<T>(path, body, csrfToken, fetchImpl);
    },
  };

  return (
    <ApiContext.Provider value={api}>
      {children}
      {open && (
        <ReauthDialog
          locale={locale}
          csrfToken={csrfToken}
          fetchImpl={fetchImpl}
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
}: {
  locale: Locale;
  csrfToken: string | undefined;
  onDone: () => void;
  onCancel: () => void;
  fetchImpl?: typeof fetch | undefined;
}) {
  const tr = (k: Parameters<typeof t>[1]) => t(locale, k);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  async function withCode(e: React.FormEvent) {
    e.preventDefault();
    const value = compactCode(code);
    const invalid = validateTotp(value);
    if (invalid) {
      setError(tr(invalid === 'code_required' ? 'mfa.code.required' : 'mfa.code.format'));
      return;
    }
    setBusy(true);
    const res = await apiPost('/api/auth/reauth/totp', { code: value }, csrfToken, fetchImpl);
    setBusy(false);
    if (res.ok) onDone();
    else setError(tr(res.code === 'invalid_code' ? 'mfa.code.invalid' : 'apiError.internal'));
  }

  async function withPasskey() {
    setBusy(true);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4">
      <Card
        className="w-full max-w-md p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reauth-title"
        aria-describedby="reauth-body"
      >
        <h2 id="reauth-title" className="text-lg font-semibold text-navy-900">
          {tr('reauth.title')}
        </h2>
        <p id="reauth-body" className="mt-2 text-sm text-gray-700">
          {tr('reauth.body')}
        </p>
        {error && (
          <Alert tone="critical" title={tr('signIn.error.title')} className="mt-4">
            {error}
          </Alert>
        )}
        <Button
          type="button"
          fullWidth
          className="mt-4"
          icon={<KeyRound aria-hidden="true" size={20} strokeWidth={1.75} />}
          onClick={withPasskey}
          disabled={busy}
        >
          {tr('reauth.passkey')}
        </Button>
        <form onSubmit={withCode} noValidate className="mt-4 flex flex-col gap-4">
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
      </Card>
    </div>
  );
}
