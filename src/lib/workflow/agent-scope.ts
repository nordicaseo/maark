export function normalizeId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveTrustedAgentId(args: {
  requestedAgentId?: unknown;
  assignedAgentId?: unknown;
}): string | null {
  const requested = normalizeId(args.requestedAgentId);
  const assigned = normalizeId(args.assignedAgentId);
  if (!assigned) return null;
  if (!requested) return assigned;
  return requested === assigned ? assigned : null;
}
