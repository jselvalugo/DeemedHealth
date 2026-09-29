'use client';

/**
 * `RecordPage` (ADR-0014 section 3): header with the title, lifecycle status, owner,
 * site, and requirement chips; the actions the API allows for this viewer; the declared
 * detail sections; and tabs. History is a timeline from the history endpoint; Evidence,
 * Tasks, Comments, and Approvals are "coming soon" until S5 and S6. Archived records
 * show a banner and are read-only apart from Restore. Masked fields show ••• with a
 * Reveal button (reason, step-up, audited).
 */
import {
  REVEAL_REASON_CODES,
  type DetailTab,
  type FieldValue,
  type HistoryEvent,
  type RecordGetResponse,
  type RecordTypeDef,
  type RecordView,
  updateFields,
} from '@deemed/domain';
import { t, type Locale } from '@deemed/i18n';
import { ArrowLeft, Archive, ArchiveRestore, Eye, EyeOff, Pencil } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Alert } from '../components/Alert.js';
import { Badge } from '../components/Badge.js';
import { Button } from '../components/Button.js';
import { Card } from '../components/Card.js';
import { CitationChip, Modal, Select, Tabs, Textarea } from '../components/controls.js';
import { Eyebrow } from '../components/misc.js';
import { EmptyState, textLinkClasses } from '../components/scaffolds.js';
import { useRecords, type RecordsError } from './client.js';
import {
  emptyText,
  fieldLabel,
  formatInstant,
  formatValue,
  recordTitle,
  refTarget,
  statusField,
  statusTone,
  typeName,
  typePlural,
} from './format.js';
import { RecordForm } from './RecordForm.js';
import { RefValue } from './refs.js';

export type RecordPageProps = {
  def: RecordTypeDef;
  id: string;
  /** Module name for the eyebrow, already translated. */
  moduleName: string;
  listHref: string;
};

type Load =
  | { state: 'loading' }
  | { state: 'ok'; data: RecordGetResponse }
  | { state: 'error'; error: RecordsError };

