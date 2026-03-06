import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REQUIRED_REMOTE_FUNCTIONS = [
  'tasks:get',
  'tasks:list',
  'agents:list',
  'topicWorkflow:getWorkflowContext',
  'topicWorkflow:advanceStage',
  'topicWorkflow:resetFromStage',
  'topicWorkflow:ensureStageOwner',
];

const REQUIRED_API_ROUTES = [
  'src/app/api/ai/process-comments/route.ts',
  'src/app/api/topic-workflow/create/route.ts',
  'src/app/api/topic-workflow/run/route.ts',
  'src/app/api/topic-workflow/advance/route.ts',
  'src/app/api/topic-workflow/approve/route.ts',
  'src/app/api/topic-workflow/rerun/route.ts',
  'src/app/api/admin/agents/route.ts',
  'src/app/api/admin/agents/shared-user/route.ts',
  'src/app/api/admin/agents/heartbeat/route.ts',
  'src/app/api/admin/crawl-gsc/route.ts',
  'src/app/api/admin/crawl-gsc/run/route.ts',
  'src/app/api/admin/crawl-gsc/cron/route.ts',
  'src/app/api/admin/crawl-gsc/observability/route.ts',
  'src/app/api/admin/crawl-gsc/properties/route.ts',
  'src/app/api/admin/crawl-gsc/oauth/start/route.ts',
  'src/app/api/admin/crawl-gsc/oauth/callback/route.ts',
  'src/app/api/mission-control/tasks/[id]/route.ts',
  'src/app/api/client/dashboard/route.ts',
  'src/app/api/pages/[id]/insights/route.ts',
  'src/app/api/pages/[id]/keywords/route.ts',
];

const ACCEPTABLE_VALIDATION_ERRORS = [
  /ArgumentValidationError/i,
  /invalid arguments/i,
  /missing required field/i,
  /required value/i,
];

function runConvex(fnName, args = '{}') {
  try {
    const stdout = execFileSync('npx', ['convex', 'run', fnName, args], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, output: stdout || '' };
  } catch (error) {
    const output = `${error.stdout || ''}\n${error.stderr || ''}`.trim();
    if (/Could not find public function/i.test(output)) {
      return { ok: false, output };
    }
    if (ACCEPTABLE_VALIDATION_ERRORS.some((pattern) => pattern.test(output))) {
      return { ok: true, output };
    }
    return { ok: false, output };
  }
}

function verifyRoleMembershipReadiness() {
  const permissionsPath = resolve(process.cwd(), 'src/lib/permissions.ts');
  const accessPath = resolve(process.cwd(), 'src/lib/access.ts');
  const permissions = readFileSync(permissionsPath, 'utf8');
  const access = readFileSync(accessPath, 'utf8');

  const requiredPermissionMarkers = ['super_admin', 'client', 'PROJECT_ROLE_LEVELS', 'isRootRole'];
  const missingPermissionMarkers = requiredPermissionMarkers.filter(
    (marker) => !permissions.includes(marker)
  );
  if (missingPermissionMarkers.length > 0) {
    throw new Error(
      `permissions.ts is missing required RBAC markers: ${missingPermissionMarkers.join(', ')}`
    );
  }

  const requiredAccessMarkers = ['userCanMutateProject', 'getProjectMembershipRole', 'isAdminUser'];
  const missingAccessMarkers = requiredAccessMarkers.filter((marker) => !access.includes(marker));
  if (missingAccessMarkers.length > 0) {
    throw new Error(
      `access.ts is missing required membership markers: ${missingAccessMarkers.join(', ')}`
    );
  }
}

async function main() {
  const missingRoutes = REQUIRED_API_ROUTES.filter(
    (routePath) => !existsSync(resolve(process.cwd(), routePath))
  );
  if (missingRoutes.length > 0) {
    console.error('\nRequired API routes are missing.\n');
    for (const routePath of missingRoutes) {
      console.error(`- ${routePath}`);
    }
    process.exit(1);
  }

  verifyRoleMembershipReadiness();

  const failures = [];
  for (const fnName of REQUIRED_REMOTE_FUNCTIONS) {
    const result = runConvex(fnName, '{}');
    if (!result.ok) {
      failures.push({ fnName, output: result.output });
    }
  }

  if (failures.length > 0) {
    console.error('\nConvex public function verification failed.\n');
    for (const failure of failures) {
      console.error(`- ${failure.fnName}`);
      console.error(failure.output || '(no output)');
      console.error('');
    }
    process.exit(1);
  }

  console.log('Convex public function verification passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
