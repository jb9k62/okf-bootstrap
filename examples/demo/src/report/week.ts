// The weekly report's week: Monday 00:00 to Sunday 23:59:59.999 on the UTC clock (ADR-0002).

/** The Monday 00:00 UTC that starts the week `date` falls in. */
export function weekStartUtc(date: Date): Date {
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysSinceMonday));
}
