'use client';

/**
 * `RecordTable` (ADR-0014 section 3): the list of one record type, driven by the
 * registry. A native `<table>` (caption, `scope` headers, `aria-sort`, sticky header)
 * with a column chooser, a filter bar built from `filterable` fields, search over
 * `searchable` fields, cursor paging, saved views, row selection with a bulk action bar,
 * and the four page states (loading, empty, error, no permission). Results are announced
 * in a polite live region. Actions follow `actions` (from the session's permissions);
 * the API checks every request again, per record.
 */
import {
  ROLE_IDS,
  bulkFields,
  bulkUpdateSchema,
  createFields,
  filterOps,
  isListable,
  type BulkResponse,
  type FieldDef,
  type RecordListResponse,
  type RecordTypeDef,
  type RecordView,
  type RoleId,
  type SavedView,
} from '@deemed/domain';
import { t, tCount } from '@deemed/i18n';
import {
  addDays,
  formatInstant as isoInstant,
  isCalendarDate,
  parseInstant,
  startOfDayInZone,
  toZonedDate,
  instantFromEpochMilliseconds,
  type TimeZone,
} from '@deemed/dates';
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, Plus, Save, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { cn } from '../cn.js';
import { Alert } from '../components/Alert.js';
import { Badge } from '../components/Badge.js';
import { Button } from '../components/Button.js';
import { Checkbox, Drawer, Modal, Select, Textarea } from '../components/controls.js';
import { Input } from '../components/Input.js';
import { EmptyState } from '../components/scaffolds.js';
import { isUuid } from '../module-registry.js';
import { useRecords, type ArchivedMode, type ListFilterInput, type RecordsError } from './client.js';
import {
  enumLabel,
  fieldLabel,
  formatValue,
  recordTitle,
  refTarget,
  statusField,
  statusTone,
  typePlural,
  type ListActions,
} from './format.js';
import { RecordForm } from './RecordForm.js';
import { mutationFailure } from './RecordPage.js';
import { RefSelect, RefText, RefValue, recordHref } from './refs.js';

export const PAGE_SIZE = 25;

export type RecordTableProps = {
  def: RecordTypeDef;
  /** List-level actions for this viewer (`listActionsFor(def, permissions)`). */
  actions: ListActions;
  /** Open the create drawer on load (launcher "New …", `?new=1`). */
  initialCreate?: boolean;
};

type Draft = { value: string; from: string; to: string };
type SortKey = { field: string; dir: 'asc' | 'desc' };
type Load =
  | { state: 'loading'; data?: RecordListResponse }
  | { state: 'ok'; data: RecordListResponse }
  | { state: 'error'; error: RecordsError };

const EMPTY_DRAFT: Draft = { value: '', from: '', to: '' };

function filterableFields(def: RecordTypeDef): [string, FieldDef][] {
  return Object.entries(def.fields).filter(
    ([name, f]) => filterOps(f).length > 0 && isListable(def, name) && f.kind !== 'text_array',
  );
}

function listableFields(def: RecordTypeDef): string[] {
  return Object.keys(def.fields).filter((f) => isListable(def, f));
}

/** Filter drafts to API filters; returns the fields whose input is not valid. */
export function draftsToFilters(
  def: RecordTypeDef,
  drafts: Readonly<Record<string, Draft>>,
  timeZone: TimeZone,
): { filters: ListFilterInput[]; invalid: string[] } {
  const filters: ListFilterInput[] = [];
  const invalid: string[] = [];
  for (const [name, f] of filterableFields(def)) {
    const d = drafts[name] ?? EMPTY_DRAFT;
    if (f.kind === 'date' || f.kind === 'timestamp') {
      for (const [bound, raw] of [
        ['from', d.from],
        ['to', d.to],
      ] as const) {
        if (!raw) continue;
        if (!isCalendarDate(raw)) {
          invalid.push(name);
          continue;
        }
        if (f.kind === 'date') {
          filters.push({ field: name, op: bound === 'from' ? 'gte' : 'lte', value: raw });
        } else {
          // Days are days in the health center's zone: [start of from, start of to + 1).
          const day = bound === 'from' ? raw : addDays(raw, 1);
          const at = isoInstant(startOfDayInZone(day, timeZone));
          filters.push({ field: name, op: bound === 'from' ? 'gte' : 'lt', value: at });
        }
      }
      continue;
    }
    const v = d.value.trim();
    if (!v) continue;
    if (f.kind === 'uuid' && !isUuid(v)) {
      invalid.push(name);
      continue;
    }
    filters.push({ field: name, op: 'eq', value: v });
  }
  return { filters, invalid };
}