export function RecordPage({ def, id, moduleName, listHref }: RecordPageProps) {
  const { client, locale, Link, timeZone } = useRecords();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [tab, setTab] = useState('details');
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<null | 'archive' | 'restore'>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Bumped to fetch again (after a change, or Try again).
  const [fetches, setFetches] = useState(0);
  const fetchRecord = () => setFetches((n) => n + 1);

  // The page is keyed by record id (a new id mounts a new page), so no reset is needed.
  useEffect(() => {
    let live = true;
    void client.get(def.id, id).then((res) => {
      if (live) setLoad(res.ok ? { state: 'ok', data: res.data } : { state: 'error', error: res });
    });
    return () => {
      live = false;
    };
  }, [client, def.id, id, fetches]);

  const plural = typePlural(locale, def);
  const back = (
    <Link href={listHref} className={textLinkClasses}>
      <ArrowLeft aria-hidden="true" size={16} strokeWidth={1.75} />
      {t(locale, 'records.page.back', { records: plural })}
    </Link>
  );

  if (load.state === 'loading') {
    return (
      <div aria-busy="true" className="flex flex-col gap-6">
        <p role="status" className="sr-only">
          {t(locale, 'loading.label')}
        </p>
        <div aria-hidden="true" className="flex flex-col gap-3 motion-safe:animate-pulse">
          <div className="h-3 w-48 rounded-control bg-gray-100" />
          <div className="h-9 w-80 max-w-full rounded-control bg-gray-100" />
          <div className="h-40 w-full rounded-card bg-gray-100" />
        </div>
      </div>
    );
  }

  if (load.state === 'error') {
    const code = load.error.code;
    if (code === 'not_found' || code === 'forbidden') {
      return (
        <div className="flex flex-col gap-4">
          <div>{back}</div>
          <EmptyState
            icon={code === 'forbidden' ? 'lock' : 'inbox'}
            headingLevel={1}
            title={t(
              locale,
              code === 'forbidden' ? 'records.noPermission.title' : 'records.page.notFoundTitle',
              { records: plural },
            )}
            body={t(
              locale,
              code === 'forbidden' ? 'records.noPermission.body' : 'records.page.notFoundBody',
            )}
          />
        </div>
      );
    }
    return (
      <ErrorBlock
        title={t(locale, 'records.error.title', { records: typeName(locale, def) })}
        onRetry={() => {
          setLoad({ state: 'loading' });
          void fetchRecord();
        }}
      />
    );
  }

  const { record, allowedActions, revealable } = load.data;
  const title = recordTitle(locale, def, record.fields);
  const archived = record.archivedAt !== null;
  const canEdit = allowedActions.includes('update') && updateFields(def).length > 0 && !archived;
  const status = statusField(def);
  const statusValue = status ? record.fields[status] : undefined;
  const ownerId = def.owner ? record.fields[def.owner.field] : undefined;
  const siteId = def.fields.siteId && !titleIsSite(def) ? record.fields.siteId : undefined;
  const requirementIds = [
    ...def.requirementIds,
    ...(def.rowRequirementIdField && typeof record.fields[def.rowRequirementIdField] === 'string'
      ? [record.fields[def.rowRequirementIdField] as string]
      : []),
  ].filter((v, i, a) => a.indexOf(v) === i);

  const tabs = [
    { id: 'details', label: t(locale, 'records.tabs.details') },
    ...def.detail.tabs
      .filter((x) => x !== 'history')
      .map((x) => ({
        id: x,
        label: t(locale, `records.tabs.${x}`),
        badge: (
          <span className="rounded-full bg-gray-50 px-2 py-0.5 text-xs font-semibold text-gray-700">
            {t(locale, 'records.tabs.comingSoon')}
          </span>
        ),
      })),
    ...(def.detail.tabs.includes('history')
      ? [{ id: 'history', label: t(locale, 'records.tabs.history') }]
      : []),
  ];

  const onChanged = (next: RecordView, message: string) => {
    setLoad({ state: 'ok', data: { ...load.data, record: next } });
    setNotice(message);
    // Allowed actions depend on the new state (archived or not): ask the API again.
    void fetchRecord();
    headingRef.current?.focus();
  };

  return (
    <div className="flex flex-col gap-6">
      <div>{back}</div>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <Eyebrow>{`${moduleName} · ${typeName(locale, def)}`}</Eyebrow>
          <h1
            ref={headingRef}
            id="page-title"
            tabIndex={-1}
            className="mt-1 text-3xl font-semibold break-words text-navy-900 outline-none"
          >
            {title}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-700">
            {typeof statusValue === 'string' && (
              <Badge status={statusTone(statusValue)}>
                {formatValue(locale, def, status as string, statusValue, timeZone)}
              </Badge>
            )}
            {archived && <Badge status="neutral">{t(locale, 'records.value.archived')}</Badge>}
            {def.owner && (
              <span className="inline-flex items-center gap-1">
                <span className="font-semibold">{t(locale, 'records.page.owner')}:</span>
                {typeof ownerId === 'string' ? (
                  <RefValue type="person" id={ownerId} />
                ) : (
                  emptyText(locale, def, def.owner.field)
                )}
              </span>
            )}
            {siteId !== undefined && (
              <span className="inline-flex items-center gap-1">
                <span className="font-semibold">{t(locale, 'records.page.site')}:</span>
                {typeof siteId === 'string' ? (
                  <RefValue type="site" id={siteId} />
                ) : (
                  emptyText(locale, def, 'siteId')
                )}
              </span>
            )}
            {requirementIds.length > 0 && (
              <span className="inline-flex flex-wrap items-center gap-1">
                <span className="font-semibold">{t(locale, 'records.page.requirements')}:</span>
                {requirementIds.map((r) => (
                  <CitationChip key={r} id={r} label={t(locale, 'records.citation', { id: r })} />
                ))}
              </span>
            )}
          </div>
        </div>
        {allowedActions.some((a) => a !== 'history') && (
          <div
            role="group"
            aria-label={t(locale, 'records.page.actions')}
            className="flex shrink-0 flex-wrap gap-3"
          >
            {canEdit && !editing && (
              <Button
                variant="secondary"
                icon={<Pencil aria-hidden="true" size={16} strokeWidth={1.75} />}
                onClick={() => {
                  setTab('details');
                  setNotice(null);
                  setEditing(true);
                }}
              >
                {t(locale, 'records.page.edit')}
              </Button>
            )}
            {allowedActions.includes('archive') && !archived && (
              <Button
                variant="secondary"
                icon={<Archive aria-hidden="true" size={16} strokeWidth={1.75} />}
                onClick={() => setDialog('archive')}
              >
                {t(locale, 'records.page.archive')}
              </Button>
            )}
            {allowedActions.includes('restore') && archived && (
              <Button
                icon={<ArchiveRestore aria-hidden="true" size={16} strokeWidth={1.75} />}
                onClick={() => setDialog('restore')}
              >
                {t(locale, 'records.page.restore')}
              </Button>
            )}
          </div>
        )}
      </div>

      {notice && <Alert tone="ok" title={notice} />}
      {archived && (
        <Alert tone="warn" title={t(locale, 'records.page.archivedTitle')}>
          {t(locale, 'records.page.archivedBody', {
            date: formatInstant(locale, record.archivedAt as string, timeZone),
          })}
        </Alert>
      )}
      {def.managedBy && <Alert tone="info" title={t(locale, 'records.page.managedElsewhere')} />}

      <Tabs
        label={t(locale, 'records.tabs.label')}
        tabs={tabs}
        selected={tab}
        onSelect={setTab}
        panel={
          tab === 'details' ? (
            editing ? (
              <Card>
                <h2 className="mb-4 text-xl font-semibold text-navy-900">
                  {t(locale, 'records.form.editTitle', { name: title })}
                </h2>
                <RecordForm
                  def={def}
                  mode="edit"
                  record={record}
                  onCancel={() => setEditing(false)}
                  onSaved={(next) => {
                    setEditing(false);
                    onChanged(next, t(locale, 'records.form.saved'));
                  }}
                />
              </Card>
            ) : (
              <Details def={def} record={record} revealable={revealable} />
            )
          ) : tab === 'history' ? (
            allowedActions.includes('history') ? (
              <HistoryTimeline key={record.rowVersion ?? 0} def={def} id={record.id} />
            ) : (
              <p className="text-gray-700">{t(locale, 'records.tabs.historyDenied')}</p>
            )
          ) : (
            <ComingSoon tab={tab as DetailTab} />
          )
        }
      />

      <ArchiveDialog
        def={def}
        record={record}
        title={title}
        open={dialog === 'archive'}
        onOpenChange={(o) => setDialog(o ? 'archive' : null)}
        onDone={(next) => {
          setDialog(null);
          onChanged(next, t(locale, 'records.archive.done'));
        }}
      />
      <RestoreDialog
        def={def}
        record={record}
        title={title}
        open={dialog === 'restore'}
        onOpenChange={(o) => setDialog(o ? 'restore' : null)}
        onDone={(next) => {
          setDialog(null);
          onChanged(next, t(locale, 'records.restore.done'));
        }}
      />
    </div>
  );
}

