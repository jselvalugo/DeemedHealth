import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { DETAIL_TABS, getRecordType, recordTypes } from '@deemed/domain';
import { messages, type Locale } from '@deemed/i18n';
import { axeViolations } from '../test-utils.js';
import { RecordsProvider, type RecordsClient } from './client.js';
import { enumLabelKeys, listActionsFor } from './format.js';
import { RecordForm } from './RecordForm.js';
import { RecordPage } from './RecordPage.js';
import { RecordTable } from './RecordTable.js';
import {
  PERSON_ID,
  SITE2_ID,
  SITE_ID,
  fakeClient,
  getOf,
  listOf,
  person,
  site,
} from './test-client.js';

const siteDef = getRecordType('site');
const personDef = getRecordType('person');
const ALL = { create: true, update: true, archive: true, bulk: true };
const NONE = { create: false, update: false, archive: false, bulk: false };

function A({ href, children, ...rest }: { href: string; children?: ReactNode }) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

function wrap(client: RecordsClient, ui: ReactNode, locale: Locale = 'en') {
  return render(
    <RecordsProvider
      client={client}
      locale={locale}
      timeZone="America/New_York"
      Link={A}
      navigate={() => {}}
    >
      <main>{ui}</main>
    </RecordsProvider>,
  );
}

