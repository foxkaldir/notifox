import { Temporal } from '@js-temporal/polyfill';
import { Notice, TFile, TFolder, normalizePath, requestUrl, type App, type TAbstractFile } from 'obsidian';
import {
  classifyServerResponse, OperationalError, operationalDiagnostic, serverTransportDiagnostic,
  retryDelayMilliseconds, type FileDiagnostic, type OperationalDiagnostic
} from './diagnostics/model';
import { isNtfyTopicUrl } from './integrations/ntfy';
import { parse } from './parser';
import { parseDefaultAlertTime, resolutionDiagnostic, resolveReminder } from './resolver';
import {
  canonicalOutput, configurationFingerprint, shouldScanEntry, updateScanEntry,
  type PluginData, type ScanIndex
} from './persistence';
import type { NotifoxSettings } from './settings';
import { discoverTasks, readTasksConfiguration, type TasksConfiguration } from './integrations/obsidian-tasks-plugin';
import type { ExportReminder, LocalTime, ResolverSettings } from './types';

const DEBOUNCE_MS = 350;
const MAX_BATCH_DELAY_MS = 2000;
const SETTINGS_DEBOUNCE_MS = 600;
const MAX_CONCURRENT_READS = 4;

interface DirtyPath {
  generation: number;
  reparse: boolean;
}

interface ExporterOptions {
  app: App;
  outputPath: string;
  index: ScanIndex;
  getSettings: () => NotifoxSettings;
  saveData: (data: PluginData) => Promise<void>;
  diagnostics: DiagnosticsReporter;
}

interface DiagnosticsReporter {
  setFile(path: string, diagnostics: FileDiagnostic[], exportedLines?: number[]): void;
  removeFile(path: string): void;
  report(issue: OperationalDiagnostic, notify?: boolean): void;
  reportServer(issue: OperationalDiagnostic): void;
  clear(code: string): void;
  serverConnected(): void;
  setServerPending(pending: boolean): void;
}

// Identifies Markdown paths without requiring a live file object.
function markdownPath(path: string): boolean {
  return path.toLocaleLowerCase().endsWith('.md');
}

