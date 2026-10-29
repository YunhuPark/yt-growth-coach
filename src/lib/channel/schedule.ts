import type { Weekly } from "../shared/store";

/** The most recent scheduled moment (this computer's local time) at or before `now`. */
export function lastDue(now: Date, day: number, hour: number): Date {
  const d = new Date(now);
  d.setHours(hour, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() - day + 7) % 7)); // back to the scheduled weekday
  if (d.getTime() > now.getTime()) d.setDate(d.getDate() - 7); // it is that weekday, but the hour hasn't come yet
  return d;
}

/** The next scheduled moment after `now`. */
export function nextDue(now: Date, day: number, hour: number): Date {
  const next = lastDue(now, day, hour);
  next.setDate(next.getDate() + 7);
  return next;
}

/**
 * True when a scheduled moment has passed since the last run (or since the schedule was switched on).
 * Because it compares against the last scheduled moment rather than "right now", a computer that was off at the
 * scheduled time still runs the job as soon as the app starts, but at most once per week.
 */
export function isDue(now: Date, lastRunAt: string | undefined, w: Weekly): boolean {
  if (!w.enabled) return false;
  const due = lastDue(now, w.day, w.hour).getTime();
  const reference = Math.max(lastRunAt ? Date.parse(lastRunAt) : 0, w.since ? Date.parse(w.since) : 0);
  return reference < due;
}

export const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"] as const;
