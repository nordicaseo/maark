import { execFileSync } from 'node:child_process';

const DEFAULT_PROJECT_PRODUCTION_ALIAS = 'maark-nordicaseo.vercel.app';

function normalizeRef(ref) {
  return String(ref || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
}

const PROJECT_PRODUCTION_REF =
  normalizeRef(
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
      process.env.VERCEL_PRODUCTION_ALIAS ||
      DEFAULT_PROJECT_PRODUCTION_ALIAS
  );
const CANONICAL_ALIAS = normalizeRef(
  process.env.VERCEL_CANONICAL_ALIAS || PROJECT_PRODUCTION_REF
);
const EXPECTED_PROJECT_NAME =
  process.env.EXPECTED_VERCEL_PROJECT_NAME || 'maark';
const EXPECTED_CONTEXT_NAME =
  process.env.EXPECTED_VERCEL_CONTEXT_NAME || 'nordicaseo';
const REQUIRED_DOMAINS = (process.env.VERCEL_REQUIRED_DOMAINS ||
  'maark.ai,www.maark.ai')
  .split(',')
  .map((value) => normalizeRef(value))
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
    const raw = execFileSync('npx', ['vercel', 'inspect', ref, '--json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const parsed = parseJsonFromCliOutput(raw);
    return {
      ref,
      id: String(parsed.id || ''),
      url: normalizeRef(parsed.url || ''),
      target: String(parsed.target || ''),
      readyState: String(parsed.readyState || ''),
      name: String(parsed.name || ''),
      contextName: String(parsed.contextName || ''),
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
  if (deployment.name !== EXPECTED_PROJECT_NAME) {
    throw new Error(
      `Deployment "${deployment.ref}" belongs to project "${deployment.name || 'unknown'}" (expected "${EXPECTED_PROJECT_NAME}").`
    );
  }
  if (deployment.contextName !== EXPECTED_CONTEXT_NAME) {
    throw new Error(
      `Deployment "${deployment.ref}" belongs to context "${deployment.contextName || 'unknown'}" (expected "${EXPECTED_CONTEXT_NAME}").`
    );
  }
}

function main() {
  if (REQUIRED_DOMAINS.length === 0) {
    throw new Error('No required domains configured for alias verification.');
  }
  if (!PROJECT_PRODUCTION_REF) {
    throw new Error('Project production alias reference is required for alias verification.');
  }

  const projectProduction = inspectDeployment(PROJECT_PRODUCTION_REF);
  validateCanonicalDeployment(projectProduction);
  const canonical =
    CANONICAL_ALIAS === PROJECT_PRODUCTION_REF
      ? projectProduction
      : inspectDeployment(CANONICAL_ALIAS);
  validateCanonicalDeployment(canonical);

  if (canonical.id !== projectProduction.id) {
    console.error('\nVercel production alias drift detected.\n');
    console.error(
      `Canonical (${CANONICAL_ALIAS}) -> ${canonical.url} (${canonical.id})`
    );
    console.error(
      `Project production (${PROJECT_PRODUCTION_REF}) -> ${projectProduction.url} (${projectProduction.id})`
    );
    process.exit(1);
  }

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
      `Project production: ${PROJECT_PRODUCTION_REF} -> ${projectProduction.url} (${projectProduction.id})`
    );
    for (const mismatch of mismatches) {
      console.error(
        `- ${mismatch.domain} -> ${mismatch.inspected.url} (${mismatch.inspected.id})`
      );
      console.error(
        `  Fix: npx vercel alias set ${projectProduction.url} ${mismatch.domain}`
      );
    }
    process.exit(1);
  }

  console.log(
    `Vercel alias verification passed (${REQUIRED_DOMAINS.join(', ')} -> ${projectProduction.url}).`
  );
}

main();
