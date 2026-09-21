export type DiagnosticSeverity = 'error' | 'warning' | 'info';
export type DiagnosticSource = 'local' | 'server';
export type OperationalScope = 'configuration' | 'file' | 'server' | 'delivery';

export interface TextRange {
  start: number;
  end: number;
}

export interface FileDiagnostic {
  code: string;
  message: string;
  line: number;
  range: TextRange;
  severity: DiagnosticSeverity;
  source: DiagnosticSource;
}

export interface OperationalDiagnostic {
  code: string;
  message: string;
  scope: OperationalScope;
  severity: DiagnosticSeverity;
  retryable: boolean;
  detail?: string;
  retryAfter?: string;
}

export interface ServerResponseLike {
  status: number;
  headers: Record<string, string>;
  text: string;
}

export class OperationalError extends Error {
  constructor(readonly diagnostic: OperationalDiagnostic) {
    super(diagnostic.message);
    this.name = 'OperationalError';
  }
}

const SERVER_DETAIL_LIMIT = 400;

// Validates optional HTTP endpoints before they reach the exporter.
export function httpUrlError(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    return ['http:', 'https:'].includes(new URL(trimmed).protocol) ? '' : 'Use an HTTP or HTTPS URL.';
  } catch {
    return 'Enter a valid HTTP(S) URL.';
  }
}

// Validates the user-facing default alert time format and ranges.
export function defaultAlertTimeError(value: string): string {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59 || Number(match[3] ?? 0) > 59) {
    return 'Use HH:mm or HH:mm:ss.';
  }
  return '';
}

// Reads a short, user-safe message from a structured or plain-text response body.
function responseDetail(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    const value = JSON.parse(trimmed) as Record<string, unknown>;
    const detail = typeof value.detail === 'string' ? value.detail
      : typeof value.message === 'string' ? value.message
        : typeof value.title === 'string' ? value.title : undefined;
    return detail?.slice(0, SERVER_DETAIL_LIMIT);
  } catch {
    return trimmed.replace(/\s+/g, ' ').slice(0, SERVER_DETAIL_LIMIT);
  }
}

// Looks up a response header without relying on a particular casing.
function responseHeader(headers: Record<string, string>, name: string): string | undefined {
  const wanted = name.toLocaleLowerCase();
  return Object.entries(headers).find(([key]) => key.toLocaleLowerCase() === wanted)?.[1];
}

// Classifies non-successful notifox responses into stable operational states.
export function classifyServerResponse(response: ServerResponseLike): OperationalDiagnostic | undefined {
  if (response.status >= 200 && response.status < 300) return undefined;
  const detail = responseDetail(response.text);
  const common = { scope: 'server' as const, severity: 'error' as const, detail };
  if (response.status === 400 || response.status === 422) {
    return { ...common, code: 'SERVER_REQUEST_INVALID', message: 'The notifox server rejected the reminder update.', retryable: false };
  }
  if (response.status === 401 || response.status === 403) {
    return { ...common, code: 'SERVER_AUTHENTICATION', message: 'The notifox server rejected authentication.', retryable: false };
  }
  if (response.status === 404) {
    return { ...common, code: 'SERVER_ENDPOINT_NOT_FOUND', message: 'The notifox server endpoint was not found.', retryable: false };
  }
  if (response.status === 409) {
    return { ...common, code: 'SERVER_REVISION_CONFLICT', message: 'The notifox server rejected a stale reminder update.', retryable: true };
  }
  if (response.status === 413) {
    return { ...common, code: 'SERVER_PAYLOAD_TOO_LARGE', message: 'The reminder update is too large for the notifox server.', retryable: false };
  }
  if (response.status === 429) {
    return {
      ...common,
      code: 'SERVER_RATE_LIMITED',
      message: 'The notifox server is rate limiting updates.',
      retryable: true,
      retryAfter: responseHeader(response.headers, 'retry-after')
    };
  }
  if (response.status >= 500) {
    return { ...common, code: 'SERVER_UNAVAILABLE', message: 'The notifox server is temporarily unavailable.', retryable: true };
  }
  return {
    ...common,
    code: 'SERVER_UNEXPECTED_RESPONSE',
    message: `The notifox server returned HTTP ${response.status}.`,
    retryable: false
  };
}

// Creates a stable diagnostic for a request that failed before receiving HTTP.
export function serverTransportDiagnostic(error: unknown): OperationalDiagnostic {
  const detail = error instanceof Error ? error.message : String(error);
  return {
    code: 'SERVER_UNREACHABLE',
    message: 'Could not reach the notifox server.',
    scope: 'server',
    severity: 'error',
    retryable: true,
    detail: detail.slice(0, SERVER_DETAIL_LIMIT)
  };
}

// Preserves classified operational failures and safely wraps unexpected ones.
export function operationalDiagnostic(error: unknown): OperationalDiagnostic {
  if (error instanceof OperationalError) return error.diagnostic;
  const detail = error instanceof Error ? error.message : String(error);
  return {
    code: 'EXPORT_FAILED',
    message: 'Could not update the Notifox reminder export.',
    scope: 'file',
    severity: 'error',
    retryable: true,
    detail: detail.slice(0, SERVER_DETAIL_LIMIT)
  };
}

// Converts Retry-After into a bounded delay and supplies a transient default.
export function retryDelayMilliseconds(issue: OperationalDiagnostic, now = Date.now()): number {
  if (!issue.retryable) return Number.POSITIVE_INFINITY;
  const seconds = Number(issue.retryAfter);
  if (issue.retryAfter && Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 24 * 60 * 60 * 1000);
  if (issue.retryAfter) {
    const date = Date.parse(issue.retryAfter);
    if (Number.isFinite(date)) return Math.min(Math.max(0, date - now), 24 * 60 * 60 * 1000);
  }
  return 30_000;
}

// Compares file diagnostics without depending on object identity.
export function diagnosticsEqual(left: FileDiagnostic[], right: FileDiagnostic[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
