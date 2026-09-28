import { z } from 'zod';
import { IsoDate, Npi, RecordMeta, TenantScoped, Uuid, UtcTimestamp } from '../primitives.js';
import { RoleIdSchema } from '../permissions.js';

/**
 * A person known to the health center. Staff, provider, board member, and
 * contractor are roles of a person, held in temporal rows (`staff_assignment`,
 * `provider_profile`, `board_membership`, `contractor_contact`), not subtypes.
 *
 * There is no SSN field, now or later (decision D1). Persons are matched on
 * name, DOB, NPI, and license number. The schema is strict, so a payload that
 * carries an SSN (or any unknown key) is rejected rather than silently dropped.
 *
 * Field-encrypted values (DOB, home address) are not part of `Person`: they are
 * read only through an audited reveal (`PersonSensitive`, ADR-0007, ADR-0008 §4).
 */
export const PersonKind = z.enum(['staff', 'provider', 'board_member', 'contractor']);
export type PersonKind = z.infer<typeof PersonKind>;

/** A person's own editable fields (the record type `person` picks from these). No SSN (D1). */
export const PersonFields = z.object({
  givenName: z.string().trim().min(1).max(100),
  familyName: z.string().trim().min(1).max(100),
  preferredName: z.string().trim().min(1).max(100).nullable(),
  workEmail: z.string().max(254).email().nullable(),
  npi: Npi.nullable(),
});

export const Person = TenantScoped.extend({
  id: Uuid,
  ...PersonFields.shape,
  /** Current kinds, derived from open temporal rows; informational. */
  kinds: z.array(PersonKind),
  hasDob: z.boolean(),
  hasHomeAddress: z.boolean(),
  identityUserId: Uuid.nullable(),
  isTestRecord: z.boolean(),
})
  .merge(RecordMeta)
  .strict();
export type Person = z.infer<typeof Person>;

/** Clear-text sensitive fields, returned only by an audited reveal. */
export const PersonSensitive = z
  .object({
    personId: Uuid,
    dob: IsoDate.nullable(),
    homeAddress: z
      .object({
        line1: z.string().trim().min(1),
        line2: z.string().trim().min(1).nullable(),
        city: z.string().trim().min(1),
        state: z.string().length(2),
        postalCode: z.string().regex(/^\d{5}(-\d{4})?$/),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type PersonSensitive = z.infer<typeof PersonSensitive>;

/** Site scope for a role: every site, or a listed subset ("All roles can be limited to specific sites"). */
export const SiteScope = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }).strict(),
  z.object({ kind: z.literal('sites'), siteIds: z.array(Uuid).min(1) }).strict(),
]);
export type SiteScope = z.infer<typeof SiteScope>;

const AUDITOR_MAX_MS = 30 * 24 * 60 * 60 * 1000;

/** A role held by a user account, with site scope and (for auditors) an end date. ADR-0006 rule 7. */
export const RoleAssignment = TenantScoped.extend({
  id: Uuid,
  userAccountId: Uuid,
  personId: Uuid.nullable(),
  role: RoleIdSchema,
  siteScope: SiteScope,
  validFrom: UtcTimestamp,
  validTo: UtcTimestamp.nullable(),
  grantedBy: Uuid,
  grantedAt: UtcTimestamp,
})
  .strict()
  .superRefine((a, ctx) => {
    if (a.validTo !== null && Date.parse(a.validTo) <= Date.parse(a.validFrom)) {
      ctx.addIssue({
        code: 'custom',
        path: ['validTo'],
        message: 'validTo must be after validFrom',
      });
    }
    if (a.role === 'auditor') {
      if (a.validTo === null) {
        ctx.addIssue({
          code: 'custom',
          path: ['validTo'],
          message: 'auditor access needs an end date',
        });
      } else if (Date.parse(a.validTo) - Date.parse(a.validFrom) > AUDITOR_MAX_MS) {
        ctx.addIssue({
          code: 'custom',
          path: ['validTo'],
          message: 'auditor access is at most 30 days',
        });
      }
    }
  });
export type RoleAssignment = z.infer<typeof RoleAssignment>;
