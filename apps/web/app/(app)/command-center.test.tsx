import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { RecordView } from '@deemed/domain';
import type { Locale } from '@deemed/i18n';
import { RecordsProvider, type RecordsClient, type RecordsResult } from '@deemed/ui';
import { axeViolations } from '../../test/axe';
import { CommandCenterBriefs } from './_command-center/briefs';
import { CommandCenterCalendar } from './_command-center/calendar';
import { CommandCenterOverview } from './_command-center/overview';
import { CommandCenterPriorities } from './_command-center/priorities';
import type { CommandCenterProps } from './_command-center/parts';

const SITE = 'd0000001-0002-4000-8000-000000000001';
const PERSON = 'd0000001-0003-4000-8000-000000000006';
const TODAY = '2026-09-29';

function row(
  n: number,
  requirementId: string,
  status: string,
  nextDueOn: string | null,
  siteId: string | null = null,
): RecordView {
  return {
    id: `d0000001-0006-4000-8000-${String(n).padStart(12, '0')}`,
    rowVersion: 1,
    archivedAt: null,
    fields: {
      requirementId,
      subjectType: siteId ? 'site' : 'organization',
      subjectId: siteId ?? 'd0000001-0001-4000-8000-000000000001',
      siteId,
      ownerPersonId: PERSON,
      status,
      notApplicableReason: null,
      nextDueOn,
      statusComputedAt: '2026-09-28T13:00:00.000Z',
    },
  };
}

const ROWS = [
  row(1, 'CM-05-CRED-LIP-LICENSURE', 'met', '2028-02-29', SITE),
  row(2, 'CM-05-PRIV-RENEWAL', 'due_soon', '2026-10-02', SITE),
  row(3, 'CM-20-BOARD-SIZE', 'missing', null),
  row(4, 'CM-19-POLICY-SFDP', 'overdue', '2026-09-01', SITE),
  row(5, 'CM-19-BUDGET-ANNUAL', 'due_soon', '2026-10-20'),
  row(6, 'FL-456-LICENSE-ACTIVE', 'not_applicable', null),
];

type Fail = { ok: false; status: number; code: 'forbidden' | 'internal' };

function client(
  rows: RecordView[] | Fail = ROWS,
): RecordsClient & { list: ReturnType<typeof vi.fn> } {
  const list = vi.fn(async (type: string): Promise<RecordsResult<never>> => {
    if (type !== 'requirement_instance') return { ok: false, status: 404, code: 'not_found' };
    if (!Array.isArray(rows)) return rows;
    return {
      ok: true,
      data: { recordType: type, items: rows, nextCursor: null, total: rows.length, limit: 200 },
    } as never;
  });
  const get = vi.fn(async (type: string, id: string) => {
    const fields =
      type === 'site'
        ? { name: 'XYZ-S1 Main' }
        : type === 'person'
          ? { givenName: 'Maria', familyName: 'Delgado' }
          : {};
    return {
      ok: true,
      data: {
        recordType: type,
        record: { id, rowVersion: 1, archivedAt: null, fields },
        allowedActions: [],
        revealable: [],
      },
    } as never;
  });
  const none = vi.fn(async () => ({ ok: false, status: 400, code: 'bad_request' }) as never);
  return {
    list,
    get,
    create: none,
    update: none,
    archive: none,
    restore: none,
    bulk: none,
    history: none,
    reveal: none,
    listViews: none,
    createView: none,
    updateView: none,
  } as never;
}

function A({ href, children, ...rest }: { href: string; children?: ReactNode }) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

function renderPage(
  Page: (p: CommandCenterProps) => ReactNode,
  {
    c = client(),
    locale = 'en',
    over = {},
  }: { c?: RecordsClient; locale?: Locale; over?: Partial<CommandCenterProps> } = {},
) {
  return render(
    <RecordsProvider
      client={c}
      locale={locale}
      timeZone="America/New_York"
      Link={A}
      navigate={() => {}}
    >
      <main>
        <Page
          locale={locale}
          eyebrow="Command Center · XYZ Community Health Center"
          title="Welcome, Maria"
          canReadReadiness
          requirementsHref="/readiness"
          today={TODAY}
          {...over}
        />
      </main>
    </RecordsProvider>,
  );
}

