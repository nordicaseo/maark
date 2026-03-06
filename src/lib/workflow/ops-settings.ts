import { eq } from 'drizzle-orm';
import { db, ensureDb } from '@/db';
import { dbNow } from '@/db/utils';
import { projects } from '@/db/schema';
import {
  getDefaultWorkflowOpsSettings,
  mergeWorkflowOpsSettings,
  parseSettingsRoot,
  resolveWorkflowOpsSettingsFromProjectSettings,
  type WorkflowOpsSettings,
} from '@/lib/workflow/ops-settings-utils';

export type { WorkflowOpsSettings } from '@/lib/workflow/ops-settings-utils';
export {
  getDefaultWorkflowOpsSettings,
  mergeWorkflowOpsSettings,
  resolveWorkflowOpsSettingsFromProjectSettings,
} from '@/lib/workflow/ops-settings-utils';

export async function getWorkflowOpsSettings(
  projectId?: number | null
): Promise<WorkflowOpsSettings> {
  await ensureDb();
  const defaults = getDefaultWorkflowOpsSettings();
  if (!projectId) return defaults;

  const [project] = await db
    .select({ settings: projects.settings })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) return defaults;
  return resolveWorkflowOpsSettingsFromProjectSettings(project.settings, defaults);
}

export async function updateProjectWorkflowOpsSettings(
  projectId: number,
  input: Partial<WorkflowOpsSettings>
): Promise<WorkflowOpsSettings> {
  await ensureDb();

  const [project] = await db
    .select({
      id: projects.id,
      settings: projects.settings,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) {
    throw new Error('Project not found.');
  }

  const currentRoot = parseSettingsRoot(project.settings);
  const current = resolveWorkflowOpsSettingsFromProjectSettings(currentRoot);
  const merged = mergeWorkflowOpsSettings(current, input);

  const nextSettings = {
    ...currentRoot,
    workflowOps: merged,
  };

  await db
    .update(projects)
    .set({
      settings: nextSettings,
      updatedAt: dbNow(),
    })
    .where(eq(projects.id, projectId));

  return merged;
}
