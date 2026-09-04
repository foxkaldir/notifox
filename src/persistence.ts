import type { NotifoxSettings } from './settings';
import type { TasksConfiguration } from './integrations/obsidian-tasks-plugin';
import type { ExportReminder } from './types';

export interface PluginData extends NotifoxSettings {
  scanIndex?: ScanIndex;
}

const SCAN_INDEX_VERSION = 3;
const EXPORTER_SCHEMA_VERSION = 3;
const PERSISTENCE_VERSION = 4;
const HEX_HASH = /^[0-9a-f]{64}$/;
const BASE64URL_HASH = /^[A-Za-z0-9_-]{43}$/;

export interface FileScanEntry {
  mtime: number;
  size: number;
  lastScannedAt: number;
  contentHash: string;
  reminders: ExportReminder[];
  refreshAfter?: string;
  fingerprint: string;
}

export interface ScanIndex {
  version: number;
  files: Record<string, FileScanEntry>;
  outputRetryNeeded: boolean;
}

// Creates a clean index for first-run or recovery scans.
function emptyScanIndex(): ScanIndex {
  return { version: SCAN_INDEX_VERSION, files: {}, outputRetryNeeded: false };
}

// Checks the persisted shape of one reminder record.
function isReminder(value: unknown): value is ExportReminder {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const oneShots = record['one-shots'];
  const repeat = record.repeat as Record<string, unknown> | undefined;
  return Number.isInteger(record.line) && (record.line as number) > 0
    && (oneShots === undefined || (Array.isArray(oneShots) && oneShots.every((item) => {
      return Boolean(item) && typeof item === 'object' && typeof (item as Record<string, unknown>).timestamp === 'string';
    })))
    && (repeat === undefined || (typeof repeat === 'object' && repeat !== null
      && typeof repeat.timestamp === 'string' && typeof repeat.duration === 'number'));
}

// Accepts only a complete, compatible persisted index.
function readScanIndex(value: unknown): ScanIndex | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<ScanIndex>;
  if (candidate.version !== SCAN_INDEX_VERSION || !candidate.files || typeof candidate.files !== 'object'
    || (candidate.outputRetryNeeded !== undefined && typeof candidate.outputRetryNeeded !== 'boolean')) return undefined;
  for (const entryValue of Object.values(candidate.files)) {
    if (!entryValue || typeof entryValue !== 'object') return undefined;
    const entry = entryValue as Partial<FileScanEntry>;
    if (!Number.isFinite(entry.mtime) || !Number.isFinite(entry.size) || !Number.isFinite(entry.lastScannedAt)
      || typeof entry.contentHash !== 'string' || !HEX_HASH.test(entry.contentHash)
      || typeof entry.fingerprint !== 'string' || !HEX_HASH.test(entry.fingerprint)
      || !Array.isArray(entry.reminders) || !entry.reminders.every(isReminder)
      || (entry.refreshAfter !== undefined
        && (typeof entry.refreshAfter !== 'string' || !Number.isFinite(Date.parse(entry.refreshAfter))))) return undefined;
  }
  return {
    version: SCAN_INDEX_VERSION,
    files: candidate.files as Record<string, FileScanEntry>,
    outputRetryNeeded: candidate.outputRetryNeeded === true
  };
}

// Produces a lowercase SHA-256 digest for cache comparisons.
async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Hashes every setting that can change exported reminders.
export async function configurationFingerprint(
  timeZone: string,
  defaultAlertTime: string,
  vaultName: string,
  configuration: TasksConfiguration
): Promise<string> {
  const statuses = [...configuration.statusTypes].sort(([left], [right]) => left.localeCompare(right));
  return sha256(JSON.stringify({
    exporterSchemaVersion: EXPORTER_SCHEMA_VERSION,
    timeZone,
    defaultAlertTime,
    vaultName,
    globalFilter: configuration.globalFilter,
    statusTypes: statuses
  }));
}

// Finds the earliest timestamp that can make cached results stale.
function refreshAfter(reminders: ExportReminder[]): string | undefined {
  return reminders.flatMap((reminder) => [
    ...(reminder['one-shots'] ?? []).map((item) => item.timestamp),
    ...(reminder.repeat ? [reminder.repeat.timestamp] : [])
  ]).sort()[0];
}

// Groups the delivery server and reminders into the stable exported representation.
export function canonicalOutput(vault: string, ntfyServer: string, files: Record<string, FileScanEntry>): string {
  const groupedFiles = Object.fromEntries(Object.entries(files)
    .filter(([, entry]) => entry.reminders.length > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, entry]) => [path, [...entry.reminders].sort((left, right) => left.line - right.line)]));
  return `${JSON.stringify({ 'ntfy-server': ntfyServer, [vault]: groupedFiles }, null, 2)}\n`;
}

