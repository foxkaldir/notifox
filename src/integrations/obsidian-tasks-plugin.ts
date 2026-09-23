import type { App } from 'obsidian';
import type { Diagnostic, DiscoveredTask, Priority, StatusType } from '../types';

const TASKS_PLUGIN_ID = 'obsidian-tasks-plugin';
const TASK_METADATA_EMOJI = ['📅', '⏳', '🛫', '➕', '✅', '❌', '🔁', '🔺', '⏫', '🔼', '🔽', '⏬', '🆔', '⛔', '🏁'];
const TASK_METADATA = new RegExp(TASK_METADATA_EMOJI.join('|'), 'g');
const ACTIVE_TYPES = new Set<StatusType>(['TODO', 'IN_PROGRESS', 'ON_HOLD']);
const PRIORITIES: Record<string, Priority> = { '🔺': 'highest', '⏫': 'high', '🔼': 'medium', '🔽': 'low', '⏬': 'lowest' };

export interface TasksConfiguration {
  globalFilter: string;
  statusTypes: Map<string, StatusType>;
}

export interface TasksConfigurationResult {
  ok: true;
  configuration: TasksConfiguration;
}

export interface TasksConfigurationFailure {
  ok: false;
  diagnostic: Diagnostic;
}

export interface DiscoveryDiagnostic extends Diagnostic {
  line: number;
  range: { start: number; end: number };
}

// Validates an explicitly assigned Tasks priority.
export function isPriority(value: unknown): value is Priority {
  return typeof value === 'string' && ['highest', 'high', 'medium', 'low', 'lowest'].includes(value);
}

function statusType(value: unknown): StatusType | undefined {
  return typeof value === 'string' && ['TODO', 'IN_PROGRESS', 'ON_HOLD', 'DONE', 'CANCELLED', 'NON_TASK'].includes(value)
    ? value as StatusType : undefined;
}

function hasEmojiTaskFormat(settings: Record<string, unknown>): boolean {
  const candidate = settings.taskFormat ?? settings.taskFormatName ?? settings.taskFormatIdentifier;
  if (candidate === undefined) return true;
  return typeof candidate === 'string' && /emoji/i.test(candidate);
}

function customStatusTypes(settings: Record<string, unknown>): Map<string, StatusType> {
  const statuses = new Map<string, StatusType>([
    [' ', 'TODO'], ['/', 'IN_PROGRESS'], ['<', 'ON_HOLD'], ['x', 'DONE'], ['X', 'DONE'], ['-', 'CANCELLED']
  ]);
  const candidates = [settings.customStatuses, settings.statuses, settings.statusConfigurations];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    for (const item of candidate) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const symbol = record.symbol;
      const type = statusType(record.type ?? record.statusType);
      if (typeof symbol === 'string' && symbol.length === 1 && type) statuses.set(symbol, type);
    }
  }
  return statuses;
}

export async function readTasksConfiguration(app: App): Promise<TasksConfigurationResult | TasksConfigurationFailure> {
  const pluginManager = (app as unknown as { plugins?: { getPlugin(id: string): unknown } }).plugins;
  const plugin = pluginManager?.getPlugin(TASKS_PLUGIN_ID) as { manifest?: { version?: string }; settings?: unknown; _settings?: unknown } | null;
  if (!plugin) return { ok: false, diagnostic: { code: 'TASKS_UNAVAILABLE', message: 'Enable the Tasks plugin to export reminders.' } };
  const version = plugin.manifest?.version;
  if (!version || Number.parseInt(version.split('.')[0], 10) < 8) {
    return { ok: false, diagnostic: { code: 'TASKS_VERSION', message: 'Notifox Reminders requires Tasks 8.x or later.' } };
  }
  let rawSettings = plugin.settings ?? plugin._settings;
  if (!rawSettings || typeof rawSettings !== 'object') {
    try {
      const settingsPath = `${app.vault.configDir}/plugins/${TASKS_PLUGIN_ID}/data.json`;
      rawSettings = JSON.parse(await app.vault.adapter.read(settingsPath)) as unknown;
    } catch {
      // Tasks has no stable query API; fail below when its persisted settings are unavailable.
    }
  }
  if (!rawSettings || typeof rawSettings !== 'object') {
    return { ok: false, diagnostic: { code: 'TASKS_SETTINGS', message: 'Tasks settings are not available to the exporter.' } };
  }
  const settings = rawSettings as Record<string, unknown>;
  if (!hasEmojiTaskFormat(settings)) {
    return { ok: false, diagnostic: { code: 'TASKS_FORMAT', message: 'Configure Tasks to use Tasks Emoji format.' } };
  }
  const globalFilter = settings.globalFilter;
  if (globalFilter !== undefined && typeof globalFilter !== 'string') {
    return { ok: false, diagnostic: { code: 'TASKS_SETTINGS', message: 'Tasks Global Filter has an unsupported configuration.' } };
  }
  return { ok: true, configuration: { globalFilter: globalFilter ?? '', statusTypes: customStatusTypes(settings) } };
}

