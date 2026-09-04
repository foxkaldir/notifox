import { describe, expect, it } from 'vitest';
import {
  canonicalOutput, decodePluginData, serializePluginData, shouldScanEntry, updateScanEntry,
  type FileScanEntry, type PluginData
} from '../src/persistence';

const HASH_A = '00'.repeat(32);
const HASH_B = 'ff'.repeat(32);

function pluginData(files: Record<string, FileScanEntry>, outputRetryNeeded = true): PluginData {
  return {
    vaultId: 'vault-id',
    timeZone: 'America/Los_Angeles',
    defaultAlertTime: '09:00',
    ntfyServer: 'https://ntfy.sh',
    scanIndex: { version: 3, files, outputRetryNeeded }
  };
}

function reminder(line: number) {
  return { line };
}

function file(overrides: Partial<FileScanEntry> = {}): FileScanEntry {
  return {
    mtime: 100,
    size: 20,
    lastScannedAt: 150,
    contentHash: HASH_A,
    fingerprint: HASH_B,
    reminders: [],
    ...overrides
  };
}

describe('plugin data persistence', () => {
  it('migrates verbose scan data without losing any runtime fields', () => {
    const verbose = pluginData({
      'note.md': file({
        refreshAfter: '2027-04-15T16:00:00Z',
        reminders: [
          reminder(1),
          { ...reminder(2), 'one-shots': [] },
          {
            ...reminder(3),
            'one-shots': [{ timestamp: '2027-04-15T16:00:00Z' }],
            repeat: { timestamp: '2027-04-16T16:00:00Z', duration: 86_400 }
          }
        ]
      })
    });
    const decoded = decodePluginData(verbose);
    expect(decoded).toEqual(verbose);
    expect(decodePluginData(JSON.parse(serializePluginData(decoded as PluginData)))).toEqual(verbose);
  });

  it('round-trips multiple fingerprints, optional refresh times, and retry state', () => {
    const data = pluginData({
      'z.md': file({ contentHash: HASH_B, fingerprint: HASH_A }),
      'a.md': file({
        refreshAfter: '2030-01-02T03:04:05Z',
        reminders: [{ ...reminder(1), 'one-shots': [], repeat: { timestamp: '2030-01-02T03:04:05Z', duration: 60 } }]
      })
    }, false);
    expect(decodePluginData(JSON.parse(serializePluginData(data)))).toEqual(data);
  });

  it('rejects malformed compact indexes while preserving valid settings', () => {
    const encoded = JSON.parse(serializePluginData(pluginData({ 'a.md': file() }))) as Record<string, any>;
    const malformed = [
      { ...encoded, scanIndex: { ...encoded.scanIndex, f: [[...encoded.scanIndex.f[0], 'extra']] } },
      { ...encoded, scanIndex: { ...encoded.scanIndex, h: ['not-a-hash'] } },
      { ...encoded, scanIndex: { ...encoded.scanIndex, f: [encoded.scanIndex.f[0].map((value: unknown, index: number) => index === 4 ? 'x'.repeat(43) : value)] } },
      { ...encoded, scanIndex: { ...encoded.scanIndex, f: [encoded.scanIndex.f[0].map((value: unknown, index: number) => index === 5 ? 2 : value)] } },
      { ...encoded, scanIndex: { ...encoded.scanIndex, f: [encoded.scanIndex.f[0].map((value: unknown, index: number) => index === 7 ? [['id']] : value)] } }
    ];
    for (const value of malformed) {
      expect(decodePluginData(value)).toEqual({
        vaultId: 'vault-id',
        timeZone: 'America/Los_Angeles',
        defaultAlertTime: '09:00',
        ntfyServer: 'https://ntfy.sh',
        scanIndex: { version: 3, files: {}, outputRetryNeeded: false }
      });
    }
  });

  it('writes deterministic minified bytes without a trailing newline', () => {
    const left = pluginData({
      'z.md': file({ fingerprint: HASH_A }),
      'a.md': file({ fingerprint: HASH_B })
    });
    const right = pluginData({
      'a.md': file({ fingerprint: HASH_B }),
      'z.md': file({ fingerprint: HASH_A })
    });
    const output = serializePluginData(left);
    expect(output).toBe(serializePluginData(right));
    expect(output).toBe(JSON.stringify(JSON.parse(output)));
    expect(output.endsWith('\n')).toBe(false);
  });

  it('is materially smaller than representative verbose pretty data', () => {
    const files = Object.fromEntries(Array.from({ length: 500 }, (_, index) => [
      `folder/note-${index.toString().padStart(4, '0')}.md`,
      file({
        mtime: 1_800_000_000_000 + index,
        size: 1_000 + index,
        lastScannedAt: 1_800_000_100_000 + index,
        contentHash: index % 2 ? HASH_A : HASH_B,
        reminders: [{ ...reminder(12),
          'one-shots': [{ timestamp: '2027-04-15T16:00:00Z' }] }]
      })
    ]));
    const data = pluginData(files);
    const legacyBytes = JSON.stringify(data, null, 2).length + 1;
    expect(serializePluginData(data).length).toBeLessThan(legacyBytes * 0.5);
  });
});