describe('RecordTable', () => {
  it('shows a loading state, then a native table with caption, scoped headers, and aria-sort', async () => {
    let resolve: (v: unknown) => void = () => {};
    const client = fakeClient({
      list: () => new Promise((r) => (resolve = r as never)),
    });
    wrap(client, <RecordTable def={siteDef} actions={ALL} />);
    expect(screen.getByRole('status').textContent).toBe('Loading records…');
    expect(await axeViolations()).toEqual([]);

    resolve({ ok: true, data: listOf('site', [site(), site(SITE2_ID)], 2) });
    const table = await screen.findByRole('table');
    expect(table.querySelector('caption')?.textContent).toContain('Showing 1–2 of 2');
    const name = within(table).getByRole('columnheader', { name: /Site name/ });
    expect(name.getAttribute('scope')).toBe('col');
    expect(name.getAttribute('aria-sort')).toBe('ascending');
    expect(within(table).getAllByRole('rowheader')).toHaveLength(2);
    expect(within(table).getByRole('link', { name: 'XYZ-S1 Main' }).getAttribute('href')).toBe(
      `/admin/org/${SITE_ID}`,
    );
    // Results are announced politely.
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe('2 records found.');
    expect(await axeViolations()).toEqual([]);
  });

  it('sorts from the column header and sends the filters the bar builds', async () => {
    const user = userEvent.setup();
    const client = fakeClient({
      list: (t) => Promise.resolve({ ok: true, data: listOf(t, [site()]) }),
    });
    wrap(client, <RecordTable def={siteDef} actions={ALL} />);
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: /Site name/ }));
    await waitFor(() =>
      expect(client.list.mock.lastCall?.[1].sort).toEqual([{ field: 'name', dir: 'desc' }]),
    );
    await user.selectOptions(screen.getByLabelText('Time zone'), 'America/Chicago');
    const group = screen.getByRole('group', { name: 'In scope from' });
    await user.type(within(group).getByLabelText('From'), '2021-01-01');
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() =>
      expect(client.list.mock.lastCall?.[1].filters).toEqual([
        { field: 'timeZone', op: 'eq', value: 'America/Chicago' },
        { field: 'validFrom', op: 'gte', value: '2021-01-01' },
      ]),
    );
  });

  it('shows the empty, filtered-empty, error, and no-permission states', async () => {
    const empty = wrap(fakeClient(), <RecordTable def={siteDef} actions={ALL} />);
    expect(await screen.findByRole('heading', { name: 'No sites yet' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'New site' }).length).toBeGreaterThan(0);
    expect(await axeViolations()).toEqual([]);
    empty.unmount();

    const user = userEvent.setup();
    const retry = fakeClient({
      list: () => Promise.resolve({ ok: false, status: 500, code: 'internal' }),
    });
    const err = wrap(retry, <RecordTable def={siteDef} actions={ALL} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('We couldn’t load Sites')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(retry.list).toHaveBeenCalledTimes(2));
    expect(await axeViolations()).toEqual([]);
    err.unmount();

    wrap(
      fakeClient({ list: () => Promise.resolve({ ok: false, status: 403, code: 'forbidden' }) }),
      <RecordTable def={siteDef} actions={NONE} />,
    );
    expect(
      await screen.findByRole('heading', { name: 'You don’t have access to Sites' }),
    ).toBeTruthy();
    expect(await axeViolations()).toEqual([]);
  });

  it('selects rows with the keyboard and offers only the bulk actions allowed', async () => {
    const user = userEvent.setup();
    const client = fakeClient({
      list: (t) => Promise.resolve({ ok: true, data: listOf(t, [site(), site(SITE2_ID)]) }),
      bulk: () =>
        Promise.resolve({
          ok: true,
          data: {
            bulkId: SITE_ID,
            results: [
              { id: SITE_ID, status: 'updated' as const, rowVersion: 4 },
              { id: SITE2_ID, status: 'version_conflict' as const, rowVersion: 9 },
            ],
          },
        }),
    });
    wrap(client, <RecordTable def={siteDef} actions={ALL} />);
    await screen.findByRole('table');
    const all = screen.getByRole('checkbox', { name: 'Select all rows on this page' });
    all.focus();
    await user.keyboard(' ');
    const bar = screen.getByRole('region', { name: 'Actions for the selected records' });
    expect(within(bar).getByText('2 selected')).toBeTruthy();
    await user.click(within(bar).getByRole('button', { name: 'Change Site type' }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Site type'), 'mobile');
    await user.click(within(dialog).getByRole('button', { name: 'Apply to selected' }));
    expect(client.bulk.mock.lastCall?.[1]).toEqual({
      action: 'update',
      items: [
        { id: SITE_ID, rowVersion: 3 },
        { id: SITE2_ID, rowVersion: 3 },
      ],
      fields: { siteType: 'mobile' },
    });
    expect(await screen.findByText('1 changed. 1 not changed.')).toBeTruthy();
    expect(screen.getByText('Not changed: changed by someone else.')).toBeTruthy();
  });

  it('hides actions the policy denies (no New, no selection, no archived filter)', async () => {
    const client = fakeClient({
      list: (t) => Promise.resolve({ ok: true, data: listOf(t, [site()]) }),
    });
    wrap(client, <RecordTable def={siteDef} actions={NONE} />);
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: 'New site' })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByLabelText('Show')).toBeNull();
  });

  it('offers bulk actions only for types that serve bulk (finding L7)', async () => {
    const noBulk = { ...siteDef, actions: siteDef.actions.filter((a) => a !== 'bulk') };
    const perms = new Set(['admin:read', 'admin:write'] as const);
    expect(listActionsFor(noBulk, perms)).toEqual({
      create: true,
      update: true,
      archive: true,
      bulk: false,
    });
    wrap(
      fakeClient({ list: (t) => Promise.resolve({ ok: true, data: listOf(t, [site()]) }) }),
      <RecordTable def={noBulk} actions={listActionsFor(noBulk, perms)} />,
    );
    await screen.findByRole('table');
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('labels a date range once, with From and To inside the group', async () => {
    wrap(fakeClient(), <RecordTable def={siteDef} actions={ALL} />);
    const group = screen.getByRole('group', { name: 'In scope from' });
    expect(within(group).getByLabelText('From')).toBeTruthy();
    expect(within(group).getByLabelText('To')).toBeTruthy();
    expect(screen.queryByText(/from from|until to/)).toBeNull();
  });

  it('derives list actions from the session permissions', () => {
    expect(listActionsFor(siteDef, new Set(['admin:read']))).toEqual(NONE);
    expect(listActionsFor(siteDef, new Set(['admin:read', 'admin:write']))).toEqual(ALL);
    // Managed elsewhere: no generic create or update even with admin:write.
    expect(listActionsFor(getRecordType('user_account'), new Set(['admin:write']))).toEqual(NONE);
  });

  it('works in Spanish', async () => {
    wrap(
      fakeClient({ list: (t) => Promise.resolve({ ok: true, data: listOf(t, [site()]) }) }),
      <RecordTable def={siteDef} actions={ALL} />,
      'es',
    );
    await screen.findByRole('table');
    expect(screen.getByRole('button', { name: 'Aplicar filtros' })).toBeTruthy();
    expect(
      within(screen.getByRole('table')).getByText('Sitio de prestación de servicios'),
    ).toBeTruthy();
  });
});

