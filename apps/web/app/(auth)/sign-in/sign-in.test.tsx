import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../../test/axe';
import type { AuthFormState } from '../../../lib/auth-types';
import { MfaForm } from './mfa/mfa-form';
import { RecoveryForm } from './recovery/recovery-form';
import { SignInForm, type SignInActions } from './sign-in-form';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const idle = async (): Promise<AuthFormState> => ({ status: 'idle' });

function actions(overrides: Partial<SignInActions> = {}): SignInActions {
  return { start: idle, password: idle, sso: idle, ...overrides };
}

/** Render inside a <main> like the sign-in layout does. */
function inMain(ui: ReactNode) {
  return render(<main>{ui}</main>);
}

describe('sign-in page', () => {
  it('has no axe violations (email step, with notice and demo hint)', async () => {
    inMain(<SignInForm locale="en" notice="expired" showDemoHint actions={actions()} />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Sign in to Deemed Health' }),
    ).toBeTruthy();
    expect(screen.getByText(/15 minutes without activity/)).toBeTruthy();
    expect(await axeViolations()).toEqual([]);
  });

  it('shows an inline error on the email field and focuses it', async () => {
    const user = userEvent.setup();
    const start = vi.fn(async (): Promise<AuthFormState> => ({
      status: 'error',
      code: 'email_required',
      field: 'email',
    }));
    inMain(
      <SignInForm
        locale="en"
        notice={undefined}
        showDemoHint={false}
        actions={actions({ start })}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    const email = await screen.findByRole('textbox', { name: 'Work email' });
    await waitFor(() => expect(email.getAttribute('aria-invalid')).toBe('true'));
    expect(screen.getByText('Enter your work email.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(email));
    expect(await axeViolations()).toEqual([]);
  });

  it('moves to SSO or password after the email, and shows not-implemented errors', async () => {
    const user = userEvent.setup();
    const start = async (_p: AuthFormState, f: FormData): Promise<AuthFormState> => ({
      status: 'method',
      email: String(f.get('email')),
      sso: true,
    });
    const password = async (): Promise<AuthFormState> => ({ status: 'not_implemented' });
    inMain(
      <SignInForm
        locale="en"
        notice={undefined}
        showDemoHint={false}
        actions={actions({ start, password })}
      />,
    );
    await user.type(screen.getByRole('textbox', { name: 'Work email' }), 'demo@xyz-chc.test');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Signing in as demo@xyz-chc.test')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue with single sign-on (SSO)' })).toBeTruthy();
    await user.type(screen.getByLabelText('Password'), 'anything-long-enough');
    await user.click(screen.getByRole('button', { name: 'Sign in with password' }));
    expect(await screen.findByText(/No identity provider is connected/)).toBeTruthy();
    expect(await axeViolations()).toEqual([]);
  });

  it('shows the locked state as an alert', async () => {
    const user = userEvent.setup();
    const start = async (): Promise<AuthFormState> => ({
      status: 'method',
      email: 'x@y.test',
      sso: false,
    });
    const password = async (): Promise<AuthFormState> => ({ status: 'error', code: 'locked' });
    inMain(
      <SignInForm
        locale="es"
        notice={undefined}
        showDemoHint={false}
        actions={actions({ start, password })}
      />,
    );
    await user.type(screen.getByRole('textbox'), 'x@y.test');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.type(await screen.findByLabelText('Contraseña'), 'whatever-password');
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión con contraseña' }));
    expect((await screen.findByRole('alert')).textContent).toContain('bloqueada');
  });
});

describe('MFA and recovery pages', () => {
  it('MFA form has no axe violations', async () => {
    inMain(<MfaForm locale="en" expired={false} actions={{ code: idle, passkey: idle }} />);
    expect(screen.getByRole('button', { name: 'Use a passkey' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Code from your authenticator app' })).toBeTruthy();
    expect(await axeViolations()).toEqual([]);
  });

  it('MFA shows the expired state with a way to start again', async () => {
    inMain(<MfaForm locale="en" expired actions={{ code: idle, passkey: idle }} />);
    expect(screen.getByRole('link', { name: 'Start again' }).getAttribute('href')).toBe('/sign-in');
    expect(await axeViolations()).toEqual([]);
  });

  it('recovery form has no axe violations', async () => {
    inMain(<RecoveryForm locale="en" action={idle} />);
    expect(screen.getByRole('textbox', { name: 'Recovery code' })).toBeTruthy();
    expect(await axeViolations()).toEqual([]);
  });
});
