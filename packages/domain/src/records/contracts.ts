/**
 * HTTP contract of the generic record API (ADR-0014 section 2), shared by apps/api
 * (request validation) and apps/web (response parsing). Nothing here carries a
 * masked value in clear text except `RevealResponse`, which only the audited reveal
 * endpoint returns.
 */
import { z } from 'zod';
import { RoleIdSchema } from '../permissions.js';
import { containsSsnShape } from '../ssn-detector.js';
import { FILTER_OPS } from './query.js';

const Id = z.string().uuid();

/** A masked field until revealed: whether it holds a value, never the value. */
export const MaskedValue = z.object({ masked: z.literal(true), hasValue: z.boolean() }).strict();

export const FieldValue = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.string()),
  MaskedValue,
]);
export type FieldValue = z.infer<typeof FieldValue>;

export const RecordView = z.object({
  id: Id,
  /** Send as `If-Match: "<rowVersion>"` on every change. Null for unversioned types. */
  rowVersion: z.number().int().nullable(),
  archivedAt: z.string().nullable(),
  fields: z.record(FieldValue),
});
export type RecordView = z.infer<typeof RecordView>;

export const RecordListResponse = z.object({
  recordType: z.string(),
  items: z.array(RecordView),
  /** Opaque, signed, bound to this query and viewer; null on the last page. */
  nextCursor: z.string().nullable(),
  /** Rows matching the filters within the viewer's scope. */
  total: z.number().int().nonnegative(),
  limit: z.number().int(),
});
export type RecordListResponse = z.infer<typeof RecordListResponse>;

/** Actions the viewer may take on this record right now (the UI never decides access). */
export const RECORD_VIEWER_ACTIONS = ['update', 'archive', 'restore', 'history'] as const;

export const RecordGetResponse = z.object({
  recordType: z.string(),
  record: RecordView,
  allowedActions: z.array(z.enum(RECORD_VIEWER_ACTIONS)),
  /** Masked fields this viewer may reveal (step-up and a reason still required). */
  revealable: z.array(z.string()),
});
export type RecordGetResponse = z.infer<typeof RecordGetResponse>;

/**
 * Free text: 1 to 500 characters, never SSN-shaped (D1). Stored on the row; the audit log
 * keeps only its length and a keyed digest.
 */
const Reason = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((v) => !containsSsnShape(v), 'SSN-shaped text (D1)');

export const ArchiveRequest = z.object({ reason: Reason }).strict();
export type ArchiveRequest = z.infer<typeof ArchiveRequest>;

/** An optional reason for restoring; logged as its length and a keyed digest only. */
export const RestoreRequest = z.object({ reason: Reason.optional() }).strict();
export type RestoreRequest = z.infer<typeof RestoreRequest>;

/**
 * Why a masked value is revealed. The code is stored as the audit event's `reason`; the
 * optional note is free text and is logged only as its length and a keyed digest.
 */
export const REVEAL_REASON_CODES = [
  'exclusion_screening',
  'credentialing_verification',
  'records_request',
  'data_correction',
  'other',
] as const;

export const RevealRequest = z
  .object({ reasonCode: z.enum(REVEAL_REASON_CODES), note: Reason.optional() })
  .strict()
  .refine((r) => r.reasonCode !== 'other' || r.note !== undefined, {
    path: ['note'],
    message: 'explain "other"',
  });
export type RevealRequest = z.infer<typeof RevealRequest>;

export const RevealResponse = z.object({ field: z.string(), value: z.string().nullable() });
export type RevealResponse = z.infer<typeof RevealResponse>;

export const BULK_MAX_ITEMS = 500;

export const BulkItem = z.object({ id: Id, rowVersion: z.number().int().min(1) }).strict();

export const BulkRequest = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('update'),
      items: z.array(BulkItem).min(1).max(BULK_MAX_ITEMS),
      fields: z.record(z.unknown()),
    })
    .strict(),
  z
    .object({
      action: z.literal('archive'),
      items: z.array(BulkItem).min(1).max(BULK_MAX_ITEMS),
      reason: Reason,
    })
    .strict(),
]);
export type BulkRequest = z.infer<typeof BulkRequest>;

export const BULK_ROW_STATUSES = [
  'updated',
  'archived',
  'not_found',
  'forbidden',
  'version_conflict',
  'archived_already',
  'blocked',
  'invalid',
] as const;
export type BulkRowStatus = (typeof BULK_ROW_STATUSES)[number];

export const BulkResponse = z.object({
  bulkId: Id,
  results: z.array(
    z.object({
      id: Id,
      status: z.enum(BULK_ROW_STATUSES),
      rowVersion: z.number().int().optional(),
      fields: z.array(z.string()).optional(),
    }),
  ),
});
export type BulkResponse = z.infer<typeof BulkResponse>;

export const HistoryEvent = z.object({
  id: Id,
  occurredAt: z.string(),
  category: z.string(),
  action: z.string(),
  outcome: z.string(),
  actorType: z.string(),
  actorLabel: z.string(),
  /** The stored, redacted diff (ADR-0008 section 5): columns, never protected values. */
  diff: z.unknown().nullable(),
  metadata: z.record(z.unknown()),
  reason: z.string().nullable(),
});
export type HistoryEvent = z.infer<typeof HistoryEvent>;

