import { z } from 'zod';
import { IsoDate, RecordMeta, RequirementId, TenantScoped, Uuid } from '../primitives.js';
import { ModuleIdSchema } from '../modules.js';
import { RoleIdSchema } from '../permissions.js';

export const TaskStatus = z.enum(['open', 'in_progress', 'blocked', 'done', 'cancelled']);
export type TaskStatus = z.infer<typeof TaskStatus>;

/**
 * The single action surface. Modules create tasks through the Tasks domain
 * service and never keep a private to-do list. A task is assigned to a person,
 * to a role queue, or to both.
 */
export const Task = TenantScoped.extend({
  id: Uuid,
  title: z.string().trim().min(1).max(300),
  status: TaskStatus,
  dueOn: IsoDate.nullable(),
  sourceModule: ModuleIdSchema,
  siteId: Uuid.nullable(),
  assigneePersonId: Uuid.nullable(),
  assigneeRole: RoleIdSchema.nullable(),
  requirementInstanceId: Uuid.nullable(),
  workflowRunId: Uuid.nullable(),
  /** Catalog requirements this task serves; empty only for non-regulatory tasks. */
  requirementIds: z.array(RequirementId),
})
  .merge(RecordMeta)
  .strict()
  .refine((t) => t.assigneePersonId !== null || t.assigneeRole !== null, {
    message: 'A task needs an assignee person or role queue',
    path: ['assigneePersonId'],
  });
export type Task = z.infer<typeof Task>;
