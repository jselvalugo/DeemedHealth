/**
 * Administration: role grants and MFA reset. Every mutation here needs a step-up within
 * 5 minutes (ADR-0006 rule 5), is checked per record (site scope), is audited in the
 * same transaction (ADR-0006 rule 10, ADR-0008 `permission` and `auth`), and makes the
 * affected user's sessions rotate their token (rule 4: rotation on privilege change).
 */
import { appendAuditEvent, schema, type TransactionContext, type Tx } from '@deemed/db';
import {
  GrantRoleRequest,
  MfaResetRequest,
  RevokeRoleRequest,
  getRole,
  type MfaResetResponse,
  type RoleAssignmentView,
} from '@deemed/domain';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { redactedDiff } from '../audit.js';
import type { Handler, Helpers } from '../context.js';
import { ApiError, DeniedError } from '../errors.js';
import type { RouteId } from '../manifest.js';

const UserParams = z.object({ userAccountId: z.string().uuid() });
const IdParams = z.object({ id: z.string().uuid() });
const DAY_MS = 86_400_000;

type AssignmentRow = typeof schema.roleAssignment.$inferSelect;

function view(r: AssignmentRow): RoleAssignmentView {
  return {
    id: r.id,
    userAccountId: r.userAccountId,
    roleId: r.roleKey,
    siteId: r.siteId,
    validFrom: r.validFrom.toISOString(),
    expiresAt: r.expiresAt?.toISOString() ?? null,
    approvalArea: r.approvalArea,
    revokedAt: r.revokedAt?.toISOString() ?? null,
  };
}

async function requireUser(tx: Tx, userAccountId: string): Promise<void> {
  const found = await tx
    .select({ id: schema.userAccount.id })
    .from(schema.userAccount)
    .where(eq(schema.userAccount.id, userAccountId))
    .limit(1);
  if (found.length === 0) throw new ApiError('not_found');
}

/** An administrator never changes their own roles or MFA (separation of duties). */
function notSelf(h: Helpers, userAccountId: string): void {
  if (userAccountId === h.session().userAccountId) {
    throw new DeniedError('self_service_forbidden', { table: 'user_account', id: userAccountId });
  }
}

function assignmentDiff(before: AssignmentRow | null, after: AssignmentRow) {
  const pick = (r: AssignmentRow | null) =>
    r && {
      role_key: r.roleKey,
      site_id: r.siteId,
      valid_from: r.validFrom,
      expires_at: r.expiresAt,
      approval_area: r.approvalArea,
      revoked_at: r.revokedAt,
      grant_reason: r.grantReason,
      revoke_reason: r.revokeReason,
    };
  return redactedDiff('public.role_assignment', pick(before), pick(after));
}