// Tests whether a path belongs to a folder subtree.
function pathWithin(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`);
}

// Extracts and resolves reminder records from one note's content.
function collectFileReminders(
  path: string,
  content: string,
  configuration: TasksConfiguration,
  resolver: ResolverSettings
): { reminders: ExportReminder[]; diagnostics: FileDiagnostic[] } {
  const discovered = discoverTasks(path, content, configuration);
  const diagnostics: FileDiagnostic[] = discovered.diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    message: diagnostic.message,
    line: diagnostic.line,
    range: diagnostic.range,
    severity: 'error',
    source: 'local'
  }));
  const reminders = discovered.tasks.flatMap((task) => {
    const parsed = parse(task.fieldText);
    if (!parsed.ok) {
      const range = parsed.diagnostic.range
        ? {
          start: task.fieldTextStart + parsed.diagnostic.range.start,
          end: task.fieldTextStart + parsed.diagnostic.range.end
        }
        : task.fieldRange;
      diagnostics.push({
        code: parsed.diagnostic.code,
        message: parsed.diagnostic.message,
        line: task.lineNumber,
        range,
        severity: 'error',
        source: 'local'
      });
      return [];
    }
    const unresolved = resolutionDiagnostic(parsed.field, task);
    if (unresolved) {
      diagnostics.push({
        code: unresolved.code,
        message: unresolved.message,
        line: task.lineNumber,
        range: task.fieldRange,
        severity: 'error',
        source: 'local'
      });
      return [];
    }
    const resolved = resolveReminder(parsed.field, task, resolver);
    if (!resolved) return [];
    const record: ExportReminder = { line: task.lineNumber, text: task.text };
    if (task.priority) record.priority = task.priority;
    if (resolved.oneShots.length) {
      record['one-shots'] = resolved.oneShots.map((instant) => ({ timestamp: instant.toString() }));
    }
    if (resolved.repeat) {
      record.repeat = { timestamp: resolved.repeat.timestamp.toString(), duration: resolved.repeat.duration };
    }
    return [record];
  });
  return { reminders, diagnostics };
}

export class IncrementalReminderExporter {
  private readonly app: App;
  private readonly outputPath: string;
  private readonly getSettings: () => NotifoxSettings;
  private readonly saveData: (data: PluginData) => Promise<void>;
  private readonly diagnostics: DiagnosticsReporter;
  private readonly index: ScanIndex;
  private readonly dirty = new Map<string, DirtyPath>();
  private generation = 0;
  private quietTimer: number | undefined;
  private maxTimer: number | undefined;
  private settingsTimer: number | undefined;
  private serverRetryTimer: number | undefined;
  private batchRunning = false;
  private runAgain = false;
  private reconcilePending = false;
  private inspectOutputPending = false;
  private forceAllPending = false;
  private manualNoticePending = false;
  private wasHidden = false;
  private unloaded = false;
  private lastOutputBytes: string | undefined;
  private outputVerified = false;
  private lastFailure = '';
  private lastFailureCode = '';
  private serverRetryBlocked = false;
  private nextServerRetryAt = 0;
  private persistChain: Promise<void> = Promise.resolve();

  // Captures the vault dependencies and persisted index.
  constructor(options: ExporterOptions) {
    this.app = options.app;
    this.outputPath = options.outputPath;
    this.index = options.index;
    this.getSettings = options.getSettings;
    this.saveData = options.saveData;
    this.diagnostics = options.diagnostics;
  }

  // Persists normalized state before event processing begins.
  initialize(): Promise<void> {
    this.diagnostics.setServerPending(this.index.serverRetryNeeded);
    return this.persistData();
  }

  // Starts the initial vault and output reconciliation.
  start(): void {
    this.requestReconciliation(true);
  }

  // Cancels timers and prevents workers from taking more jobs.
  stop(): void {
    this.unloaded = true;
    this.clearBatchTimers();
    if (this.settingsTimer !== undefined) window.clearTimeout(this.settingsTimer);
    if (this.serverRetryTimer !== undefined) window.clearTimeout(this.serverRetryTimer);
  }

  // Saves settings immediately and debounces their rescan.
  async settingsChanged(): Promise<void> {
    const serverEnabled = this.getSettings().notifoxServer.trim().length > 0;
    this.index.serverRetryNeeded = serverEnabled;
    this.serverRetryBlocked = false;
    this.nextServerRetryAt = 0;
    if (this.serverRetryTimer !== undefined) window.clearTimeout(this.serverRetryTimer);
    this.serverRetryTimer = undefined;
    this.diagnostics.setServerPending(serverEnabled);
    if (!serverEnabled) this.diagnostics.serverConnected();
    await this.persistData();
    if (this.settingsTimer !== undefined) window.clearTimeout(this.settingsTimer);
    this.settingsTimer = window.setTimeout(() => {
      this.settingsTimer = undefined;
      this.requestReconciliation(true);
    }, SETTINGS_DEBOUNCE_MS);
  }

  // Reconciles once after a real background-to-foreground transition.
  visibilityChanged(hidden: boolean): void {
    if (hidden) {
      this.wasHidden = true;
      return;
    }
    if (!this.wasHidden) return;
    this.wasHidden = false;
    this.requestReconciliation(true);
  }

  // Queues affected Markdown files after create or modify events.
  createdOrModified(file: TAbstractFile): void {
    if (file instanceof TFile && file.extension === 'md') this.markDirty(file.path);
    if (file instanceof TFolder) this.markFolderFiles(file);
  }

  // Queues removal of a deleted file or indexed folder subtree.
  deleted(file: TAbstractFile): void {
    if (file instanceof TFile && markdownPath(file.path)) this.markDirty(file.path);
    if (file instanceof TFolder) this.markIndexedFolder(file.path);
  }

  // Queues both sides of a file or folder rename.
  renamed(file: TAbstractFile, oldPath: string): void {
    if (file instanceof TFile) {
      if (markdownPath(oldPath)) this.markDirty(oldPath);
      if (file.extension === 'md') this.markDirty(file.path);
      return;
    }
    if (!(file instanceof TFolder)) return;
    this.markIndexedFolder(oldPath);
    this.markFolderFiles(file);
  }

  // Forces every Markdown file to be read and the output verified.
  regenerate(): void {
    this.forceAllPending = true;
    this.inspectOutputPending = true;
    this.manualNoticePending = true;
    if (this.index.serverRetryNeeded) {
      this.serverRetryBlocked = false;
      this.nextServerRetryAt = 0;
      if (this.serverRetryTimer !== undefined) window.clearTimeout(this.serverRetryTimer);
      this.serverRetryTimer = undefined;
    }
    this.scheduleBatch(0);
  }

  // Queues the latest local snapshot for an explicit server retry.
  retryServer(): void {
    if (!this.getSettings().notifoxServer.trim()) return;
    this.index.serverRetryNeeded = true;
    this.serverRetryBlocked = false;
    this.nextServerRetryAt = 0;
    if (this.serverRetryTimer !== undefined) window.clearTimeout(this.serverRetryTimer);
    this.serverRetryTimer = undefined;
    this.inspectOutputPending = true;
    this.diagnostics.setServerPending(true);
    this.scheduleBatch(0);
  }

  // Adds current Markdown descendants to the dirty-path queue.
  private markFolderFiles(folder: TFolder): void {
    for (const child of folder.children) {
      if (child instanceof TFolder) this.markFolderFiles(child);
      if (child instanceof TFile && child.extension === 'md') this.markDirty(child.path);
    }
  }

  // Adds cached descendants of a removed or renamed folder.
  private markIndexedFolder(folderPath: string): void {
    for (const path of Object.keys(this.index.files)) {
      if (pathWithin(path, folderPath)) this.markDirty(path);
    }
  }

  // Coalesces a path while preserving events received during a scan.
  private markDirty(path: string, reparse = false): void {
    const normalized = normalizePath(path);
    const previous = this.dirty.get(normalized);
    this.dirty.set(normalized, {
      generation: ++this.generation,
      reparse: reparse || previous?.reparse === true
    });
    this.scheduleBatch(DEBOUNCE_MS);
  }

  // Requests metadata reconciliation and optional output inspection.
  private requestReconciliation(inspectOutput: boolean): void {
    this.reconcilePending = true;
    this.inspectOutputPending ||= inspectOutput;
    this.scheduleBatch(DEBOUNCE_MS);
  }

  // Serializes plugin-data writes so newer state cannot be overwritten.
  private persistData(): Promise<void> {
    const snapshot = JSON.parse(JSON.stringify({
      ...this.getSettings(),
      scanIndex: this.index
    } satisfies PluginData)) as PluginData;
    this.persistChain = this.persistChain.catch(() => undefined).then(() => this.saveData(snapshot));
    return this.persistChain;
  }

  // Schedules a quiet-period batch with a maximum burst delay.
  private scheduleBatch(delay: number): void {
    if (this.unloaded) return;
    if (this.quietTimer !== undefined) window.clearTimeout(this.quietTimer);
    this.quietTimer = window.setTimeout(() => {
      this.quietTimer = undefined;
      void this.startBatch();
    }, delay);
    if (this.maxTimer !== undefined) return;
    this.maxTimer = window.setTimeout(() => {
      this.maxTimer = undefined;
      if (this.quietTimer !== undefined) window.clearTimeout(this.quietTimer);
      this.quietTimer = undefined;
      void this.startBatch();
    }, MAX_BATCH_DELAY_MS);
  }

  // Cancels both batch scheduling timers.
  private clearBatchTimers(): void {
    if (this.quietTimer !== undefined) window.clearTimeout(this.quietTimer);
    if (this.maxTimer !== undefined) window.clearTimeout(this.maxTimer);
    this.quietTimer = undefined;
    this.maxTimer = undefined;
  }

  // Runs one batch and arranges a follow-up when events arrived meanwhile.
  private async startBatch(): Promise<void> {
    if (this.unloaded) return;
    if (this.batchRunning) {
      this.runAgain = true;
      return;
    }
    this.clearBatchTimers();
    this.batchRunning = true;
    try {
      await this.processBatch();
      this.lastFailure = '';
      if (this.lastFailureCode) this.diagnostics.clear(this.lastFailureCode);
      this.lastFailureCode = '';
    } catch (error) {
      this.reportFailure(error);
    } finally {
      this.batchRunning = false;
      if (!this.unloaded && this.runAgain) {
        this.runAgain = false;
        this.scheduleBatch(0);
      }
    }
  }

  // Snapshots and clears the flags consumed by one batch.
  private takeBatchRequest(): {
    reconcile: boolean;
    inspectOutput: boolean;
    forceAll: boolean;
    showManualNotice: boolean;
  } {
    const request = {
      reconcile: this.reconcilePending,
      inspectOutput: this.inspectOutputPending,
      forceAll: this.forceAllPending,
      showManualNotice: this.manualNoticePending
    };
    this.reconcilePending = false;
    this.inspectOutputPending = false;
    this.forceAllPending = false;
    this.manualNoticePending = false;
    return request;
  }

  // Restores flags when validation prevents a batch from starting.
  private restoreBatchRequest(request: ReturnType<IncrementalReminderExporter['takeBatchRequest']>): void {
    this.reconcilePending ||= request.reconcile;
    this.inspectOutputPending ||= request.inspectOutput;
    this.forceAllPending ||= request.forceAll;
    this.manualNoticePending ||= request.showManualNotice;
  }

  // Validates configuration and prepares shared scan inputs.
  private async prepareScan(settings: NotifoxSettings): Promise<{
    configuration: TasksConfiguration;
    defaultAlertTime: LocalTime;
    fingerprint: string;
    vaultName: string;
  }> {
    const tasks = await readTasksConfiguration(this.app);
    if (!tasks.ok) throw new OperationalError({
      code: tasks.diagnostic.code,
      message: tasks.diagnostic.message,
      scope: 'configuration',
      severity: 'error',
      retryable: false
    });
    const defaultAlertTime = parseDefaultAlertTime(settings.defaultAlertTime);
    if (!defaultAlertTime) throw new OperationalError({
      code: 'INVALID_DEFAULT_ALERT_TIME',
      message: 'Default alert time must use HH:mm or HH:mm:ss.',
      scope: 'configuration',
      severity: 'error',
      retryable: false
    });
    try {
      Temporal.Now.zonedDateTimeISO(settings.timeZone);
    } catch {
      throw new OperationalError({
        code: 'INVALID_TIME_ZONE',
        message: 'Timezone must be a valid IANA timezone.',
        scope: 'configuration',
        severity: 'error',
        retryable: false
      });
    }
    const vaultName = this.app.vault.getName();
    const fingerprint = await configurationFingerprint(
      settings.timeZone, settings.defaultAlertTime, vaultName, tasks.configuration
    );
    return { configuration: tasks.configuration, defaultAlertTime, fingerprint, vaultName };
  }

  // Coordinates reconciliation, scanning, persistence, and output repair.
  private async processBatch(): Promise<void> {
    const request = this.takeBatchRequest();
    const settings = { ...this.getSettings() };
    let scan: Awaited<ReturnType<IncrementalReminderExporter['prepareScan']>>;
    try {
      scan = await this.prepareScan(settings);
    } catch (error) {
      this.restoreBatchRequest(request);
      throw error;
    }

    const now = Temporal.Now.instant();
    const work = this.collectWork(request.reconcile, request.forceAll, scan.fingerprint, now);
    const result = await this.scanFiles(work.paths, scan, settings, now);
    result.remindersChanged ||= work.removedEntries;
    result.indexChanged ||= work.removedEntries;
    if (this.unloaded) return;

    if (request.inspectOutput) await this.readActualOutput();
    const output = this.buildOutputIfNeeded(result.remindersChanged, request.inspectOutput);
    if (result.indexChanged || result.remindersChanged || this.index.outputRetryNeeded || this.index.serverRetryNeeded) {
      await this.persistData();
    }
    const wroteOutput = output === undefined ? false : await this.writeOutputIfChanged(output);
    if (this.outputVerified) this.publishFileHighlights();
    if (output !== undefined && !this.serverRetryBlocked && Date.now() >= this.nextServerRetryAt
      && (wroteOutput || this.index.serverRetryNeeded)) await this.postOutput(output);
    if (result.error) throw result.error;
    if (request.showManualNotice) this.showManualNotice(wroteOutput);
  }

  // Combines dirty paths with files selected by reconciliation metadata.
  private collectWork(
    reconcile: boolean,
    forceAll: boolean,
    fingerprint: string,
    now: Temporal.Instant
  ): { paths: Map<string, DirtyPath>; removedEntries: boolean } {
    const work = new Map(this.dirty);
    const markdownFiles = this.app.vault.getMarkdownFiles();
    const currentPaths = new Set(markdownFiles.map((file) => file.path));

    const removedEntries = reconcile || forceAll ? this.removeVanishedEntries(currentPaths) : false;
    if (reconcile || forceAll) {
      for (const file of markdownFiles) {
        const decision = shouldScanEntry(this.index.files[file.path], file.stat, now.epochMilliseconds, fingerprint);
        if (!forceAll && !decision.scan) continue;
        const dirty = work.get(file.path);
        work.set(file.path, {
          generation: dirty?.generation ?? 0,
          reparse: decision.reparse || dirty?.reparse === true
        });
      }
      return { paths: work, removedEntries };
    }

    if (!Object.values(this.index.files).some((entry) => entry.fingerprint !== fingerprint)) {
      return { paths: work, removedEntries };
    }
    for (const file of markdownFiles) {
      const dirty = work.get(file.path);
      work.set(file.path, { generation: dirty?.generation ?? 0, reparse: dirty?.reparse === true });
    }
    return { paths: work, removedEntries };
  }

  // Drops cached entries for files that no longer exist.
  private removeVanishedEntries(currentPaths: Set<string>): boolean {
    let removed = false;
    for (const path of Object.keys(this.index.files)) {
      if (currentPaths.has(path)) continue;
      delete this.index.files[path];
      this.diagnostics.removeFile(path);
      removed = true;
    }
    return removed;
  }

  // Processes the batch with at most four concurrent file reads.
  private async scanFiles(
    work: Map<string, DirtyPath>,
    scan: Awaited<ReturnType<IncrementalReminderExporter['prepareScan']>>,
    settings: NotifoxSettings,
    now: Temporal.Instant
  ): Promise<{ remindersChanged: boolean; indexChanged: boolean; error?: unknown }> {
    const jobs = [...work.entries()];
    let cursor = 0;
    let remindersChanged = false;
    let indexChanged = false;
    let firstError: unknown;

    const worker = async (): Promise<void> => {
      while (!this.unloaded) {
        const job = jobs[cursor++];
        if (!job) return;
        const [path, dirty] = job;
        try {
          const result = await this.scanPath(path, dirty.reparse, scan, settings, now);
          remindersChanged ||= result.remindersChanged;
          indexChanged ||= result.indexChanged;
          if (dirty.generation > 0 && this.dirty.get(path)?.generation === dirty.generation) this.dirty.delete(path);
        } catch (error) {
          firstError ??= error;
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_READS, jobs.length) }, worker));
    return { remindersChanged, indexChanged, error: firstError };
  }

  // Resolves a dirty path against its final vault state.
  private async scanPath(
    path: string,
    reparse: boolean,
    scan: Awaited<ReturnType<IncrementalReminderExporter['prepareScan']>>,
    settings: NotifoxSettings,
    now: Temporal.Instant
  ): Promise<{ remindersChanged: boolean; indexChanged: boolean }> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || file.extension !== 'md') return this.removeIndexedPath(path);
    try {
      return await this.scanFile(file, reparse, scan, settings, now);
    } catch (error) {
      const finalFile = this.app.vault.getAbstractFileByPath(path);
      if (!(finalFile instanceof TFile)) return this.removeIndexedPath(path);
      const detail = error instanceof Error ? error.message : String(error);
      throw new OperationalError({
        code: 'FILE_SCAN_FAILED',
        message: `Could not scan ${path}.`,
        scope: 'file',
        severity: 'error',
        retryable: true,
        detail
      });
    }
  }

  // Reads, hashes, and conditionally reparses one Markdown file.
  private async scanFile(
    file: TFile,
    reparse: boolean,
    scan: Awaited<ReturnType<IncrementalReminderExporter['prepareScan']>>,
    settings: NotifoxSettings,
    now: Temporal.Instant
  ): Promise<{ remindersChanged: boolean; indexChanged: boolean }> {
    const content = await this.app.vault.cachedRead(file);
    if (this.unloaded) return { remindersChanged: false, indexChanged: false };
    const result = await updateScanEntry({
      previous: this.index.files[file.path],
      content,
      stat: file.stat,
      fingerprint: scan.fingerprint,
      reparse,
      collectFile: () => collectFileReminders(file.path, content, scan.configuration, {
        timeZone: settings.timeZone,
        defaultAlertTime: scan.defaultAlertTime,
        now
      })
    });
    this.index.files[file.path] = result.entry;
    this.diagnostics.setFile(file.path, result.entry.diagnostics);
    return { remindersChanged: result.remindersChanged, indexChanged: true };
  }

  // Removes one cached path and reports whether output may change.
  private removeIndexedPath(path: string): { remindersChanged: boolean; indexChanged: boolean } {
    const existed = this.index.files[path] !== undefined;
    if (existed) delete this.index.files[path];
    this.diagnostics.removeFile(path);
    return { remindersChanged: existed, indexChanged: existed };
  }

  // Publishes green fields only after the current JSON snapshot is confirmed on disk.
  private publishFileHighlights(): void {
    for (const [path, entry] of Object.entries(this.index.files)) {
      this.diagnostics.setFile(path, entry.diagnostics, entry.reminders.map((reminder) => reminder.line));
    }
  }

  // Builds canonical output only when it may need comparison or repair.
  private buildOutputIfNeeded(remindersChanged: boolean, inspectOutput: boolean): string | undefined {
    const serverRetryDue = this.index.serverRetryNeeded && !this.serverRetryBlocked && Date.now() >= this.nextServerRetryAt;
    if (!remindersChanged && !inspectOutput && !this.index.outputRetryNeeded && !serverRetryDue) return undefined;
    const settings = this.getSettings();
    const output = canonicalOutput(this.app.vault.getName(), settings.ntfyServer, this.index.files);
    if (this.lastOutputBytes !== output) this.index.outputRetryNeeded = true;
    return output;
  }

  // Reads the actual output bytes for startup or foreground verification.
  private async readActualOutput(): Promise<void> {
    this.outputVerified = false;
    try {
      this.lastOutputBytes = await this.app.vault.adapter.read(this.outputPath);
    } catch {
      this.lastOutputBytes = undefined;
    }
  }

  // Writes changed bytes and maintains the persistent retry flag.
  private async writeOutputIfChanged(output: string): Promise<boolean> {
    if (this.lastOutputBytes === output) {
      if (this.index.outputRetryNeeded) {
        this.index.outputRetryNeeded = false;
        await this.persistData();
      }
      this.outputVerified = true;
      return false;
    }
    try {
      await this.app.vault.adapter.write(this.outputPath, output);
      this.lastOutputBytes = output;
      this.outputVerified = true;
      this.index.outputRetryNeeded = false;
      if (!isNtfyTopicUrl(this.getSettings().ntfyServer)
        && Object.values(this.index.files).some((entry) => entry.reminders.length > 0)) {
        this.diagnostics.report({
          code: 'INVALID_NTFY_TOPIC',
          message: 'Include one topic in the ntfy URL.',
          scope: 'configuration',
          severity: 'warning',
          retryable: false
        });
      } else {
        this.diagnostics.clear('INVALID_NTFY_TOPIC');
      }
      await this.persistData();
      return true;
    } catch (error) {
      this.outputVerified = false;
      for (const [path, entry] of Object.entries(this.index.files)) {
        this.diagnostics.setFile(path, entry.diagnostics);
      }
      this.index.outputRetryNeeded = true;
      await this.persistData();
      throw error;
    }
  }

  // Posts saved JSON to the configured endpoint without failing local exports.
  private async postOutput(output: string): Promise<void> {
    const url = this.getSettings().notifoxServer.trim();
    if (!url) {
      this.index.serverRetryNeeded = false;
      this.diagnostics.serverConnected();
      return;
    }
    try {
      if (!['http:', 'https:'].includes(new URL(url).protocol)) {
        this.index.serverRetryNeeded = true;
        this.serverRetryBlocked = true;
        this.diagnostics.report({
          code: 'INVALID_NOTIFOX_URL',
          message: 'Use an HTTP or HTTPS URL.',
          scope: 'configuration',
          severity: 'error',
          retryable: false
        });
        this.diagnostics.setServerPending(true);
        await this.persistData();
        return;
      }
      this.diagnostics.clear('INVALID_NOTIFOX_URL');
      this.diagnostics.setServerPending(true);
      const response = await requestUrl({
        url,
        method: 'POST',
        contentType: 'application/json',
        body: output,
        throw: false
      });
      const issue = classifyServerResponse(response);
      if (issue) {
        this.index.serverRetryNeeded = true;
        this.serverRetryBlocked = !issue.retryable;
        const retryDelay = retryDelayMilliseconds(issue);
        this.nextServerRetryAt = Date.now() + retryDelay;
        if (issue.retryable) this.scheduleServerRetry(retryDelay);
        else if (this.serverRetryTimer !== undefined) {
          window.clearTimeout(this.serverRetryTimer);
          this.serverRetryTimer = undefined;
        }
        this.diagnostics.reportServer(issue);
        this.diagnostics.setServerPending(true);
      } else {
        this.index.serverRetryNeeded = false;
        this.serverRetryBlocked = false;
        this.nextServerRetryAt = 0;
        if (this.serverRetryTimer !== undefined) window.clearTimeout(this.serverRetryTimer);
        this.serverRetryTimer = undefined;
        this.diagnostics.serverConnected();
      }
    } catch (error) {
      const issue = serverTransportDiagnostic(error);
      this.index.serverRetryNeeded = true;
      this.serverRetryBlocked = false;
      const retryDelay = retryDelayMilliseconds(issue);
      this.nextServerRetryAt = Date.now() + retryDelay;
      this.scheduleServerRetry(retryDelay);
      this.diagnostics.reportServer(issue);
      this.diagnostics.setServerPending(true);
    }
    await this.persistData();
  }

  // Schedules one bounded retry for a transient server failure.
  private scheduleServerRetry(delay: number): void {
    if (this.serverRetryTimer !== undefined) window.clearTimeout(this.serverRetryTimer);
    this.serverRetryTimer = window.setTimeout(() => {
      this.serverRetryTimer = undefined;
      this.retryServer();
    }, delay);
  }

  // Reports the manual command result without exposing scan internals.
  private showManualNotice(wroteOutput: boolean): void {
    const count = Object.values(this.index.files).reduce((sum, entry) => sum + entry.reminders.length, 0);
    new Notice(`${wroteOutput ? 'Wrote' : 'Verified'} ${count} reminder record${count === 1 ? '' : 's'}.`);
  }

  // Deduplicates repeated operational failures shown to the user.
  private reportFailure(error: unknown): void {
    const issue = operationalDiagnostic(error);
    const key = `${issue.code}\u0000${issue.message}\u0000${issue.detail ?? ''}`;
    if (key === this.lastFailure) return;
    if (this.lastFailureCode && this.lastFailureCode !== issue.code) this.diagnostics.clear(this.lastFailureCode);
    this.lastFailure = key;
    this.lastFailureCode = issue.code;
    this.diagnostics.report(issue);
  }
}
