/**
 * Audit actions derived from the registry (ADR-0014 section 2.9): `<type>.create`,
 * `.update`, `.archive`, `.restore`, `.import`, `.transition`, `.export`, and one
 * `<type>.reveal_<field>` per revealable field. The generator writes the ones not
 * already in the base list to `../generated/record-audit-actions.ts`, and a migration
 * seeds them into `audit.action_registry` (a db test keeps the two in step).
 */
import type { AuditCategory } from '../audit-actions.js';
import { toSnake, type RecordTypeDef } from './define.js';

export interface DerivedAuditAction {
  action: string;
  category: AuditCategory;
  description: string;
}

/** `<type>.reveal_<field_in_snake_case>`. */
export function revealAction(typeId: string, field: string): string {
  return `${typeId}.reveal_${toSnake(field)}`;
}

export function recordAuditActionsFor(def: RecordTypeDef): DerivedAuditAction[] {
  const out: DerivedAuditAction[] = [];
  const has = (a: RecordTypeDef['actions'][number]) => def.actions.includes(a);
  const add = (verb: string, category: AuditCategory, description: string) =>
    out.push({ action: `${def.id}.${verb}`, category, description });
  if (has('create')) add('create', 'mutation', `${def.noun} created`);
  if (has('update') || has('bulk')) add('update', 'mutation', `${def.noun} changed`);
  if (has('archive') || has('bulk')) add('archive', 'mutation', `${def.noun} archived`);
  if (has('restore')) add('restore', 'mutation', `${def.noun} restored`);
  if (def.lifecycle && def.lifecycle.transitions.length > 0) {
    add('transition', 'mutation', `${def.noun} status changed`);
  }
  if (has('import') && def.import.enabled) {
    add('import', 'mutation', `${def.noun} import run committed (summary event)`);
  }
  if (has('export')) add('export', 'export', `${def.noun} list exported`);
  if (has('reveal')) {
    for (const [name, f] of Object.entries(def.fields)) {
      if (!f.reveal) continue;
      out.push({
        action: revealAction(def.id, name),
        category: 'reveal',
        description: `${def.noun} ${toSnake(name).split('_').join(' ')} shown in clear text`,
      });
    }
  }
  return out;
}

export function recordAuditActions(types: readonly RecordTypeDef[]): DerivedAuditAction[] {
  return types.flatMap(recordAuditActionsFor);
}
