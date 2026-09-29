/**
 * Display helpers for records: labels, titles, value formatting, lifecycle badge tones,
 * and references between record types. Pure (no React), so the demo adapter and tests
 * use them too. Dates follow the design system and CLAUDE.md: calendar dates are shown
 * as they are (no zone), instants in the health center's time zone.
 */
import {
  fieldLabelKey,
  isMasked,
  recordNameKey,
  type FieldValue,
  type Permission,
  type RecordTypeDef,
} from '@deemed/domain';
import { isMessageKey, t, type Locale, type MessageKey } from '@deemed/i18n';
import { parseInstant, type TimeZone } from '@deemed/dates';
import type { BadgeStatus } from '../components/Badge.js';
import type { PermissionSet } from '../module-registry.js';

export const LOCALE_TAGS: Record<Locale, string> = { en: 'en-US', es: 'es-US' };

export function fieldLabel(locale: Locale, def: RecordTypeDef, field: string): string {
  const key = fieldLabelKey(def.id, field);
  return isMessageKey(key) ? t(locale, key) : field;
}

export function typeName(locale: Locale, def: RecordTypeDef): string {
  const key = recordNameKey(def.id);
  return isMessageKey(key) ? t(locale, key) : def.noun;
}

export function typePlural(locale: Locale, def: RecordTypeDef): string {
  const key = `recordType.${def.id}.plural`;
  return isMessageKey(key) ? t(locale, key) : def.noun;
}

/** Label of an enum value: `recordValue.<type>.<field>.<value>`, role keys use role names. */
export function enumLabel(
  locale: Locale,
  def: RecordTypeDef,
  field: string,
  value: string,
): string {
  if (field === 'roleKey') {
    const role = `role.${value}.name`;
    if (isMessageKey(role)) return t(locale, role);
  }
  const key = `recordValue.${def.id}.${field}.${value}`;
  return isMessageKey(key) ? t(locale, key) : value;
}

/** Keys of every enum value label the registry needs (checked by a test in EN and ES). */
export function enumLabelKeys(def: RecordTypeDef): string[] {
  const keys: string[] = [];
  for (const [name, f] of Object.entries(def.fields)) {
    if (f.kind !== 'enum' || name === 'roleKey') continue;
    for (const v of f.values ?? []) keys.push(`recordValue.${def.id}.${name}.${v}`);
  }
  return keys;
}

/** Fields that name the record in headers, links, and dialogs. */
const TITLE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  site: ['name'],
  person: ['givenName', 'familyName'],
  user_account: ['loginEmail'],
  role_assignment: ['roleKey'],
  requirement_instance: ['requirementId'],
};

export function titleFields(def: RecordTypeDef): readonly string[] {
  return TITLE_FIELDS[def.id] ?? def.list.defaultColumns.slice(0, 1);
}

export function recordTitle(
  locale: Locale,
  def: RecordTypeDef,
  fields: Readonly<Record<string, FieldValue | undefined>>,
): string {
  const parts = titleFields(def)
    .map((f) => {
      const v = fields[f];
      if (typeof v !== 'string' || v === '') return '';
      return def.fields[f]?.kind === 'enum' ? enumLabel(locale, def, f, v) : v;
    })
    .filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : typeName(locale, def);
}

/** The field that holds the lifecycle state, if the type has one. */
export function statusField(def: RecordTypeDef): string | undefined {
  return def.lifecycle?.field;
}

const TONES: Readonly<Record<string, BadgeStatus>> = {
  met: 'ok',
  active: 'ok',
  due_soon: 'warn',
  suspended: 'warn',
  overdue: 'critical',
  missing: 'critical',
  invited: 'info',
  not_applicable: 'neutral',
  not_assessed: 'neutral',
  deprovisioned: 'neutral',
};

/** Badge tone of a lifecycle state (always shown with its icon and label). */
export function statusTone(value: string): BadgeStatus {
  return TONES[value] ?? 'neutral';
}

/** Fields that point at another record type, and which one. */
const REFS: Readonly<Record<string, string>> = {
  'user_account.personId': 'person',
  'role_assignment.userAccountId': 'user_account',
  'role_assignment.siteId': 'site',
  'requirement_instance.siteId': 'site',
  'requirement_instance.ownerPersonId': 'person',
};