export const HistoryResponse = z.object({
  recordType: z.string(),
  id: Id,
  items: z.array(HistoryEvent),
  nextCursor: z.string().nullable(),
});
export type HistoryResponse = z.infer<typeof HistoryResponse>;

export const EXPORT_MAX_ROWS = 1000;

/** `query` takes the list query-string parameters (filters, sort, q, archived, view). */
export const ExportRequest = z
  .object({
    format: z.literal('csv'),
    query: z.record(z.string().max(512)).default({}),
    columns: z.array(z.string().max(64)).max(50).optional(),
  })
  .strict();
export type ExportRequest = z.infer<typeof ExportRequest>;

export const IMPORT_MAX_ROWS = 5000;

export const ImportDryRunRequest = z.object({ csv: z.string().min(1).max(200_000) }).strict();
export type ImportDryRunRequest = z.infer<typeof ImportDryRunRequest>;

export const IMPORT_COLUMN_STATUSES = [
  'mapped',
  'ignored',
  'blocked_ssn',
  'confirm_not_ssn',
] as const;
export const IMPORT_ROW_ACTIONS = ['create', 'update', 'error'] as const;

export const ImportDryRunReport = z.object({
  recordType: z.string(),
  dryRun: z.literal(true),
  fileSha256: z.string(),
  /** The file is refused as a whole (for example an SSN-like column, decision D1). */
  refused: z
    .enum(['ssn_column', 'no_rows', 'bad_csv', 'too_many_rows', 'no_mapped_columns'])
    .nullable(),
  columns: z.array(
    z.object({
      header: z.string(),
      field: z.string().nullable(),
      status: z.enum(IMPORT_COLUMN_STATUSES),
    }),
  ),
  summary: z.object({
    create: z.number().int(),
    update: z.number().int(),
    error: z.number().int(),
  }),
  rows: z.array(
    z.object({
      /** 1-based data row (the header is row 0). */
      row: z.number().int(),
      action: z.enum(IMPORT_ROW_ACTIONS),
      /** Record that the row would update. */
      id: Id.optional(),
      /** Field paths and error codes; never the cell values. */
      errors: z.array(z.object({ field: z.string(), code: z.string() })),
    }),
  ),
});
export type ImportDryRunReport = z.infer<typeof ImportDryRunReport>;

export const SavedViewQuery = z
  .object({
    filters: z
      .array(
        z
          .object({
            field: z.string().max(64),
            op: z.enum(FILTER_OPS),
            value: z.union([z.string().max(200), z.array(z.string().max(200)).max(50)]),
          })
          .strict(),
      )
      .max(20),
    sort: z
      .array(z.object({ field: z.string().max(64), dir: z.enum(['asc', 'desc']) }).strict())
      .max(3),
    q: z.string().max(200).nullable().optional(),
  })
  .strict();
export type SavedViewQuery = z.infer<typeof SavedViewQuery>;

const ViewName = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((v) => !containsSsnShape(v), 'SSN-shaped text (D1)');

export const SavedViewCreate = z
  .object({
    name: ViewName,
    visibility: z.enum(['private', 'roles']),
    sharedRoles: z.array(RoleIdSchema).max(10).optional(),
    query: SavedViewQuery,
    columns: z.array(z.string().max(64)).max(50).optional(),
  })
  .strict();
export type SavedViewCreate = z.infer<typeof SavedViewCreate>;

export const SavedViewUpdate = z
  .object({
    name: ViewName.optional(),
    visibility: z.enum(['private', 'roles']).optional(),
    sharedRoles: z.array(RoleIdSchema).max(10).optional(),
    query: SavedViewQuery.optional(),
    columns: z.array(z.string().max(64)).max(50).optional(),
    /** Removes the view (soft delete). */
    archived: z.literal(true).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to change' });
export type SavedViewUpdate = z.infer<typeof SavedViewUpdate>;

/**
 * A saved view's query as returned. The owner sees it whole; anyone else sees a shared
 * view's fields and operators only (no values, no search text).
 */
export const SavedViewQueryView = z.object({
  filters: z.array(
    z.object({
      field: z.string(),
      op: z.enum(FILTER_OPS),
      value: z.union([z.string(), z.array(z.string())]).optional(),
    }),
  ),
  sort: z.array(z.object({ field: z.string(), dir: z.enum(['asc', 'desc']) })),
  q: z.string().nullable().optional(),
});
export type SavedViewQueryView = z.infer<typeof SavedViewQueryView>;

export const SavedView = z.object({
  id: Id,
  recordType: z.string(),
  name: z.string(),
  visibility: z.enum(['private', 'roles']),
  sharedRoles: z.array(z.string()),
  query: SavedViewQueryView,
  columns: z.array(z.string()),
  rowVersion: z.number().int(),
  /** The viewer owns the view (and may change it). */
  owned: z.boolean(),
});
export type SavedView = z.infer<typeof SavedView>;

export const SavedViewListResponse = z.object({ items: z.array(SavedView) });
export type SavedViewListResponse = z.infer<typeof SavedViewListResponse>;
