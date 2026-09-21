import { Plugin, normalizePath } from 'obsidian';
import { DiagnosticManager, operationalDiagnostic } from './diagnostics';
import { IncrementalReminderExporter } from './exporter';
import { decodePluginData, serializePluginData, type PluginData } from './persistence';
import { DEFAULT_SETTINGS, NotifoxSettingTab, type NotifoxSettings } from './settings';

const OUTPUT_FILE = 'reminders.json';
const DATA_FILE = 'data.json';

// Creates a stable identity for a newly configured vault.
function newVaultId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export default class NotifoxRemindersPlugin extends Plugin {
  declare settings: NotifoxSettings;
  diagnostics!: DiagnosticManager;
  private exporter!: IncrementalReminderExporter;

  // Loads state and wires the plugin entry point to the exporter.
  async onload(): Promise<void> {
    this.diagnostics = new DiagnosticManager(this.app, this);
    let saved;
    try {
      saved = decodePluginData(await this.loadData());
    } catch (error) {
      saved = decodePluginData(null);
      this.diagnostics.report(operationalDiagnostic(error));
    }
    this.settings = this.loadSettings(saved);
    this.diagnostics.hydrate(saved.scanIndex.files);
    this.diagnostics.register();
    this.exporter = new IncrementalReminderExporter({
      app: this.app,
      outputPath: this.outputPath(),
      index: saved.scanIndex,
      getSettings: () => this.settings,
      saveData: (data) => this.app.vault.adapter.write(this.dataPath(), serializePluginData(data)),
      diagnostics: this.diagnostics
    });
    this.diagnostics.setRetryHandler(() => this.exporter.retryServer());
    try {
      await this.exporter.initialize();
    } catch (error) {
      this.diagnostics.report(operationalDiagnostic(error));
    }

    this.addSettingTab(new NotifoxSettingTab(this.app, this));
    this.addCommand({
      id: 'regenerate-reminder-json',
      name: 'Regenerate reminder JSON',
      callback: () => this.exporter.regenerate()
    });
    this.addCommand({
      id: 'retry-server-update',
      name: 'Retry server update',
      callback: () => this.exporter.retryServer()
    });
    this.app.workspace.onLayoutReady(() => this.startExporter());
  }

  // Stops pending exporter work during plugin teardown.
  onunload(): void {
    this.exporter?.stop();
  }

  // Saves edited settings and schedules affected files for reconciliation.
  async updateSettings(update: Partial<NotifoxSettings>): Promise<void> {
    this.settings = { ...this.settings, ...update };
    await this.exporter.settingsChanged();
  }

  // Connects vault and visibility events after the workspace is ready.
  private startExporter(): void {
    this.registerEvent(this.app.vault.on('create', (file) => this.exporter.createdOrModified(file)));
    this.registerEvent(this.app.vault.on('modify', (file) => this.exporter.createdOrModified(file)));
    this.registerEvent(this.app.vault.on('delete', (file) => this.exporter.deleted(file)));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.exporter.renamed(file, oldPath)));
    this.registerDomEvent(document, 'visibilitychange', () => this.exporter.visibilityChanged(document.hidden));
    this.exporter.start();
  }

  // Applies defaults while preserving an existing vault identity.
  private loadSettings(saved: Partial<PluginData> | null): NotifoxSettings {
    return {
      vaultId: saved?.vaultId || newVaultId(),
      timeZone: saved?.timeZone || DEFAULT_SETTINGS.timeZone,
      defaultAlertTime: saved?.defaultAlertTime || DEFAULT_SETTINGS.defaultAlertTime,
      ntfyServer: saved?.ntfyServer || DEFAULT_SETTINGS.ntfyServer,
      notifoxServer: saved?.notifoxServer ?? DEFAULT_SETTINGS.notifoxServer
    };
  }

  // Resolves the adapter path for the generated reminder file.
  private outputPath(): string {
    return normalizePath(`${this.app.vault.configDir}/plugins/${this.manifest.id}/${OUTPUT_FILE}`);
  }

  // Resolves the adapter path for compact internal plugin data.
  private dataPath(): string {
    return normalizePath(`${this.app.vault.configDir}/plugins/${this.manifest.id}/${DATA_FILE}`);
  }
}
