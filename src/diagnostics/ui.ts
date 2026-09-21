import { StateEffect } from '@codemirror/state';
import {
  Decoration, type DecorationSet, EditorView, hoverTooltip, type HoverTooltipSource, type PluginValue,
  ViewPlugin, type ViewUpdate
} from '@codemirror/view';
import { editorInfoField, MarkdownView, Modal, Notice, Platform, type App, type Plugin, type Setting } from 'obsidian';
import type { FileDiagnostic, OperationalDiagnostic } from './model';
import {
  renderDiagnosticTooltip, renderFileDiagnostic, renderOperationalDiagnostic, renderSettingDiagnostic
} from './layout';

const refreshDiagnostics = StateEffect.define<void>();

interface SettingDiagnosticTarget {
  setting: Setting;
  matches: (issue: OperationalDiagnostic) => boolean;
}

// Renders the complete diagnostic list and navigation actions.
class DiagnosticsModal extends Modal {
  constructor(app: App, private readonly diagnostics: DiagnosticManager) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass('notifox-diagnostics-modal');
    this.setTitle('Notifox diagnostics');
    this.contentEl.empty();
    const operational = this.diagnostics.operationalDiagnostics();
    const files = this.diagnostics.fileDiagnostics();
    if (!operational.length && !files.length) {
      this.contentEl.createEl('p', { text: 'No outstanding Notifox errors.', cls: 'notifox-diagnostics-empty' });
      return;
    }
    const list = this.contentEl.createDiv({ cls: 'notifox-diagnostics-list' });
    for (const issue of operational) renderOperationalDiagnostic(list, issue);
    for (const [path, issues] of files) {
      for (const issue of issues) {
        renderFileDiagnostic(list, path, issue, () => {
          this.close();
          void this.diagnostics.openFileDiagnostic(path, issue);
        });
      }
    }
    if (this.diagnostics.canRetry()) {
      const actions = this.contentEl.createDiv({ cls: 'notifox-diagnostics-actions' });
      const retry = actions.createEl('button', { text: 'Retry server update', cls: 'mod-cta' });
      retry.addEventListener('click', () => {
        this.close();
        this.diagnostics.retry();
      });
    }
  }

}

export class DiagnosticManager {
  private readonly files = new Map<string, FileDiagnostic[]>();
  private readonly operational = new Map<string, OperationalDiagnostic>();
  private readonly notified = new Set<string>();
  private readonly statusEl: HTMLElement;
  private retryHandler: (() => void) | undefined;
  private pendingServerUpdate = false;
  private readonly settingTargets = new Set<SettingDiagnosticTarget>();

  constructor(private readonly app: App, private readonly plugin: Plugin) {
    this.statusEl = plugin.addStatusBarItem();
    this.statusEl.addClass('notifox-status');
    this.statusEl.addEventListener('click', () => this.open());
    this.statusEl.setAttribute('role', 'button');
    this.statusEl.setAttribute('aria-label', 'Open Notifox diagnostics');
    this.updateStatus();
  }

  // Registers editor decorations and the command for the portable details surface.
  register(): void {
    const buildDecorations = (view: EditorView) => this.buildDecorations(view);
    class DiagnosticViewPlugin implements PluginValue {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view);
      }

