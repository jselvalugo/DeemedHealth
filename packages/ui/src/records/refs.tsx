'use client';

/**
 * References between records (an owner, a site, an account). The API returns ids; the
 * UI shows the referenced record's title when the viewer may read it, and a short id
 * otherwise. Titles are fetched through the same client (so the same permissions apply)
 * and cached for the page view.
 */
import { getRecordType, isRecordTypeId } from '@deemed/domain';
import { t } from '@deemed/i18n';
import { useEffect, useState } from 'react';
import { recordNav } from '../module-registry.js';
import { textLinkClasses } from '../components/scaffolds.js';
import { Select } from '../components/controls.js';
import { Input } from '../components/Input.js';
import { useRecords, type RecordsContextValue } from './client.js';
import { recordTitle, shortId } from './format.js';

export function recordHref(type: string, id: string): string | null {
  const nav = recordNav(type);
  if (!nav) return null;
  return `${nav.listRoute === '/' ? '' : nav.listRoute}/${id}`;
}

function titleOf(ctx: RecordsContextValue, type: string, id: string): Promise<string | null> {
  const key = `${type}:${id}`;
  let p = ctx.refTitles.get(key);
  if (!p) {
    p = ctx.client.get(type, id).then((res) => {
      if (!res.ok || !isRecordTypeId(type)) return null;
      return recordTitle(ctx.locale, getRecordType(type), res.data.record.fields);
    });
    ctx.refTitles.set(key, p);
  }
  return p;
}

/** The title of a referenced record, or null while loading or when it can't be read. */
export function useRefTitle(type: string, id: string): string | null | undefined {
  const ctx = useRecords();
  const [title, setTitle] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void titleOf(ctx, type, id).then((v) => live && setTitle(v));
    return () => {
      live = false;
    };
  }, [ctx, type, id]);
  return title;
}

/** The title of a referenced record, linked to its page; a short id when unreadable. */
export function RefValue({ type, id }: { type: string; id: string }) {
  const { Link, locale } = useRecords();
  const title = useRefTitle(type, id);
  const href = recordHref(type, id);
  if (!title || !href) {
    return (
      <span className="font-mono text-sm text-gray-700">
        {t(locale, 'records.value.shortId', { id: shortId(id) })}
      </span>
    );
  }
  return (
    <Link href={href} className={textLinkClasses}>
      {title}
    </Link>
  );
}

/** A referenced record's title as plain text (for use inside another link). */
export function RefText({ type, id }: { type: string; id: string }) {
  const { locale } = useRecords();
  const title = useRefTitle(type, id);
  return <>{title ?? t(locale, 'records.value.shortId', { id: shortId(id) })}</>;
}

type Option = { id: string; title: string };

/**
 * A select of records of another type (owner, site). Falls back to a plain ID input
 * when the viewer cannot list that type.
 */
export function RefSelect({
  id,
  type,
  label,
  value,
  onChange,
  error,
  hint,
  requiredText,
  emptyLabel,
}: {
  id: string;
  type: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  hint?: string | undefined;
  requiredText?: string | undefined;
  /** Text of the empty option ("None", "Any", "All sites"). */
  emptyLabel: string;
}) {
  const ctx = useRecords();
  const [options, setOptions] = useState<Option[] | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    if (!isRecordTypeId(type)) return;
    const def = getRecordType(type);
    void ctx.client
      .list(type, {
        filters: [],
        sort: def.list.defaultSort.map((s) => ({ field: s.field, dir: s.dir })),
        q: '',
        limit: 200,
        cursor: null,
        archived: 'exclude',
      })
      .then((res) => {
        if (!live) return;
        setOptions(
          res.ok
            ? res.data.items.map((r) => ({
                id: r.id,
                title: recordTitle(ctx.locale, def, r.fields),
              }))
            : null,
        );
      });
    return () => {
      live = false;
    };
  }, [ctx, type]);

  if (options === null || !isRecordTypeId(type)) {
    return (
      <Input
        id={id}
        label={label}
        hint={hint ?? t(ctx.locale, 'records.filters.idHint')}
        error={error}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        spellCheck={false}
      />
    );
  }
  const known = options?.some((o) => o.id === value) ?? false;
  return (
    <Select
      id={id}
      label={label}
      hint={hint}
      error={error}
      requiredText={requiredText}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-busy={options === undefined || undefined}
    >
      <option value="">{emptyLabel}</option>
      {value && !known && (
        <option value={value}>
          {t(ctx.locale, 'records.value.shortId', { id: shortId(value) })}
        </option>
      )}
      {(options ?? []).map((o) => (
        <option key={o.id} value={o.id}>
          {o.title}
        </option>
      ))}
    </Select>
  );
}