/** A saved view's filters back into drafts (the reverse of `draftsToFilters`). */
export function filtersToDrafts(
  def: RecordTypeDef,
  filters: readonly { field: string; op: string; value: string | readonly string[] }[],
  timeZone: TimeZone,
): Record<string, Draft> {
  const out: Record<string, Draft> = {};
  for (const f of filters) {
    const kind = def.fields[f.field]?.kind;
    const d = { ...(out[f.field] ?? EMPTY_DRAFT) };
    const one = typeof f.value === 'string' ? f.value : (f.value[0] ?? '');
    const zoned = (iso: string, minus = 0) => {
      try {
        return toZonedDate(instantFromEpochMilliseconds(parseInstant(iso) - minus), timeZone);
      } catch {
        return '';
      }
    };
    if (kind === 'date') {
      if (f.op === 'gte' || f.op === 'gt') d.from = one;
      else if (f.op === 'lte' || f.op === 'lt') d.to = one;
      else if (f.op === 'between' && Array.isArray(f.value)) {
        d.from = f.value[0] ?? '';
        d.to = f.value[1] ?? '';
      } else d.from = d.to = one;
    } else if (kind === 'timestamp') {
      if (f.op === 'gte' || f.op === 'gt') d.from = zoned(one);
      else if (f.op === 'lt') d.to = zoned(one, 1);
      else if (f.op === 'lte') d.to = zoned(one);
    } else d.value = one;
    out[f.field] = d;
  }
  return out;
}