      update(update: ViewUpdate): void {
        const refresh = update.transactions
          .some((transaction) => transaction.effects.some((effect) => effect.is(refreshDiagnostics)));
        if (refresh) {
          this.decorations = buildDecorations(update.view);
        } else if (update.docChanged) {
          this.decorations = Decoration.none;
        }
      }
    }
    this.plugin.registerEditorExtension([
      ViewPlugin.fromClass(DiagnosticViewPlugin, {
        decorations: (value) => value.decorations,
        eventHandlers: {
          click: (event) => {
            if (!Platform.isMobileApp) return false;
            const target = event.target as Element | null;
            if (!target?.closest?.('.notifox-diagnostic-error, .notifox-diagnostic-warning')) return false;
            this.open();
            return true;
          }
        }
      }),
      hoverTooltip((view, position) => this.tooltip(view, position)),
      EditorView.baseTheme({
        '.notifox-diagnostic-error': {
          textDecoration: 'underline wavy var(--text-error)',
          textDecorationThickness: '1.5px',
          textUnderlineOffset: '3px'
        },
        '.notifox-diagnostic-warning': {
          textDecoration: 'underline dotted var(--text-warning)',
          textUnderlineOffset: '3px'
        },
        '.cm-tooltip.notifox-diagnostic-tooltip-shell': {
          backgroundColor: 'var(--background-primary)',
          border: '1px solid var(--background-modifier-border-hover)',
          borderRadius: 'var(--radius-m)',
          boxShadow: 'var(--shadow-s)',
          color: 'var(--text-normal)',
          overflow: 'hidden'
        }
      })
    ]);
    this.plugin.addCommand({ id: 'open-diagnostics', name: 'Open diagnostics', callback: () => this.open() });
  }

  // Restores cached file issues without producing historical notices.
  hydrate(files: Record<string, { diagnostics: FileDiagnostic[] }>): void {
    for (const [path, entry] of Object.entries(files)) {
      if (entry.diagnostics.length) this.files.set(path, entry.diagnostics);
    }
    this.updateStatus();
  }

  // Replaces all diagnostics for one file and refreshes open editors.
  setFile(path: string, diagnostics: FileDiagnostic[]): void {
    if (diagnostics.length) this.files.set(path, diagnostics);
    else this.files.delete(path);
    this.refreshEditors(path);
    this.updateStatus();
  }

  // Removes diagnostics belonging to a deleted or renamed file.
  removeFile(path: string): void {
    if (!this.files.delete(path)) return;
    this.refreshEditors(path);
    this.updateStatus();
  }

  // Records an operational problem and optionally announces its first occurrence.
  report(issue: OperationalDiagnostic, notify = true): void {
    this.operational.set(issue.code, issue);
    if (notify && !this.notified.has(issue.code)) {
      const suffix = issue.detail ? ` ${issue.detail}` : '';
      new Notice(`Notifox Reminders: ${issue.message}${suffix}`);
      this.notified.add(issue.code);
    }
    this.updateStatus();
  }

  // Replaces stale server failures with the latest classified response.
  reportServer(issue: OperationalDiagnostic): void {
    for (const [code, current] of this.operational) {
      if (current.scope === 'server' && code !== issue.code) this.clear(code);
    }
    this.report(issue);
  }

  // Clears a resolved operational problem and permits a future recurrence notice.
  clear(code: string): void {
    this.operational.delete(code);
    this.notified.delete(code);
    this.updateStatus();
  }

  // Clears every server problem after a successful request.
  serverConnected(): void {
    for (const [code, issue] of this.operational) {
      if (issue.scope === 'server') this.clear(code);
    }
    this.pendingServerUpdate = false;
    this.updateStatus();
  }

  // Updates the persistent pending state used by status and retry controls.
  setServerPending(pending: boolean): void {
    this.pendingServerUpdate = pending;
    this.updateStatus();
  }

  // Installs the exporter callback used by the dialog and command.
  setRetryHandler(handler: () => void): void {
    this.retryHandler = handler;
  }

  // Opens the diagnostic details dialog.
  open(): void {
    new DiagnosticsModal(this.app, this).open();
  }

  // Binds matching diagnostics to Obsidian's inline error area for one setting.
  bindSetting(setting: Setting, matches: (issue: OperationalDiagnostic) => boolean): void {
    for (const target of this.settingTargets) {
      if (!target.setting.settingEl.parentElement || target.setting === setting) this.settingTargets.delete(target);
    }
    this.settingTargets.add({ setting, matches });
    this.refreshSettingDiagnostics();
  }

  // Returns operational issues in stable display order.
  operationalDiagnostics(): OperationalDiagnostic[] {
    return [...this.operational.values()].sort((left, right) => left.code.localeCompare(right.code));
  }

  // Returns file issues in stable path order.
  fileDiagnostics(): Array<[string, FileDiagnostic[]]> {
    return [...this.files.entries()].sort(([left], [right]) => left.localeCompare(right));
  }

  // Reports whether retrying the current server snapshot is meaningful.
  canRetry(): boolean {
    return this.pendingServerUpdate && this.retryHandler !== undefined;
  }

  // Requests a retry through the exporter without coupling the modal to it.
  retry(): void {
    this.retryHandler?.();
  }

  // Opens a note and moves the editor cursor to the diagnostic.
  async openFileDiagnostic(path: string, issue: FileDiagnostic): Promise<void> {
    await this.app.workspace.openLinkText(path, '', false);
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || view.file?.path !== path) return;
    const position = { line: Math.max(0, issue.line - 1), ch: issue.range.start };
    view.editor.setCursor(position);
    view.editor.scrollIntoView({ from: position, to: position }, true);
  }

  // Builds visible mark decorations from cached line-relative diagnostics.
  private buildDecorations(view: EditorView): DecorationSet {
    const path = view.state.field(editorInfoField).file?.path;
    if (!path) return Decoration.none;
    const ranges = (this.files.get(path) ?? []).flatMap((issue) => {
      if (issue.line < 1 || issue.line > view.state.doc.lines) return [];
      const line = view.state.doc.line(issue.line);
      const start = Math.min(line.to, line.from + issue.range.start);
      const end = Math.max(start + (start < line.to ? 1 : 0), Math.min(line.to, line.from + issue.range.end));
      if (end <= start) return [];
      const decoration = Decoration.mark({
        class: issue.severity === 'warning' ? 'notifox-diagnostic-warning' : 'notifox-diagnostic-error'
      });
      return [decoration.range(start, end)];
    });
    return Decoration.set(ranges, true);
  }

  // Creates a hover tooltip for the diagnostic beneath the pointer.
  private tooltip(view: EditorView, position: number): ReturnType<HoverTooltipSource> {
    const path = view.state.field(editorInfoField).file?.path;
    if (!path) return null;
    const line = view.state.doc.lineAt(position);
    const issue = (this.files.get(path) ?? []).find((candidate) => {
      if (candidate.line !== line.number) return false;
      const start = line.from + candidate.range.start;
      const end = line.from + candidate.range.end;
      return position >= start && position <= Math.max(start + 1, end);
    });
    if (!issue) return null;
    const from = Math.min(line.to, line.from + issue.range.start);
    const to = Math.max(from, Math.min(line.to, line.from + issue.range.end));
    return {
      pos: from,
      end: to,
      above: true,
      create(editor) {
        const dom = renderDiagnosticTooltip(editor.dom.ownerDocument, issue);
        return {
          dom,
          mount() {
            dom.parentElement?.addClass('notifox-diagnostic-tooltip-shell');
          }
        };
      }
    };
  }

  // Dispatches a lightweight refresh effect to editors showing the changed path.
  private refreshEditors(path: string): void {
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      if (!(leaf.view instanceof MarkdownView) || leaf.view.file?.path !== path) continue;
      const editor = leaf.view.editor as unknown as { cm?: EditorView };
      editor.cm?.dispatch({ effects: refreshDiagnostics.of() });
    }
  }

  // Summarizes outstanding errors in the desktop status bar.
  private updateStatus(): void {
    const fileCount = [...this.files.values()].reduce((sum, issues) => sum + issues.length, 0);
    const operationalCount = this.operational.size;
    const count = fileCount + operationalCount;
    const hasError = [...this.files.values()].some((issues) => issues.some((issue) => issue.severity === 'error'))
      || [...this.operational.values()].some((issue) => issue.severity === 'error');
    this.statusEl.setText(count ? `Notifox: ${count} issue${count === 1 ? '' : 's'}`
      : this.pendingServerUpdate ? 'Notifox: server update pending' : 'Notifox ✓');
    this.statusEl.toggleClass('mod-error', hasError);
    this.statusEl.toggleClass('mod-warning', !hasError && (count > 0 || this.pendingServerUpdate));
    this.refreshSettingDiagnostics();
  }

  // Refreshes mounted setting rows and drops targets from closed settings tabs.
  private refreshSettingDiagnostics(): void {
    const issues = this.operationalDiagnostics();
    for (const target of this.settingTargets) {
      if (!target.setting.settingEl.parentElement) {
        this.settingTargets.delete(target);
        continue;
      }
      renderSettingDiagnostic(target.setting, issues.find(target.matches)?.message ?? null);
    }
  }
}
