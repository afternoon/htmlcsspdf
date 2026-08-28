/**
 * "2 hours ago" from a timestamp.
 *
 * Uses Intl.RelativeTimeFormat rather than a date library: this is the only
 * date formatting in the app, so a dependency would be a poor trade — and the
 * platform localises the wording for free.
 */

const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

const DIVISIONS: Array<{ amount: number; unit: Intl.RelativeTimeFormatUnit }> = [
  { amount: 60, unit: "second" },
  { amount: 60, unit: "minute" },
  { amount: 24, unit: "hour" },
  { amount: 7, unit: "day" },
  { amount: 4.34524, unit: "week" },
  { amount: 12, unit: "month" },
  { amount: Number.POSITIVE_INFINITY, unit: "year" },
];

export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  let duration = (timestamp - now) / 1000;

  for (const { amount, unit } of DIVISIONS) {
    if (Math.abs(duration) < amount) {
      return formatter.format(Math.round(duration), unit);
    }
    duration /= amount;
  }

  // Unreachable: the last division is infinite.
  return formatter.format(Math.round(duration), "year");
}
