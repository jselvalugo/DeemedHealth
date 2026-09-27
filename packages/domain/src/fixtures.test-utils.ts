// Shared synthetic values for the domain unit tests. Not exported from the package.
export const ORG = '01920000-0000-7000-8000-000000000001';
export const OTHER_ORG = '01920000-0000-7000-8000-000000000002';
export const SITE = '01920000-0000-7000-8000-000000000010';
export const PERSON = '01920000-0000-7000-8000-000000000020';
export const USER = '01920000-0000-7000-8000-000000000030';
export const ID = (n: number) => `01920000-0000-7000-8000-${String(n).padStart(12, '0')}`;
export const TS = '2026-09-27T14:03:11.123456Z';
export const META = {
  createdAt: TS,
  createdBy: USER,
  updatedAt: TS,
  updatedBy: USER,
  archivedAt: null,
};
export const HASH = 'a'.repeat(64);