/** A site's own page shows no "Site:" line. */
function titleIsSite(def: RecordTypeDef): boolean {
  return def.id === 'site';
}

function ComingSoon({ tab }: { tab: DetailTab }) {
  const { locale } = useRecords();
  const name = t(locale, `records.tabs.${tab}`);
  return (
    <div className="flex flex-col items-start gap-2 rounded-card bg-gray-25 p-6">
      <Badge status="info">{t(locale, 'records.tabs.comingSoon')}</Badge>
      <h2 className="text-lg font-semibold text-navy-900">{name}</h2>
      <p className="text-gray-700">{t(locale, 'records.tabs.comingSoonBody', { tab: name })}</p>
    </div>
  );
}

function ErrorBlock({ title, onRetry }: { title: string; onRetry: () => void }) {
  const { locale } = useRecords();
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <h1 ref={ref} tabIndex={-1} className="text-2xl font-semibold text-navy-900 outline-none">
        {title}
      </h1>
      <Alert tone="critical" title={title}>
        {t(locale, 'records.error.body')}
      </Alert>
      <div>
        <Button onClick={onRetry}>{t(locale, 'records.retry')}</Button>
      </div>
    </div>
  );
}

function Details({
  def,
  record,
  revealable,
}: {
  def: RecordTypeDef;
  record: RecordView;
  revealable: readonly string[];
}) {
  const { locale } = useRecords();
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      {def.detail.sections
        .filter((s) => s.fields && s.fields.length > 0)
        .map((section) => {
          const key = `records.section.${section.id}`;
          const heading = t(locale, key as 'records.section.summary');
          return (
            <Card key={section.id}>
              <h2 className="text-xl font-semibold text-navy-900">{heading}</h2>
              <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">
                {(section.fields ?? [])
                  .filter((f) => f in record.fields)
                  .map((f) => (
                    <div key={f} className="min-w-0">
                      <dt className="text-sm font-semibold text-gray-500">
                        {fieldLabel(locale, def, f)}
                      </dt>
                      <dd className="mt-1 break-words text-gray-900">
                        <FieldDisplay
                          def={def}
                          record={record}
                          field={f}
                          value={record.fields[f]}
                          canReveal={revealable.includes(f)}
                        />
                      </dd>
                    </div>
                  ))}
              </dl>
            </Card>
          );
        })}
      <Card className="xl:col-span-2">
        <dl>
          <dt className="text-sm font-semibold text-gray-500">
            {t(locale, 'records.page.recordId')}
          </dt>
          <dd className="mt-1 font-mono text-sm break-all text-gray-900">{record.id}</dd>
        </dl>
      </Card>
    </div>
  );
}

