const BEARER_PREFIX = /^Bearer\s+/i;

export function extractBearerToken(
  authorizationHeader: string | null | undefined
): string | null {
  if (!authorizationHeader) return null;
  const token = authorizationHeader.replace(BEARER_PREFIX, '').trim();
  return token.length > 0 ? token : null;
}

export function isWorkflowCronAuthorized(headers: Headers): boolean {
  const expected = String(process.env.WORKFLOW_CRON_SECRET || '').trim();
  if (!expected) return false;
  const token = extractBearerToken(headers.get('authorization'));
  return token === expected;
}
