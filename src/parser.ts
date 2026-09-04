import type {
  Anchor, Diagnostic, Direction, Interval, LocalTime, OffsetOneShot,
  OneShotClause, ParseResult, ReminderField, RepeatClause, TimeOneShot, Unit
} from './types';

const UNIT_SECONDS: Record<Unit, number> = {
  second: 1,
  minute: 60,
  hour: 3600,
  day: 86400,
  week: 604800
};

const UNITS: Record<string, Unit> = {
  second: 'second', seconds: 'second', s: 'second', sec: 'second', secs: 'second',
  minute: 'minute', minutes: 'minute', m: 'minute', min: 'minute', mins: 'minute',
  hour: 'hour', hours: 'hour', h: 'hour', hr: 'hour', hrs: 'hour',
  day: 'day', days: 'day', d: 'day',
  week: 'week', weeks: 'week', w: 'week', wk: 'week', wks: 'week'
};

const KNOWN_BAD_UNITS = new Set(['month', 'months', 'mo', 'mos', 'year', 'years', 'y', 'yr', 'yrs']);

function problem(code: string, message: string): ParseResult {
  return { ok: false, diagnostic: { code, message } };
}

function parseDecimal(value: string): { numerator: bigint; denominator: bigint; positive: boolean } | Diagnostic {
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) {
    return { code: 'INVALID_NUMBER', message: 'The duration quantity is malformed.' };
  }
  const normalized = value.startsWith('.') ? `0${value}` : value;
  const [whole, fraction = ''] = normalized.split('.');
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(`${whole}${fraction}`);
  return { numerator, denominator, positive: numerator > 0n };
}

function roundHalfUp(numerator: bigint, denominator: bigint): number {
  return Number((numerator * 2n + denominator) / (denominator * 2n));
}

function parseIntervalPrefix(input: string): { interval: Interval; rest: string; positive: boolean } | Diagnostic {
  const value = input.trimStart();
  if (/^[+-]|^\d+\.(?!\d)|^\d+[eE]/.test(value)) {
    return { code: 'INVALID_NUMBER', message: 'The duration quantity is malformed.' };
  }
  const match = /^(?:(\d+(?:\.\d+)?|\.\d+)\s*)?([A-Za-z]+)(.*)$/s.exec(value);
  if (!match) return { code: 'MISSING_REPEAT_INTERVAL', message: 'A duration interval is required.' };
  const [, numberText, unitText, rest] = match;
  const unitKey = unitText.toLowerCase();
  const unit = UNITS[unitKey];
  if (!unit || KNOWN_BAD_UNITS.has(unitKey)) {
    return { code: 'UNKNOWN_UNIT', message: `Unsupported interval unit: ${unitText}.` };
  }
  const decimal = numberText ? parseDecimal(numberText) : { numerator: 1n, denominator: 1n, positive: true };
  if ('code' in decimal) return decimal;
  const roundedSeconds = roundHalfUp(decimal.numerator * BigInt(UNIT_SECONDS[unit]), decimal.denominator);
  return {
    interval: { numerator: decimal.numerator, denominator: decimal.denominator, unit, roundedSeconds },
    rest,
    positive: decimal.positive
  };
}

function parseTimePrefix(input: string): { time: LocalTime; rest: string } | Diagnostic | undefined {
  const text = input.trimStart();
  const match = /^(\d{1,2})(?::(\d{2})(?::(\d{2}))?)?\s*([AaPp][Mm])?(.*)$/s.exec(text);
  if (!match) return undefined;
  const [, hourText, minuteText, secondText, meridiemText, rest] = match;
  const hour = Number(hourText);
  const minute = minuteText === undefined ? 0 : Number(minuteText);
  const second = secondText === undefined ? 0 : Number(secondText);
  const meridiem = meridiemText?.toLowerCase();
  if (minute > 59 || second > 59 || (meridiem ? hour < 1 || hour > 12 : hour > 23)) {
    return { code: 'INVALID_TIME', message: 'The reminder time is invalid.' };
  }
  const adjustedHour = meridiem === 'am' ? hour % 12 : meridiem === 'pm' ? (hour % 12) + 12 : hour;
  return { time: { hour: adjustedHour, minute, second }, rest };
}

