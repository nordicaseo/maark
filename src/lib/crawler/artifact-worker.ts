import { createHmac } from 'crypto';
import type { PageIssueSeverity } from '@/types/page';

const PROCESS_PATH = '/artifacts/process';
const READ_PATH = '/artifacts/read';

function getWorkerBaseUrl(): string | null {
  const value = process.env.CLOUDFLARE_ARTIFACT_WORKER_URL;
  if (!value || !value.trim()) return null;
  return value.trim().replace(/\/+$/, '');
}

function getWorkerSecret(): string | null {
  const value = process.env.CLOUDFLARE_ARTIFACT_WORKER_SECRET;
  if (!value || !value.trim()) return null;
  return value.trim();
}

function getTimeoutMs(): number {
  const parsed = Number.parseInt(String(process.env.CLOUDFLARE_ARTIFACT_WORKER_TIMEOUT_MS || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 45_000;
  return Math.min(parsed, 180_000);
}

function signPayload(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

async function postWorker<TRequest, TResponse>(path: string, payload: TRequest): Promise<TResponse> {
  const baseUrl = getWorkerBaseUrl();
  const secret = getWorkerSecret();
  if (!baseUrl || !secret) {
    throw new Error('Cloudflare artifact worker is not configured.');
  }

  const body = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const signature = signPayload(secret, timestamp, body);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getTimeoutMs());

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-maark-timestamp': timestamp,
        'x-maark-signature': signature,
      },
      body,
      signal: controller.signal,
    });

    const json = (await response.json().catch(() => ({}))) as {
      error?: string;
      [key: string]: unknown;
    };

    if (!response.ok) {
      const detail = typeof json.error === 'string' ? json.error : `HTTP ${response.status}`;
      throw new Error(`Artifact worker request failed: ${detail}`);
    }

    return json as TResponse;
  } finally {
    clearTimeout(timeout);
  }
}

export function isArtifactWorkerConfigured(): boolean {
  return Boolean(getWorkerBaseUrl() && getWorkerSecret());
}

export interface WorkerArtifactDescriptor {
  objectKey: string;
  checksum?: string;
  sizeBytes?: number;
  mimeType?: string;
}

export interface WorkerGradeIssue {
  issueType: string;
  severity: PageIssueSeverity;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface WorkerGradeReport {
  score: number;
  dimensions: Record<string, number>;
  issues: WorkerGradeIssue[];
  summary?: string;
}

export interface ProcessArtifactsRequest {
  projectId: number;
  pageId: number;
  runId?: number | null;
  snapshotId: number;
  url: string;
  action?: 'process' | 'reclean' | 'regrade' | 'reprocess';
  rawHtml?: string;
  rawMarkdown?: string | null;
  rawObjectKey?: string | null;
  cleanObjectKey?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ProcessArtifactsResponse {
  raw: WorkerArtifactDescriptor;
  clean: WorkerArtifactDescriptor;
  grade: {
    artifact: WorkerArtifactDescriptor;
    report: WorkerGradeReport;
  };
  processedAt?: string;
}

export async function processArtifactsInWorker(
  payload: ProcessArtifactsRequest
): Promise<ProcessArtifactsResponse> {
  return postWorker<ProcessArtifactsRequest, ProcessArtifactsResponse>(PROCESS_PATH, payload);
}

export interface ReadArtifactContentRequest {
  objectKey: string;
}

export interface ReadArtifactContentResponse {
  objectKey: string;
  mimeType?: string;
  content: string;
}

export async function readArtifactContentFromWorker(
  payload: ReadArtifactContentRequest
): Promise<ReadArtifactContentResponse> {
  return postWorker<ReadArtifactContentRequest, ReadArtifactContentResponse>(READ_PATH, payload);
}
