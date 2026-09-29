/**
 * Loads the policy inputs for a signed-in user: every non-revoked role grant (the
 * policy engine decides which are active at `now`) and the approval-area mapping.
 */
import type { ActiveSession } from '@deemed/auth';
import { schema, type Tx } from '@deemed/db';
import type { ApprovalAreas, ModuleId, Principal } from '@deemed/domain';
import { and, eq, isNull } from 'drizzle-orm';

export interface PrincipalBundle {
  principal: Principal;
  approvalAreas: ApprovalAreas;
  organizationName: string;
}

export async function loadPrincipal(tx: Tx, session: ActiveSession): Promise<PrincipalBundle> {
  const grants = await tx
    .select({
      id: schema.roleAssignment.id,
      roleId: schema.roleAssignment.roleKey,
      siteId: schema.roleAssignment.siteId,
      validFrom: schema.roleAssignment.validFrom,
      expiresAt: schema.roleAssignment.expiresAt,
      approvalArea: schema.roleAssignment.approvalArea,
    })
    .from(schema.roleAssignment)
    .where(
      and(
        eq(schema.roleAssignment.userAccountId, session.userAccountId),
        isNull(schema.roleAssignment.revokedAt),
      ),
    );
  const areas = await tx
    .select({ key: schema.approvalArea.key, modules: schema.approvalArea.modules })
    .from(schema.approvalArea);
  const org = await tx
    .select({ name: schema.organization.legalName })
    .from(schema.organization)
    .where(eq(schema.organization.id, session.organizationId))
    .limit(1);
  return {
    principal: {
      organizationId: session.organizationId,
      userAccountId: session.userAccountId,
      personId: session.personId,
      grants,
    },
    approvalAreas: Object.fromEntries(areas.map((a) => [a.key, a.modules as ModuleId[]])),
    organizationName: org[0]?.name ?? '',
  };
}
