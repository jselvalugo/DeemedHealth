import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { getRecordType } from '@deemed/domain';
import { RecordPage, RecordsProvider } from '@deemed/ui';
import { axeViolations } from '../../test/axe';
import { httpRecordsClient } from '../../lib/records-http';
import { ApiProvider, useApi } from './reauth';

vi.mock('@simplewebauthn/browser', () => ({ startAuthentication: vi.fn() }));

const PERSON = 'd0000001-0003-4000-8000-000000000006';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const record = {
  recordType: 'person',
  record: {
    id: PERSON,
    rowVersion: 1,
    archivedAt: null,
    fields: {
      givenName: 'Priya',
      familyName: 'Raman',
      preferredName: null,
      workEmail: 'priya.raman@xyz-chc.example',
      npi: '1000001010',
      dob: { masked: true, hasValue: true },
      homeAddress: { masked: true, hasValue: false },
    },
  },
  allowedActions: ['update', 'archive', 'history'],
  revealable: ['dob'],
};

function A({ href, children }: { href: string; children?: ReactNode }) {
  return <a href={href}>{children}</a>;
}

function Page() {
  const api = useApi();
  return (
    <RecordsProvider
      client={httpRecordsClient(api)}
      locale="en"
      timeZone="America/New_York"
      Link={A}
      navigate={() => {}}
    >
      <main>
        <RecordPage
          def={getRecordType('person')}
          id={PERSON}
          moduleName="Administration"
          listHref="/admin/people"
        />
      </main>
    </RecordsProvider>
  );
}

describe('reveal over HTTP (ADR-0007, ADR-0006 rule 5)', () => {
  it('needs step-up: 401 reauth_required opens “Confirm it’s you”, then the reveal is retried', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(200, record))
      .mockResolvedValueOnce(
        json(401, {
          error: {
            code: 'reauth_required',
            messageKey: 'apiError.reauth_required',
            correlationId: 'c',
          },
        }),
      )
      .mockResolvedValueOnce(json(200, { reauthenticatedAt: 'now', validForSeconds: 300 }))
      .mockResolvedValueOnce(json(200, { field: 'dob', value: '1985-03-14' }));
    render(
      <ApiProvider locale="en" csrfToken="csrf-1" fetchImpl={fetchImpl}>
        <Page />
      </ApiProvider>,
    );
    await user.click(await screen.findByRole('button', { name: 'Reveal Date of birth' }));
    const reveal = await screen.findByRole('dialog', { name: 'Reveal Date of birth' });
    await user.selectOptions(within(reveal).getByLabelText(/Why do you need/), 'records_request');
    await user.click(within(reveal).getByRole('button', { name: 'Confirm and reveal' }));

    // The step-up dialog stacks above the reveal dialog and takes focus.
    const stepUp = await screen.findByRole('dialog', { name: 'Confirm it’s you' });
    expect(document.activeElement).toBe(
      within(stepUp).getByLabelText('Code from your authenticator app'),
    );
    expect(await axeViolations()).toEqual([]);
    await user.keyboard('000000');
    await user.click(within(stepUp).getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('1985-03-14')).toBeTruthy();
    expect(screen.getByText(/This reveal was recorded in the audit log/)).toBeTruthy();
    const calls = fetchImpl.mock.calls.map(([url, init]) => [url, init?.method]);
    expect(calls).toEqual([
      [`/api/records/person/${PERSON}`, 'GET'],
      [`/api/records/person/${PERSON}/reveal/dob`, 'POST'],
      ['/api/auth/reauth/totp', 'POST'],
      [`/api/records/person/${PERSON}/reveal/dob`, 'POST'],
    ]);
    expect(JSON.parse(String(fetchImpl.mock.calls[3]?.[1]?.body))).toEqual({
      reasonCode: 'records_request',
    });
  });

  it('sends If-Match and the CSRF token on changes', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json(200, record));
    const got: ReturnType<typeof httpRecordsClient>[] = [];
    function Grab({ onClient }: { onClient: (c: ReturnType<typeof httpRecordsClient>) => void }) {
      const api = useApi();
      useEffect(() => {
        onClient(httpRecordsClient(api));
      }, [api, onClient]);
      return null;
    }
    render(
      <ApiProvider locale="en" csrfToken="csrf-1" fetchImpl={fetchImpl}>
        <Grab onClient={(c) => got.push(c)} />
      </ApiProvider>,
    );
    await got[0]!.update('person', PERSON, 7, { preferredName: 'Pri' });
    const init = fetchImpl.mock.calls[0]![1]!;
    expect(fetchImpl.mock.calls[0]![0]).toBe(`/api/records/person/${PERSON}`);
    expect(init.method).toBe('PATCH');
    expect((init.headers as Record<string, string>)['if-match']).toBe('"7"');
    expect((init.headers as Record<string, string>)['x-csrf-token']).toBe('csrf-1');
  });
});
