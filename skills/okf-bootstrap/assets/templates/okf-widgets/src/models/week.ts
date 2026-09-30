/**
 * The ISO week on the UTC clock, and the time zone helpers the utc-week widget draws with.
 *
 * An example of the pattern every model follows: pure functions, no I/O, pinned by a test.
 * When the real logic lives somewhere the browser cannot run it (SQL, a server, another
 * language), a widget uses a model like this one, says on screen that it is a model, and a
 * test pins the model to the same cases as the real code's tests.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** The Monday (ISO 8601) that starts the UTC week holding `instantMs`, as `YYYY-MM-DD`. */
export function weekStartUtc(instantMs: number): string {
  const date = new Date(instantMs);
  const midnight = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
  // getUTCDay: Sunday 0 .. Saturday 6. Days since Monday: Monday 0 .. Sunday 6.
  const sinceMonday = (date.getUTCDay() + 6) % 7;
  return new Date(midnight - sinceMonday * DAY_MS).toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` to the UTC midnight that starts it, in milliseconds. */
export function utcMidnight(dateString: string): number {
  return Date.parse(`${dateString}T00:00:00.000Z`);
}

export function addDays(dateString: string, days: number): string {
  return new Date(utcMidnight(dateString) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Spelled out rather than Intl: ICU versions disagree on "Sep" and "Sept".
function dayMonth(dateString: string): string {
  const date = new Date(utcMidnight(dateString));
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

/** "Mon 14 Sep to Sun 20 Sep" for the week starting `weekStart`. */
export function weekLabel(weekStart: string): string {
  return `${dayMonth(weekStart)} to ${dayMonth(addDays(weekStart, 6))}`;
}

/**
 * The zone's offset from UTC at an instant, in milliseconds (Johannesburg gives +2 hours).
 * Built from Intl so daylight saving is right without a time zone library.
 */
export function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(instantMs));
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour'),
    value('minute'),
    value('second'),
  );
  // Whole seconds only: formatToParts has no milliseconds.
  return asUtc - (instantMs - (instantMs % 1000));
}

/** The instant at which a local calendar day starts in `timeZone`. */
export function localMidnight(dateString: string, timeZone: string): number {
  const guess = utcMidnight(dateString);
  const first = guess - zoneOffsetMs(guess, timeZone);
  // One refinement covers a day on which the offset changes (daylight saving).
  return guess - zoneOffsetMs(first, timeZone);
}

/** The local calendar date of an instant in `timeZone`, as `YYYY-MM-DD`. */
export function localDate(instantMs: number, timeZone: string): string {
  return new Date(instantMs + zoneOffsetMs(instantMs, timeZone))
    .toISOString()
    .slice(0, 10);
}
