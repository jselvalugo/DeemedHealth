/**
 * Stable error codes for @deemed/dates. Messages never echo the offending
 * value: a date on its own can be personal data (for example a birth date).
 */
export type DatesErrorCode =
  | 'DATES_INVALID_CALENDAR_DATE'
  | 'DATES_INVALID_INSTANT'
  | 'DATES_INVALID_TIME'
  | 'DATES_UNSUPPORTED_TIME_ZONE'
  | 'DATES_INVALID_ARGUMENT'
  | 'DATES_OUT_OF_RANGE'
  | 'DATES_NO_BUSINESS_DAY';

export class DatesError extends Error {
  readonly code: DatesErrorCode;

  constructor(code: DatesErrorCode, message: string) {
    super(message);
    this.name = 'DatesError';
    this.code = code;
  }
}

/** Throws `DATES_INVALID_ARGUMENT` unless `value` is an integer in [min, max]. */
export function assertInteger(value: number, name: string, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new DatesError(
      'DATES_INVALID_ARGUMENT',
      `${name} must be an integer between ${min} and ${max}.`,
    );
  }
}
