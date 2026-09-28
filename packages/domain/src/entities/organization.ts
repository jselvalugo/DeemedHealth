import { z } from 'zod';
import {
  FloridaState,
  FloridaTimeZone,
  IsoDate,
  RecordMeta,
  TenantScoped,
  Uuid,
  validRange,
} from '../primitives.js';

/**
 * Award type and sub-programs use the requirements catalog's values
 * (`packages/requirements-catalog` `AwardType`, `SubProgram`) so applicability
 * matching needs no mapping. The ERD's `section_330 | look_alike` spelling is
 * aligned to these in S2.
 */
export const AwardType = z.enum(['section330', 'lookalike']);
export type AwardType = z.infer<typeof AwardType>;
export const SubProgram = z.enum(['CHC', 'MHC', 'HCH', 'PHPC']);
export type SubProgram = z.infer<typeof SubProgram>;

/** The tenant. `id` is the `organization_id` on every tenant row (ADR-0011). */
export const Organization = z
  .object({
    id: Uuid,
    legalName: z.string().trim().min(1).max(200),
    awardType: AwardType,
    subPrograms: z.array(SubProgram),
    grantNumber: z.string().trim().min(1).nullable(),
    timeZone: FloridaTimeZone,
    /** FL-D3: turns on public-records (FL-SUNSHINE) handling. */
    isPublicAgency: z.boolean(),
    state: FloridaState,
  })
  .merge(RecordMeta)
  .strict();
export type Organization = z.infer<typeof Organization>;

/** Form 5B site categories, same values as the catalog `SiteType`. */
export const SiteType = z.enum([
  'service_delivery',
  'administrative',
  'mobile',
  'intermittent',
  'seasonal',
  'other',
]);
export type SiteType = z.infer<typeof SiteType>;

/** A site's own fields (the record type `site` picks its editable fields from these). */
export const SiteFields = z.object({
  name: z.string().trim().min(1).max(200),
  form5bSiteId: z.string().trim().min(1).max(40).nullable(),
  siteType: SiteType,
  addressLine1: z.string().trim().min(1).max(200),
  addressLine2: z.string().trim().min(1).max(200).nullable(),
  city: z.string().trim().min(1).max(100),
  state: FloridaState,
  postalCode: z.string().regex(/^\d{5}(-\d{4})?$/, 'Expected a ZIP or ZIP+4'),
  timeZone: FloridaTimeZone,
  validFrom: IsoDate,
  validTo: IsoDate.nullable(),
});

export const Site = TenantScoped.extend({ id: Uuid, ...SiteFields.shape })
  .merge(RecordMeta)
  .strict()
  .refine(validRange, { message: 'validTo must be on or after validFrom', path: ['validTo'] });
export type Site = z.infer<typeof Site>;
