export interface TimeZoneOption {
  value: string;
  label: string;
  offsetMinutes: number;
}

// Returns the runtime's IANA zones while retaining UTC and the configured zone.
function supportedTimeZones(configuredTimeZone: string): string[] {
  const zones = typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : [Intl.DateTimeFormat().resolvedOptions().timeZone];
  return [...new Set([...zones, 'UTC', configuredTimeZone].filter(Boolean))];
}

// Gets a zone's UTC offset in minutes at the supplied instant.
function offsetMinutes(timeZone: string, at: Date): number {
  const name = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset'
  }).formatToParts(at).find((part) => part.type === 'timeZoneName')?.value;
  if (!name || name === 'GMT') return 0;
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(name);
  if (!match) throw new Error(`Unsupported UTC offset: ${name}`);
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
}

// Formats a signed minute offset for a compact dropdown label.
function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const absolute = Math.abs(minutes);
  const hours = Math.floor(absolute / 60).toString().padStart(2, '0');
  const remainder = (absolute % 60).toString().padStart(2, '0');
  return `UTC${sign}${hours}:${remainder}`;
}

// Builds dropdown options ordered by current offset and then IANA name.
export function timeZoneOptions(configuredTimeZone: string, at = new Date()): TimeZoneOption[] {
  return supportedTimeZones(configuredTimeZone)
    .map((value) => {
      try {
        const offset = offsetMinutes(value, at);
        return { value, label: `${formatOffset(offset)} — ${value}`, offsetMinutes: offset };
      } catch {
        return { value, label: `Unknown offset — ${value}`, offsetMinutes: Number.POSITIVE_INFINITY };
      }
    })
    .sort((left, right) => left.offsetMinutes - right.offsetMinutes || left.value.localeCompare(right.value));
}
