'use client';

import { HeartPulse, Loader2, RefreshCcw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AgentLaneKey } from '@/types/agent-runtime';
import { formatDate, laneLabel } from '../_lib/agent-helpers';

interface RuntimePoolHealth {
  projectId: number;
  totalAgents: number;
  totalDedicated: number;
  availableWriters: number;
  queuedWriting: number;
  staleLocks: number;
  writerRows: Array<{
    id: string;
    name: string;
    status: string;
    lockHealth: string;
    currentTaskId: string | null;
    laneKey: AgentLaneKey | null;
    isTemporary?: boolean;
  }>;
  laneHealth: Array<{
    laneKey: AgentLaneKey;
    totalWriters: number;
    availableWriters: number;
    workingWriters: number;
    queuedWriting: number;
    oldestQueueAgeSec: number;
  }>;
}

interface HeartbeatResponse {
  runAt: string;
  projectSummary: string;
  suggestedActions: string[];
}

interface RuntimeTabProps {
  runtimeHealth: RuntimePoolHealth | null;
  heartbeatResult: HeartbeatResponse | null;
  heartbeatRunning: boolean;
  runtimeBusy: boolean;
  activeProjectId: number | null;
  onRunHeartbeat: () => void;
  onSyncRuntime: () => void;
  onRefreshHealth: () => void;
}

export function RuntimeTab({
  runtimeHealth,
  heartbeatResult,
  heartbeatRunning,
  runtimeBusy,
  activeProjectId,
  onRunHeartbeat,
  onSyncRuntime,
  onRefreshHealth,
}: RuntimeTabProps) {
  return (
    <div className="space-y-4">
      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={onRunHeartbeat} disabled={!activeProjectId || heartbeatRunning}>
          {heartbeatRunning ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1" />
          ) : (
            <HeartPulse className="h-4 w-4 mr-1" />
          )}
          Run Heartbeat
        </Button>
        <Button variant="outline" onClick={onSyncRuntime} disabled={!activeProjectId || runtimeBusy}>
          {runtimeBusy ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1" />
          ) : (
            <ShieldCheck className="h-4 w-4 mr-1" />
          )}
          Sync Runtime Team
        </Button>
        <Button variant="outline" onClick={onRefreshHealth} disabled={!activeProjectId || runtimeBusy}>
          <RefreshCcw className="h-3.5 w-3.5 mr-1" />
          Refresh
        </Button>
      </div>

      {/* Pool Health */}
      <div className="border border-border rounded-lg bg-card p-4 space-y-3">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" />
          Runtime Pool Health
        </h3>
        {runtimeHealth ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Total Agents" value={runtimeHealth.totalAgents} />
              <Stat label="Dedicated" value={runtimeHealth.totalDedicated} />
              <Stat label="Available Writers" value={runtimeHealth.availableWriters} />
              <Stat label="Queued Writing" value={runtimeHealth.queuedWriting} />
            </div>
            {runtimeHealth.staleLocks > 0 && (
              <p className="text-xs text-destructive">
                Stale writer locks: {runtimeHealth.staleLocks}
              </p>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No runtime health loaded.</p>
        )}
      </div>

      {/* Lane Health */}
      {runtimeHealth?.laneHealth && runtimeHealth.laneHealth.length > 0 && (
        <div className="border border-border rounded-lg bg-card p-4 space-y-3">
          <h3 className="font-semibold text-sm">Lane Health</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {runtimeHealth.laneHealth.map((lane) => (
              <div key={lane.laneKey} className="border border-border rounded-md p-3 space-y-1">
                <p className="text-sm font-medium">{laneLabel(lane.laneKey)}</p>
                <p className="text-xs text-muted-foreground">
                  {lane.totalWriters} total · {lane.availableWriters} avail · {lane.workingWriters} working
                </p>
                <p className="text-xs text-muted-foreground">
                  Queued: {lane.queuedWriting}
                  {lane.oldestQueueAgeSec > 0 && ` · oldest ${lane.oldestQueueAgeSec}s`}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Writer Rows */}
      {runtimeHealth?.writerRows && runtimeHealth.writerRows.length > 0 && (
        <div className="border border-border rounded-lg bg-card p-4 space-y-3">
          <h3 className="font-semibold text-sm">Writer Instances</h3>
          <div className="space-y-1.5 text-xs">
            {runtimeHealth.writerRows.map((writer) => (
              <div
                key={writer.id}
                className="flex items-center justify-between gap-2 border-b border-border/50 pb-1.5"
              >
                <div className="min-w-0">
                  <p className="font-medium truncate">{writer.name}</p>
                  <p className="text-muted-foreground">
                    {writer.laneKey ? laneLabel(writer.laneKey) : 'No lane'}
                    {writer.isTemporary ? ' · temporary' : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      writer.status === 'ONLINE' || writer.status === 'IDLE'
                        ? 'bg-emerald-100 text-emerald-700'
                        : writer.status === 'WORKING'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {writer.status}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] ${
                      writer.lockHealth === 'healthy' || writer.lockHealth === 'idle'
                        ? 'bg-emerald-50 text-emerald-600'
                        : writer.lockHealth === 'stale'
                          ? 'bg-red-50 text-red-600'
                          : 'bg-gray-50 text-gray-500'
                    }`}
                  >
                    {writer.lockHealth}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Heartbeat Result */}
      {heartbeatResult && (
        <div className="border border-border rounded-lg bg-card p-4">
          <h3 className="font-semibold text-sm mb-1">Last Heartbeat Result</h3>
          <p className="text-xs text-muted-foreground">
            {formatDate(heartbeatResult.runAt)} · {heartbeatResult.projectSummary}
          </p>
          {heartbeatResult.suggestedActions?.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-sm space-y-1">
              {heartbeatResult.suggestedActions.map((action) => (
                <li key={action}>{action}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-border rounded-md p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}