describe('RecordPage', () => {
  it('shows the header, sections, coming-soon tabs, and history', async () => {
    const user = userEvent.setup();
    const client = fakeClient({
      get: (t) => Promise.resolve({ ok: true, data: getOf(t, site()) }),
      history: (t, id) =>
        Promise.resolve({
          ok: true,
          data: {
            recordType: t,
            id,
            nextCursor: null,
            items: [
              {
                id: SITE2_ID,
                occurredAt: '2026-09-27T15:00:00.000Z',
                category: 'mutation',
                action: 'site.update',
                outcome: 'success',
                actorType: 'user',
                actorLabel: 'María Delgado',
                diff: { fields: { city: {}, postal_code: {} } },
                metadata: {},
                reason: null,
              },
            ],
          },
        }),
    });
    wrap(
      client,
      <RecordPage def={siteDef} id={SITE_ID} moduleName="Administration" listHref="/admin/org" />,
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'XYZ-S1 Main' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Address' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeTruthy();
    expect(await axeViolations()).toEqual([]);

    await user.click(screen.getByRole('tab', { name: /Evidence/ }));
    expect(screen.getByRole('tabpanel').textContent).toContain('arrive in a later release');
    // Arrow keys move between tabs.
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'History' }).getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByText('Changed: City, ZIP code')).toBeTruthy();
    expect(screen.getByText(/by María Delgado/)).toBeTruthy();
    expect(screen.getByText(/Sep 27, 2026, 11:00 AM EDT/)).toBeTruthy();
    expect(await axeViolations()).toEqual([]);
  });

  it('hides the actions the API does not allow', async () => {
    wrap(
      fakeClient({
        get: (t) => Promise.resolve({ ok: true, data: getOf(t, site(), ['history']) }),
      }),
      <RecordPage def={siteDef} id={SITE_ID} moduleName="Administration" listHref="/admin/org" />,
    );
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Record actions' })).toBeNull();
  });

  it('archives with a required reason, then shows the archived banner and Restore', async () => {
    const user = userEvent.setup();
    const archived = site(SITE_ID, {}, '2026-09-28T13:00:00.000Z');
    let isArchived = false;
    const client = fakeClient({
      get: (t) =>
        Promise.resolve({
          ok: true,
          data: isArchived ? getOf(t, archived, ['restore', 'history']) : getOf(t, site()),
        }),
      archive: (t) => {
        isArchived = true;
        return Promise.resolve({ ok: true, data: { recordType: t, record: archived } });
      },
    });
    wrap(
      client,
      <RecordPage def={siteDef} id={SITE_ID} moduleName="Administration" listHref="/admin/org" />,
    );
    await user.click(await screen.findByRole('button', { name: 'Archive' }));
    const dialog = await screen.findByRole('dialog', { name: 'Archive XYZ-S1 Main?' });
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }));
    expect(within(dialog).getByText('Enter a reason for archiving.')).toBeTruthy();
    expect(client.archive).not.toHaveBeenCalled();
    expect(await axeViolations()).toEqual([]);
    await user.type(within(dialog).getByLabelText(/Reason for archiving/), 'Site closed');
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }));
    expect(client.archive.mock.lastCall).toEqual(['site', SITE_ID, 3, 'Site closed']);
    expect(await screen.findByText('This record is archived')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Restore' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('explains archive blockers in plain language', async () => {
    const user = userEvent.setup();
    const client = fakeClient({
      get: (t) => Promise.resolve({ ok: true, data: getOf(t, site()) }),
      archive: () =>
        Promise.resolve({
          ok: false,
          status: 409,
          code: 'conflict',
          fields: ['blockedBy.active_role_assignment'],
        }),
    });
    wrap(
      client,
      <RecordPage def={siteDef} id={SITE_ID} moduleName="Administration" listHref="/admin/org" />,
    );
    await user.click(await screen.findByRole('button', { name: 'Archive' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Reason for archiving/), 'Closing');
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }));
    expect(
      await within(dialog).findByText(
        /while other active records depend on it: active role assignments/,
      ),
    ).toBeTruthy();
  });

  it('shows not found for a record outside the viewer’s scope', async () => {
    wrap(
      fakeClient({ get: () => Promise.resolve({ ok: false, status: 404, code: 'not_found' }) }),
      <RecordPage def={siteDef} id={SITE_ID} moduleName="Administration" listHref="/admin/org" />,
    );
    expect(
      await screen.findByRole('heading', { name: 'We couldn’t find this record' }),
    ).toBeTruthy();
    expect(await axeViolations()).toEqual([]);
  });
});