function FieldDisplay({
  def,
  record,
  field,
  value,
  canReveal,
}: {
  def: RecordTypeDef;
  record: RecordView;
  field: string;
  value: FieldValue | undefined;
  canReveal: boolean;
}) {
  const { locale, timeZone } = useRecords();
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return (
      <MaskedField
        def={def}
        record={record}
        field={field}
        hasValue={value.hasValue}
        canReveal={canReveal}
      />
    );
  }
  const target = refTarget(def, field, record.fields);
  if (target && typeof value === 'string' && value) return <RefValue type={target} id={value} />;
  const status = statusField(def);
  if (field === status && typeof value === 'string') {
    return (
      <Badge status={statusTone(value)}>{formatValue(locale, def, field, value, timeZone)}</Badge>
    );
  }
  const mono = def.fields[field]?.kind === 'uuid' || field === 'npi' || field === 'requirementId';
  return (
    <span className={mono ? 'font-mono text-sm' : undefined}>
      {formatValue(locale, def, field, value, timeZone)}
    </span>
  );
}

/**
 * A masked value: ••• until revealed. Reveal asks for a reason, then the client runs
 * step-up (re-authentication) and the API writes a `reveal` audit event. The value lives
 * only in this component's state (never cached, never in a list) and "Hide" drops it.
 */
