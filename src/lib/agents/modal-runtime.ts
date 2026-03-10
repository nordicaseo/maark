import { extractBearerToken } from '@/lib/workflow/cron-auth';

export type AgentComputeRuntime = 'local' | 'modal';

const DEFAULT_CALLBACK_PATH = '/api/agent/runtime/callback';
const DEFAULT_MODAL_TIMEOUT_MS = 30_000;

function firstEnv(...keys: string[]): string | null {
  for (const key of keys) {
    const value = String(process.env[key] || '').trim();
    if (value) return value;
  }
  return null;
}

function normalizeBaseUrl(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function parseTimeoutMs(raw: string | null): number {
  const parsed = Number.parseInt(String(raw || ''), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_MODAL_TIMEOUT_MS;
  return Math.max(3_000, Math.min(parsed, 120_000));
}

function extractRuntimeJobId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const source = payload as Record<string, unknown>;
  for (const key of ['runtimeJobId', 'modalJobId', 'jobId', 'id']) {
    const value = source[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function normalizeRoutePath(path: string): string {
  const trimmed = String(path || '').trim();
  if (!trimmed) return '/agent/run';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function expectedCallbackSecrets(): string[] {
  const callbackSecret = firstEnv(
    'MAARK_AGENT_MODAL_CALLBACK_SECRET',
    'AGENT_MODAL_CALLBACK_SECRET'
  );
  const sharedSecret = firstEnv(
    'MAARK_AGENT_MODAL_SHARED_SECRET',
    'AGENT_MODAL_SHARED_SECRET'
  );
  return Array.from(
    new Set([callbackSecret, sharedSecret].map((value) => String(value || '').trim()).filter(Boolean))
  );
}

export interface ModalAgentRuntimeConfig {
  runtime: AgentComputeRuntime;
  baseUrl: string | null;
  sharedSecret: string | null;
  callbackSecret: string | null;
  callbackUrl: string | null;
  timeoutMs: number;
}

export interface DispatchModalAgentRunInput {
  payload: Record<string, unknown>;
  routePath?: string;
  runtimePreference?: AgentComputeRuntime | null;
}

export interface DispatchModalAgentRunResult {
  runtime: AgentComputeRuntime;
  dispatched: boolean;
  status: number | null;
  runtimeJobId: string | null;
  responsePayload: Record<string, unknown> | null;
  reasonCode:
    | 'runtime_local'
    | 'modal_url_missing'
    | 'modal_dispatch_success';
}

export function resolveAgentComputeRuntime(
  preferred?: AgentComputeRuntime | string | null
): AgentComputeRuntime {
  const requested = String(
    preferred || firstEnv('MAARK_AGENT_RUNTIME', 'AGENT_COMPUTE_RUNTIME') || 'local'
  )
    .trim()
    .toLowerCase();
  return requested === 'modal' ? 'modal' : 'local';
}

export function resolveModalAgentRuntimeConfig(
  preferredRuntime?: AgentComputeRuntime | string | null
): ModalAgentRuntimeConfig {
  const runtime = resolveAgentComputeRuntime(preferredRuntime);
  const baseUrl = normalizeBaseUrl(
    firstEnv('MAARK_AGENT_MODAL_URL', 'AGENT_MODAL_URL')
  );
  const sharedSecret = firstEnv(
    'MAARK_AGENT_MODAL_SHARED_SECRET',
    'AGENT_MODAL_SHARED_SECRET'
  );
  const callbackSecret =
    firstEnv('MAARK_AGENT_MODAL_CALLBACK_SECRET', 'AGENT_MODAL_CALLBACK_SECRET') ||
    sharedSecret;
  const callbackBaseUrl = normalizeBaseUrl(
    firstEnv(
      'NEXT_PUBLIC_APP_URL',
      'APP_URL',
      'VERCEL_PROJECT_PRODUCTION_URL'
    )
  );
  const callbackPath =
    firstEnv('MAARK_AGENT_MODAL_CALLBACK_PATH', 'AGENT_MODAL_CALLBACK_PATH') ||
    DEFAULT_CALLBACK_PATH;
  const callbackUrl = callbackBaseUrl
    ? `${callbackBaseUrl}${callbackPath.startsWith('/') ? callbackPath : `/${callbackPath}`}`
    : null;
  const timeoutMs = parseTimeoutMs(firstEnv('AGENT_MODAL_TIMEOUT_MS'));

  return {
    runtime,
    baseUrl,
    sharedSecret,
    callbackSecret,
    callbackUrl,
    timeoutMs,
  };
}

export async function dispatchModalAgentRun(
  input: DispatchModalAgentRunInput
): Promise<DispatchModalAgentRunResult> {
  const config = resolveModalAgentRuntimeConfig(input.runtimePreference);
  if (config.runtime !== 'modal') {
    return {
      runtime: 'local',
      dispatched: false,
      status: null,
      runtimeJobId: null,
      responsePayload: null,
      reasonCode: 'runtime_local',
    };
  }
  if (!config.baseUrl) {
    return {
      runtime: 'modal',
      dispatched: false,
      status: null,
      runtimeJobId: null,
      responsePayload: null,
      reasonCode: 'modal_url_missing',
    };
  }

  const routePath = normalizeRoutePath(input.routePath || '/agent/run');
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (config.sharedSecret) {
    headers['x-agent-secret'] = config.sharedSecret;
  }

  const payload: Record<string, unknown> = { ...input.payload };
  if (config.callbackUrl && payload.callbackUrl === undefined) {
    payload.callbackUrl = config.callbackUrl;
  }
  if (config.callbackSecret && payload.callbackSecret === undefined) {
    payload.callbackSecret = config.callbackSecret;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}${routePath}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const responsePayload = (await response.json().catch(() => null)) as
      | Record<string, unknown>
      | null;
    if (!response.ok) {
      const message =
        typeof responsePayload?.error === 'string'
          ? responsePayload.error
          : 'Modal dispatch failed.';
      throw new Error(`${message} (status ${response.status})`);
    }

    return {
      runtime: 'modal',
      dispatched: true,
      status: response.status,
      runtimeJobId: extractRuntimeJobId(responsePayload),
      responsePayload,
      reasonCode: 'modal_dispatch_success',
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function isModalAgentCallbackAuthorized(headers: Headers): boolean {
  const expected = expectedCallbackSecrets();
  if (expected.length === 0) return false;

  const provided =
    String(headers.get('x-agent-secret') || '').trim() ||
    String(headers.get('x-webhook-secret') || '').trim() ||
    String(extractBearerToken(headers.get('authorization')) || '').trim();
  if (!provided) return false;
  return expected.includes(provided);
}
