import type { Temporal } from '@js-temporal/polyfill';

export type Anchor = 'due' | 'scheduled' | 'start';
export type Priority = 'highest' | 'high' | 'medium' | 'low' | 'lowest';
export type Direction = 'before' | 'after';
export type StatusType = 'TODO' | 'IN_PROGRESS' | 'ON_HOLD' | 'DONE' | 'CANCELLED' | 'NON_TASK';
export type Unit = 'second' | 'minute' | 'hour' | 'day' | 'week';

export interface LocalTime {
  hour: number;
  minute: number;
  second: number;
}

export interface Interval {
  numerator: bigint;
  denominator: bigint;
  unit: Unit;
  roundedSeconds: number;
}

export interface TimeOneShot {
  kind: 'time';
  time: LocalTime;
  anchor?: Anchor;
  sourceIndex: number;
}

export interface OffsetOneShot {
  kind: 'offset';
  interval: Interval;
  direction: Direction;
  anchor?: Anchor;
  time?: LocalTime;
  sourceIndex: number;
}

export type OneShotClause = TimeOneShot | OffsetOneShot;

export interface RepeatClause {
  interval: Interval;
  seed: 'last' | 'previous' | 'prev' | LocalTime;
  anchor?: Anchor;
  sourceIndex: number;
}

export interface ReminderField {
  oneShots: OneShotClause[];
  repeat?: RepeatClause;
}

export interface Diagnostic {
  code: string;
  message: string;
  clauseIndex?: number;
  range?: { start: number; end: number };
}

export type ParseResult = { ok: true; field: ReminderField } | { ok: false; diagnostic: Diagnostic };

export interface TaskDates {
  due?: string;
  scheduled?: string;
  start?: string;
}

export interface DiscoveredTask {
  text: string;
  priority?: Priority;
  path: string;
  lineNumber: number;
  rawLine: string;
  statusType: StatusType;
  dates: TaskDates;
  fieldText: string;
  fieldTextStart: number;
  fieldRange: { start: number; end: number };
}

export interface ResolverSettings {
  timeZone: string;
  defaultAlertTime: LocalTime;
  now: Temporal.Instant;
}

export interface ResolvedReminder {
  oneShots: Temporal.Instant[];
  repeat?: { timestamp: Temporal.Instant; duration: number };
}

export interface ExportReminder {
  line: number;
  text: string;
  priority?: Priority;
  'one-shots'?: Array<{ timestamp: string }>;
  repeat?: { timestamp: string; duration: number };
}