function MaskedField({
  def,
  record,
  field,
  hasValue,
  canReveal,
}: {
  def: RecordTypeDef;
  record: RecordView;
  field: string;
  hasValue: boolean;
  canReveal: boolean;
}) {
  const { locale } = useRecords();
  const label = fieldLabel(locale, def, field);
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<string | null | undefined>(undefined);
  const buttonRef = useRef<HTMLButtonElement>(null);

  if (shown !== undefined) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{shown ?? t(locale, 'records.reveal.noValue')}</span>
          <Button
            variant="ghost"
            icon={<EyeOff aria-hidden="true" size={16} strokeWidth={1.75} />}
            aria-label={t(locale, 'records.reveal.hideLabel', { field: label })}
            onClick={() => {
              setShown(undefined);
              requestAnimationFrame(() => buttonRef.current?.focus());
            }}
          >
            {t(locale, 'records.reveal.hide')}
          </Button>
        </div>
        <p role="status" className="text-sm text-gray-500">
          {t(locale, 'records.reveal.audited')}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span aria-hidden="true" className="font-mono tracking-widest">
        •••
      </span>
      <span className="sr-only">{t(locale, 'records.value.masked')}</span>
      {canReveal && hasValue ? (
        <Button
          ref={buttonRef}
          variant="secondary"
          icon={<Eye aria-hidden="true" size={16} strokeWidth={1.75} />}
          aria-label={t(locale, 'records.reveal.buttonLabel', { field: label })}
          onClick={() => setOpen(true)}
        >
          {t(locale, 'records.reveal.button')}
        </Button>
      ) : !hasValue ? (
        <span className="text-sm text-gray-500">{t(locale, 'records.reveal.noValue')}</span>
      ) : (
        <span className="text-sm text-gray-500">{t(locale, 'records.reveal.notAllowed')}</span>
      )}
      <RevealDialog
        def={def}
        record={record}
        field={field}
        label={label}
        open={open}
        onOpenChange={setOpen}
        onRevealed={(v) => {
          setOpen(false);
          setShown(v);
        }}
      />
    </div>
  );
}

