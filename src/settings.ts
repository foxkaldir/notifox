import { PluginSettingTab, Setting, type App } from 'obsidian';
import type NotifoxRemindersPlugin from './main';
import { defaultAlertTimeError, httpUrlError, type DiagnosticSeverity } from './diagnostics/model';
import { timeZoneOptions } from './time-zones';
import { isNtfyTopicUrl } from './integrations/ntfy';

export interface NotifoxSettings {
  vaultId: string;
  timeZone: string;
  defaultAlertTime: string;
  ntfyServer: string;
  notifoxServer: string;
}

export const DEFAULT_SETTINGS: Omit<NotifoxSettings, 'vaultId'> = {
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  defaultAlertTime: '09:00:00',
  ntfyServer: '',
  notifoxServer: ''
};

// Applies native input validity state without creating a second tooltip.
function showInputError(input: HTMLInputElement, error: string): void {
  input.setCustomValidity(error);
  input.toggleClass('notifox-invalid-input', Boolean(error));
  input.setAttribute('aria-invalid', String(Boolean(error)));
}

// Keeps a configuration diagnostic synchronized with its current field value.
function syncConfigurationError(
  plugin: NotifoxRemindersPlugin,
  code: string,
  message: string,
  severity: DiagnosticSeverity
): void {
  if (message) {
    plugin.diagnostics.report({ code, message, scope: 'configuration', severity, retryable: false }, false);
  } else {
    plugin.diagnostics.clear(code);
  }
}

export class NotifoxSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: NotifoxRemindersPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('p', { text: 'Configuration settings for the Notifox reminders plugin.' });

    new Setting(containerEl)
      .setName('Timezone')
      .setDesc('IANA timezone used to resolve task dates and local reminder times. Offsets reflect the current date.')
      .addDropdown((dropdown) => dropdown
        .addOptions(Object.fromEntries(timeZoneOptions(this.plugin.settings.timeZone).map(({ value, label }) => [value, label])))
        .setValue(this.plugin.settings.timeZone)
        .onChange(async (value) => {
          await this.plugin.updateSettings({ timeZone: value });
        }));

    const defaultAlertTimeErrorMessage = defaultAlertTimeError(this.plugin.settings.defaultAlertTime);
    syncConfigurationError(this.plugin, 'INVALID_DEFAULT_ALERT_TIME', defaultAlertTimeErrorMessage, 'error');
    const defaultAlertTimeSetting = new Setting(containerEl)
      .setName('Default alert time')
      .setDesc('Used by an empty reminder field and offsets without “at”.')
      .addText((text) => {
        text.setPlaceholder('09:00:00').setValue(this.plugin.settings.defaultAlertTime);
        showInputError(text.inputEl, defaultAlertTimeErrorMessage);
        text.onChange(async (value) => {
          const trimmed = value.trim();
          const error = defaultAlertTimeError(trimmed);
          showInputError(text.inputEl, error);
          syncConfigurationError(this.plugin, 'INVALID_DEFAULT_ALERT_TIME', error, 'error');
          await this.plugin.updateSettings({ defaultAlertTime: trimmed });
        });
      });
    this.plugin.diagnostics.bindSetting(
      defaultAlertTimeSetting,
      (issue) => issue.code === 'INVALID_DEFAULT_ALERT_TIME'
    );

    const notifoxServerErrorMessage = httpUrlError(this.plugin.settings.notifoxServer);
    syncConfigurationError(this.plugin, 'INVALID_NOTIFOX_URL', notifoxServerErrorMessage, 'error');
    const notifoxServerSetting = new Setting(containerEl)
      .setName('Notifox server')
      .setDesc('Receives reminders.json after updates. Leave blank to disable.')
      .addText((text) => {
        text.setPlaceholder('https://example.com/reminders').setValue(this.plugin.settings.notifoxServer);
        showInputError(text.inputEl, notifoxServerErrorMessage);
        text.onChange(async (value) => {
          const trimmed = value.trim();
          const error = httpUrlError(trimmed);
          showInputError(text.inputEl, error);
          syncConfigurationError(this.plugin, 'INVALID_NOTIFOX_URL', error, 'error');
          await this.plugin.updateSettings({ notifoxServer: trimmed });
        });
      });
    this.plugin.diagnostics.bindSetting(
      notifoxServerSetting,
      (issue) => issue.code === 'INVALID_NOTIFOX_URL' || issue.scope === 'server'
    );

    const ntfyErrorMessage = !this.plugin.settings.ntfyServer || isNtfyTopicUrl(this.plugin.settings.ntfyServer)
      ? '' : 'Include one topic in the ntfy URL.';
    if (ntfyErrorMessage) {
      syncConfigurationError(this.plugin, 'INVALID_NTFY_TOPIC', ntfyErrorMessage, 'warning');
    }
    const ntfyServerSetting = new Setting(containerEl)
      .setName('ntfy.sh server')
      .setDesc('HTTP(S) topic URL. Authentication may be supplied with ?auth=….')
      .addText((text) => {
        text.setPlaceholder('https://ntfy.sh/your-topic').setValue(this.plugin.settings.ntfyServer);
        showInputError(text.inputEl, ntfyErrorMessage);
        text.onChange(async (value) => {
          const trimmed = value.trim();
          const error = !trimmed || isNtfyTopicUrl(trimmed) ? '' : 'Include one topic in the ntfy URL.';
          showInputError(text.inputEl, error);
          syncConfigurationError(this.plugin, 'INVALID_NTFY_TOPIC', error, 'warning');
          await this.plugin.updateSettings({ ntfyServer: trimmed });
        });
      });
    this.plugin.diagnostics.bindSetting(
      ntfyServerSetting,
      (issue) => issue.code === 'INVALID_NTFY_TOPIC' || issue.scope === 'delivery'
    );
  }
}
