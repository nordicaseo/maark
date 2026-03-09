import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BLOCKED_PATH_MARKERS = ['site-auditor', 'serpmesh', 'serp-mesh'];
const EXPECTED_REMOTES = [
  'https://github.com/nordicaseo/maark.git',
  'https://github.com/nordicaseo/maark',
  'git@github.com:nordicaseo/maark.git',
  'git@github.com:nordicaseo/maark',
];
const EXPECTED_PACKAGE_NAME = process.env.EXPECTED_PACKAGE_NAME || 'content-writer';
const EXPECTED_VERCEL_PROJECT_NAME =
  process.env.EXPECTED_VERCEL_PROJECT_NAME || 'maark';
const EXPECTED_VERCEL_PROJECT_ID =
  process.env.EXPECTED_VERCEL_PROJECT_ID || 'prj_6JDgeFGHSTs42AjlaXOOXkLNquy4';
const EXPECTED_VERCEL_ORG_ID =
  process.env.EXPECTED_VERCEL_ORG_ID || 'team_12ttcviDMRgJSWVEGXTcFfjp';

function runGit(args) {
  try {
    return execFileSync('git', args, {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    const output = `${error.stdout || ''}\n${error.stderr || ''}`.trim();
    throw new Error(`Failed to run git ${args.join(' ')}.\n${output}`);
  }
}

function ensureNotBlockedPath(pathValue, label) {
  const normalizedPath = String(pathValue || '').toLowerCase();
  const blockedMarker = BLOCKED_PATH_MARKERS.find((marker) =>
    normalizedPath.includes(marker)
  );
  if (blockedMarker) {
    throw new Error(
      `${label} contains blocked marker "${blockedMarker}". This guard only allows maark/content-writer work.`
    );
  }
}

function verifyGitRemote() {
  const origin = runGit(['remote', 'get-url', 'origin']);
  if (!EXPECTED_REMOTES.includes(origin)) {
    throw new Error(
      `Git origin mismatch.\nExpected one of: ${EXPECTED_REMOTES.join(', ')}\nActual: ${origin}`
    );
  }
  return origin;
}

function verifyPackageName() {
  const packagePath = resolve(process.cwd(), 'package.json');
  if (!existsSync(packagePath)) {
    throw new Error(`Missing package.json at ${packagePath}`);
  }
  const parsed = JSON.parse(readFileSync(packagePath, 'utf8'));
  const packageName = String(parsed.name || '');
  if (packageName !== EXPECTED_PACKAGE_NAME) {
    throw new Error(
      `package.json name mismatch.\nExpected: ${EXPECTED_PACKAGE_NAME}\nActual: ${packageName || '(empty)'}`
    );
  }
  return packageName;
}

function verifyVercelProjectLink() {
  const vercelProjectPath = resolve(process.cwd(), '.vercel/project.json');
  if (!existsSync(vercelProjectPath)) {
    throw new Error(
      `Missing .vercel/project.json at ${vercelProjectPath}. Run "npx vercel link" for the maark project.`
    );
  }

  const parsed = JSON.parse(readFileSync(vercelProjectPath, 'utf8'));
  const projectName = String(parsed.projectName || '');
  const projectId = String(parsed.projectId || '');
  const orgId = String(parsed.orgId || '');

  const mismatches = [];
  if (projectName !== EXPECTED_VERCEL_PROJECT_NAME) {
    mismatches.push(
      `projectName expected "${EXPECTED_VERCEL_PROJECT_NAME}" but was "${projectName || '(empty)'}"`
    );
  }
  if (projectId !== EXPECTED_VERCEL_PROJECT_ID) {
    mismatches.push(
      `projectId expected "${EXPECTED_VERCEL_PROJECT_ID}" but was "${projectId || '(empty)'}"`
    );
  }
  if (orgId !== EXPECTED_VERCEL_ORG_ID) {
    mismatches.push(`orgId expected "${EXPECTED_VERCEL_ORG_ID}" but was "${orgId || '(empty)'}"`);
  }

  if (mismatches.length > 0) {
    throw new Error(
      `.vercel/project.json guard failed:\n- ${mismatches.join('\n- ')}`
    );
  }

  return { projectName, projectId, orgId };
}

function main() {
  const cwd = process.cwd();
  ensureNotBlockedPath(cwd, 'Working directory');

  const topLevel = runGit(['rev-parse', '--show-toplevel']);
  ensureNotBlockedPath(topLevel, 'Git top-level');

  const origin = verifyGitRemote();
  const packageName = verifyPackageName();
  const vercelProject = verifyVercelProjectLink();

  console.log(
    `Project guardrails passed (origin=${origin}, package=${packageName}, vercel=${vercelProject.projectName}/${vercelProject.projectId}).`
  );
}

main();