function RevealDialog({
  def,
  record,
  field,
  label,
  open,
  onOpenChange,
  onRevealed,
}: {
  def: RecordTypeDef;
  record: RecordView;
  field: string;
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRevealed: (value: string | null) => void;
}) {
  const { client, locale } = useRecords();
  const base = useId();
  const [reason, setReason] = useState<(typeof REVEAL_REASON_CODES)[number] | ''>('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<{ reason?: string; note?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!reason)
      errs.reason = t(locale, 'records.validation.choose', {
        field: t(locale, 'records.reveal.reason'),
      });
    if (reason === 'other' && !note.trim()) errs.note = t(locale, 'records.reveal.noteRequired');
    setErrors(errs);
    setFailure(null);
    if (!reason || Object.keys(errs).length > 0) return;
    setBusy(true);
    const res = await client.reveal(def.id, record.id, field, {
      reasonCode: reason,
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    setBusy(false);
    if (res.ok) {
      setReason('');
      setNote('');
      onRevealed(res.data.value);
      return;
    }
    setFailure(
      res.code === 'reauth_required'
        ? t(locale, 'records.reveal.stepUp')
        : res.code === 'forbidden'
          ? t(locale, 'records.reveal.notAllowed')
          : t(locale, `apiError.${res.code === 'network' ? 'internal' : res.code}`),
    );
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t(locale, 'records.reveal.title', { field: label })}
      description={t(locale, 'records.reveal.body')}
      closeLabel={t(locale, 'records.close')}
    >
      <form id={`${base}-form`} onSubmit={submit} noValidate className="flex flex-col gap-4">
        {failure && (
          <Alert tone="critical" title={t(locale, 'records.form.problem')}>
            {failure}
          </Alert>
        )}
        <Select
          id={`${base}-reason`}
          label={t(locale, 'records.reveal.reason')}
          value={reason}
          error={errors.reason}
          requiredText={t(locale, 'records.form.required')}
          onChange={(e) => setReason(e.target.value as typeof reason)}
        >
          <option value="">{t(locale, 'records.form.choose')}</option>
          {REVEAL_REASON_CODES.map((c) => (
            <option key={c} value={c}>
              {t(locale, `records.reveal.reason.${c}`)}
            </option>
          ))}
        </Select>
        <Textarea
          id={`${base}-note`}
          label={t(locale, 'records.reveal.note')}
          hint={t(locale, 'records.reveal.noteHint')}
          value={note}
          maxLength={500}
          error={errors.note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            {t(locale, 'records.cancel')}
          </Button>
          <Button type="submit" loading={busy} loadingLabel={t(locale, 'records.form.saving')}>
            {t(locale, 'records.reveal.submit')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ArchiveDialog({
  def,
  record,
  title,
  open,
  onOpenChange,
  onDone,
}: {
  def: RecordTypeDef;
  record: RecordView;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: (next: RecordView) => void;
}) {
  const { client, locale } = useRecords();
  const base = useId();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFailure(null);
    if (!reason.trim()) {
      setError(t(locale, 'records.archive.reasonRequired'));
      return;
    }
    setError(undefined);
    setBusy(true);
    const res = await client.archive(def.id, record.id, record.rowVersion ?? 1, reason.trim());
    setBusy(false);
    if (res.ok) {
      setReason('');
      onDone(res.data.record);
      return;
    }
    setFailure(mutationFailure(locale, res));
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t(locale, 'records.archive.title', { name: title })}
      description={t(locale, 'records.archive.body')}
      closeLabel={t(locale, 'records.close')}
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {failure && (
          <Alert tone="critical" title={t(locale, 'records.form.problem')}>
            {failure}
          </Alert>
        )}
        <Textarea
          id={`${base}-reason`}
          label={t(locale, 'records.archive.reason')}
          hint={t(locale, 'records.archive.reasonHint')}
          requiredText={t(locale, 'records.form.required')}
          value={reason}
          maxLength={500}
          error={error}
          onChange={(e) => setReason(e.target.value)}
        />
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            {t(locale, 'records.cancel')}
          </Button>
          <Button
            type="submit"
            variant="danger"
            loading={busy}
            loadingLabel={t(locale, 'records.form.saving')}
          >
            {t(locale, 'records.archive.submit')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RestoreDialog({
  def,
  record,
  title,
  open,
  onOpenChange,
  onDone,
}: {
  def: RecordTypeDef;
  record: RecordView;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: (next: RecordView) => void;
}) {
  const { client, locale } = useRecords();
  const base = useId();
  const [reason, setReason] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    setFailure(null);
    const res = await client.restore(
      def.id,
      record.id,
      record.rowVersion ?? 1,
      reason.trim() || undefined,
    );
    setBusy(false);
    if (res.ok) {
      setReason('');
      onDone(res.data.record);
    } else setFailure(mutationFailure(locale, res));
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t(locale, 'records.restore.title', { name: title })}
      description={t(locale, 'records.restore.body')}
      closeLabel={t(locale, 'records.close')}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            {t(locale, 'records.cancel')}
          </Button>
          <Button
            onClick={() => void confirm()}
            loading={busy}
            loadingLabel={t(locale, 'records.form.saving')}
          >
            {t(locale, 'records.restore.submit')}
          </Button>
        </>
      }
    >
      {failure && (
        <Alert tone="critical" title={t(locale, 'records.form.problem')}>
          {failure}
        </Alert>
      )}
      <Textarea
        id={`${base}-reason`}
        label={t(locale, 'records.restore.reason')}
        hint={t(locale, 'records.archive.reasonHint')}
        value={reason}
        maxLength={500}
        onChange={(e) => setReason(e.target.value)}
      />
    </Modal>
  );
}

/** Archive, restore, and bulk failures in plain language (blockers named, never ids). */
export function mutationFailure(locale: Locale, res: RecordsError): string {
  const blockers = (res.fields ?? [])
    .filter((f) => f.startsWith('blockedBy.'))
    .map((f) => f.slice('blockedBy.'.length));
  if (res.code === 'conflict' && blockers.length > 0) {
    return t(locale, 'records.archive.blocked', {
      reasons: blockers
        .map((b) => t(locale, `records.blocker.${b}` as 'records.blocker.active_user_account'))
        .join(', '),
    });
  }
  if (res.code === 'version_conflict') return t(locale, 'apiError.version_conflict');
  return t(locale, `apiError.${res.code === 'network' ? 'internal' : res.code}`);
}

// ---------------------------------------------------------------------------
// History timeline
// ---------------------------------------------------------------------------

const HISTORY_VERBS = [
  'create',
  'update',
  'archive',
  'restore',
  'transition',
  'export',
  'import',
] as const;

function actionLabel(locale: Locale, action: string): string {
  const verb = action.slice(action.lastIndexOf('.') + 1);
  if (verb.startsWith('reveal')) return t(locale, 'records.history.action.reveal');
  const known = HISTORY_VERBS.find((v) => v === verb);
  return t(locale, known ? `records.history.action.${known}` : 'records.history.action.other');
}

/** Field names from a redacted diff (`diff.fields` keyed by column); values are never shown. */
function changedFields(locale: Locale, def: RecordTypeDef, diff: unknown): string[] {
  const fields =
    diff && typeof diff === 'object' && 'fields' in diff
      ? (diff as { fields: unknown }).fields
      : null;
  if (!fields || typeof fields !== 'object') return [];
  const byColumn = new Map(Object.entries(def.fields).map(([n, f]) => [f.column, n]));
  return Object.keys(fields)
    .map((col) => {
      const name = byColumn.get(col);
      if (name) return fieldLabel(locale, def, name);
      return col === 'archived_at' ? t(locale, 'records.value.archived') : null;
    })
    .filter((x): x is string => x !== null);
}

/** The record's history. The caller keys it by row version, so a change reloads it. */
export function HistoryTimeline({ def, id }: { def: RecordTypeDef; id: string }) {
  const { client, locale, timeZone } = useRecords();
  const [items, setItems] = useState<HistoryEvent[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadPage = useCallback(
    async (from: string | null) => {
      setBusy(true);
      const res = await client.history(def.id, id, from);
      setBusy(false);
      if (!res.ok) {
        setError(true);
        return;
      }
      setError(false);
      setItems((prev) => (from && prev ? [...prev, ...res.data.items] : res.data.items));
      setCursor(res.data.nextCursor);
    },
    [client, def.id, id],
  );

  useEffect(() => {
    let live = true;
    void client.history(def.id, id, null).then((res) => {
      if (!live) return;
      if (!res.ok) setError(true);
      else {
        setItems(res.data.items);
        setCursor(res.data.nextCursor);
      }
    });
    return () => {
      live = false;
    };
  }, [client, def.id, id]);

  if (error && !items) {
    return (
      <Alert tone="critical" title={t(locale, 'records.history.error')}>
        <Button variant="secondary" className="mt-2" onClick={() => void loadPage(null)}>
          {t(locale, 'records.retry')}
        </Button>
      </Alert>
    );
  }
  if (!items) {
    return (
      <p role="status" className="text-gray-700">
        {t(locale, 'loading.label')}
      </p>
    );
  }
  if (items.length === 0)
    return <p className="text-gray-700">{t(locale, 'records.history.empty')}</p>;

  return (
    <div className="flex flex-col gap-4">
      <ol className="relative flex flex-col gap-0 border-l-2 border-gray-200 pl-6">
        {items.map((e) => {
          const fields = changedFields(locale, def, e.diff);
          return (
            <li key={e.id} className="relative pb-6 last:pb-0">
              <span
                aria-hidden="true"
                className="absolute top-1.5 -left-[31px] size-3 rounded-full border-2 border-white bg-navy-900"
              />
              <p className="flex flex-wrap items-center gap-2 font-semibold text-navy-900">
                {actionLabel(locale, e.action)}
                {e.outcome !== 'success' && (
                  <Badge status="critical">{t(locale, 'records.history.denied')}</Badge>
                )}
              </p>
              <p className="text-sm text-gray-700">
                <time dateTime={e.occurredAt}>{formatInstant(locale, e.occurredAt, timeZone)}</time>{' '}
                {t(locale, 'records.history.by', { actor: e.actorLabel })}
              </p>
              {fields.length > 0 && (
                <p className="mt-1 text-sm text-gray-700">
                  {t(locale, 'records.history.fields', { fields: fields.join(', ') })}
                </p>
              )}
              {e.reason && (
                <p className="mt-1 text-sm text-gray-700">
                  {t(locale, 'records.history.reason', {
                    reason: revealReason(locale, e.reason),
                  })}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      {cursor && (
        <div>
          <Button variant="secondary" loading={busy} onClick={() => void loadPage(cursor)}>
            {t(locale, 'records.history.more')}
          </Button>
        </div>
      )}
    </div>
  );
}

function revealReason(locale: Locale, code: string): string {
  const known = REVEAL_REASON_CODES.find((c) => c === code);
  return known ? t(locale, `records.reveal.reason.${known}`) : code;
}
