import { describe, expect, it } from 'vitest';
import {
  classifyServerResponse, defaultAlertTimeError, httpUrlError, retryDelayMilliseconds, serverTransportDiagnostic
} from '../src/diagnostics/model';

describe('diagnostic classification', () => {
  it.each([
    [400, 'SERVER_REQUEST_INVALID', false],
    [401, 'SERVER_AUTHENTICATION', false],
    [403, 'SERVER_AUTHENTICATION', false],
    [404, 'SERVER_ENDPOINT_NOT_FOUND', false],
    [409, 'SERVER_REVISION_CONFLICT', true],
    [413, 'SERVER_PAYLOAD_TOO_LARGE', false],
    [429, 'SERVER_RATE_LIMITED', true],
    [503, 'SERVER_UNAVAILABLE', true]
  ])('classifies HTTP %i as %s', (status, code, retryable) => {
    expect(classifyServerResponse({ status, headers: {}, text: '' })).toMatchObject({ code, retryable });
  });

  it('accepts success and extracts bounded problem details', () => {
    expect(classifyServerResponse({ status: 204, headers: {}, text: '' })).toBeUndefined();
    expect(classifyServerResponse({
      status: 422,
      headers: {},
      text: JSON.stringify({ detail: 'Correct the malformed reminder snapshot.' })
    })).toMatchObject({ detail: 'Correct the malformed reminder snapshot.' });
  });

  it('preserves Retry-After and classifies transport failures', () => {
    const rateLimited = classifyServerResponse({ status: 429, headers: { 'Retry-After': '120' }, text: '' })!;
    expect(rateLimited).toMatchObject({ retryAfter: '120' });
    expect(retryDelayMilliseconds(rateLimited)).toBe(120_000);
    expect(serverTransportDiagnostic(new Error('Offline'))).toMatchObject({
      code: 'SERVER_UNREACHABLE', detail: 'Offline', retryable: true
    });
  });
});

describe('configuration diagnostics', () => {
  it('allows disabled endpoints and validates configured URLs', () => {
    expect(httpUrlError('')).toBe('');
    expect(httpUrlError('https://example.com/reminders')).toBe('');
    expect(httpUrlError('file:///tmp/reminders')).not.toBe('');
    expect(httpUrlError('not a URL')).not.toBe('');
  });

  it('validates default alert time ranges', () => {
    expect(defaultAlertTimeError('09:30')).toBe('');
    expect(defaultAlertTimeError('09:30:15')).toBe('');
    expect(defaultAlertTimeError('24:00')).not.toBe('');
    expect(defaultAlertTimeError('9:30')).not.toBe('');
  });
});