describe('masked fields and reveal', () => {
  it('shows ••• with a Reveal button that needs a reason and step-up, and says it is audited', async () => {
    const user = userEvent.setup();
    let steppedUp = false;
    const client = fakeClient({
      get: (t) => Promise.resolve({ ok: true, data: getOf(t, person(), ['history'], ['dob']) }),
      // The first call answers as the API does without a recent step-up; the client
      // (ApiProvider in apps/web) would show the dialog and retry. Here the person cancels.
      reveal: (_t, _i, field) =>
        steppedUp
          ? Promise.resolve({ ok: true, data: { field, value: '1985-03-14' } })
          : Promise.resolve({ ok: false, status: 401, code: 'reauth_required' }),
    });
    wrap(
      client,
      <RecordPage
        def={personDef}
        id={PERSON_ID}
        moduleName="Administration"
        listHref="/admin/people"
      />,
    );
    await screen.findByRole('heading', { level: 1, name: 'Priya Raman' });
    expect(screen.getAllByText('•••').length).toBe(2);
    // Revealable and holding a value: a button. Not revealable: no button.
    expect(screen.queryByRole('button', { name: 'Reveal Home address' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Reveal Date of birth' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reveal Date of birth' });
    expect(within(dialog).getByText(/recorded in the audit log/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Confirm and reveal' }));
    expect(within(dialog).getByText('Choose Why do you need to see it?.')).toBeTruthy();
    await user.selectOptions(within(dialog).getByLabelText(/Why do you need/), 'other');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm and reveal' }));
    expect(within(dialog).getByText('Explain why you need to see this value.')).toBeTruthy();
    await user.selectOptions(
      within(dialog).getByLabelText(/Why do you need/),
      'credentialing_verification',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Confirm and reveal' }));
    expect(await within(dialog).findByText('Confirm it’s you to reveal this value.')).toBeTruthy();
    expect(client.reveal.mock.lastCall?.[3]).toEqual({ reasonCode: 'credentialing_verification' });
    expect(await axeViolations()).toEqual([]);

    steppedUp = true;
    await user.click(within(dialog).getByRole('button', { name: 'Confirm and reveal' }));
    expect(await screen.findByText('1985-03-14')).toBeTruthy();
    expect(screen.getByText(/This reveal was recorded in the audit log/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Hide Date of birth' }));
    expect(screen.queryByText('1985-03-14')).toBeNull();
  });
});

describe('RecordForm', () => {
  it('validates in English and Spanish before sending', async () => {
    const user = userEvent.setup();
    const client = fakeClient();
    const view = wrap(
      client,
      <RecordForm def={siteDef} mode="create" onSaved={() => {}} onCancel={() => {}} />,
    );
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(screen.getByText(/^There are \d+ problems to fix$/)).toBeTruthy();
    expect(screen.getAllByText('Enter Site name.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Choose Site type.').length).toBeGreaterThan(0);
    expect(client.create).not.toHaveBeenCalled();
    expect(await axeViolations()).toEqual([]);
    view.unmount();

    wrap(
      client,
      <RecordForm def={siteDef} mode="create" onSaved={() => {}} onCancel={() => {}} />,
      'es',
    );
    await user.type(screen.getByLabelText(/Código postal/), '90210');
    await user.click(screen.getByRole('button', { name: 'Crear' }));
    expect(screen.getAllByText(/Escriba un código postal de Florida/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Escriba Nombre del sitio.').length).toBeGreaterThan(0);
  });

  it('handles a 409 version conflict: says who changed what and reloads, keeping my edits', async () => {
    const user = userEvent.setup();
    const theirs = site(SITE_ID, { city: 'Winter Park', addressLine1: '101 Example Health Way' });
    theirs.rowVersion = 4;
    const client = fakeClient({
      update: (t, _id, version) =>
        version === 3
          ? Promise.resolve({
              ok: false,
              status: 409,
              code: 'version_conflict',
              fields: ['addressLine1', 'city'],
              currentVersion: 4,
            })
          : Promise.resolve({ ok: true, data: { recordType: t, record: theirs } }),
      get: (t) => Promise.resolve({ ok: true, data: getOf(t, theirs) }),
    });
    const saved: unknown[] = [];
    wrap(
      client,
      <RecordForm
        def={siteDef}
        mode="edit"
        record={site()}
        onSaved={(r) => saved.push(r)}
        onCancel={() => {}}
      />,
    );
    const zip = screen.getByLabelText(/ZIP code/);
    await user.clear(zip);
    await user.type(zip, '32789');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(client.update.mock.lastCall).toEqual(['site', SITE_ID, 3, { postalCode: '32789' }]);
    expect(await screen.findByText('Someone else changed this record')).toBeTruthy();
    expect(screen.getByText('They changed: Address, City.')).toBeTruthy();
    expect(await axeViolations()).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Load their version and keep my edits' }));
    expect(await screen.findByText(/Their version is loaded/)).toBeTruthy();
    expect((screen.getByLabelText(/^City/) as HTMLInputElement).value).toBe('Winter Park');
    expect((screen.getByLabelText(/ZIP code/) as HTMLInputElement).value).toBe('32789');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(client.update.mock.lastCall).toEqual(['site', SITE_ID, 4, { postalCode: '32789' }]);
    await waitFor(() => expect(saved).toHaveLength(1));
  });

  it('maps server validation fields to messages', async () => {
    const user = userEvent.setup();
    const client = fakeClient({
      update: () =>
        Promise.resolve({ ok: false, status: 400, code: 'bad_request', fields: ['city'] }),
    });
    wrap(
      client,
      <RecordForm
        def={siteDef}
        mode="edit"
        record={site()}
        onSaved={() => {}}
        onCancel={() => {}}
      />,
    );
    await user.type(screen.getByLabelText(/^City/), 'x');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('There is 1 problem to fix')).toBeTruthy();
    expect(screen.getAllByText('Check City.').length).toBeGreaterThan(0);
  });
});

describe('records EN/ES keys', () => {
  it('has every enum value, section, tab, and list name in English and Spanish', () => {
    const keys: string[] = [];
    for (const def of recordTypes()) {
      keys.push(...enumLabelKeys(def), `recordType.${def.id}.plural`);
      if (def.actions.includes('create')) keys.push(`recordType.${def.id}.new`);
      for (const s of def.detail.sections) keys.push(`records.section.${s.id}`);
    }
    for (const tab of DETAIL_TABS) keys.push(`records.tabs.${tab}`);
    const en = messages.en as Record<string, string>;
    const es = messages.es as Record<string, string>;
    expect(keys.filter((k) => !en[k]?.trim())).toEqual([]);
    expect(keys.filter((k) => !es[k]?.trim())).toEqual([]);
  });
});
