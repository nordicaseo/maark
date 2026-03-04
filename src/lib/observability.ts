import { db, ensureDb } from '@/db';
import { alertEvents, auditLogs } from '@/db/schema';

type JsonMap = Record<string, unknown>;

export interface AuditLogInput {
  userId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | number | null;
  projectId?: number | null;
  severity?: 'info' | 'warning' | 'error';
  metadata?: JsonMap;
}

export interface AlertEventInput {
  source: string;
  eventType: string;
  message: string;
  severity?: 'info' | 'warning' | 'error' | 'critical';
  projectId?: number | null;
  resourceId?: string | number | null;
  metadata?: JsonMap;
}

export async function logAuditEvent(input: AuditLogInput) {
  try {
    await ensureDb();
    await db.insert(auditLogs).values({
      userId: input.userId ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId != null ? String(input.resourceId) : null,
      projectId: input.projectId ?? null,
      severity: input.severity ?? 'info',
      metadata: input.metadata ?? null,
    });
  } catch (error) {
    console.error('Audit logging failed:', error);
  }
}

export async function logAlertEvent(input: AlertEventInput) {
  try {
    await ensureDb();
    await db.insert(alertEvents).values({
      source: input.source,
      eventType: input.eventType,
      severity: input.severity ?? 'warning',
      message: input.message,
      projectId: input.projectId ?? null,
      resourceId: input.resourceId != null ? String(input.resourceId) : null,
      metadata: input.metadata ?? null,
    });

    const webhook = process.env.ALERT_WEBHOOK_URL;
    if (webhook) {
      await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: input.source,
          eventType: input.eventType,
          severity: input.severity ?? 'warning',
          message: input.message,
          projectId: input.projectId ?? null,
          resourceId: input.resourceId != null ? String(input.resourceId) : null,
          metadata: input.metadata ?? null,
          at: new Date().toISOString(),
        }),
      });
    }
  } catch (error) {
    console.error('Alert logging failed:', error);
  }
}
