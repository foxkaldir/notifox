import { Temporal } from '@js-temporal/polyfill';
import type {
  Anchor, Diagnostic, DiscoveredTask, Interval, LocalTime, ReminderField, ResolvedReminder,
  ResolverSettings, TaskDates
} from './types';

function selectedDate(dates: TaskDates, anchor?: Anchor): string | undefined {
  if (anchor) return dates[anchor];
  return dates.due ?? dates.scheduled ?? dates.start;
}

export function resolutionDiagnostic(field: ReminderField, task: DiscoveredTask): Diagnostic | undefined {
  const requestedAnchors = [
    ...field.oneShots.map((clause) => clause.anchor),
    field.repeat && typeof field.repeat.seed === 'object' ? field.repeat.anchor : undefined
  ].filter((anchor): anchor is Anchor => anchor !== undefined);
  if (requestedAnchors.some((anchor) => !task.dates[anchor])) {
    return {
      code: Object.values(task.dates).some(Boolean) ? 'MISSING_ANCHOR_DATE' : 'NO_VALID_DATE',
      message: 'The task is missing a date required by the reminder field.'
    };
  }
  const needsDefaultAnchor = field.oneShots.some((clause) => !clause.anchor)
    || field.oneShots.length === 0
    || Boolean(field.repeat && typeof field.repeat.seed === 'object' && !field.repeat.anchor);
  if (needsDefaultAnchor && !selectedDate(task.dates)) {
    return { code: 'NO_VALID_DATE', message: 'The task has no valid reminder date.' };
  }
  return undefined;
}

function localDateTime(date: string, time: LocalTime, timeZone: string): Temporal.ZonedDateTime {
  const parsed = Temporal.PlainDate.from(date);
  const wanted = Temporal.PlainDateTime.from({
    year: parsed.year,
    month: parsed.month,
    day: parsed.day,
    hour: time.hour,
    minute: time.minute,
    second: time.second
  });
  const resolve = (value: Temporal.PlainDateTime, disambiguation: 'compatible' | 'reject') => Temporal.ZonedDateTime.from({
    timeZone,
    year: value.year,
    month: value.month,
    day: value.day,
    hour: value.hour,
    minute: value.minute,
    second: value.second
  }, { disambiguation });
  const compatible = resolve(wanted, 'compatible');
  if (compatible.toPlainDateTime().equals(wanted)) return compatible;
  // Temporal's compatible mode retains the minutes in a DST gap (02:30 → 03:30).
  // Notifox policy instead selects the first valid wall-clock time (02:30 → 03:00).
  for (let seconds = 0; seconds <= 7200; seconds += 1) {
    try {
      return resolve(wanted.add({ seconds }), 'reject');
    } catch {
      // This local second is still in the gap.
    }
  }
  return compatible;
}