function parseAnchorSuffix(input: string): { anchor?: Anchor; rest: string } | Diagnostic {
  const trimmed = input.trim();
  if (!trimmed) return { rest: '' };
  const match = /^on\s+([A-Za-z]+)(.*)$/is.exec(trimmed);
  if (!match) return { rest: trimmed };
  const [, value, rest] = match;
  const key = value.toLowerCase();
  if (key !== 'due' && key !== 'scheduled' && key !== 'start') {
    return { code: 'UNKNOWN_ANCHOR', message: `Unknown date anchor: ${value}.` };
  }
  if (/^\s+on\b/i.test(rest)) return { code: 'MULTIPLE_ANCHORS', message: 'A clause specifies more than one anchor.' };
  return { anchor: key, rest: rest.trim() };
}

function parseTimeOneShot(text: string, sourceIndex: number): TimeOneShot | Diagnostic | undefined {
  const withAt = /^at\b\s*(.*)$/is.exec(text);
  const parsed = parseTimePrefix(withAt ? withAt[1] : text);
  if (!parsed) return withAt ? { code: 'MISSING_TIME', message: 'A time is required after “at”.' } : undefined;
  if ('code' in parsed) return parsed;
  const suffix = parseAnchorSuffix(parsed.rest);
  if ('code' in suffix) return suffix;
  if (suffix.rest) return undefined;
  return { kind: 'time', time: parsed.time, anchor: suffix.anchor, sourceIndex };
}

function parseOffsetOneShot(text: string, sourceIndex: number): OffsetOneShot | Diagnostic {
  const parsed = parseIntervalPrefix(text);
  if ('code' in parsed) return parsed;
  if (parsed.positive && parsed.interval.roundedSeconds === 0) {
    return { code: 'POSITIVE_DURATION_ROUNDS_TO_ZERO', message: 'The positive duration rounds to zero seconds.' };
  }
  const directionMatch = /^\s+([A-Za-z]+)(.*)$/s.exec(parsed.rest);
  if (!directionMatch) return { code: 'UNKNOWN_DIRECTION', message: 'An offset requires “before” or “after”.' };
  const directionValue = directionMatch[1].toLowerCase();
  if (directionValue !== 'before' && directionValue !== 'after') {
    return { code: 'UNKNOWN_DIRECTION', message: 'An offset requires “before” or “after”.' };
  }
  let rest = directionMatch[2].trim();
  let anchor: Anchor | undefined;
  const anchorMatch = /^(due|scheduled|start)\b(.*)$/i.exec(rest);
  if (anchorMatch) {
    anchor = anchorMatch[1].toLowerCase() as Anchor;
    rest = anchorMatch[2].trim();
  } else if (rest && !/^at\b/i.test(rest)) {
    const word = /^([A-Za-z]+)/.exec(rest)?.[1];
    if (word) return { code: 'UNKNOWN_ANCHOR', message: `Unknown date anchor: ${word}.` };
  }
  let time: LocalTime | undefined;
  if (rest) {
    const at = /^at\b\s*(.*)$/is.exec(rest);
    if (!at) return { code: 'UNEXPECTED_TOKEN', message: 'Unrecognized text remains after the reminder clause.' };
    const parsedTime = parseTimePrefix(at[1]);
    if (!parsedTime) return { code: 'MISSING_TIME', message: 'A time is required after “at”.' };
    if ('code' in parsedTime) return parsedTime;
    if (parsedTime.rest.trim()) return { code: 'UNEXPECTED_TOKEN', message: 'Unrecognized text remains after the reminder clause.' };
    time = parsedTime.time;
  }
  return { kind: 'offset', interval: parsed.interval, direction: directionValue as Direction, anchor, time, sourceIndex };
}

