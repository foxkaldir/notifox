import type { Setting } from 'obsidian';
import type { FileDiagnostic, OperationalDiagnostic } from './model';

// Renders an operational diagnostic using the shared message and metadata layout.
export function renderOperationalDiagnostic(container: HTMLElement, issue: OperationalDiagnostic): void {
  const item = container.createDiv({ cls: `notifox-diagnostic-item mod-${issue.severity}` });
  const primary = item.createDiv({ cls: 'notifox-diagnostic-primary' });
  primary.createEl('strong', { text: issue.message, cls: 'notifox-diagnostic-message' });
  primary.createSpan({ text: '·', cls: 'notifox-diagnostic-separator' });
  primary.createEl('code', { text: issue.code, cls: 'notifox-diagnostic-code' });
  if (issue.detail) item.createEl('div', { text: issue.detail, cls: 'notifox-diagnostic-detail' });
  if (issue.retryAfter) {
    const metadata = item.createDiv({ cls: 'notifox-diagnostic-metadata' });
    metadata.createEl('span', { text: 'Retry after' });
    metadata.createEl('code', { text: issue.retryAfter });
  }
}

// Renders a file diagnostic with its navigation action aligned beside the message.
export function renderFileDiagnostic(
  container: HTMLElement,
  path: string,
  issue: FileDiagnostic,
  openFile: () => void
): void {
  const item = container.createDiv({ cls: `notifox-diagnostic-item mod-${issue.severity}` });
  const primary = item.createDiv({ cls: 'notifox-diagnostic-primary' });
  primary.createEl('strong', { text: issue.message, cls: 'notifox-diagnostic-message' });
  primary.createSpan({ text: '·', cls: 'notifox-diagnostic-separator' });
  primary.createEl('code', { text: issue.code, cls: 'notifox-diagnostic-code' });
  const actions = item.createDiv({ cls: 'notifox-diagnostic-item-actions' });
  const open = actions.createEl('button', { text: `Open ${path}:${issue.line}` });
  open.addEventListener('click', openFile);
}

// Builds the compact editor tooltip with a readable metadata line.
export function renderDiagnosticTooltip(document: Document, issue: FileDiagnostic): HTMLElement {
  const dom = document.createElement('div');
  dom.className = 'notifox-diagnostic-tooltip';
  dom.createEl('strong', { text: issue.message, cls: 'notifox-diagnostic-tooltip-message' });
  const metadata = dom.createDiv({ cls: 'notifox-diagnostic-tooltip-metadata' });
  metadata.createEl('code', { text: issue.code });
  metadata.createSpan({ text: '·', cls: 'notifox-diagnostic-separator' });
  metadata.createEl('span', { text: `${issue.source === 'local' ? 'Local' : 'Server'} validation` });
  return dom;
}

// Uses Obsidian's inline Setting error API with a fallback for older supported releases.
export function renderSettingDiagnostic(setting: Setting, message: string | null): void {
  const compatible = setting as Omit<Setting, 'setErrorMessage'> & {
    setErrorMessage?: (value: string | null) => Setting;
  };
  if (compatible.setErrorMessage) {
    compatible.setErrorMessage(message);
    return;
  }

  const existing = setting.infoEl.querySelector<HTMLElement>(':scope > .notifox-setting-error-fallback');
  if (!message) {
    existing?.remove();
    setting.settingEl.removeClass('is-invalid');
    return;
  }
  const error = existing ?? setting.infoEl.createDiv({ cls: 'notifox-setting-error-fallback' });
  error.setText(message);
  setting.settingEl.addClass('is-invalid');
}
