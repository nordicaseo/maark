import { execFileSync } from 'node:child_process';

const CANONICAL_ALIAS =
  process.env.VERCEL_CANONICAL_ALIAS || 'maark-nordicaseo.vercel.app';
const REQUIRED_DOMAINS = (process.env.VERCEL_REQUIRED_DOMAINS || 'maark.ai,www.maark.ai')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

function parseJsonFromCliOutput(output) {
  const start = output.indexOf('{');
  if (start < 0) {
    throw new Error(`Unable to parse JSON output:\n${output}`);
  }
  return JSON.parse(output.slice(start));
}

function inspectDeployment(ref) {
  try {
    const raw = execFileSync('vercel', ['inspect', ref, '--json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const parsed = parseJsonFromCliOutput(raw);
    return {
      ref,
      id: String(parsed.id || ''),
      url: String(parsed.url || ''),
      target: String(parsed.target || ''),
      readyState: String(parsed.readyState || ''),
    };
  } catch (error) {
    const output = `${error.stdout || ''}\n${error.stderr || ''}`.trim();
    throw new Error(`Failed to inspect "${ref}".\n${output}`);
  }
}

function validateCanonicalDeployment(deployment) {
  if (!deployment.id) {
    throw new Error(
      `Canonical alias "${deployment.ref}" did not return a deployment id.`
    );
  }
  if (deployment.target !== 'production') {
    throw new Error(
      `Canonical alias "${deployment.ref}" is not production (target=${deployment.target || 'unknown'}).`
    );
  }
  if (deployment.readyState !== 'READY') {
    throw new Error(
      `Canonical alias "${deployment.ref}" is not ready (readyState=${deployment.readyState || 'unknown'}).`
    );
  }
}

function main() {
  if (REQUIRED_DOMAINS.length === 0) {
    throw new Error('No required domains configured for alias verification.');
  }

  const canonical = inspectDeployment(CANONICAL_ALIAS);
  validateCanonicalDeployment(canonical);

  const mismatches = [];
  for (const domain of REQUIRED_DOMAINS) {
    const inspected = inspectDeployment(domain);
    if (inspected.id !== canonical.id) {
      mismatches.push({ domain, inspected });
    }
  }

  if (mismatches.length > 0) {
    console.error('\nVercel domain alias drift detected.\n');
    console.error(
      `Canonical deployment: ${CANONICAL_ALIAS} -> ${canonical.url} (${canonical.id})`
    );
    for (const mismatch of mismatches) {
      console.error(
        `- ${mismatch.domain} -> ${mismatch.inspected.url} (${mismatch.inspected.id})`
      );
      console.error(
        `  Fix: vercel alias set ${canonical.url} ${mismatch.domain}`
      );
    }
    process.exit(1);
  }

  console.log(
    `Vercel alias verification passed (${REQUIRED_DOMAINS.join(', ')} -> ${canonical.url}).`
  );
}

main();