// Compares already sorted reminder lists by their serialized value.
function remindersEqual(left: ExportReminder[], right: ExportReminder[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

// Decides whether metadata permits reusing a cached file result.
export function shouldScanEntry(
  entry: FileScanEntry | undefined,
  stat: { mtime: number; size: number },
  nowEpochMilliseconds: number,
  fingerprint: string
): { scan: boolean; reparse: boolean } {
  if (!entry) return { scan: true, reparse: false };
  const expired = entry.refreshAfter !== undefined && nowEpochMilliseconds > Date.parse(entry.refreshAfter);
  return {
    scan: entry.mtime !== stat.mtime || entry.size !== stat.size || stat.mtime > entry.lastScannedAt
      || expired || entry.fingerprint !== fingerprint,
    reparse: expired
  };
}

type ReminderTuple = [number, string[] | null, [string, number] | null];
type FileTuple = [
  // path: Markdown file path relative to the vault root.
  string,
  // mtime: File modification time in milliseconds since the Unix epoch.
  number,
  // size: File size in bytes.
  number,
  // lastScannedAt: Last completed scan time in milliseconds since the Unix epoch.
  number,
  // contentHash: File content SHA-256 digest encoded as unpadded base64url.
  string,
  // fingerprintIndex: Zero-based index of the scan configuration fingerprint in CompactScanIndex.h.
  number,
  // refreshAfter: Earliest cached reminder timestamp, or null when no refresh is scheduled.
  string | null,
  // reminders: Cached [line, one-shot timestamps or null, [repeat timestamp, interval seconds] or null] tuples.
  ReminderTuple[]
];

interface CompactScanIndex {
  // Persistence format version used to validate the compact index.
  v: number;
  // Deduplicated configuration fingerprints encoded as unpadded base64url SHA-256 hashes.
  h: string[];
  // File scan tuples sorted by path; each references its fingerprint by index in h.
  f: FileTuple[];
  // Whether writing the exported reminder output still needs to be retried.
  r: boolean;
}

interface EncodedPluginData {
  vaultId: string;
  timeZone: string;
  defaultAlertTime: string;
  ntfyServer: string;
  scanIndex: CompactScanIndex;
}

// Converts a lowercase hexadecimal SHA-256 digest to unpadded base64url.
function encodeHash(hash: string): string {
  if (!HEX_HASH.test(hash)) throw new Error('Cannot persist an invalid SHA-256 hash.');
  let binary = '';
  for (let offset = 0; offset < hash.length; offset += 2) {
    binary += String.fromCharCode(Number.parseInt(hash.slice(offset, offset + 2), 16));
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

// Converts an unpadded base64url SHA-256 digest to lowercase hexadecimal.
function decodeHash(hash: string): string | undefined {
  if (!BASE64URL_HASH.test(hash)) return undefined;
  try {
    const binary = atob(hash.replaceAll('-', '+').replaceAll('_', '/') + '=');
    if (binary.length !== 32) return undefined;
    const decoded = [...binary].map((character) => character.charCodeAt(0).toString(16).padStart(2, '0')).join('');
    return encodeHash(decoded) === hash ? decoded : undefined;
  } catch {
    return undefined;
  }
}

// Encodes one runtime reminder without repeated property names.
function encodeReminder(reminder: ExportReminder): ReminderTuple {
  const oneShots = reminder['one-shots']?.map(({ timestamp }) => timestamp) ?? null;
  const repeat = reminder.repeat ? [reminder.repeat.timestamp, reminder.repeat.duration] as [string, number] : null;
  return [reminder.line, oneShots, repeat];
}

// Decodes and validates one compact reminder tuple.
function decodeReminder(value: unknown): ExportReminder | undefined {
  if (!Array.isArray(value) || value.length !== 3 || !Number.isInteger(value[0]) || value[0] < 1) return undefined;
  const [line, oneShots, repeat] = value;
  if (oneShots !== null && (!Array.isArray(oneShots)
    || !oneShots.every((timestamp: unknown) => typeof timestamp === 'string'))) {
    return undefined;
  }
  if (repeat !== null && (!Array.isArray(repeat) || repeat.length !== 2
    || typeof repeat[0] !== 'string' || !Number.isFinite(repeat[1]))) return undefined;
  const reminder: ExportReminder = { line };
  if (oneShots !== null) reminder['one-shots'] = (oneShots as string[]).map((timestamp) => ({ timestamp }));
  if (repeat !== null) reminder.repeat = { timestamp: repeat[0], duration: repeat[1] };
  return reminder;
}

// Encodes the runtime scan index into deterministic compact version 4 tuples.
function encodeScanIndex(index: ScanIndex): CompactScanIndex {
  const hashes = [...new Set(Object.values(index.files).map((entry) => entry.fingerprint))].sort();
  const hashIndexes = new Map(hashes.map((hash, position) => [hash, position]));
  const files = Object.entries(index.files).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([path, entry]) => [
    path,
    entry.mtime,
    entry.size,
    entry.lastScannedAt,
    encodeHash(entry.contentHash),
    hashIndexes.get(entry.fingerprint)!,
    entry.refreshAfter ?? null,
    entry.reminders.map(encodeReminder)
    ] satisfies FileTuple);
  return { v: PERSISTENCE_VERSION, h: hashes.map(encodeHash), f: files, r: index.outputRetryNeeded };
}

// Decodes a complete compact version 4 scan index or rejects it for a safe rescan.
function decodeScanIndex(value: unknown): ScanIndex | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as Partial<CompactScanIndex>;
  if (candidate.v !== PERSISTENCE_VERSION || !Array.isArray(candidate.h) || !Array.isArray(candidate.f)
    || typeof candidate.r !== 'boolean') return undefined;
  const hashes = candidate.h.map((hash) => typeof hash === 'string' ? decodeHash(hash) : undefined);
  if (hashes.some((hash) => hash === undefined)) return undefined;
  const files: Record<string, FileScanEntry> = {};
  for (const valueEntry of candidate.f) {
    if (!Array.isArray(valueEntry) || valueEntry.length !== 8) return undefined;
    const [path, mtime, size, lastScannedAt, encodedContentHash, fingerprintIndex, refreshTime, reminderValues] = valueEntry;
    const contentHash = typeof encodedContentHash === 'string' ? decodeHash(encodedContentHash) : undefined;
    if (typeof path !== 'string' || Object.hasOwn(files, path)
      || !Number.isFinite(mtime) || !Number.isFinite(size) || !Number.isFinite(lastScannedAt)
      || contentHash === undefined || !Number.isInteger(fingerprintIndex)
      || fingerprintIndex < 0 || fingerprintIndex >= hashes.length
      || (refreshTime !== null && (typeof refreshTime !== 'string' || !Number.isFinite(Date.parse(refreshTime))))
      || !Array.isArray(reminderValues)) return undefined;
    const reminders = reminderValues.map(decodeReminder);
    if (reminders.some((reminder) => reminder === undefined)) return undefined;
    files[path] = {
      mtime,
      size,
      lastScannedAt,
      contentHash,
      fingerprint: hashes[fingerprintIndex]!,
      reminders: reminders as ExportReminder[],
      ...(refreshTime === null ? {} : { refreshAfter: refreshTime })
    };
  }
  return { version: SCAN_INDEX_VERSION, files, outputRetryNeeded: candidate.r };
}

// Encodes runtime plugin data for compact deterministic persistence.
function encodePluginData(data: PluginData): EncodedPluginData {
  return {
    vaultId: data.vaultId,
    timeZone: data.timeZone,
    defaultAlertTime: data.defaultAlertTime,
    ntfyServer: data.ntfyServer,
    scanIndex: encodeScanIndex(data.scanIndex ?? emptyScanIndex())
  };
}

// Loads valid settings and scan state, recovering an empty index when the cache is invalid.
export function decodePluginData(value: unknown): Partial<NotifoxSettings> & { scanIndex: ScanIndex } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { scanIndex: emptyScanIndex() };
  const candidate = value as Record<string, unknown>;
  const decoded: Partial<NotifoxSettings> & { scanIndex: ScanIndex } = {
    scanIndex: decodeScanIndex(candidate.scanIndex) ?? readScanIndex(candidate.scanIndex) ?? emptyScanIndex()
  };
  if (typeof candidate.vaultId === 'string') decoded.vaultId = candidate.vaultId;
  if (typeof candidate.timeZone === 'string') decoded.timeZone = candidate.timeZone;
  if (typeof candidate.defaultAlertTime === 'string') decoded.defaultAlertTime = candidate.defaultAlertTime;
  if (typeof candidate.ntfyServer === 'string') decoded.ntfyServer = candidate.ntfyServer;
  return decoded;
}

// Produces the exact minified bytes written to internal data.json.
export function serializePluginData(data: PluginData): string {
  return JSON.stringify(encodePluginData(data));
}

// Hashes file content, reuses valid reminders, and builds the next cached scan result.
export async function updateScanEntry(options: {
  previous: FileScanEntry | undefined;
  content: string;
  stat: { mtime: number; size: number };
  fingerprint: string;
  reparse: boolean;
  collectReminders: () => ExportReminder[];
}): Promise<{ entry: FileScanEntry; remindersChanged: boolean }> {
  const { previous, content, stat, fingerprint, reparse, collectReminders } = options;
  const contentHash = await sha256(content);
  const reminders = reparse || !previous || previous.contentHash !== contentHash || previous.fingerprint !== fingerprint
    ? collectReminders().sort((left, right) => left.line - right.line)
    : previous.reminders;
  const entry: FileScanEntry = {
    mtime: stat.mtime,
    size: stat.size,
    lastScannedAt: Date.now(),
    contentHash,
    reminders,
    refreshAfter: refreshAfter(reminders),
    fingerprint
  };
  return {
    entry,
    remindersChanged: !previous || previous.fingerprint !== fingerprint || !remindersEqual(previous.reminders, reminders)
  };
}