/** The record type a uuid field refers to (the subject of a requirement depends on its kind). */
export function refTarget(
  def: RecordTypeDef,
  field: string,
  fields?: Readonly<Record<string, unknown>>,
): string | null {
  if (def.id === 'requirement_instance' && field === 'subjectId') {
    const kind = fields?.subjectType;
    return kind === 'site' ? 'site' : kind === 'person' ? 'person' : null;
  }
  return REFS[`${def.id}.${field}`] ?? null;
}

/** What an empty value means for this field ("All sites" for an unscoped grant). */
const EMPTY_TEXT: Readonly<Record<string, MessageKey>> = {
  'role_assignment.siteId': 'records.value.allSites',
  'requirement_instance.siteId': 'records.value.orgWide',
};

export function emptyText(locale: Locale, def: RecordTypeDef, field: string): string {
  return t(locale, EMPTY_TEXT[`${def.id}.${field}`] ?? 'records.value.empty');
}

/** `2028-02-29` → "Feb 29, 2028". A calendar date has no zone, so it is formatted as UTC. */
export function formatDate(locale: Locale, value: string): string {
  const [y, m, d] = [value.slice(0, 4), value.slice(5, 7), value.slice(8, 10)].map(Number);
  if (!y || !m || !d) return value;
  return new Intl.DateTimeFormat(LOCALE_TAGS[locale], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(Date.UTC(y, m - 1, d));
}

/** An ISO instant in the health center's zone, with the zone's abbreviation. */
export function formatInstant(locale: Locale, value: string, timeZone: TimeZone): string {
  let ms: number;
  try {
    ms = parseInstant(value);
  } catch {
    return value;
  }
  return new Intl.DateTimeFormat(LOCALE_TAGS[locale], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone,
  }).format(ms);
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

/** Plain-text display of a (non-masked) field value. */
export function formatValue(
  locale: Locale,
  def: RecordTypeDef,
  field: string,
  value: FieldValue | undefined,
  timeZone: TimeZone,
): string {
  if (value === null || value === undefined || value === '') return emptyText(locale, def, field);
  if (typeof value === 'object' && !Array.isArray(value)) return t(locale, 'records.value.masked');
  const kind = def.fields[field]?.kind;
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean')
    return t(locale, value ? 'records.value.yes' : 'records.value.no');
  if (typeof value === 'number') return new Intl.NumberFormat(LOCALE_TAGS[locale]).format(value);
  switch (kind) {
    case 'enum':
      return enumLabel(locale, def, field, value);
    case 'date':
      return formatDate(locale, value);
    case 'timestamp':
      return formatInstant(locale, value, timeZone);
    case 'uuid':
      return t(locale, 'records.value.shortId', { id: shortId(value) });
    default:
      return value;
  }
}

export function isMaskedField(def: RecordTypeDef, field: string): boolean {
  return isMasked(def, field);
}

function holds(perms: PermissionSet, p: Permission): boolean {
  return perms instanceof Set ? perms.has(p) : (perms as readonly Permission[]).includes(p);
}

/**
 * List-level actions to offer: New, bulk change and archive, the archived filter, and
 * sharing a saved view. They are HINTS scoped to the session (the role permissions the
 * API reported at sign-in), not decisions: the API checks every request again, per
 * record, and the record page uses the API's own `allowedActions`. An action the type
 * does not serve is never offered.
 */
export type ListActions = { create: boolean; update: boolean; archive: boolean; bulk: boolean };

export function listActionsFor(def: RecordTypeDef, perms: PermissionSet): ListActions {
  const has = (a: RecordTypeDef['actions'][number]) => def.actions.includes(a) && !def.readOnly;
  return {
    create: has('create') && holds(perms, def.access.create),
    update: has('update') && holds(perms, def.access.update),
    archive: has('archive') && holds(perms, def.access.archive),
    // Bulk change and bulk archive are the `bulk` route, which needs `update`.
    bulk: has('bulk') && holds(perms, def.access.update),
  };
}
