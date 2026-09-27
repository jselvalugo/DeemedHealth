import { z } from 'zod';
import { TenantScoped, Uuid, UtcTimestamp } from '../primitives.js';

export const NotificationChannel = z.enum(['in_app', 'email']);
export type NotificationChannel = z.infer<typeof NotificationChannel>;

/**
 * A message to one person, rendered from an EN/ES template. `params` carry ids
 * and short labels only, never PHI or field-encrypted values: email is not a
 * safe channel for them, so the message links back into the app instead.
 */
export const Notification = TenantScoped.extend({
  id: Uuid,
  recipientPersonId: Uuid,
  channel: NotificationChannel,
  templateKey: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/),
  params: z.record(z.string(), z.union([z.string().max(200), z.number(), z.boolean()])),
  taskId: Uuid.nullable(),
  requirementInstanceId: Uuid.nullable(),
  createdAt: UtcTimestamp,
  sentAt: UtcTimestamp.nullable(),
  readAt: UtcTimestamp.nullable(),
}).strict();
export type Notification = z.infer<typeof Notification>;
