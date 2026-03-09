const BEARER_PREFIX = /^Bearer\s+/i;

export function extractBearerToken(
  authorizationHeader: string | null | undefined
): string | null {
  if (!authorizationHeader) return null;
  const token = authorizationHeader.replace(BEARER_PREFIX, '').trim();
  return token.length > 0 ? token : null;
}

function expectedWorkflowCronSecrets(): string[] {
  return Array.from(
    new Set(
      [process.env.WORKFLOW_CRON_SECRET, process.env.CRON_SECRET]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    )
  );
}

export function isWorkflowCronAuthorized(headers: Headers): boolean {
  const expectedSecrets = expectedWorkflowCronSecrets();
  if (expectedSecrets.length === 0) return false;
  const token = extractBearerToken(headers.get('authorization'));
  return token !== null && expectedSecrets.includes(token);
}