const entry: FileScanEntry = {
  mtime: 100,
  size: 20,
  lastScannedAt: 150,
  contentHash: 'abc',
  reminders: [{ line: 2, 'one-shots': [{ timestamp: '2027-04-15T16:00:00Z' }] }],
  refreshAfter: '2027-04-15T16:00:00Z',
  fingerprint: 'current'
};

describe('scan index reconciliation', () => {
  it('trusts matching metadata before the refresh time', () => {
    expect(shouldScanEntry(entry, { mtime: 100, size: 20 }, Date.parse('2027-04-15T15:59:59Z'), 'current'))
      .toEqual({ scan: false, reparse: false });
  });

  it.each([
    [{ mtime: 101, size: 20 }, 'newer mtime'],
    [{ mtime: 99, size: 20 }, 'older mtime'],
    [{ mtime: 100, size: 21 }, 'changed size'],
    [{ mtime: 151, size: 20 }, 'mtime newer than the scan']
  ])('scans metadata changes: %s (%s)', (stat) => {
    expect(shouldScanEntry(entry, stat, Date.parse('2027-04-15T15:59:59Z'), 'current').scan).toBe(true);
  });

  it('reparses after the cached schedule passes and scans obsolete fingerprints', () => {
    expect(shouldScanEntry(entry, { mtime: 100, size: 20 }, Date.parse('2027-04-15T16:00:01Z'), 'current'))
      .toEqual({ scan: true, reparse: true });
    expect(shouldScanEntry(entry, { mtime: 100, size: 20 }, Date.parse('2027-04-15T15:00:00Z'), 'obsolete').scan)
      .toBe(true);
  });

  it('recovers an empty index from corrupt or missing persisted data', () => {
    const empty = { version: 3, files: {}, outputRetryNeeded: false };
    for (const value of [undefined, null, [], {},
      { scanIndex: { version: 3, files: { 'a.md': { ...file(), reminders: [{ nope: true }] } } } },
      { scanIndex: { version: 999, files: {} } }
    ]) {
      expect(decodePluginData(value).scanIndex).toEqual(empty);
    }
    expect(decodePluginData({ scanIndex: empty }).scanIndex).toEqual(empty);
  });

});

describe('canonical output', () => {
  it('sorts file keys and line-numbered reminders into stable bytes', () => {
    const files = {
      'z.md': entry,
      'a.md': { ...entry, reminders: [{ line: 1 }] }
    };
    expect(canonicalOutput('Work Notes', 'https://ntfy.sh', files)).toBe('{\n  "ntfy-server": "https://ntfy.sh",\n  "Work Notes": {\n    "a.md": [\n      {\n        "line": 1\n      }\n    ],\n    "z.md": [\n      {\n        "line": 2,\n        "one-shots": [\n          {\n            "timestamp": "2027-04-15T16:00:00Z"\n          }\n        ]\n      }\n    ]\n  }\n}\n');
  });
});


describe('cached scan updates', () => {
  it('sorts parsed reminders, tracks expiry, and reuses unchanged content', async () => {
    const options = {
      previous: undefined,
      content: 'note content',
      stat: { mtime: 100, size: 12 },
      fingerprint: HASH_A,
      reparse: false,
      collectReminders: () => [
        { line: 3, repeat: { timestamp: '2027-04-16T16:00:00Z', duration: 60 } },
        { line: 1, 'one-shots': [{ timestamp: '2027-04-15T16:00:00Z' }] }
      ]
    };
    const first = await updateScanEntry(options);
    expect(first.remindersChanged).toBe(true);
    expect(first.entry.reminders.map(({ line }) => line)).toEqual([1, 3]);
    expect(first.entry.refreshAfter).toBe('2027-04-15T16:00:00Z');
    expect(first.entry.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const reused = await updateScanEntry({
      ...options, previous: first.entry, stat: { mtime: 200, size: 12 },
      collectReminders: () => { throw new Error('Unchanged content must use cached reminders'); }
    });
    expect(reused.remindersChanged).toBe(false);
    expect(reused.entry.mtime).toBe(200);
    expect(reused.entry.reminders).toBe(first.entry.reminders);
    for (const change of [{ reparse: true }, { content: 'changed content' }, { fingerprint: HASH_B }]) {
      const updated = await updateScanEntry({
        ...options, previous: first.entry, ...change, collectReminders: () => []
      });
      expect(updated.remindersChanged).toBe(true);
      expect(updated.entry.reminders).toEqual([]);
      expect(updated.entry.refreshAfter).toBeUndefined();
    }
  });
});