function roundedDivision(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

export function addInterval(value: Temporal.ZonedDateTime, interval: Interval, multiplier = 1): Temporal.ZonedDateTime {
  if (interval.unit === 'second' || interval.unit === 'minute' || interval.unit === 'hour') {
    return value.add({ seconds: interval.roundedSeconds * multiplier });
  }
  const sign = multiplier < 0 ? -1 : 1;
  const dayMultiplier = interval.unit === 'week' ? 7n : 1n;
  const totalDaysNumerator = interval.numerator * dayMultiplier * BigInt(Math.abs(multiplier));
  const calendarDays = totalDaysNumerator / interval.denominator;
  const fractionalNumerator = totalDaysNumerator % interval.denominator;
  const elapsedSeconds = roundedDivision(fractionalNumerator * 86400n, interval.denominator);
  return value.add({ days: sign * Number(calendarDays) }).add({ seconds: sign * Number(elapsedSeconds) });
}

function resolveOneShot(
  clause: ReminderField['oneShots'][number],
  task: DiscoveredTask,
  settings: ResolverSettings
): Temporal.Instant | undefined {
  const date = selectedDate(task.dates, clause.anchor);
  if (!date) return undefined;
  const time = clause.kind === 'time' ? clause.time : clause.time ?? settings.defaultAlertTime;
  let timestamp = localDateTime(date, time, settings.timeZone);
  if (clause.kind === 'offset') {
    timestamp = addInterval(timestamp, clause.interval, clause.direction === 'before' ? -1 : 1);
  }
  return timestamp.toInstant();
}

function resolveRepeatSeed(
  field: ReminderField,
  task: DiscoveredTask,
  settings: ResolverSettings,
  chronologicalExplicit: Temporal.Instant[],
  lexicalExplicit: Temporal.Instant[],
  implicit: Temporal.Instant | undefined
): Temporal.Instant | undefined {
  const repeat = field.repeat;
  if (!repeat) return undefined;
  if (typeof repeat.seed === 'object') {
    const date = selectedDate(task.dates, repeat.anchor);
    return date ? localDateTime(date, repeat.seed, settings.timeZone).toInstant() : undefined;
  }
  if (repeat.seed === 'last') return chronologicalExplicit.at(-1) ?? implicit;
  return lexicalExplicit.at(-1) ?? implicit;
}

function toZone(instant: Temporal.Instant, timeZone: string): Temporal.ZonedDateTime {
  return instant.toZonedDateTimeISO(timeZone);
}

function nextOccurrence(seed: Temporal.Instant, interval: Interval, settings: ResolverSettings): Temporal.Instant {
  const seedZoned = toZone(seed, settings.timeZone);
  const now = settings.now;
  let multiplier = 1;
  if (seed.epochMilliseconds < now.epochMilliseconds) {
    const elapsedMilliseconds = BigInt(now.epochMilliseconds) - BigInt(seed.epochMilliseconds);
    const denominator = BigInt(Math.max(interval.roundedSeconds, 1)) * 1000n;
    multiplier = Math.max(1, Number(elapsedMilliseconds / denominator));
  }
  let candidate = addInterval(seedZoned, interval, multiplier).toInstant();
  while (candidate.epochMilliseconds < now.epochMilliseconds) {
    multiplier += 1;
    candidate = addInterval(seedZoned, interval, multiplier).toInstant();
  }
  while (multiplier > 1) {
    const previous = addInterval(seedZoned, interval, multiplier - 1).toInstant();
    if (previous.epochMilliseconds < now.epochMilliseconds) break;
    multiplier -= 1;
    candidate = previous;
  }
  return candidate;
}

function isRepeatCollision(
  instant: Temporal.Instant,
  repeatSeed: Temporal.Instant,
  interval: Interval,
  settings: ResolverSettings
): boolean {
  if (instant.epochMilliseconds <= repeatSeed.epochMilliseconds) return false;
  const seedZoned = toZone(repeatSeed, settings.timeZone);
  const rough = Math.max(1, Math.round((instant.epochMilliseconds - repeatSeed.epochMilliseconds) / (interval.roundedSeconds * 1000)));
  for (let index = Math.max(1, rough - 3); index <= rough + 3; index += 1) {
    if (addInterval(seedZoned, interval, index).toInstant().epochMilliseconds === instant.epochMilliseconds) return true;
  }
  return false;
}

export function resolveReminder(
  field: ReminderField,
  task: DiscoveredTask,
  settings: ResolverSettings
): ResolvedReminder | undefined {
  if (resolutionDiagnostic(field, task)) return undefined;
  const lexicalExplicit = field.oneShots
    .map((clause) => resolveOneShot(clause, task, settings))
    .filter((value): value is Temporal.Instant => value !== undefined);
  if (field.oneShots.length && lexicalExplicit.length !== field.oneShots.length) return undefined;
  const explicit = [...lexicalExplicit].sort((left, right) => left.epochMilliseconds - right.epochMilliseconds);

  const implicit = explicit.length === 0
    ? (() => {
      const date = selectedDate(task.dates);
      return date ? localDateTime(date, settings.defaultAlertTime, settings.timeZone).toInstant() : undefined;
    })()
    : undefined;
  if (!implicit && explicit.length === 0) return undefined;

  const allOneShots = [...explicit, ...(implicit ? [implicit] : [])]
    .filter((value, index, values) => index === 0 || values[index - 1].epochMilliseconds !== value.epochMilliseconds);
  const seed = resolveRepeatSeed(field, task, settings, explicit, lexicalExplicit, implicit);
  if (field.repeat && !seed) return undefined;
  const repeat = field.repeat && seed
    ? { timestamp: nextOccurrence(seed, field.repeat.interval, settings), duration: field.repeat.interval.roundedSeconds }
    : undefined;
  const oneShots = allOneShots
    .filter((instant) => instant.epochMilliseconds >= settings.now.epochMilliseconds)
    .filter((instant) => !field.repeat || !seed || !isRepeatCollision(instant, seed, field.repeat.interval, settings));
  if (oneShots.length === 0 && !repeat) return undefined;
  return { oneShots, repeat };
}

export function parseDefaultAlertTime(value: string): LocalTime | undefined {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = match[3] ? Number(match[3]) : 0;
  if (hour > 23 || minute > 59 || second > 59) return undefined;
  return { hour, minute, second };
}