// Finds field bells outside inline code, including adjacent task emoji.
function nonCodeBellPositions(text: string): number[] {
  const positions: number[] = [];
  let code = false;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '`') code = !code;
    if (!code && text.startsWith('🔔', index) && (index === 0 || /\s/.test(text[index - 1])
      || ['🔔', ...TASK_METADATA_EMOJI].some((emoji) => text.slice(0, index).endsWith(emoji)))) {
      positions.push(index);
      index += '🔔'.length - 1;
    }
  }
  return positions;
}

// Finds the first Tasks metadata field in a task body.
function metadataStart(text: string): number | undefined {
  const match = TASK_METADATA.exec(text);
  TASK_METADATA.lastIndex = 0;
  return match?.index;
}

// Locates the complete reminder field on a task line for editor highlighting.
export function reminderFieldRange(rawLine: string): { start: number; end: number } | undefined {
  const match = /^(?:\s*(?:[-*+]|\d+[.)])\s+\[[^\]]\]\s+)(.*)$/.exec(rawLine);
  if (!match) return undefined;
  const body = match[1];
  const bell = nonCodeBellPositions(body)[0];
  if (bell === undefined) return undefined;
  const start = rawLine.length - body.length + bell;
  const afterBell = bell + '🔔'.length;
  const nextMetadata = metadataStart(body.slice(afterBell));
  return { start, end: nextMetadata === undefined ? rawLine.length : rawLine.length - body.length + afterBell + nextMetadata };
}

function taskDates(text: string): { due?: string; scheduled?: string; start?: string } {
  const find = (emoji: string): string | undefined => new RegExp(`${emoji}\\s*(\\d{4}-\\d{2}-\\d{2})`).exec(text)?.[1];
  return { due: find('📅'), scheduled: find('⏳'), start: find('🛫') };
}

function matchesGlobalFilter(body: string, globalFilter: string): boolean {
  if (!globalFilter) return true;
  return body.toLocaleLowerCase().includes(globalFilter.toLocaleLowerCase());
}

// Removes the configured literal Global Filter from the reminder description.
function reminderText(description: string, globalFilter: string): string {
  if (!globalFilter) return description.trim();
  const escaped = globalFilter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return description.replace(new RegExp(escaped, 'gi'), '').trim();
}

// Discovers active reminder tasks and their description, priority, and schedule fields.
export function discoverTasks(
  path: string,
  content: string,
  configuration: TasksConfiguration
): { tasks: DiscoveredTask[]; diagnostics: DiscoveryDiagnostic[] } {
  const tasks: DiscoveredTask[] = [];
  const diagnostics: DiscoveryDiagnostic[] = [];
  const lines = content.split(/\r?\n/);
  for (let offset = 0; offset < lines.length; offset += 1) {
    const rawLine = lines[offset];
    const match = /^(?:\s*(?:[-*+]|\d+[.)])\s+\[([^\]])\]\s+)(.*)$/.exec(rawLine);
    if (!match) continue;
    const [, symbol, body] = match;
    const bodyStart = rawLine.length - body.length;
    if (!matchesGlobalFilter(body, configuration.globalFilter)) continue;
    const statusType = configuration.statusTypes.get(symbol) ?? (symbol === ' ' ? 'TODO' : 'DONE');
    if (!ACTIVE_TYPES.has(statusType)) continue;
    const bells = nonCodeBellPositions(body);
    if (!bells.length) continue;
    if (bells.length > 1) {
      diagnostics.push({
        code: 'MULTIPLE_REMINDER_FIELDS',
        message: 'The task contains more than one reminder field.',
        line: offset + 1,
        range: { start: bodyStart + bells[0], end: bodyStart + bells[bells.length - 1] + '🔔'.length }
      });
      continue;
    }
    const bell = bells[0];
    const metadata = metadataStart(body);
    if (metadata !== undefined && bell > metadata) {
      diagnostics.push({
        code: 'INVALID_FIELD_POSITION',
        message: 'The reminder field must appear before all Tasks metadata.',
        line: offset + 1,
        range: { start: bodyStart + bell, end: bodyStart + bell + '🔔'.length }
      });
      continue;
    }
    const fieldStart = bell + '🔔'.length;
    const fieldEnd = metadata ?? body.length;
    const rawField = body.slice(fieldStart, fieldEnd);
    const leadingWhitespace = rawField.length - rawField.trimStart().length;
    const priorityEmoji = metadata === undefined ? undefined : /🔺|⏫|🔼|🔽|⏬/.exec(body.slice(metadata))?.[0];
    tasks.push({
      text: reminderText(body.slice(0, bell), configuration.globalFilter),
      ...(priorityEmoji ? { priority: PRIORITIES[priorityEmoji] } : {}),
      path,
      lineNumber: offset + 1,
      rawLine,
      statusType,
      dates: taskDates(body),
      fieldText: rawField.trim(),
      fieldTextStart: bodyStart + fieldStart + leadingWhitespace,
      fieldRange: {
        start: bodyStart + bell,
        end: Math.max(bodyStart + bell + '🔔'.length, bodyStart + fieldEnd)
      }
    });
  }
  return { tasks, diagnostics };
}
