# @deemed/dates

The one place due-date, cadence, and time-zone math lives (ADR-0001, phase-1
plan S4). Every other package imports from here. **Never compute a due date
inline.**

## Model

| Concept | Type | Stored as | Notes |
| --- | --- | --- | --- |
| A point in time | `Instant` (branded epoch ms) | `timestamptz` (UTC) | Created, verified-at, approved-at, job run times |
| A day on the calendar | `CalendarDate` (branded `YYYY-MM-DD`) | `date` | Expiration dates, due dates, meeting dates. No zone. |
| Where "today" is | `TimeZone` | site / organization column | Only `America/New_York` and `America/Chicago` (Florida) |
| "Now" | `Clock` | n/a | Injected. `systemClock` is the only read of system time; tests use `fixedClock` |

Rules the API enforces:

- An ISO instant must carry `Z` or an explicit offset. A string without one is
  a wall-clock time, and the zone is never guessed.
- A calendar date is strict `YYYY-MM-DD`; `2027-02-29` is rejected, never rolled
  over to March 1.
- Something due or expiring on date D at a site is on time through the end of D
  **in that site's zone**, and late from local midnight starting D+1
  (`lapsesAt`). The same instant can be "due today" at a Central site and
  "overdue" at an Eastern one.
- A site's zone wins over the organization's (`effectiveTimeZone`).
- Errors are `DatesError` with a stable `code`; messages never echo the input
  (a date alone can be personal data).

## API at a glance

- **Calendar:** `parseCalendarDate`, `calendarDate`, `addDays`, `addMonths`
  (month-end clamping: Jan 31 + 1 month = Feb 28/29), `addYears`
  (2028-02-29 + 1 year = 2029-02-28), `differenceInDays`, `isoDayOfWeek`,
  `isLeapYear`, `daysInMonth`, `startOfMonth`, `endOfMonth`.
- **Instants and zones:** `parseInstant`, `formatInstant`, `toZonedDate`,
  `toZonedDateTime`, `zonedDateTimeToInstant` (DST resolved like Temporal's
  `'compatible'`: a skipped time moves forward, a repeated time takes the
  earlier instant), `startOfDayInZone`, `offsetMinutesAt`, `todayIn(clock, zone)`.
- **Cadence:** `cadence(every, unit)`, `nthOccurrence` / `occurrences` /
  `nextOccurrenceOnOrAfter` for anchored series (always computed from the
  anchor, so a Jan 31 monthly series returns to the 31st after February),
  `nextDueFromLastVerification(last, everyMonths)` for "every N months from the
  last verification" (re-anchors on the actual verification date).
- **Lead days:** `normalizeLeadDays`, `leadDaySchedule(due, [90, 60, 30, 0])`,
  `remindersDueThrough` (so a resumed job finds every reminder it owes; pair each
  with an idempotency key), `currentLeadTier`.
- **Business days:** `isWeekend`, `isBusinessDay`, `addBusinessDays`,
  `nextBusinessDayOnOrAfter`, `previousBusinessDayOnOrBefore`,
  `rollToBusinessDay` (`none` / `following` / `preceding`),
  `firstBusinessDayOfMonth`. Holidays are an injected `HolidayCalendar`; this
  package ships none, because which holidays a health center observes is its
  own data.
- **Due status:** `evaluateDueOnDate` (for "as of" reports that name a date) and
  `evaluateDueAt(due, instant, zone, { atRiskDays })`, returning `not_due`,
  `at_risk`, `due_today`, or `overdue` with `daysUntilDue`; `lapsesAt`,
  `isExpiredAt`. Mapping these to readiness statuses is the readiness engine's
  job, driven by catalog parameters.

## Library choice: none (runtime `Intl` only)

We evaluated `date-fns` + `date-fns-tz`, `@js-temporal/polyfill`, and
`temporal-polyfill`, and chose no runtime dependency:

1. **The hard part is small and pure.** Calendar arithmetic (month-end clamping,
   leap years, day counts, weekdays) is integer math on a `YYYY-MM-DD` value
   (Hinnant's epoch-day algorithms). No `Date` object is involved, so the host
   time zone cannot leak in. The test suite checks it against the ECMAScript
   UTC calendar for every day from 1899 to 2101.
2. **Zone rules already ship with the runtime.** The two supported zones need
   only the UTC offset at an instant, which `Intl.DateTimeFormat` gives from the
   runtime's IANA data (Node 22 is built with full ICU). The Node version is
   pinned by `.nvmrc`, and the tests pin every 2026 and 2028 DST switch instant
   in both zones, so a tzdata regression fails CI.
3. **`date-fns-tz` works on `Date`**, which has no date-only type and carries
   host-zone behavior; we would still write the date-only, clamping,
   lead-day, and business-day logic ourselves, plus guard every call site.
4. **Temporal is the right long-term model but not yet native in Node 22 LTS.**
   The polyfills are large for `apps/web` (which may import this package) and
   add a dependency to audit and pin for math we can prove with tests. The API
   here deliberately mirrors Temporal (`PlainDate` ≈ `CalendarDate`, `Instant`,
   `'compatible'` disambiguation, clamping `add`), so the internals can switch
   to native Temporal later without changing callers.
5. **100% branch coverage is enforceable** on code we own end to end.

## Guardrails

- ESLint (root config) forbids `new Date()`, `Date.now()`, and host-local
  `Date` getters/setters in `packages/dates/src` outside `clock.ts`.
- `vitest.config.ts` enforces 100% statements, branches, functions, and lines;
  the root `pnpm test` runs `test:coverage` for this package.
- The suite is host-zone independent; run it under `TZ=UTC` and
  `TZ=Pacific/Kiritimati` (test strategy §5) to confirm.

## Tests

`src/fx-date.test.ts` runs the FX-DATE-* fixtures from `docs/qa/fixture-plan.md`
§4 (FEB29, MONTHEND, TZ-E, TZ-C, DST) against the public entry point, with
synthetic sites XYZ-S1 (Eastern) and XYZ-S3 (Central). The other test files cover
each module, including DST gaps and overlaps in both zones and the 2028 leap
year.

```sh
pnpm --filter @deemed/dates test:coverage
TZ=Pacific/Kiritimati pnpm --filter @deemed/dates test
```