describe('Command Center overview', () => {
  it('shows the internal readiness score with its denominator, no axe violations', async () => {
    renderPage(CommandCenterOverview);
    expect(screen.getByRole('status').textContent).toBe('Loading readiness…');
    expect(await screen.findByText('20%')).toBeTruthy();
    expect(screen.getByText('1 of 5 applicable requirements met')).toBeTruthy();
    expect(screen.getByText('Not applicable (not counted): 1')).toBeTruthy();
    expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('20');
    expect(screen.getByText(/not an HRSA determination/)).toBeTruthy();
    // Priorities in working order: overdue, this week, missing, coming up.
    const top = within(screen.getByRole('region', { name: 'Today’s priorities' })).getAllByRole(
      'link',
      { name: /^Open requirement/ },
    );
    expect(top.map((a) => a.textContent)).toEqual([
      'CM-19-POLICY-SFDP',
      'CM-05-PRIV-RENEWAL',
      'CM-20-BOARD-SIZE',
      'CM-19-BUDGET-ANNUAL',
    ]);
    expect(top[0]!.getAttribute('href')).toBe('/readiness/d0000001-0006-4000-8000-000000000004');
    expect(screen.getByText('28 days overdue')).toBeTruthy();
    expect((await screen.findAllByText('XYZ-S1 Main')).length).toBeGreaterThan(0);
    expect(await axeViolations()).toEqual([]);
  });

  it('never states more than the viewer may read: one scoped list call through the client', async () => {
    const c = client();
    renderPage(CommandCenterOverview, { c });
    await screen.findByText('20%');
    const calls = (c.list as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe('requirement_instance');
    expect(calls[0]![1]).toMatchObject({ archived: 'exclude', limit: 200, cursor: null });
  });

  it('shows the empty state with a way to Requirements', async () => {
    renderPage(CommandCenterOverview, { c: client([]) });
    expect(
      await screen.findByRole('heading', { name: 'No requirements tracked yet' }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Requirements' }).getAttribute('href')).toBe(
      '/readiness',
    );
  });

  it('shows an error with a retry that loads again', async () => {
    const user = userEvent.setup();
    const c = client({ ok: false, status: 500, code: 'internal' });
    renderPage(CommandCenterOverview, { c });
    expect(await screen.findByText('We couldn’t load readiness')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(c.list).toHaveBeenCalledTimes(2);
  });

  it('explains no permission without calling the API', async () => {
    const c = client();
    renderPage(CommandCenterOverview, { c, over: { canReadReadiness: false } });
    expect(screen.getByRole('heading', { name: 'Readiness isn’t part of your role' })).toBeTruthy();
    expect(c.list).not.toHaveBeenCalled();
    expect(await axeViolations()).toEqual([]);
  });

  it('treats a forbidden answer from the API as no permission', async () => {
    renderPage(CommandCenterOverview, { c: client({ ok: false, status: 403, code: 'forbidden' }) });
    expect(
      await screen.findByRole('heading', { name: 'Readiness isn’t part of your role' }),
    ).toBeTruthy();
  });

  it('renders in Spanish', async () => {
    renderPage(CommandCenterOverview, { locale: 'es' });
    expect(await screen.findByText('1 de 5 requisitos aplicables cumplidos')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Prioridades de hoy' })).toBeTruthy();
    expect(screen.getByText('Vencido hace 28 días')).toBeTruthy();
  });
});

describe("Today's priorities", () => {
  it('groups everything not met, with counts', async () => {
    renderPage(CommandCenterPriorities);
    const overdue = await screen.findByRole('region', { name: 'Overdue' });
    expect(within(overdue).getByText('1 requirement')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Due this week' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Missing evidence' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Coming up' })).toBeTruthy();
    expect(screen.queryByText('CM-05-CRED-LIP-LICENSURE')).toBeNull();
    expect(screen.queryByText('FL-456-LICENSE-ACTIVE')).toBeNull();
    expect(await axeViolations()).toEqual([]);
  });

  it('says so when nothing needs attention', async () => {
    renderPage(CommandCenterPriorities, { c: client([ROWS[0]!]) });
    expect(await screen.findByRole('heading', { name: 'You’re all caught up' })).toBeTruthy();
  });
});

describe('Readiness briefs', () => {
  it('is a computed summary, labeled as not written by AI', async () => {
    renderPage(CommandCenterBriefs);
    expect(await screen.findByRole('heading', { name: 'Readiness brief' })).toBeTruthy();
    expect(screen.getByText(/not written by AI/)).toBeTruthy();
    expect(
      screen.getByText('Internal readiness is 20%: 1 of 5 applicable requirements are met.'),
    ).toBeTruthy();
    expect(
      screen.getByText('Overdue: 1. Missing evidence: 1. Due soon: 2. Not applicable: 1.'),
    ).toBeTruthy();
    const focus = screen.getByRole('region', { name: 'Where to focus' });
    expect(within(focus).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Print' })).toBeTruthy();
    expect(await axeViolations()).toEqual([]);
  });
});

describe('Calendar', () => {
  it('shows the month with due items and moves between months', async () => {
    const user = userEvent.setup();
    renderPage(CommandCenterCalendar);
    expect(await screen.findByRole('heading', { name: 'September 2026' })).toBeTruthy();
    const grid = screen.getByRole('table');
    expect(within(grid).getByText('CM-19-POLICY-SFDP, Overdue')).toBeTruthy();
    expect(grid.querySelector('[aria-current="date"] time')?.getAttribute('datetime')).toBe(TODAY);
    const list = screen.getByRole('region', { name: 'Due in September 2026' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(await axeViolations()).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByRole('heading', { name: 'October 2026' })).toBeTruthy();
    const october = screen.getByRole('region', { name: 'Due in October 2026' });
    expect(within(october).getAllByRole('listitem')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'This month' }));
    expect(screen.getByRole('heading', { name: 'September 2026' })).toBeTruthy();
  });
});
