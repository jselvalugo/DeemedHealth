import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { permissionsFor } from '@deemed/domain';
import { findRoute } from '@deemed/ui';
import { axeViolations } from '../../test/axe';
import { ModulePlaceholder, NoPermissionView } from './views';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe('module placeholder', () => {
  it('shows the How it works card and an empty state, with no axe violations', async () => {
    const { module, page } = findRoute('/providers/expirations')!;
    render(
      <main>
        <ModulePlaceholder
          locale="en"
          module={module}
          page={page}
          tenantName="XYZ Community Health Center"
          userFirstName="Dana"
          perms={permissionsFor(['compliance_officer'])}
        />
      </main>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Expirations' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'How Deemed Health works' })).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByText('Planned')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Nothing here yet' })).toBeTruthy();
    expect(await axeViolations()).toEqual([]);
  });

  it('greets the user on the Command Center overview and hides step links they cannot open', () => {
    const { module, page } = findRoute('/')!;
    render(
      <ModulePlaceholder
        locale="es"
        module={module}
        page={page}
        tenantName="XYZ Community Health Center"
        userFirstName="Luis"
        perms={permissionsFor(['credentialing_coordinator'])}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Hola, Luis' })).toBeTruthy();
    // Coordinators have My tasks, but not Organization & sites or Requirements.
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/tasks']);
  });
});

describe('no permission view', () => {
  it('explains the missing access and links home, with no axe violations', async () => {
    render(
      <main>
        <NoPermissionView locale="en" pageName="Audit log" homeHref="/providers" />
      </main>,
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'You don’t have access to this page' }),
    ).toBeTruthy();
    expect(screen.getByText(/Your role doesn’t include Audit log/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to your home page' }).getAttribute('href')).toBe(
      '/providers',
    );
    expect(await axeViolations()).toEqual([]);
  });
});
