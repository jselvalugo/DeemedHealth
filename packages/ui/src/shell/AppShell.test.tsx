import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { permissionsFor, type RoleId } from '@deemed/domain';
import { launcherModules, MODULES } from '../module-registry.js';
import { axeViolations } from '../test-utils.js';
import { AppShell } from './AppShell.js';
import type { LinkLikeProps } from './types.js';

function A({ href, children, ...rest }: LinkLikeProps) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

function renderShell({
  role = 'compliance_officer',
  pathname = '/',
  locale = 'en',
}: { role?: RoleId; pathname?: string; locale?: 'en' | 'es' } = {}) {
  const onNavigate = vi.fn();
  const modules = launcherModules(permissionsFor([role]));
  const utils = render(
    <AppShell
      locale={locale}
      modules={modules}
      pathname={pathname}
      user={{ name: 'Dana Rivera', email: 'demo@xyz-chc.test', roleLabel: 'Compliance officer' }}
      tenant={{ name: 'XYZ Community Health Center' }}
      logoSrc="/logo.png"
      homeHref="/"
      LinkComponent={A}
      onNavigate={onNavigate}
      onLocaleChange={vi.fn()}
      onSignOut={vi.fn()}
    >
      <h1>Page content</h1>
    </AppShell>,
  );
  return { ...utils, onNavigate, modules };
}

const searchButton = () => screen.getByRole('button', { name: /Go to a module or page/ });
const combobox = () => screen.getByRole('combobox', { name: 'Go to a module or page' });
const activeOption = () => {
  const id = combobox().getAttribute('aria-activedescendant');
  return id ? document.getElementById(id) : null;
};

describe('AppShell', () => {
  it('renders the header, the tenant, and the current module’s tabs from the registry', () => {
    renderShell({ pathname: '/providers/credentialing' });
    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.getAllByText('XYZ Community Health Center').length).toBeGreaterThan(0);
    const nav = screen.getByRole('navigation', { name: 'Modules' });
    const tabs = within(nav).getAllByRole('link');
    expect(tabs.map((a) => a.textContent)).toEqual([
      'Providers',
      'Credentialing',
      'Privileging',
      'Expirations',
      'Committee review',
    ]);
    expect(
      within(nav).getByRole('link', { name: 'Credentialing' }).getAttribute('aria-current'),
    ).toBe('page');
  });

  it('has no axe violations', async () => {
    renderShell();
    expect(await axeViolations()).toEqual([]);
  });
});

describe('ModuleLauncher', () => {
  it('opens from the search button, lists every permitted module, and has no axe violations', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(searchButton());
    const dialog = screen.getByRole('dialog', { name: 'Go to a module or page' });
    expect(document.activeElement).toBe(combobox());
    const groups = within(dialog).getAllByRole('group');
    expect(groups).toHaveLength(MODULES.filter((m) => m.status !== 'planned').length);
    const pages = MODULES.flatMap((m) => m.pages).length;
    expect(within(dialog).getByText(`16 modules · ${pages} pages`)).toBeTruthy();
    expect(await axeViolations()).toEqual([]);
  });

  it('hides modules the user lacks permission for', async () => {
    const user = userEvent.setup();
    renderShell({ role: 'credentialing_coordinator', pathname: '/providers' });
    await user.click(searchButton());
    const dialog = screen.getByRole('dialog');
    const names = within(dialog)
      .getAllByRole('group')
      .map((g) => g.getAttribute('aria-label'));
    expect(names).toEqual([
      'Providers & Credentialing',
      'Enrollment',
      'Screening',
      'Learning',
      'Tasks & Workflows',
    ]);
    expect(within(dialog).queryByText('Governance')).toBeNull();
    expect(within(dialog).queryByText('Audit log')).toBeNull();
    // The current module is marked.
    expect(within(groups(dialog)[0]!).getByText('Current')).toBeTruthy();
  });

  it('moves with arrows and Tab, opens with Enter, and moves focus to the page', async () => {
    const user = userEvent.setup();
    const { onNavigate } = renderShell();
    await user.click(searchButton());
    expect(activeOption()?.getAttribute('data-route')).toBe('/');
    expect(activeOption()?.getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{ArrowDown}');
    expect(activeOption()?.textContent).toBe('Overview');
    await user.keyboard('{Tab}');
    expect(activeOption()?.textContent).toBe('Today’s priorities');
    await user.keyboard('{Shift>}{Tab}{/Shift}{ArrowUp}');
    expect(activeOption()?.getAttribute('data-kind')).toBe('module');
    await user.keyboard('{ArrowUp}'); // wraps to the last page
    expect(activeOption()?.textContent).toBe('Audit log');
    await user.keyboard('{Enter}');
    expect(onNavigate).toHaveBeenCalledWith('/admin/audit');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement?.id).toBe('main');
  });

  it('filters modules and pages with fuzzy search', async () => {
    const user = userEvent.setup();
    const { onNavigate } = renderShell();
    await user.click(searchButton());
    await user.keyboard('expir');
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog)
        .getAllByRole('group')
        .map((g) => g.getAttribute('aria-label')),
    ).toEqual(['Providers & Credentialing']);
    expect(within(dialog).getByText('1 module · 1 page')).toBeTruthy();
    expect(dialog.querySelector('mark')?.textContent).toBe('Expir');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onNavigate).toHaveBeenCalledWith('/providers/expirations');

    await user.click(searchButton());
    await user.keyboard('qqqq');
    expect(screen.getByText('No modules or pages match “qqqq”.')).toBeTruthy();
    expect(combobox().getAttribute('aria-activedescendant')).toBeNull();
  });

  it('closes with Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(searchButton());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(searchButton());
  });

  it('opens with Ctrl+K and from the module switcher with the current module selected', async () => {
    const user = userEvent.setup();
    renderShell({ pathname: '/screening/matches' });
    act(() => {
      fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    });
    expect(screen.getByRole('dialog')).toBeTruthy();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Switch module. Current: Screening' }));
    expect(activeOption()?.getAttribute('data-kind')).toBe('module');
    expect(activeOption()?.textContent).toContain('Screening');
  });

  it('works in Spanish', async () => {
    const user = userEvent.setup();
    renderShell({ locale: 'es' });
    await user.click(screen.getByRole('button', { name: /Ir a un módulo o página/ }));
    await user.keyboard('gober');
    const dialog = screen.getByRole('dialog', { name: 'Ir a un módulo o página' });
    expect(within(dialog).getAllByRole('group')[0]!.getAttribute('aria-label')).toBe('Gobernanza');
  });
});

function groups(dialog: HTMLElement) {
  return within(dialog).getAllByRole('group');
}