export function RecordTable({ def, actions, initialCreate = false }: RecordTableProps) {
  const { client, locale, timeZone, navigate } = useRecords();
  const base = useId();
  const plural = typePlural(locale, def);
  const listable = useMemo(() => listableFields(def), [def]);
  const defaultColumns = useMemo(
    () => def.list.defaultColumns.filter((c) => listable.includes(c)),
    [def, listable],
  );
  const defaultSort = useMemo(
    () => def.list.defaultSort.map((s) => ({ field: s.field, dir: s.dir })),
    [def],
  );
  const searchable = Object.entries(def.fields).filter(([n, f]) => f.searchable && isListable(def, n));
  const filterable = filterableFields(def);

  const [columns, setColumns] = useState<string[]>(defaultColumns);
  const [sort, setSort] = useState<SortKey[]>(defaultSort);
  const [q, setQ] = useState('');
  const [qDraft, setQDraft] = useState('');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [filters, setFilters] = useState<ListFilterInput[]>([]);
  const [invalid, setInvalid] = useState<string[]>([]);
  const [archived, setArchived] = useState<ArchivedMode>('exclude');
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [views, setViews] = useState<SavedView[]>([]);
  const [viewId, setViewId] = useState('');
  const [dialog, setDialog] = useState<null | 'columns' | 'saveView' | 'bulkArchive' | `bulk:${string}`>(null);
  const [createOpen, setCreateOpen] = useState(initialCreate && actions.create);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn'; title: string; body?: string } | null>(null);
  const [announce, setAnnounce] = useState('');

  const cursor = cursors[cursors.length - 1] ?? null;
  const pageIndex = cursors.length - 1;

  useEffect(() => {
    let live = true;
    setLoad((prev) => ({ state: 'loading', ...(prev.state === 'ok' ? { data: prev.data } : {}) }));
    void client
      .list(def.id, { filters, sort, q, limit: PAGE_SIZE, cursor, archived })
      .then((res) => {
        if (!live) return;
        if (res.ok) {
          setLoad({ state: 'ok', data: res.data });
          setAnnounce(tCount(locale, 'records.list.announce', res.data.total));
        } else setLoad({ state: 'error', error: res });
        setSelected(new Set());
      });
    return () => {
      live = false;
    };
  }, [client, def.id, filters, sort, q, cursor, archived, reload, locale]);

  const loadViews = useCallback(async () => {
    if (!def.actions.includes('views')) return;
    const res = await client.listViews(def.id);
    if (res.ok) setViews(res.data.items);
  }, [client, def]);

  useEffect(() => {
    void loadViews();
  }, [loadViews]);

  const resetPaging = () => setCursors([null]);

  function applyFilters(e?: FormEvent) {
    e?.preventDefault();
    const next = draftsToFilters(def, drafts, timeZone);
    setInvalid(next.invalid);
    if (next.invalid.length > 0) return;
    setFilters(next.filters);
    setQ(qDraft);
    resetPaging();
  }

  function clearFilters() {
    setDrafts({});
    setFilters([]);
    setInvalid([]);
    setQ('');
    setQDraft('');
    setViewId('');
    resetPaging();
  }

  function toggleSort(field: string) {
    const current = sort[0];
    const dir = current?.field === field && current.dir === 'asc' ? 'desc' : 'asc';
    setSort([{ field, dir }]);
    resetPaging();
  }

  function applyView(id: string) {
    setViewId(id);
    const view = views.find((v) => v.id === id);
    if (!view) {
      clearFilters();
      setColumns(defaultColumns);
      setSort(defaultSort);
      return;
    }
    setDrafts(filtersToDrafts(def, view.query.filters, timeZone));
    setFilters(view.query.filters.map((f) => ({ field: f.field, op: f.op, value: f.value })));
    setSort(view.query.sort.length > 0 ? view.query.sort.map((s) => ({ ...s })) : defaultSort);
    setQ(view.query.q ?? '');
    setQDraft(view.query.q ?? '');
    const cols = view.columns.filter((c) => listable.includes(c));
    setColumns(cols.length > 0 ? cols : defaultColumns);
    setInvalid([]);
    resetPaging();
  }

  const data = load.state === 'error' ? undefined : load.data;
  const items = data?.items ?? [];
  const selectable = actions.update && def.actions.includes('bulk');
  const bulkable = bulkFields(def).filter((f) => isListable(def, f));
  const canBulkArchive = selectable && actions.archive && def.archivable;
  const showSelection = selectable && (bulkable.length > 0 || canBulkArchive);
  const canCreate = actions.create && createFields(def).length > 0;
  const activeView = views.find((v) => v.id === viewId);
  const filtered = filters.length > 0 || q !== '';
  const statusCol = statusField(def);
  const selectedItems = items.filter((r) => selected.has(r.id));

  function bulkDone(res: BulkResponse, kind: 'update' | 'archive') {
    const done = res.results.filter((r) => r.status === (kind === 'update' ? 'updated' : 'archived'));
    const skipped = res.results.filter((r) => !done.includes(r));
    const reasons = [...new Set(skipped.map((r) => t(locale, `records.bulk.status.${r.status}`)))];
    setNotice({
      tone: skipped.length > 0 ? 'warn' : 'ok',
      title: t(locale, 'records.bulk.result', { done: done.length, skipped: skipped.length }),
      ...(reasons.length > 0 ? { body: t(locale, 'records.bulk.skipped', { reasons: reasons.join(', ') }) } : {}),
    });
    setDialog(null);
    setReload((n) => n + 1);
  }

  const newLabelKey = `recordType.${def.id}.new` as 'recordType.site.new';
  const newButton = canCreate ? (
    <Button icon={<Plus aria-hidden="true" size={16} strokeWidth={1.75} />} onClick={() => setCreateOpen(true)}>
      {t(locale, newLabelKey)}
    </Button>
  ) : null;

  return (
    <div className="flex flex-col gap-4">
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {announce}
      </p>

      {/* Views, columns, and New */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          {def.actions.includes('views') && (
            <Select
              id={`${base}-view`}
              label={t(locale, 'records.views.label')}
              value={viewId}
              onChange={(e) => applyView(e.target.value)}
              className="min-w-56"
            >
              <option value="">{t(locale, 'records.views.default')}</option>
              {views.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.visibility === 'roles' ? t(locale, 'records.views.sharedTag', { name: v.name }) : v.name}
                </option>
              ))}
            </Select>
          )}
          {def.actions.includes('views') && (
            <Button
              variant="secondary"
              icon={<Save aria-hidden="true" size={16} strokeWidth={1.75} />}
              onClick={() => setDialog('saveView')}
            >
              {t(locale, activeView?.owned ? 'records.views.update' : 'records.views.save')}
            </Button>
          )}
          {activeView?.owned && (
            <Button
              variant="ghost"
              icon={<Trash2 aria-hidden="true" size={16} strokeWidth={1.75} />}
              onClick={async () => {
                const res = await client.updateView(def.id, activeView.id, activeView.rowVersion, {
                  archived: true,
                });
                if (res.ok) {
                  setNotice({ tone: 'ok', title: t(locale, 'records.views.deleted') });
                  applyView('');
                  void loadViews();
                } else setNotice({ tone: 'warn', title: mutationFailure(locale, res) });
              }}
            >
              {t(locale, 'records.views.delete')}
            </Button>
          )}
          <Button
            variant="secondary"
            icon={<Columns3 aria-hidden="true" size={16} strokeWidth={1.75} />}
            onClick={() => setDialog('columns')}
          >
            {t(locale, 'records.columns.button')}
          </Button>
        </div>
        {newButton}
      </div>

      {/* Search and filters */}
      <section aria-labelledby={`${base}-filters`} className="rounded-card bg-gray-25 p-4">
        <h2 id={`${base}-filters`} className="sr-only">
          {t(locale, 'records.filters.title')}
        </h2>
        <form onSubmit={applyFilters} noValidate className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {searchable.length > 0 && (
              <Input
                id={`${base}-q`}
                type="search"
                label={t(locale, 'records.search.label')}
                hint={t(locale, 'records.search.hint', {
                  fields: searchable.map(([n]) => fieldLabel(locale, def, n)).join(', '),
                })}
                value={qDraft}
                maxLength={200}
                onChange={(e) => setQDraft(e.target.value)}
              />
            )}
            {filterable.map(([name, f]) => (
              <FilterInput
                key={name}
                def={def}
                name={name}
                f={f}
                id={`${base}-f-${name}`}
                draft={drafts[name] ?? EMPTY_DRAFT}
                invalid={invalid.includes(name)}
                onChange={(d) => setDrafts((prev) => ({ ...prev, [name]: d }))}
              />
            ))}
            {def.archivable && actions.update && (
              <Select
                id={`${base}-archived`}
                label={t(locale, 'records.archived.label')}
                value={archived}
                onChange={(e) => {
                  setArchived(e.target.value as ArchivedMode);
                  resetPaging();
                }}
              >
                <option value="exclude">{t(locale, 'records.archived.exclude')}</option>
                <option value="only">{t(locale, 'records.archived.only')}</option>
                <option value="include">{t(locale, 'records.archived.include')}</option>
              </Select>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit">{t(locale, 'records.filters.apply')}</Button>
            <Button variant="secondary" onClick={clearFilters}>
              {t(locale, 'records.filters.clear')}
            </Button>
            {filters.length > 0 && (
              <span className="text-sm text-gray-700">
                {tCount(locale, 'records.filters.active', filters.length)}
              </span>
            )}
          </div>
        </form>
      </section>

      {notice && (
        <Alert tone={notice.tone} title={notice.title}>
          {notice.body}
        </Alert>
      )}

      {showSelection && selected.size > 0 && (
        <div
          role="region"
          aria-label={t(locale, 'records.bulk.label')}
          className="flex flex-wrap items-center gap-3 rounded-card border border-navy-900 bg-blue-50 p-3"
        >
          <span className="font-semibold text-navy-900">
            {tCount(locale, 'records.selected', selected.size)}
          </span>
          {bulkable.map((f) => (
            <Button key={f} variant="secondary" onClick={() => setDialog(`bulk:${f}`)}>
              {t(locale, 'records.bulk.change', { field: fieldLabel(locale, def, f) })}
            </Button>
          ))}
          {canBulkArchive && (
            <Button variant="secondary" onClick={() => setDialog('bulkArchive')}>
              {t(locale, 'records.bulk.archive')}
            </Button>
          )}
          <Button variant="ghost" onClick={() => setSelected(new Set())}>
            {t(locale, 'records.select.clear')}
          </Button>
        </div>
      )}

      {/* States */}
      {load.state === 'error' ? (
        load.error.code === 'forbidden' ? (
          <EmptyState
            icon="lock"
            title={t(locale, 'records.noPermission.title', { records: plural })}
            body={t(locale, 'records.noPermission.body')}
          />
        ) : (
          <div className="flex flex-col gap-3">
            <Alert tone="critical" title={t(locale, 'records.error.title', { records: plural })}>
              {t(locale, 'records.error.body')}
            </Alert>
            <div>
              <Button onClick={() => setReload((n) => n + 1)}>{t(locale, 'records.retry')}</Button>
            </div>
          </div>
        )
      ) : !data ? (
        <div aria-busy="true">
          <p role="status" className="sr-only">
            {t(locale, 'records.loading')}
          </p>
          <div aria-hidden="true" className="flex flex-col gap-2 motion-safe:animate-pulse">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-10 rounded-control bg-gray-100" />
            ))}
          </div>
        </div>
      ) : data.total === 0 ? (
        filtered ? (
          <EmptyState
            title={t(locale, 'records.emptyFiltered.title', { records: plural.toLowerCase() })}
            body={t(locale, 'records.emptyFiltered.body')}
            action={
              <Button variant="secondary" onClick={clearFilters}>
                {t(locale, 'records.filters.clear')}
              </Button>
            }
          />
        ) : (
          <EmptyState
            title={t(locale, 'records.empty.title', { records: plural.toLowerCase() })}
            body={t(locale, 'records.empty.body', { records: plural.toLowerCase() })}
            action={newButton ?? undefined}
          />
        )
      ) : (
        <>
          <div
            role="region"
            aria-label={t(locale, 'records.list.scrollRegion', { records: plural })}
            // Keyboard users can scroll a wide table (axe: scrollable-region-focusable).
            tabIndex={0}
            className="focus-ring max-h-[70vh] overflow-auto rounded-card border border-gray-200"
          >
            <table aria-busy={load.state === 'loading' || undefined} className="w-full border-collapse text-left text-sm">
              <caption className="sr-only">
                {`${plural}. ${t(locale, 'records.list.range', rangeVars(pageIndex, items.length, data.total))}`}
              </caption>
              <thead>
                <tr>
                  {showSelection && (
                    <th scope="col" className="sticky top-0 z-10 w-12 bg-gray-25 px-2">
                      <Checkbox
                        id={`${base}-all`}
                        label={t(locale, 'records.select.all')}
                        labelHidden
                        checked={items.length > 0 && selected.size === items.length}
                        indeterminate={selected.size > 0 && selected.size < items.length}
                        onChange={(c) => setSelected(c ? new Set(items.map((r) => r.id)) : new Set())}
                      />
                    </th>
                  )}
                  {columns.map((col) => {
                    const sortable = def.fields[col]?.sortable === true;
                    const active = sort[0]?.field === col ? sort[0].dir : null;
                    const Glyph = active === 'asc' ? ArrowUp : active === 'desc' ? ArrowDown : ArrowUpDown;
                    return (
                      <th
                        key={col}
                        scope="col"
                        aria-sort={
                          sortable ? (active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : 'none') : undefined
                        }
                        className="sticky top-0 z-10 border-b border-gray-200 bg-gray-25 px-3 py-2 text-xs font-semibold tracking-[0.04em] whitespace-nowrap text-gray-700 uppercase"
                      >
                        {sortable ? (
                          <button
                            type="button"
                            onClick={() => toggleSort(col)}
                            className="focus-ring -mx-1 inline-flex min-h-10 items-center gap-1 rounded-sm px-1 uppercase hover:text-navy-900"
                          >
                            {fieldLabel(locale, def, col)}
                            <Glyph aria-hidden="true" size={14} strokeWidth={1.75} className={active ? 'text-navy-900' : 'text-gray-500'} />
                          </button>
                        ) : (
                          fieldLabel(locale, def, col)
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <Row
                    key={row.id}
                    def={def}
                    row={row}
                    columns={columns}
                    statusCol={statusCol}
                    selection={
                      showSelection
                        ? {
                            id: `${base}-row-${row.id}`,
                            checked: selected.has(row.id),
                            onChange: (c) =>
                              setSelected((prev) => {
                                const next = new Set(prev);
                                if (c) next.add(row.id);
                                else next.delete(row.id);
                                return next;
                              }),
                          }
                        : undefined
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
          <nav aria-label={t(locale, 'records.pager.label')} className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-gray-700">
              {t(locale, 'records.list.range', rangeVars(pageIndex, items.length, data.total))}
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                disabled={pageIndex === 0}
                onClick={() => setCursors((c) => c.slice(0, -1))}
              >
                {t(locale, 'records.pager.previous')}
              </Button>
              <Button
                variant="secondary"
                disabled={!data.nextCursor}
                onClick={() => data.nextCursor && setCursors((c) => [...c, data.nextCursor])}
              >
                {t(locale, 'records.pager.next')}
              </Button>
            </div>
          </nav>
        </>
      )}

      <ColumnsDialog
        def={def}
        open={dialog === 'columns'}
        onOpenChange={(o) => setDialog(o ? 'columns' : null)}
        listable={listable}
        columns={columns}
        defaults={defaultColumns}
        onApply={(cols) => {
          setColumns(cols);
          setDialog(null);
        }}
      />
      <SaveViewDialog
        def={def}
        open={dialog === 'saveView'}
        onOpenChange={(o) => setDialog(o ? 'saveView' : null)}
        existing={activeView?.owned ? activeView : undefined}
        canShare={actions.update}
        query={{ filters, sort, q }}
        columns={columns}
        onSaved={(view) => {
          setDialog(null);
          setNotice({ tone: 'ok', title: t(locale, 'records.views.saved') });
          setViews((prev) => [...prev.filter((v) => v.id !== view.id), view]);
          setViewId(view.id);
        }}
      />
      {bulkable.map((f) => (
        <BulkEditDialog
          key={f}
          def={def}
          field={f}
          open={dialog === `bulk:${f}`}
          onOpenChange={(o) => setDialog(o ? `bulk:${f}` : null)}
          items={selectedItems}
          onDone={(res) => bulkDone(res, 'update')}
        />
      ))}
      {canBulkArchive && (
        <BulkArchiveDialog
          def={def}
          open={dialog === 'bulkArchive'}
          onOpenChange={(o) => setDialog(o ? 'bulkArchive' : null)}
          items={selectedItems}
          onDone={(res) => bulkDone(res, 'archive')}
        />
      )}
      {canCreate && (
        <Drawer
          open={createOpen}
          onOpenChange={setCreateOpen}
          title={t(locale, newLabelKey)}
          closeLabel={t(locale, 'records.close')}
        >
          <RecordForm
            def={def}
            mode="create"
            onCancel={() => setCreateOpen(false)}
            onSaved={(record) => {
              setCreateOpen(false);
              const href = recordHref(def.id, record.id);
              if (href) navigate(href);
              else setReload((n) => n + 1);
            }}
          />
        </Drawer>
      )}
    </div>
  );
}

function rangeVars(pageIndex: number, count: number, total: number) {
  const from = count === 0 ? 0 : pageIndex * PAGE_SIZE + 1;
  return { from, to: pageIndex * PAGE_SIZE + count, total };
}

function Row({
  def,
  row,
  columns,
  statusCol,
  selection,
}: {
  def: RecordTypeDef;
  row: RecordView;
  columns: readonly string[];
  statusCol: string | undefined;
  selection?: { id: string; checked: boolean; onChange: (checked: boolean) => void } | undefined;
}) {
  const { locale, timeZone, Link } = useRecords();
  const href = recordHref(def.id, row.id) ?? '#';
  const title = recordTitle(locale, def, row.fields);
  return (
    <tr className={cn('border-b border-gray-100 last:border-b-0', selection?.checked && 'bg-blue-50')}>
      {selection && (
        <td className="px-2 align-middle">
          <Checkbox
            id={selection.id}
            label={t(locale, 'records.select.row', { name: title })}
            labelHidden
            checked={selection.checked}
            onChange={selection.onChange}
          />
        </td>
      )}
      {columns.map((col, i) => {
        const value = row.fields[col];
        const target = refTarget(def, col, row.fields);
        if (i === 0) {
          return (
            <th key={col} scope="row" className="px-3 py-2 text-left align-middle font-normal">
              <span className="flex flex-wrap items-center gap-2">
                <Link
                  href={href}
                  className="focus-ring inline-flex min-h-10 items-center rounded-sm font-semibold text-blue-600 underline-offset-4 hover:underline"
                >
                  {target && typeof value === 'string' ? (
                    <RefText type={target} id={value} />
                  ) : (
                    formatValue(locale, def, col, value, timeZone)
                  )}
                </Link>
                {row.archivedAt && <Badge status="neutral">{t(locale, 'records.value.archived')}</Badge>}
              </span>
            </th>
          );
        }
        return (
          <td key={col} className="px-3 py-2 align-middle text-gray-900">
            {col === statusCol && typeof value === 'string' ? (
              <Badge status={statusTone(value)}>{formatValue(locale, def, col, value, timeZone)}</Badge>
            ) : target && typeof value === 'string' ? (
              <RefValue type={target} id={value} />
            ) : (
              <span className={def.fields[col]?.kind === 'uuid' || col === 'npi' ? 'font-mono' : undefined}>
                {formatValue(locale, def, col, value, timeZone)}
              </span>
            )}
          </td>
        );
      })}
    </tr>
  );
}

function FilterInput({
  def,
  name,
  f,
  id,
  draft,
  invalid,
  onChange,
}: {
  def: RecordTypeDef;
  name: string;
  f: FieldDef;
  id: string;
  draft: Draft;
  invalid: boolean;
  onChange: (d: Draft) => void;
}) {
  const { locale } = useRecords();
  const label = fieldLabel(locale, def, name);
  const error = invalid ? t(locale, 'records.filters.invalid') : undefined;
  if (f.kind === 'date' || f.kind === 'timestamp') {
    return (
      <fieldset className="grid grid-cols-2 gap-2 sm:col-span-2 xl:col-span-2">
        <legend className="sr-only">{label}</legend>
        <Input
          id={`${id}-from`}
          type="date"
          label={t(locale, 'records.filters.from', { field: label })}
          value={draft.from}
          error={error}
          onChange={(e) => onChange({ ...draft, from: e.target.value })}
        />
        <Input
          id={`${id}-to`}
          type="date"
          label={t(locale, 'records.filters.to', { field: label })}
          value={draft.to}
          onChange={(e) => onChange({ ...draft, to: e.target.value })}
        />
      </fieldset>
    );
  }
  if (f.kind === 'enum' || f.kind === 'boolean') {
    const values = f.kind === 'boolean' ? ['true', 'false'] : (f.values ?? []);
    return (
      <Select id={id} label={label} value={draft.value} onChange={(e) => onChange({ ...draft, value: e.target.value })}>
        <option value="">{t(locale, 'records.filters.any')}</option>
        {values.map((v) => (
          <option key={v} value={v}>
            {f.kind === 'boolean'
              ? t(locale, v === 'true' ? 'records.value.yes' : 'records.value.no')
              : enumLabel(locale, def, name, v)}
          </option>
        ))}
      </Select>
    );
  }
  const target = f.kind === 'uuid' ? refTarget(def, name) : null;
  if (target) {
    return (
      <RefSelect
        id={id}
        type={target}
        label={label}
        value={draft.value}
        error={error}
        onChange={(v) => onChange({ ...draft, value: v })}
        emptyLabel={t(locale, 'records.filters.any')}
      />
    );
  }
  return (
    <Input
      id={id}
      label={label}
      hint={f.kind === 'uuid' ? t(locale, 'records.filters.idHint') : undefined}
      value={draft.value}
      error={error}
      maxLength={200}
      autoComplete="off"
      spellCheck={false}
      onChange={(e) => onChange({ ...draft, value: e.target.value })}
    />
  );
}

function ColumnsDialog({
  def,
  open,
  onOpenChange,
  listable,
  columns,
  defaults,
  onApply,
}: {
  def: RecordTypeDef;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  listable: readonly string[];
  columns: readonly string[];
  defaults: readonly string[];
  onApply: (columns: string[]) => void;
}) {
  const { locale } = useRecords();
  const base = useId();
  const [picked, setPicked] = useState<string[]>([...columns]);
  useEffect(() => {
    if (open) setPicked([...columns]);
  }, [open, columns]);
  const ordered = (list: readonly string[]) => listable.filter((c) => list.includes(c));
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t(locale, 'records.columns.title')}
      description={t(locale, 'records.columns.body')}
      closeLabel={t(locale, 'records.close')}
      footer={
        <>
          <Button variant="ghost" onClick={() => setPicked([...defaults])}>
            {t(locale, 'records.columns.reset')}
          </Button>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t(locale, 'records.cancel')}
          </Button>
          <Button onClick={() => onApply(ordered(picked))}>{t(locale, 'records.columns.apply')}</Button>
        </>
      }
    >
      <fieldset className="grid gap-1 sm:grid-cols-2">
        <legend className="sr-only">{t(locale, 'records.columns.title')}</legend>
        {listable.map((c) => (
          <Checkbox
            key={c}
            id={`${base}-${c}`}
            label={fieldLabel(locale, def, c)}
            checked={picked.includes(c)}
            // At least one column stays on.
            disabled={picked.length === 1 && picked.includes(c)}
            onChange={(on) =>
              setPicked((prev) => (on ? [...prev, c] : prev.filter((x) => x !== c)))
            }
          />
        ))}
      </fieldset>
    </Modal>
  );
}

function SaveViewDialog({
  def,
  open,
  onOpenChange,
  existing,
  canShare,
  query,
  columns,
  onSaved,
}: {
  def: RecordTypeDef;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existing: SavedView | undefined;
  canShare: boolean;
  query: { filters: readonly ListFilterInput[]; sort: readonly SortKey[]; q: string };
  columns: readonly string[];
  onSaved: (view: SavedView) => void;
}) {
  const { client, locale } = useRecords();
  const base = useId();
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'roles'>('private');
  const [roles, setRoles] = useState<RoleId[]>([]);
  const [errors, setErrors] = useState<{ name?: string; roles?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(existing?.name ?? '');
    setVisibility(existing?.visibility ?? 'private');
    setRoles((existing?.sharedRoles ?? []).filter((r): r is RoleId => (ROLE_IDS as readonly string[]).includes(r)));
    setErrors({});
    setFailure(null);
  }, [open, existing]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!name.trim()) errs.name = t(locale, 'records.views.nameRequired');
    if (visibility === 'roles' && roles.length === 0) errs.roles = t(locale, 'records.views.rolesRequired');
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    const stored = {
      filters: query.filters.map((f) => ({
        field: f.field,
        op: f.op,
        value: typeof f.value === 'string' ? f.value : [...f.value],
      })),
      sort: query.sort.map((s) => ({ ...s })),
      q: query.q || null,
    };
    const body = {
      name: name.trim(),
      visibility,
      ...(visibility === 'roles' ? { sharedRoles: roles } : { sharedRoles: [] }),
      query: stored,
      columns: [...columns],
    };
    setBusy(true);
    const res = existing
      ? await client.updateView(def.id, existing.id, existing.rowVersion, body)
      : await client.createView(def.id, body);
    setBusy(false);
    if (res.ok) onSaved(res.data);
    else setFailure(mutationFailure(locale, res));
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t(locale, 'records.views.saveTitle')}
      description={t(locale, 'records.views.saveBody')}
      closeLabel={t(locale, 'records.close')}
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {failure && (
          <Alert tone="critical" title={t(locale, 'records.form.problem')}>
            {failure}
          </Alert>
        )}
        <Input
          id={`${base}-name`}
          label={t(locale, 'records.views.name')}
          hint={t(locale, 'records.views.nameHint')}
          value={name}
          maxLength={80}
          error={errors.name}
          onChange={(e) => setName(e.target.value)}
        />
        {canShare && (
          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-semibold text-gray-900">{t(locale, 'records.views.visibility')}</legend>
            {(['private', 'roles'] as const).map((v) => (
              <label key={v} className="inline-flex min-h-10 items-center gap-2 text-sm text-gray-900">
                <input
                  type="radio"
                  name={`${base}-visibility`}
                  value={v}
                  checked={visibility === v}
                  onChange={() => setVisibility(v)}
                  className="focus-ring size-5 accent-navy-900"
                />
                {t(locale, v === 'private' ? 'records.views.private' : 'records.views.shared')}
              </label>
            ))}
            {visibility === 'roles' && (
              <div
                role="group"
                aria-label={t(locale, 'records.views.shared')}
                aria-describedby={errors.roles ? `${base}-roles-error` : undefined}
                className="grid gap-x-4 pl-7 sm:grid-cols-2"
              >
                {ROLE_IDS.map((r) => (
                  <Checkbox
                    key={r}
                    id={`${base}-role-${r}`}
                    label={t(locale, `role.${r}.name`)}
                    checked={roles.includes(r)}
                    onChange={(on) => setRoles((prev) => (on ? [...prev, r] : prev.filter((x) => x !== r)))}
                  />
                ))}
                {errors.roles && (
                  <p id={`${base}-roles-error`} className="text-sm text-status-critical-text sm:col-span-2">
                    {errors.roles}
                  </p>
                )}
              </div>
            )}
          </fieldset>
        )}
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            {t(locale, 'records.cancel')}
          </Button>
          <Button type="submit" loading={busy} loadingLabel={t(locale, 'records.form.saving')}>
            {t(locale, existing ? 'records.views.update' : 'records.views.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function BulkEditDialog({
  def,
  field,
  open,
  onOpenChange,
  items,
  onDone,
}: {
  def: RecordTypeDef;
  field: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: readonly RecordView[];
  onDone: (res: BulkResponse) => void;
}) {
  const { client, locale } = useRecords();
  const base = useId();
  const f = def.fields[field] as FieldDef;
  const label = fieldLabel(locale, def, field);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const v = value.trim() === '' ? (f.nullable ? null : '') : value.trim();
    const parsed = bulkUpdateSchema(def).safeParse({ [field]: v });
    if (!parsed.success) {
      setError(t(locale, f.kind === 'enum' || f.kind === 'uuid' ? 'records.validation.choose' : 'records.validation.required', { field: label }));
      return;
    }
    setError(undefined);
    setBusy(true);
    const res = await client.bulk(def.id, {
      action: 'update',
      items: items.map((r) => ({ id: r.id, rowVersion: r.rowVersion ?? 1 })),
      fields: { [field]: v },
    });
    setBusy(false);
    if (res.ok) {
      setValue('');
      onDone(res.data);
    } else setFailure(mutationFailure(locale, res));
  }

  const target = refTarget(def, field);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t(locale, 'records.bulk.changeTitle', { field: label, count: items.length })}
      closeLabel={t(locale, 'records.close')}
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {failure && (
          <Alert tone="critical" title={t(locale, 'records.form.problem')}>
            {failure}
          </Alert>
        )}
        {f.kind === 'enum' ? (
          <Select id={`${base}-v`} label={label} value={value} error={error} onChange={(e) => setValue(e.target.value)}>
            <option value="">{t(locale, 'records.form.choose')}</option>
            {(f.values ?? []).map((v) => (
              <option key={v} value={v}>
                {enumLabel(locale, def, field, v)}
              </option>
            ))}
          </Select>
        ) : target ? (
          <RefSelect
            id={`${base}-v`}
            type={target}
            label={label}
            value={value}
            error={error}
            onChange={setValue}
            emptyLabel={t(locale, f.nullable ? 'records.form.none' : 'records.form.choose')}
          />
        ) : (
          <Input id={`${base}-v`} label={label} value={value} error={error} onChange={(e) => setValue(e.target.value)} />
        )}
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            {t(locale, 'records.cancel')}
          </Button>
          <Button type="submit" loading={busy} loadingLabel={t(locale, 'records.form.saving')}>
            {t(locale, 'records.bulk.apply')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function BulkArchiveDialog({
  def,
  open,
  onOpenChange,
  items,
  onDone,
}: {
  def: RecordTypeDef;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: readonly RecordView[];
  onDone: (res: BulkResponse) => void;
}) {
  const { client, locale } = useRecords();
  const base = useId();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!reason.trim()) {
      setError(t(locale, 'records.archive.reasonRequired'));
      return;
    }
    setError(undefined);
    setBusy(true);
    const res = await client.bulk(def.id, {
      action: 'archive',
      items: items.map((r) => ({ id: r.id, rowVersion: r.rowVersion ?? 1 })),
      reason: reason.trim(),
    });
    setBusy(false);
    if (res.ok) {
      setReason('');
      onDone(res.data);
    } else setFailure(mutationFailure(locale, res));
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t(locale, 'records.bulk.archiveTitle', { count: items.length })}
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
          <Button type="submit" variant="danger" loading={busy} loadingLabel={t(locale, 'records.form.saving')}>
            {t(locale, 'records.archive.submit')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

