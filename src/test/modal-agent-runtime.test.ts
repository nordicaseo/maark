import { afterEach, describe, expect, it } from 'vitest';
import {
  isModalAgentCallbackAuthorized,
  resolveAgentComputeRuntime,
  resolveModalAgentRuntimeConfig,
} from '@/lib/agents/modal-runtime';

const ENV_KEYS = [
  'MAARK_AGENT_RUNTIME',
  'AGENT_COMPUTE_RUNTIME',
  'MAARK_AGENT_MODAL_URL',
  'AGENT_MODAL_URL',
  'MAARK_AGENT_MODAL_SHARED_SECRET',
  'AGENT_MODAL_SHARED_SECRET',
  'MAARK_AGENT_MODAL_CALLBACK_SECRET',
  'AGENT_MODAL_CALLBACK_SECRET',
  'NEXT_PUBLIC_APP_URL',
  'APP_URL',
  'VERCEL_PROJECT_PRODUCTION_URL',
  'MAARK_AGENT_MODAL_CALLBACK_PATH',
  'AGENT_MODAL_CALLBACK_PATH',
] as const;

const ORIGINAL_ENV = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]])
) as Record<(typeof ENV_KEYS)[number], string | undefined>;

afterEach(() => {
  for (const key of ENV_KEYS) {
    const previous = ORIGINAL_ENV[key];
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});

describe('modal agent runtime config', () => {
  it('defaults to local runtime', () => {
    delete process.env.MAARK_AGENT_RUNTIME;
    delete process.env.AGENT_COMPUTE_RUNTIME;
    expect(resolveAgentComputeRuntime()).toBe('local');
  });

  it('resolves modal runtime with normalized callback URL', () => {
    process.env.AGENT_COMPUTE_RUNTIME = 'modal';
    process.env.AGENT_MODAL_URL = 'modal.maark.ai';
    process.env.AGENT_MODAL_SHARED_SECRET = 'shared-secret';
    process.env.NEXT_PUBLIC_APP_URL = 'maark.ai';

    const config = resolveModalAgentRuntimeConfig();
    expect(config.runtime).toBe('modal');
    expect(config.baseUrl).toBe('https://modal.maark.ai');
    expect(config.callbackUrl).toBe('https://maark.ai/api/agent/runtime/callback');
  });

  it('authorizes callback secret via header or bearer token', () => {
    process.env.AGENT_MODAL_CALLBACK_SECRET = 'callback-secret';

    const byHeader = new Headers({ 'x-agent-secret': 'callback-secret' });
    const byBearer = new Headers({ authorization: 'Bearer callback-secret' });
    const invalid = new Headers({ 'x-agent-secret': 'wrong-secret' });

    expect(isModalAgentCallbackAuthorized(byHeader)).toBe(true);
    expect(isModalAgentCallbackAuthorized(byBearer)).toBe(true);
    expect(isModalAgentCallbackAuthorized(invalid)).toBe(false);
  });
});