export const adminHandlers = {
  'admin.roles.list': async (_req, _reply, h): Promise<{ assignments: RoleAssignmentView[] }> => {
    const { userAccountId } = h.params(UserParams);
    return h.tenant(async (tx) => {
      await requireUser(tx, userAccountId);
      const rows = await tx
        .select()
        .from(schema.roleAssignment)
        .where(eq(schema.roleAssignment.userAccountId, userAccountId));
      // Site scope: only grants at sites the caller administers.
      const visible = rows.filter((r) => h.allowed('admin:read', { siteId: r.siteId }));
      return { assignments: visible.map(view) };
    });
  },

  'admin.roles.grant': async (_req, _reply, h): Promise<RoleAssignmentView> => {
    const body = h.body(GrantRoleRequest);
    const now = h.now();
    const role = getRole(body.roleId);
    const expiresAt: Date | null = body.expiresAt ? new Date(body.expiresAt) : null;
    if (role.requiresEndDate) {
      const max = (role.maxAccessDays ?? 0) * DAY_MS;
      if (
        !expiresAt ||
        expiresAt.getTime() <= now.getTime() ||
        expiresAt.getTime() - now.getTime() > max
      ) {
        throw new ApiError('bad_request', ['expiresAt']);
      }
    } else if (expiresAt && expiresAt.getTime() <= now.getTime()) {
      throw new ApiError('bad_request', ['expiresAt']);
    }
    if (body.approvalArea !== undefined && body.roleId !== 'executive') {
      throw new ApiError('bad_request', ['approvalArea']);
    }
    if (body.approvalArea !== undefined && !(body.approvalArea in h.ctx.approvalAreas)) {
      throw new ApiError('bad_request', ['approvalArea']);
    }
    notSelf(h, body.userAccountId);

    return h.tenant(async (tx, txCtx) => {
      await requireUser(tx, body.userAccountId);
      if (body.siteId) {
        const site = await tx
          .select({ id: schema.site.id })
          .from(schema.site)
          .where(eq(schema.site.id, body.siteId))
          .limit(1);
        if (site.length === 0) throw new ApiError('not_found');
      }
      h.authorize(
        'admin:write',
        { siteId: body.siteId ?? null },
        { table: 'user_account', id: body.userAccountId, siteId: body.siteId ?? null },
      );
      const [row] = await tx
        .insert(schema.roleAssignment)
        .values({
          organizationId: txCtx.organizationId as string,
          userAccountId: body.userAccountId,
          roleKey: body.roleId,
          siteId: body.siteId ?? null,
          validFrom: now,
          expiresAt,
          grantReason: body.reason,
          approvalArea: body.approvalArea ?? null,
        })
        .returning();
      const created = row as AssignmentRow;
      await h.services.auth.requireRotation(tx, body.userAccountId);
      await appendPermissionEvent(
        h,
        tx,
        txCtx,
        'role.grant',
        created,
        assignmentDiff(null, created),
        body.reason,
      );
      return view(created);
    });
  },

  'admin.roles.revoke': async (_req, _reply, h): Promise<RoleAssignmentView> => {
    const { id } = h.params(IdParams);
    const { reason } = h.body(RevokeRoleRequest);
    const now = h.now();
    return h.tenant(async (tx, txCtx) => {
      const existing = (
        await tx
          .select()
          .from(schema.roleAssignment)
          .where(eq(schema.roleAssignment.id, id))
          .limit(1)
      )[0];
      if (!existing) throw new ApiError('not_found');
      notSelf(h, existing.userAccountId);
      h.authorize(
        'admin:write',
        { siteId: existing.siteId },
        { table: 'role_assignment', id: existing.id, siteId: existing.siteId },
      );
      if (existing.revokedAt) throw new ApiError('conflict');
      const [row] = await tx
        .update(schema.roleAssignment)
        .set({ revokedAt: now, revokedBy: h.session().userAccountId, revokeReason: reason })
        .where(eq(schema.roleAssignment.id, id))
        .returning();
      const revoked = row as AssignmentRow;
      await h.services.auth.requireRotation(tx, existing.userAccountId);
      await appendPermissionEvent(
        h,
        tx,
        txCtx,
        'role.revoke',
        revoked,
        assignmentDiff(existing, revoked),
        reason,
      );
      return view(revoked);
    });
  },

  'admin.mfa.reset': async (_req, _reply, h): Promise<MfaResetResponse> => {
    const { userAccountId } = h.params(UserParams);
    const { reason } = h.body(MfaResetRequest);
    notSelf(h, userAccountId);
    return h.tenant(async (tx, txCtx) => {
      await requireUser(tx, userAccountId);
      // MFA reset is organization-wide: a site-scoped administrator cannot do it.
      h.authorize('admin:write', { siteId: null }, { table: 'user_account', id: userAccountId });
      return h.services.auth.resetMfa(tx, txCtx, userAccountId, reason, h.ctx.meta);
    });
  },
} satisfies Partial<Record<RouteId, Handler>>;

async function appendPermissionEvent(
  h: Helpers,
  tx: Tx,
  txCtx: TransactionContext,
  action: 'role.grant' | 'role.revoke',
  row: AssignmentRow,
  diff: ReturnType<typeof redactedDiff>,
  reason: string,
) {
  await appendAuditEvent(tx, txCtx, {
    category: 'permission',
    action,
    targetTable: 'role_assignment',
    targetId: row.id,
    ...(row.siteId ? { siteId: row.siteId } : {}),
    reason,
    diff,
    metadata: { subject_user_account_id: row.userAccountId, role: row.roleKey },
    sessionId: h.session().id,
  });
}
