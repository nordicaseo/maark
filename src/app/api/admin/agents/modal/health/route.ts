import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { resolveModalAgentRuntimeConfig } from '@/lib/agents/modal-runtime';

export async function GET() {
  const auth = await requireRole('admin');
  if (auth.error) return auth.error;

  const config = resolveModalAgentRuntimeConfig();
  if (config.runtime !== 'modal') {
    return NextResponse.json({
      enabled: false,
      runtime: config.runtime,
      configured: false,
      reasonCode: 'runtime_local',
    });
  }

  if (!config.baseUrl) {
    return NextResponse.json({
      enabled: true,
      runtime: config.runtime,
      configured: false,
      reasonCode: 'modal_url_missing',
    });
  }

  const headers: Record<string, string> = {};
  if (config.sharedSecret) {
    headers['x-agent-secret'] = config.sharedSecret;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}/health`, {
      method: 'GET',
      headers,
      signal: controller.signal,
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => null);

    return NextResponse.json({
      enabled: true,
      runtime: config.runtime,
      configured: true,
      reachable: response.ok,
      status: response.status,
      baseUrl: config.baseUrl,
      callbackUrl: config.callbackUrl,
      payload,
    });
  } catch (error) {
    return NextResponse.json({
      enabled: true,
      runtime: config.runtime,
      configured: true,
      reachable: false,
      status: null,
      baseUrl: config.baseUrl,
      callbackUrl: config.callbackUrl,
      error: error instanceof Error ? error.message : 'Unknown Modal health error',
    });
  } finally {
    clearTimeout(timeout);
  }
}
