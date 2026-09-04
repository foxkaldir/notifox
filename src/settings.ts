import { PluginSettingTab, Setting, type App } from 'obsidian';
import type NotifoxRemindersPlugin from './main';
import { timeZoneOptions } from './time-zones';

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
  ntfyServer: 'https://ntfy.sh',
  notifoxServer: ''
};

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

    new Setting(containerEl)
      .setName('Default alert time')
      .setDesc('Used by an empty reminder field and offsets without “at”.')
      .addText((text) => text.setPlaceholder('09:00:00').setValue(this.plugin.settings.defaultAlertTime).onChange(async (value) => {
        await this.plugin.updateSettings({ defaultAlertTime: value.trim() });
      }));

    new Setting(containerEl)
      .setName('notifox server')
      .setDesc('URL that receives the complete reminders.json via POST whenever the file is updated. Leave blank to disable.')
      .addText((text) => text.setPlaceholder('https://example.com/reminders').setValue(this.plugin.settings.notifoxServer).onChange(async (value) => {
        await this.plugin.updateSettings({ notifoxServer: value.trim() });
      }));

    new Setting(containerEl)
      .setName('ntfy.sh server')
      .setDesc('Base URL of the ntfy server that receives reminder notifications.')
      .addText((text) => text.setPlaceholder('https://ntfy.sh').setValue(this.plugin.settings.ntfyServer).onChange(async (value) => {
        await this.plugin.updateSettings({ ntfyServer: value.trim() });
      }));
  }
}
