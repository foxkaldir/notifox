import { describe, expect, it } from 'vitest';
import { parseDefaultAlertTime } from '../src/resolver';
import { discoverTasks, reminderFieldRange } from '../src/integrations/obsidian-tasks-plugin';
import { timeZoneOptions } from '../src/time-zones';
import type { StatusType } from '../src/types';

describe('Tasks discovery', () => {
  const configuration = { globalFilter: '#task', statusTypes: new Map<string, StatusType>([[' ', 'TODO'], ['x', 'DONE']]) };

  it('honors the Global Filter', () => {
    const source = [
      '- [ ] #task Submit 🔔 5pm 📅 2027-04-15',
      '- [ ] Ignore 🔔 5pm 📅 2027-04-15'
    ].join('\n');
    const result = discoverTasks('Tasks.md', source, configuration);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]).toMatchObject({ fieldText: '5pm', dates: { due: '2027-04-15' } });
    expect(result.diagnostics).toEqual([]);
  });

  it('ignores inactive statuses', () => {
    const source = '- [x] #task Done 🔔 5pm 📅 2027-04-15';
    expect(discoverTasks('Tasks.md', source, configuration).tasks).toEqual([]);
  });

  it('selects the bell and expression up to Tasks metadata', () => {
    const line = '- [ ] Write `🔔` example 🔔 5pm ⏫ 📅 2027-04-15';
    const range = reminderFieldRange(line)!;
    expect(line.slice(range.start, range.end)).toBe('🔔 5pm ');
    expect(reminderFieldRange('- [ ] No reminder 📅 2027-04-15')).toBeUndefined();
  });
});

describe('settings parsing', () => {
  it('accepts valid default alert times', () => {
    expect(parseDefaultAlertTime('09:00')).toEqual({ hour: 9, minute: 0, second: 0 });
    expect(parseDefaultAlertTime('24:00')).toBeUndefined();
  });

  it('generates timezone choices with offsets and IANA names', () => {
    const options = timeZoneOptions('America/Los_Angeles', new Date('2027-01-15T12:00:00Z'));
    expect(options.find(({ value }) => value === 'America/Los_Angeles')?.label)
      .toBe('UTC-08:00 — America/Los_Angeles');
    expect(options.find(({ value }) => value === 'UTC')?.label).toBe('UTC+00:00 — UTC');
  });
});