function parseOneShot(text: string, sourceIndex: number): OneShotClause | Diagnostic {
  const time = parseTimeOneShot(text, sourceIndex);
  if (time && !('code' in time)) return time;
  if (time && 'code' in time
      && /^(?:at\b|\d{1,2}(?::\d{2}|\s*(?:am|pm)\b))/i.test(text.trim())) return time;
  const offset = parseOffsetOneShot(text, sourceIndex);
  if ('code' in offset && offset.code === 'UNKNOWN_UNIT'
      && !/^(?:\d|\.)/.test(text.trim())
      && !KNOWN_BAD_UNITS.has(/^([A-Za-z]+)/.exec(text.trim())?.[1]?.toLowerCase() ?? '')) {
    return { code: 'UNEXPECTED_TOKEN', message: 'Unrecognized text remains after the reminder clause.' };
  }
  if ('code' in offset && offset.code === 'UNKNOWN_UNIT'
      && /^(?:at\s+)?\d{1,2}(?::\d{2}(?::\d{2})?)?\s*(?:am|pm)\b/i.test(text.trim())) {
    return { code: 'UNEXPECTED_TOKEN', message: 'Unrecognized text remains after the reminder clause.' };
  }
  return offset;
}

function parseRepeat(text: string, sourceIndex: number): RepeatClause | Diagnostic {
  const body = text.replace(/^every\b\s*/i, '');
  if (!body) return { code: 'MISSING_REPEAT_INTERVAL', message: 'A repeat interval is required after “every”.' };
  const parsed = parseIntervalPrefix(body);
  if ('code' in parsed) {
    if (parsed.code === 'UNKNOWN_UNIT' && /^(?:\d+(?:\.\d+)?|\.\d+)\s*[A-Za-z]+/.test(body)) return parsed;
    return { code: 'MISSING_REPEAT_INTERVAL', message: 'A repeat interval is required after “every”.' };
  }
  if (parsed.interval.roundedSeconds < 60) {
    return { code: 'MINIMUM_REPEAT_INTERVAL', message: 'The repeat interval is below one minute.' };
  }
  // A missing repeat suffix defaults to the chronologically latest one-shot.
  if (!parsed.rest.trim()) return { interval: parsed.interval, seed: 'last', sourceIndex };
  const after = /^\s+([A-Za-z]+)\s+(.+)$/s.exec(parsed.rest);
  if (!after || after[1].toLowerCase() !== 'after') {
    return { code: 'INVALID_REPEAT_DIRECTION', message: 'A repeat must use “after” before its seed.' };
  }
  const seedText = after[2].trim();
  if (/^(last|previous|prev)$/i.test(seedText)) {
    return { interval: parsed.interval, seed: seedText.toLowerCase() as 'last' | 'previous' | 'prev', sourceIndex };
  }
  const seed = parseTimePrefix(seedText);
  if (!seed || 'code' in seed) return seed && 'code' in seed ? seed : { code: 'INVALID_REPEAT_SEED', message: 'The repeat seed is invalid.' };
  const suffix = parseAnchorSuffix(seed.rest);
  if ('code' in suffix) return suffix;
  if (suffix.rest) return { code: 'INVALID_REPEAT_SEED', message: 'The repeat seed is invalid.' };
  return { interval: parsed.interval, seed: seed.time, anchor: suffix.anchor, sourceIndex };
}

export function parse(text: string): ParseResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, field: { oneShots: [] } };
  const clauses = text.split(',');
  if (clauses.some((clause) => !clause.trim())) return problem('EMPTY_CLAUSE', 'A comma creates an empty reminder clause.');
  if (clauses.filter((clause) => /^every\b/i.test(clause.trim())).length > 1) {
    return problem('MULTIPLE_REPEATS', 'A reminder field contains more than one repeat.');
  }
  const field: ReminderField = { oneShots: [] };
  for (let index = 0; index < clauses.length; index += 1) {
    const clause = clauses[index].trim();
    if (/^every\b/i.test(clause)) {
      if (field.repeat) return problem('MULTIPLE_REPEATS', 'A reminder field contains more than one repeat.');
      if (index !== clauses.length - 1) return problem('REPEAT_NOT_FINAL', 'A repeat clause must be final.');
      const repeat = parseRepeat(clause, index);
      if ('code' in repeat) return problem(repeat.code, repeat.message);
      field.repeat = repeat;
      continue;
    }
    const oneShot = parseOneShot(clause, index);
    if ('code' in oneShot) return problem(oneShot.code, oneShot.message);
    field.oneShots.push(oneShot);
  }
  return { ok: true, field };
}
