import { afterEach, describe, expect, it } from 'vitest';
import {
  extractBearerToken,
  isWorkflowCronAuthorized,
} from '@/lib/workflow/cron-auth';

const ORIGINAL_SECRET = process.env.WORKFLOW_CRON_SECRET;

afterEach(() => {
  process.env.WORKFLOW_CRON_SECRET = ORIGINAL_SECRET;
});

describe('workflow cron auth', () => {
  it('extracts bearer token from header', () => {
    expect(extractBearerToken('Bearer token-123')).toBe('token-123');
    expect(extractBearerToken('bearer token-xyz')).toBe('token-xyz');
    expect(extractBearerToken('')).toBeNull();
    expect(extractBearerToken(null)).toBeNull();
  });

  it('requires a matching bearer token', () => {
    process.env.WORKFLOW_CRON_SECRET = 'secret-1';
    const headers = new Headers({ authorization: 'Bearer secret-1' });
    expect(isWorkflowCronAuthorized(headers)).toBe(true);
  });

  it('rejects x-vercel-cron without bearer token', () => {
    process.env.WORKFLOW_CRON_SECRET = 'secret-1';
    const headers = new Headers({ 'x-vercel-cron': '1' });
    expect(isWorkflowCronAuthorized(headers)).toBe(false);
  });

  it('rejects invalid bearer token', () => {
    process.env.WORKFLOW_CRON_SECRET = 'secret-1';
    const headers = new Headers({ authorization: 'Bearer wrong-secret' });
    expect(isWorkflowCronAuthorized(headers)).toBe(false);
  });
});
