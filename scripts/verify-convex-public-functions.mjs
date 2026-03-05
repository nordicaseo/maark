import { execFileSync } from 'node:child_process';

const REQUIRED_REMOTE_FUNCTIONS = [
  'tasks:get',
  'tasks:list',
  'agents:list',
  'topicWorkflow:getWorkflowContext',
  'topicWorkflow:advanceStage',
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

async function main() {
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
