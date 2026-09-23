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

import { Notice, requestUrl, TFile } from 'obsidian';

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
    const settings = { ...DEFAULT_SETTINGS, vaultId: 'vault-id', ntfyServer: 'https://ntfy.sh/your-topic', notifoxServer: url };
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
    const diagnostics = {
      setFile: vi.fn(), removeFile: vi.fn(), report: vi.fn(), reportServer: vi.fn(), clear: vi.fn(), serverConnected: vi.fn(),
      setServerPending: vi.fn()
    };
    const index = { version: 4, files: {}, outputRetryNeeded: false, serverRetryNeeded: false };
    const exporter = new IncrementalReminderExporter({
      app, outputPath: 'reminders.json', index,
      getSettings: () => settings, saveData: vi.fn().mockResolvedValue(undefined), diagnostics
    });
    return { exporter, settings, write, index, app, diagnostics };
  }

  async function regenerate(exporter: IncrementalReminderExporter) {
    exporter.regenerate();
    await vi.advanceTimersByTimeAsync(0);
  }

  it('exports reminder text and optional priority from note content', async () => {
    vi.setSystemTime(new Date('2027-04-01T00:00:00Z'));
    const { exporter, settings, write, app, diagnostics } = setup();
    settings.timeZone = 'UTC';
    settings.ntfyServer = 'https://ntfy.sh';
    const note = Object.assign(new TFile(), { path: 'Tasks.md', extension: 'md', stat: { mtime: 1, size: 100 } });
    app.vault.getMarkdownFiles = () => [note];
    app.vault.getAbstractFileByPath = () => note;
    app.vault.cachedRead = async () => [
      '- [ ] Submit **plan** 🔔 9am ⏫ 📅 2027-04-15',
      '- [ ] Review 🔔 9am 📅 2027-04-15'
    ].join('\n');
    await regenerate(exporter);
    expect(JSON.parse(write.mock.calls[0][1]).Vault['Tasks.md']).toEqual([
      { line: 1, text: 'Submit **plan**', priority: 'high', 'one-shots': [{ timestamp: '2027-04-15T09:00:00Z' }] },
      { line: 2, text: 'Review', 'one-shots': [{ timestamp: '2027-04-15T09:00:00Z' }] }
    ]);
    expect(diagnostics.setFile).toHaveBeenCalledWith('Tasks.md', [], [1, 2]);
    expect(diagnostics.report).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_NTFY_TOPIC' }));
    diagnostics.report.mockClear();
    await regenerate(exporter);
    expect(diagnostics.report).not.toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_NTFY_TOPIC' }));
    settings.ntfyServer = 'https://ntfy.sh/afml98o23uf9q8a23jfa';
    await regenerate(exporter);
    expect(diagnostics.report).not.toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_NTFY_TOPIC' }));
  });

  it('publishes reminder diagnostics with line ranges instead of silently dropping them', async () => {
    vi.setSystemTime(new Date('2027-04-01T00:00:00Z'));
    const { exporter, app, diagnostics, write } = setup('');
    const note = Object.assign(new TFile(), { path: 'Tasks.md', extension: 'md', stat: { mtime: 1, size: 50 } });
    app.vault.getMarkdownFiles = () => [note];
    app.vault.getAbstractFileByPath = () => note;
    app.vault.cachedRead = async () => '- [ ] Submit 🔔 at 25:00 📅 2027-04-15';
    await regenerate(exporter);
    expect(diagnostics.setFile).toHaveBeenCalledWith('Tasks.md', [expect.objectContaining({
      code: 'INVALID_TIME', line: 1, range: expect.objectContaining({ start: 16, end: 24 })
    })]);
    expect(JSON.parse(write.mock.calls[0][1]).Vault).toEqual({});
  });

  it('does not warn about missing topics for empty exports', async () => {
    const { exporter, settings, write } = setup();
    settings.ntfyServer = '';
    await regenerate(exporter);
    expect(write).toHaveBeenCalledTimes(1);
    expect(Notice).not.toHaveBeenCalledWith(expect.stringContaining('update the ntfy.sh server field'));
  });

  it('preserves URL auth, POSTs changed bytes, and resends unchanged JSON to a changed receiver', async () => {
    const { exporter, settings, write } = setup();
    settings.ntfyServer = 'https://ntfy.sh/your-topic?auth=QmVhcmVyIHRrX3Rlc3Q';
    await regenerate(exporter);
    expect(JSON.parse(write.mock.calls[0][1])['ntfy-server']).toBe(settings.ntfyServer);
    expect(requestUrl).toHaveBeenCalledExactlyOnceWith({
      url: settings.notifoxServer, method: 'POST', contentType: 'application/json',
      body: write.mock.calls[0][1], throw: false
    });
    await regenerate(exporter);
    settings.notifoxServer = 'https://example.com/other';
    await exporter.settingsChanged();
    await vi.runAllTimersAsync();
    expect(write).toHaveBeenCalledTimes(1);
    expect(requestUrl).toHaveBeenCalledTimes(2);
    expect(vi.mocked(requestUrl).mock.calls[1][0]).toMatchObject({
      url: settings.notifoxServer, body: write.mock.calls[0][1]
    });
    settings.ntfyServer = 'https://ntfy.example.com/your-topic';
    await exporter.settingsChanged();
    await vi.runAllTimersAsync();
    expect(JSON.parse(write.mock.calls[1][1])['ntfy-server']).toBe(settings.ntfyServer);
    expect(requestUrl).toHaveBeenCalledTimes(3);
    expect(vi.mocked(requestUrl).mock.calls[2][0]).toMatchObject({
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

  it('does not mark a valid reminder as exported when the JSON write fails', async () => {
    vi.setSystemTime(new Date('2027-04-01T00:00:00Z'));
    const { exporter, app, diagnostics, write } = setup('');
    const note = Object.assign(new TFile(), { path: 'Tasks.md', extension: 'md', stat: { mtime: 1, size: 48 } });
    app.vault.getMarkdownFiles = () => [note];
    app.vault.getAbstractFileByPath = () => note;
    app.vault.cachedRead = async () => '- [ ] Submit 🔔 9am 📅 2027-04-15';
    write.mockRejectedValueOnce(new Error('Disk full'));
    await regenerate(exporter);
    expect(diagnostics.setFile).not.toHaveBeenCalledWith('Tasks.md', [], [1]);
  });

  it('preserves local output and retries a failed POST with unchanged JSON', async () => {
    vi.mocked(requestUrl).mockRejectedValueOnce(new Error('Offline'));
    const { exporter, write, index, diagnostics } = setup();
    await regenerate(exporter);
    expect(diagnostics.reportServer).toHaveBeenCalledWith(expect.objectContaining({ code: 'SERVER_UNREACHABLE' }));
    expect(index.outputRetryNeeded).toBe(false);
    expect(index.serverRetryNeeded).toBe(true);
    await regenerate(exporter);
    expect(write).toHaveBeenCalledTimes(1);
    expect(requestUrl).toHaveBeenCalledTimes(2);
    expect(index.serverRetryNeeded).toBe(false);
  });

  it('backs off before retrying a transient server failure', async () => {
    vi.mocked(requestUrl).mockRejectedValueOnce(new Error('Offline'));
    const { exporter, index } = setup();
    await regenerate(exporter);
    expect(requestUrl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(requestUrl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await vi.runOnlyPendingTimersAsync();
    expect(requestUrl).toHaveBeenCalledTimes(2);
    expect(index.serverRetryNeeded).toBe(false);
  });

  it('keeps permanent server failures pending until an explicit retry', async () => {
    vi.mocked(requestUrl).mockResolvedValueOnce({
      status: 401,
      headers: {},
      text: JSON.stringify({ detail: 'Replace the expired token.' }),
      json: { detail: 'Replace the expired token.' },
      arrayBuffer: new ArrayBuffer(0)
    });
    const { exporter, index, diagnostics } = setup();
    await regenerate(exporter);
    expect(diagnostics.reportServer).toHaveBeenCalledWith(expect.objectContaining({
      code: 'SERVER_AUTHENTICATION', detail: 'Replace the expired token.', retryable: false
    }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(requestUrl).toHaveBeenCalledTimes(1);
    expect(index.serverRetryNeeded).toBe(true);
    exporter.retryServer();
    await vi.advanceTimersByTimeAsync(0);
    expect(requestUrl).toHaveBeenCalledTimes(2);
    expect(index.serverRetryNeeded).toBe(false);
  });
});
