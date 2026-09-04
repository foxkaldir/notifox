import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { IncrementalReminderExporter } from '../src/exporter';
import { DEFAULT_SETTINGS } from '../src/settings';

vi.mock('obsidian', () => ({
  Notice: vi.fn(),
  TFile: class {},
  TFolder: class {},
  PluginSettingTab: class {},
  normalizePath: (path: string) => path,
  requestUrl: vi.fn().mockResolvedValue({ status: 200 })
}));

import { Notice, requestUrl } from 'obsidian';

describe('export POSTs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('crypto', { subtle: { digest: vi.fn().mockResolvedValue(new ArrayBuffer(32)) } });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function setup(url = 'https://example.com/reminders') {
    const settings = { ...DEFAULT_SETTINGS, vaultId: 'vault-id', notifoxServer: url };
    let bytes: string | undefined;
    const write = vi.fn(async (_path: string, output: string) => { bytes = output; });
    const app = {
      plugins: { getPlugin: () => ({ manifest: { version: '8.0.0' }, settings: {} }) },
      vault: {
        getName: () => 'Vault',
        getMarkdownFiles: () => [],
        adapter: { write, read: async () => bytes }
      }
    } as unknown as App;
    const index = { version: 3, files: {}, outputRetryNeeded: false };
    const exporter = new IncrementalReminderExporter({
      app, outputPath: 'reminders.json', index,
      getSettings: () => settings, saveData: vi.fn().mockResolvedValue(undefined)
    });
    return { exporter, settings, write, index };
  }

  async function regenerate(exporter: IncrementalReminderExporter) {
    exporter.regenerate();
    await vi.runAllTimersAsync();
  }

  it('POSTs exact saved bytes once and skips unchanged JSON, including URL edits', async () => {
    const { exporter, settings, write } = setup();
    await regenerate(exporter);
    expect(requestUrl).toHaveBeenCalledExactlyOnceWith({
      url: settings.notifoxServer, method: 'POST', contentType: 'application/json',
      body: write.mock.calls[0][1]
    });
    await regenerate(exporter);
    settings.notifoxServer = 'https://example.com/other';
    await exporter.settingsChanged();
    await vi.runAllTimersAsync();
    expect(write).toHaveBeenCalledTimes(1);
    expect(requestUrl).toHaveBeenCalledTimes(1);
    settings.ntfyServer = 'https://ntfy.example.com';
    await regenerate(exporter);
    expect(requestUrl).toHaveBeenCalledTimes(2);
    expect(vi.mocked(requestUrl).mock.calls[1][0]).toMatchObject({
      url: settings.notifoxServer, body: write.mock.calls[1][1]
    });
  });

  it('does not POST when disabled or when the local write fails', async () => {
    const disabled = setup('');
    await regenerate(disabled.exporter);
    const failed = setup();
    failed.write.mockRejectedValueOnce(new Error('Disk full'));
    await regenerate(failed.exporter);
    expect(requestUrl).not.toHaveBeenCalled();
    expect(failed.index.outputRetryNeeded).toBe(true);
  });

  it('preserves local output after a failed POST and does not resend unchanged JSON', async () => {
    vi.mocked(requestUrl).mockRejectedValueOnce(new Error('Offline'));
    const { exporter, write, index } = setup();
    await regenerate(exporter);
    expect(Notice).toHaveBeenCalledWith(expect.stringContaining('Could not POST'));
    expect(index.outputRetryNeeded).toBe(false);
    await regenerate(exporter);
    expect(write).toHaveBeenCalledTimes(1);
    expect(requestUrl).toHaveBeenCalledTimes(1);
  });
});
