import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Temporal } from '@js-temporal/polyfill';
import { describe, expect, it } from 'vitest';
import { parse } from '../src/parser';
import { resolutionDiagnostic, resolveReminder } from '../src/resolver';
import { discoverTasks } from '../src/integrations/obsidian-tasks-plugin';
import type { DiscoveredTask, ResolverSettings, StatusType, TaskDates } from '../src/types';

const settings: ResolverSettings = { timeZone: 'America/Los_Angeles', defaultAlertTime: { hour: 9, minute: 0, second: 0 }, now: Temporal.Instant.from('2027-01-01T00:00:00Z') };
const standardDates: TaskDates = { due: '2027-04-15', scheduled: '2027-04-10', start: '2027-04-01' };
const configuration = { globalFilter: '', statusTypes: new Map<string, StatusType>([[' ', 'TODO'], ['x', 'DONE']]) };

function fixture(dates: TaskDates = standardDates): DiscoveredTask {
  return { path: 'Fixture.md', lineNumber: 1, rawLine: '- [ ] Submit', statusType: 'TODO', dates, fieldText: '' };
}

function local(instant: Temporal.Instant): string {
  const value = instant.toZonedDateTimeISO(settings.timeZone);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${value.year}-${pad(value.month)}-${pad(value.day)} ${pad(value.hour)}:${pad(value.minute)}:${pad(value.second)}`;
}

interface ResolvesCase { id: string; field: string; oneShots: string[]; dates?: TaskDates; repeat?: [string, number]; seed?: string; exactOneShots?: string[] }
interface ParseErrorCase { id: string; field: string; parseError: string }
interface ResolutionErrorCase { id: string; field: string; dates: TaskDates; resolutionError: string }
interface ValidDiscoveryCase { id: string; taskLine: string; fieldText: string; dates?: TaskDates; oneShots: string[]; repeat?: [string, number]; discoveryError?: never }
interface SkippedDiscoveryCase { id: string; taskLine: string; fieldText?: never; dates?: never; oneShots?: never; repeat?: never; discoveryError?: string }
type DiscoveryCase = ValidDiscoveryCase | SkippedDiscoveryCase;
type MatrixCase = ResolvesCase | ParseErrorCase | ResolutionErrorCase | DiscoveryCase;

/*
 * Keep this file in the same section and row order as ../../text_matrix.md. Every
 * matrix row gets exactly one case in its matching section array, immediately
 * followed by a describe block that runs the whole array through testMatrixCases.
 * Use `field` for reminder-field content and `taskLine` for extraction cases.
 * Every valid case declares its expected one-shots and optional repeat.
 * Write every case as a complete object; do not generate section cases with map.
 * When the matrix changes, update the matching array; the inventory guard rejects
 * missing, duplicate, extra, and out-of-order IDs.
 */
function testMatrixCases(cases: readonly MatrixCase[]): void {
  it.each(cases)('$id', (testCase) => {
    if ('taskLine' in testCase) {
      const result = discoverTasks('Tasks.md', testCase.taskLine, configuration);
      if (testCase.discoveryError) expect(result.diagnostics).toMatchObject([{ code: testCase.discoveryError }]);
      else if (testCase.fieldText === undefined) expect(result).toEqual({ tasks: [], diagnostics: [] });
      else {
        expect(result.diagnostics).toEqual([]);
        expect(result.tasks).toMatchObject([{ fieldText: testCase.fieldText, ...(testCase.dates && { dates: testCase.dates }) }]);
        const task = result.tasks[0];
        const parsed = parse(task.fieldText);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        const resolved = resolveReminder(parsed.field, task, settings);
        expect(resolved?.oneShots.map(local)).toEqual(testCase.oneShots);
        expect(resolved?.repeat && [local(resolved.repeat.timestamp), resolved.repeat.duration]).toEqual(testCase.repeat);
      }
      return;
    }
    const parsed = parse(testCase.field);
    if ('parseError' in testCase) {
      expect(parsed).toMatchObject({ ok: false, diagnostic: { code: testCase.parseError } });
      return;
    }
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    if ('resolutionError' in testCase) {
      expect(resolutionDiagnostic(parsed.field, fixture(testCase.dates))).toMatchObject({ code: testCase.resolutionError });
      expect(resolveReminder(parsed.field, fixture(testCase.dates), settings)).toBeUndefined();
      return;
    }
    if (testCase.seed) expect(parsed.field.repeat?.seed).toBe(testCase.seed);
    const resolved = resolveReminder(parsed.field, fixture(testCase.dates), settings);
    expect(resolved?.oneShots.map(local)).toEqual(testCase.oneShots);
    if (testCase.exactOneShots) expect(resolved?.oneShots.map((instant) => instant.toString())).toEqual(testCase.exactOneShots);
    expect(resolved?.repeat && [local(resolved.repeat.timestamp), resolved.repeat.duration]).toEqual(testCase.repeat);
  });
}

const optInAndBasicTimesCases: MatrixCase[] = [
  { id: 'B01', taskLine: '- [ ] Submit 📅 2027-04-15' },
  { id: 'B02', field: '', oneShots: ['2027-04-15 09:00:00'] },
  { id: 'B03', field: '   ', oneShots: ['2027-04-15 09:00:00'] },
  { id: 'B04', field: '5pm', oneShots: ['2027-04-15 17:00:00'] },
  { id: 'B05', field: 'at 5pm', oneShots: ['2027-04-15 17:00:00'] },
  { id: 'B06', field: '10am, 9am on start', oneShots: ['2027-04-01 09:00:00', '2027-04-15 10:00:00'] },
  { id: 'B07', field: '9am, 5pm', oneShots: ['2027-04-15 09:00:00', '2027-04-15 17:00:00'] },
  { id: 'B08', field: '5pm, 9am', oneShots: ['2027-04-15 09:00:00', '2027-04-15 17:00:00'] },
  { id: 'B09', field: '9am, at 9am', oneShots: ['2027-04-15 09:00:00'] },
  { id: 'B10', field: 'AT 2:00 PM', oneShots: ['2027-04-15 14:00:00'] },
  { id: 'B11', field: '0:00', oneShots: ['2027-04-15 00:00:00'] },
  { id: 'B12', field: '00:00', oneShots: ['2027-04-15 00:00:00'] },
  { id: 'B13', field: '9:30', oneShots: ['2027-04-15 09:30:00'] },
  { id: 'B14', field: '09:30', oneShots: ['2027-04-15 09:30:00'] },
  { id: 'B15', field: '14:00', oneShots: ['2027-04-15 14:00:00'] },
  { id: 'B16', field: '14:00:30', oneShots: ['2027-04-15 14:00:30'] },
  { id: 'B17', field: '2pm', oneShots: ['2027-04-15 14:00:00'] },
  { id: 'B18', field: '2:00pm', oneShots: ['2027-04-15 14:00:00'] },
  { id: 'B19', field: '2:00 PM', oneShots: ['2027-04-15 14:00:00'] },
  { id: 'B20', field: '2:00:30pm', oneShots: ['2027-04-15 14:00:30'] },
  { id: 'B21', field: '12am', oneShots: ['2027-04-15 00:00:00'] },
  { id: 'B22', field: '12pm', oneShots: ['2027-04-15 12:00:00'] },
  { id: 'B23', field: '1am', oneShots: ['2027-04-15 01:00:00'] },
  { id: 'B24', field: '11:59:59pm', oneShots: ['2027-04-15 23:59:59'] }
];
describe('Opt-In and Basic Times', () => testMatrixCases(optInAndBasicTimesCases));

const anchorSelectionCases: MatrixCase[] = [
  { id: 'A01', field: '5pm', oneShots: ['2027-04-15 17:00:00'] },
  { id: 'A02', field: '5pm', dates: { scheduled: '2027-04-10', start: '2027-04-01' }, oneShots: ['2027-04-10 17:00:00'] },
  { id: 'A03', field: '5pm', dates: { start: '2027-04-01' }, oneShots: ['2027-04-01 17:00:00'] },
  { id: 'A04', field: '5pm', dates: {}, resolutionError: 'NO_VALID_DATE' },
  { id: 'A05', taskLine: '- [ ] Submit' },
  { id: 'A06', field: '5pm on due', oneShots: ['2027-04-15 17:00:00'] },
  { id: 'A07', field: '5pm on scheduled', oneShots: ['2027-04-10 17:00:00'] },
  { id: 'A08', field: '5pm on start', oneShots: ['2027-04-01 17:00:00'] },
  { id: 'A09', field: '5pm on due', dates: { scheduled: '2027-04-10', start: '2027-04-01' }, resolutionError: 'MISSING_ANCHOR_DATE' },
  { id: 'A10', field: '5pm on scheduled', dates: { due: '2027-04-15', start: '2027-04-01' }, resolutionError: 'MISSING_ANCHOR_DATE' },
  { id: 'A11', field: '5pm on start', dates: { due: '2027-04-15', scheduled: '2027-04-10' }, resolutionError: 'MISSING_ANCHOR_DATE' },
  { id: 'A12', field: '10am, 9am on start', oneShots: ['2027-04-01 09:00:00', '2027-04-15 10:00:00'] },
  { id: 'A13', field: '', dates: { scheduled: '2027-04-10', start: '2027-04-01' }, oneShots: ['2027-04-10 09:00:00'] },
  { id: 'A14', field: '0min before', dates: { start: '2027-04-01' }, oneShots: ['2027-04-01 09:00:00'] }
];
describe('Anchor Selection', () => testMatrixCases(anchorSelectionCases));

const unitAndAliasEquivalenceCases: MatrixCase[] = [
  { id: 'U01', field: '30 minutes before', oneShots: ['2027-04-15 08:30:00'] },
  { id: 'U02', field: '30 MIN before', oneShots: ['2027-04-15 08:30:00'] },
  { id: 'U03', field: '2hrs after', oneShots: ['2027-04-15 11:00:00'] },
  { id: 'U04', field: '3wks before', oneShots: ['2027-03-25 09:00:00'] },
  { id: 'U05', field: '2mos after', parseError: 'UNKNOWN_UNIT' },
  { id: 'U06', field: '1yrs before', parseError: 'UNKNOWN_UNIT' },
  { id: 'U07', field: '30minutes before', oneShots: ['2027-04-15 08:30:00'] },
  { id: 'U08', field: '1.5hours before', oneShots: ['2027-04-15 07:30:00'] }
];
const unitAliasCases = ['1 second', '1 seconds', '1s', '1 s', '1sec', '1 secs', '1 minute', '1 minutes', '1m', '1 m', '1min', '1 mins', '1 hour', '1 hours', '1h', '1 h', '1hr', '1 hrs', '1 day', '1 days', '1d', '1 d', '1 week', '1 weeks', '1w', '1 wk', '1wks'];
describe('Unit and Alias Equivalence', () => {
  testMatrixCases(unitAndAliasEquivalenceCases);
  it.each(unitAliasCases)('accepts alias-table example %s', (interval) => expect(parse(`${interval} before`).ok).toBe(true));
});

const numericFormsAndRoundingCases: MatrixCase[] = [
  { id: 'N01', field: '.5h before', oneShots: ['2027-04-15 08:30:00'] },
  { id: 'N02', field: '0.5h before', oneShots: ['2027-04-15 08:30:00'] },
  { id: 'N03', field: '1.25h before', oneShots: ['2027-04-15 07:45:00'] },
  { id: 'N04', field: '1.25 hours before', oneShots: ['2027-04-15 07:45:00'] },
  { id: 'N05', field: '0min before', oneShots: ['2027-04-15 09:00:00'] },
  { id: 'N06', field: '0min after', oneShots: ['2027-04-15 09:00:00'] },
  { id: 'N07', field: '0.0d before at 2pm', oneShots: ['2027-04-15 14:00:00'] },
  { id: 'N08', field: '.5s after', oneShots: ['2027-04-15 09:00:01'] },
  { id: 'N09', field: '.5s before', oneShots: ['2027-04-15 08:59:59'] },
  { id: 'N10', field: '1.4s after', oneShots: ['2027-04-15 09:00:01'] },
  { id: 'N11', field: '1.5s after', oneShots: ['2027-04-15 09:00:02'] },
  { id: 'N12', field: '55.5s after', oneShots: ['2027-04-15 09:00:56'] },
  { id: 'N13', field: '.4s after', parseError: 'POSITIVE_DURATION_ROUNDS_TO_ZERO' },
  { id: 'N14', field: '1.5mo before', parseError: 'UNKNOWN_UNIT' },
  { id: 'N15', field: '.5 years after', parseError: 'UNKNOWN_UNIT' },
  { id: 'N16', field: '0mo before', parseError: 'UNKNOWN_UNIT' },
  { id: 'N17', field: 'every 0m after last', parseError: 'MINIMUM_REPEAT_INTERVAL' },
  { id: 'N18', field: 'every 0.0 days after last', parseError: 'MINIMUM_REPEAT_INTERVAL' },
  { id: 'N19', field: 'every .4s after last', parseError: 'MINIMUM_REPEAT_INTERVAL' },
  { id: 'N20', field: 'every .5s after last', parseError: 'MINIMUM_REPEAT_INTERVAL' }
];
describe('Numeric Forms and Rounding', () => testMatrixCases(numericFormsAndRoundingCases));

const minimumRepeatIntervalCases: MatrixCase[] = [
  { id: 'M01', field: 'every 59s after last', parseError: 'MINIMUM_REPEAT_INTERVAL' },
  { id: 'M02', field: 'every 60s after last', oneShots: ['2027-04-15 09:00:00'], repeat: ['2027-04-15 09:01:00', 60], seed: 'last' },
  { id: 'M03', field: 'every 1m after last', oneShots: ['2027-04-15 09:00:00'], repeat: ['2027-04-15 09:01:00', 60], seed: 'last' },
  { id: 'M04', field: 'every minute after last', oneShots: ['2027-04-15 09:00:00'], repeat: ['2027-04-15 09:01:00', 60], seed: 'last' }
];
describe('Minimum Repeat Interval', () => testMatrixCases(minimumRepeatIntervalCases));

const oneShotOffsetsCases: MatrixCase[] = [
  { id: 'O01', field: '30s before', oneShots: ['2027-04-15 08:59:30'] },
  { id: 'O02', field: '30s after', oneShots: ['2027-04-15 09:00:30'] },
  { id: 'O03', field: '30min before', oneShots: ['2027-04-15 08:30:00'] },
  { id: 'O04', field: '30min after', oneShots: ['2027-04-15 09:30:00'] },
  { id: 'O05', field: '1.5hr before', oneShots: ['2027-04-15 07:30:00'] },
  { id: 'O06', field: '1.5hr after', oneShots: ['2027-04-15 10:30:00'] },
  { id: 'O07', field: '2 days before', oneShots: ['2027-04-13 09:00:00'] },
  { id: 'O08', field: '1 day after', oneShots: ['2027-04-16 09:00:00'] },
  { id: 'O09', field: '1 week before', oneShots: ['2027-04-08 09:00:00'] },
  { id: 'O10', field: '1 week after', oneShots: ['2027-04-22 09:00:00'] },
  { id: 'O11', field: '2mo before', parseError: 'UNKNOWN_UNIT' },
  { id: 'O12', field: '2mo after', parseError: 'UNKNOWN_UNIT' },
  { id: 'O13', field: '1yr before', parseError: 'UNKNOWN_UNIT' },
  { id: 'O14', field: '1yr after', parseError: 'UNKNOWN_UNIT' },
  { id: 'O15', field: '.5h after scheduled', oneShots: ['2027-04-10 09:30:00'] },
  { id: 'O16', field: '1 day before at 2pm', oneShots: ['2027-04-14 14:00:00'] },
  { id: 'O17', field: '1 day after at 2pm', oneShots: ['2027-04-16 14:00:00'] },
  { id: 'O18', field: '0.5d before at 2pm', oneShots: ['2027-04-15 02:00:00'] },
  { id: 'O19', field: '0.5d after at 2pm', oneShots: ['2027-04-16 02:00:00'] },
  { id: 'O20', field: '1.5d before', oneShots: ['2027-04-13 21:00:00'] },
  { id: 'O21', field: '1.5d after', oneShots: ['2027-04-16 21:00:00'] },
  { id: 'O22', field: '1.5wk before', oneShots: ['2027-04-04 21:00:00'] },
  { id: 'O23', field: '1.5wk after', oneShots: ['2027-04-25 21:00:00'] },
  { id: 'O24', field: '9am, 1 week before at 9am', oneShots: ['2027-04-08 09:00:00', '2027-04-15 09:00:00'] },
  { id: 'O25', field: '1d before due, .5h after scheduled, 5pm on start', oneShots: ['2027-04-01 17:00:00', '2027-04-10 09:30:00', '2027-04-14 09:00:00'] }
];
describe('One-Shot Offsets', () => testMatrixCases(oneShotOffsetsCases));

const repeatSeedsAndOrderingCases: MatrixCase[] = [
  { id: 'R01', field: '5pm, 9am, every hour after last', oneShots: ['2027-04-15 09:00:00', '2027-04-15 17:00:00'], repeat: ['2027-04-15 18:00:00', 3600], seed: 'last' },
  { id: 'R02', field: '5pm, at 9am, every 1h after prev', oneShots: ['2027-04-15 09:00:00'], repeat: ['2027-04-15 10:00:00', 3600], seed: 'prev' },
  { id: 'R03', field: '9am, 5pm, every 1h after previous', oneShots: ['2027-04-15 09:00:00', '2027-04-15 17:00:00'], repeat: ['2027-04-15 18:00:00', 3600], seed: 'previous' },
  { id: 'R04', field: '5pm on start, 9am on due, every 1d after last', oneShots: ['2027-04-01 17:00:00', '2027-04-15 09:00:00'], repeat: ['2027-04-16 09:00:00', 86400], seed: 'last' },
  { id: 'R05', field: '5pm on due, 9am on start, every 1d after prev', oneShots: ['2027-04-01 09:00:00', '2027-04-15 17:00:00'], repeat: ['2027-04-02 09:00:00', 86400], seed: 'prev' },
  { id: 'R06', field: 'every 30m after last', oneShots: ['2027-04-15 09:00:00'], repeat: ['2027-04-15 09:30:00', 1800], seed: 'last' },
  { id: 'R07', field: 'every 30m after previous', oneShots: ['2027-04-15 09:00:00'], repeat: ['2027-04-15 09:30:00', 1800], seed: 'previous' },
  { id: 'R08', field: 'every 30m after prev', oneShots: ['2027-04-15 09:00:00'], repeat: ['2027-04-15 09:30:00', 1800], seed: 'prev' },
  { id: 'R09', field: 'every hour after last', oneShots: ['2027-04-15 09:00:00'], repeat: ['2027-04-15 10:00:00', 3600], seed: 'last' },
  { id: 'R10', field: 'every h after last', oneShots: ['2027-04-15 09:00:00'], repeat: ['2027-04-15 10:00:00', 3600], seed: 'last' },
  { id: 'R11', field: 'every 30 minutes after 3pm', oneShots: ['2027-04-15 09:00:00'], repeat: ['2027-04-15 15:30:00', 1800] },
  { id: 'R12', field: 'every 2mo after 9am on due', parseError: 'UNKNOWN_UNIT' },
  { id: 'R13', field: 'every 1d after 9am on scheduled', oneShots: [], repeat: ['2027-04-11 09:00:00', 86400] },
  { id: 'R14', field: '5pm, every 30m after 3pm', oneShots: [], repeat: ['2027-04-15 15:30:00', 1800] },
  { id: 'R15', field: '3pm, every 30m after last', oneShots: ['2027-04-15 15:00:00'], repeat: ['2027-04-15 15:30:00', 1800], seed: 'last' },
  { id: 'R16', field: '3pm, every 30m after 3pm', oneShots: ['2027-04-15 15:00:00'], repeat: ['2027-04-15 15:30:00', 1800] },
  { id: 'R17', field: 'every .5h after last', oneShots: ['2027-04-15 09:00:00'], repeat: ['2027-04-15 09:30:00', 1800], seed: 'last' },
  { id: 'R18', field: 'every 90s after last', oneShots: ['2027-04-15 09:00:00'], repeat: ['2027-04-15 09:01:30', 90], seed: 'last' },
  { id: 'R19', field: 'every 1.5d after last', oneShots: ['2027-04-15 09:00:00'], repeat: ['2027-04-16 21:00:00', 129600], seed: 'last' },
  { id: 'R20', field: '9am, 9am, every 1h after last', oneShots: ['2027-04-15 09:00:00'], repeat: ['2027-04-15 10:00:00', 3600], seed: 'last' },
  { id: 'R21', field: 'every 1h after 9am on due', dates: { scheduled: '2027-04-10', start: '2027-04-01' }, resolutionError: 'MISSING_ANCHOR_DATE' },
  { id: 'R22', field: '3pm, every 30m', oneShots: ['2027-04-15 15:00:00'], repeat: ['2027-04-15 15:30:00', 1800], seed: 'last' },
  { id: 'R23', field: 'every 30m', oneShots: ['2027-04-15 09:00:00'], repeat: ['2027-04-15 09:30:00', 1800], seed: 'last' },
  { id: 'R24', field: 'every hour', oneShots: ['2027-04-15 09:00:00'], repeat: ['2027-04-15 10:00:00', 3600], seed: 'last' },
  { id: 'R25', field: '5pm, 3pm, every 30m', oneShots: ['2027-04-15 15:00:00', '2027-04-15 17:00:00'], repeat: ['2027-04-15 17:30:00', 1800], seed: 'last' }
];
describe('Repeat Seeds and Ordering', () => testMatrixCases(repeatSeedsAndOrderingCases));

const fieldExtractionAndInvalidSyntaxCases: MatrixCase[] = [
  { id: 'E01', taskLine: '- [ ] Submit 🔔 5pm 📅 2027-04-15', fieldText: '5pm', dates: { due: '2027-04-15' }, oneShots: ['2027-04-15 17:00:00'] },
  { id: 'E02', taskLine: '- [ ] Submit 🔼 📅 2027-04-15 🔔 5pm', discoveryError: 'INVALID_FIELD_POSITION' },
  { id: 'E03', taskLine: '- [ ] Document the `🔔 5pm` marker 📅 2027-04-15' },
  { id: 'E04', taskLine: '- [ ] `🔔` example 🔔 5pm 📅 2027-04-15', fieldText: '5pm', oneShots: ['2027-04-15 17:00:00'] },
  { id: 'E05', taskLine: '- [ ] Submit 🔔 5pm 🔔 6pm', discoveryError: 'MULTIPLE_REMINDER_FIELDS' },
  { id: 'E06', taskLine: '- [ ] Submit 🔔5pm', discoveryError: 'MISSING_FIELD_SPACE' },
  { id: 'E07', field: ', 5pm', parseError: 'EMPTY_CLAUSE' },
  { id: 'E08', field: '5pm,', parseError: 'EMPTY_CLAUSE' },
  { id: 'E09', field: '5pm,, 6pm', parseError: 'EMPTY_CLAUSE' },
  { id: 'E10', field: '5pm, , 6pm', parseError: 'EMPTY_CLAUSE' },
  { id: 'E11', field: 'at', parseError: 'MISSING_TIME' },
  { id: 'E12', field: 'at 25:00', parseError: 'INVALID_TIME' },
  { id: 'E13', field: '24:00', parseError: 'INVALID_TIME' },
  { id: 'E14', field: '12:60', parseError: 'INVALID_TIME' },
  { id: 'E15', field: '12:00:60', parseError: 'INVALID_TIME' },
  { id: 'E16', field: '0pm', parseError: 'INVALID_TIME' },
  { id: 'E17', field: '13pm', parseError: 'INVALID_TIME' },
  { id: 'E18', field: '1.h before', parseError: 'INVALID_NUMBER' },
  { id: 'E19', field: '-1h before', parseError: 'INVALID_NUMBER' },
  { id: 'E20', field: '+1h before', parseError: 'INVALID_NUMBER' },
  { id: 'E21', field: '1e3s before', parseError: 'INVALID_NUMBER' },
  { id: 'E22', field: 'hour before', oneShots: ['2027-04-15 08:00:00'] },
  { id: 'E23', field: '2mx before', parseError: 'UNKNOWN_UNIT' },
  { id: 'E24', field: '1d sideways', parseError: 'UNKNOWN_DIRECTION' },
  { id: 'E25', field: '1d before cancelled', parseError: 'UNKNOWN_ANCHOR' },
  { id: 'E26', field: '1d before due at', parseError: 'MISSING_TIME' },
  { id: 'E27', field: 'every after last', parseError: 'MISSING_REPEAT_INTERVAL' },
  { id: 'E28', field: 'every 1h before last', parseError: 'INVALID_REPEAT_DIRECTION' },
  { id: 'E29', field: 'every 1h after latest', parseError: 'INVALID_REPEAT_SEED' },
  { id: 'E30', field: 'every 1h after last, 5pm', parseError: 'REPEAT_NOT_FINAL' },
  { id: 'E31', field: 'every 1h after last, every 1d after prev', parseError: 'MULTIPLE_REPEATS' },
  { id: 'E32', field: '5pm extra words', parseError: 'UNEXPECTED_TOKEN' },
  { id: 'E33', field: '5pm on due on start', parseError: 'MULTIPLE_ANCHORS' },
  { id: 'E34', field: '5pm, invalid, 6pm', parseError: 'UNEXPECTED_TOKEN' },
  { id: 'E35', field: 'every 1.5mo after last', parseError: 'UNKNOWN_UNIT' },
  { id: 'E36', field: 'second before', oneShots: ['2027-04-15 08:59:59'] },
  { id: 'E37', field: 'minute before', oneShots: ['2027-04-15 08:59:00'] },
  { id: 'E38', field: 'day before', oneShots: ['2027-04-14 09:00:00'] },
  { id: 'E39', field: 'week before', oneShots: ['2027-04-08 09:00:00'] },
  { id: 'E40', field: 'month before', parseError: 'UNKNOWN_UNIT' },
  { id: 'E41', field: 'year before', parseError: 'UNKNOWN_UNIT' },
  { id: 'E42', field: '1y after', parseError: 'UNKNOWN_UNIT' },
  { id: 'E43', taskLine: '- [ ] Submit 🔼 🔔 5pm 📅 2027-04-15', discoveryError: 'INVALID_FIELD_POSITION' },
  { id: 'E44', taskLine: '- [ ] Submit 🔼 📅 2027-04-15 🔔', discoveryError: 'INVALID_FIELD_POSITION' },
  { id: 'E45', field: 'every 30m after', parseError: 'INVALID_REPEAT_DIRECTION' }
];
describe('Field Extraction and Invalid Syntax', () => testMatrixCases(fieldExtractionAndInvalidSyntaxCases));

const dstBehaviorCases: MatrixCase[] = [
  { id: 'D01', field: '2:30am', dates: { due: '2027-03-14' }, oneShots: ['2027-03-14 03:00:00'] },
  { id: 'D02', field: '1:30am', dates: { due: '2027-11-07' }, oneShots: ['2027-11-07 01:30:00'], exactOneShots: ['2027-11-07T08:30:00Z'] },
  { id: 'D03', field: '1d after start', dates: { start: '2027-03-13' }, oneShots: ['2027-03-14 09:00:00'] },
  { id: 'D04', field: '24h after start', dates: { start: '2027-03-13' }, oneShots: ['2027-03-14 10:00:00'] },
  { id: 'D05', field: '1d after start', dates: { start: '2027-11-06' }, oneShots: ['2027-11-07 09:00:00'] },
  { id: 'D06', field: '24h after start', dates: { start: '2027-11-06' }, oneShots: ['2027-11-07 08:00:00'] }
];
describe('DST Behavior', () => testMatrixCases(dstBehaviorCases));

const matrixSections = [optInAndBasicTimesCases, anchorSelectionCases, unitAndAliasEquivalenceCases,
  numericFormsAndRoundingCases, minimumRepeatIntervalCases, oneShotOffsetsCases,
  repeatSeedsAndOrderingCases, fieldExtractionAndInvalidSyntaxCases, dstBehaviorCases];

describe('matrix inventory guard', () => {
  it('has exactly one executable case for every matrix ID in matrix order', () => {
    const matrixPath = fileURLToPath(new URL('../../text_matrix.md', import.meta.url));
    const expected = [...readFileSync(matrixPath, 'utf8').matchAll(/^\|([A-Z]\d{2})\|/gm)].map((match) => match[1]);
    const covered = matrixSections.flatMap((section) => section.map(({ id }) => id));
    expect(new Set(covered).size).toBe(covered.length);
    expect(covered).toEqual(expected);
  });
});
