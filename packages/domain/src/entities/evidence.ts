import { z } from 'zod';
import { IsoDate, RecordMeta, Sha256Hex, TenantScoped, Uuid, UtcTimestamp } from '../primitives.js';
import { organizationObjectPrefix } from '../tenancy.js';

/** A piece of evidence; its content lives in immutable versions. */
export const Evidence = TenantScoped.extend({
  id: Uuid,
  title: z.string().trim().min(1).max(300),
  evidenceType: z.string().regex(/^[a-z][a-z0-9_]*$/, 'Expected a snake_case evidence type'),
  currentVersionId: Uuid.nullable(),
  legalHold: z.boolean(),
})
  .merge(RecordMeta)
  .strict();
export type Evidence = z.infer<typeof Evidence>;

export const EvidenceSource = z.enum(['upload', 'integration', 'attestation']);
export type EvidenceSource = z.infer<typeof EvidenceSource>;

/**
 * One immutable version of an evidence item. Never updated; a change is a new
 * version. The object key must sit under the owning organization's prefix.
 */
export const EvidenceVersion = TenantScoped.extend({
  id: Uuid,
  evidenceId: Uuid,
  versionNo: z.number().int().min(1),
  objectKey: z.string().min(1).nullable(),
  sha256: Sha256Hex.nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  mimeType: z.string().min(1).nullable(),
  /** Structured values extracted or entered (e.g. license number, expiry). */
  structuredFields: z.record(z.string(), z.unknown()),
  source: EvidenceSource,
  sourceRef: Uuid.nullable(),
  validFrom: IsoDate.nullable(),
  validTo: IsoDate.nullable(),
  submittedBy: Uuid.nullable(),
  createdAt: UtcTimestamp,
})
  .strict()
  .superRefine((v, ctx) => {
    if (v.objectKey !== null) {
      if (!v.objectKey.startsWith(organizationObjectPrefix(v.organizationId))) {
        ctx.addIssue({
          code: 'custom',
          path: ['objectKey'],
          message: "objectKey must be under the organization's prefix",
        });
      }
      for (const f of ['sha256', 'sizeBytes', 'mimeType'] as const) {
        if (v[f] === null) {
          ctx.addIssue({ code: 'custom', path: [f], message: `${f} is required with a file` });
        }
      }
    }
    if (v.validFrom !== null && v.validTo !== null && v.validTo < v.validFrom) {
      ctx.addIssue({ code: 'custom', path: ['validTo'], message: 'validTo before validFrom' });
    }
  });
export type EvidenceVersion = z.infer<typeof EvidenceVersion>;

/** Temporal link: which evidence supported which requirement instance, and when. */
export const EvidenceRequirementLink = TenantScoped.extend({
  evidenceVersionId: Uuid,
  requirementInstanceId: Uuid,
  linkedFrom: IsoDate,
  linkedTo: IsoDate.nullable(),
})
  .strict()
  .refine((l) => l.linkedTo === null || l.linkedTo >= l.linkedFrom, {
    message: 'linkedTo before linkedFrom',
    path: ['linkedTo'],
  });
export type EvidenceRequirementLink = z.infer<typeof EvidenceRequirementLink>;
