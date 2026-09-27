import { describe, expect, it } from 'vitest';
import {
  AUDIT_ACTION_NAMES,
  AUDIT_ACTION_PATTERN,
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
} from './audit-actions.js';
import { AuditEvent, AuditEventInput } from './entities/audit-event.js';
import { HASH, ID, ORG, PERSON, TS, USER } from './fixtures.test-utils.js';

const mutation = {
  organizationId: ORG,
  category: 'mutation',
  action: 'site.update',
  outcome: 'success',
  actorType: 'user',
  actorPersonId: PERSON,
  actorUserId: USER,
  actorLabel: 'Synthetic Admin',
  onBehalfOfId: null,
  sessionId: ID(40),
  requestId: ID(41),
  ipAddress: '192.0.2.10',
  userAgent: 'vitest',
  siteId: ID(10),
  targetTable: 'site',
  targetId: ID(10),
  requirementIds: [],
  reason: null,
  diff: { fields: { name: { before: 'Main', after: 'Main Street' } } },
  metadata: {},
};

describe('audit action registry (ADR-0008 §4)', () => {
  it('names follow <entity>.<verb> and map to a known category', () => {
    for (const name of AUDIT_ACTION_NAMES) {
      expect(name).toMatch(AUDIT_ACTION_PATTERN);
      expect(AUDIT_CATEGORIES).toContain(AUDIT_ACTIONS[name].category);
    }
  });

  it('covers every category', () => {
    const used = new Set(Object.values(AUDIT_ACTIONS).map((a) => a.category));
    expect([...used].sort()).toEqual([...AUDIT_CATEGORIES].sort());
  });
});

describe('AuditEventInput', () => {
  it('accepts a well-formed mutation', () => {
    expect(AuditEventInput.parse(mutation)).toEqual(mutation);
  });

  it('rejects an unregistered action', () => {
    expect(AuditEventInput.safeParse({ ...mutation, action: 'site.explode' }).success).toBe(false);
  });

  it('rejects a category that does not match the registry', () => {
    expect(AuditEventInput.safeParse({ ...mutation, category: 'system' }).success).toBe(false);
  });

  it('requires a diff on a successful mutation but not on a denied one', () => {
    expect(AuditEventInput.safeParse({ ...mutation, diff: null }).success).toBe(false);
    expect(AuditEventInput.safeParse({ ...mutation, diff: null, outcome: 'denied' }).success).toBe(
      true,
    );
  });

  it('requires a reason for reveals', () => {
    const reveal = {
      ...mutation,
      category: 'reveal',
      action: 'person.reveal_dob',
      targetTable: 'person',
      targetId: PERSON,
      diff: null,
    };
    expect(AuditEventInput.safeParse(reveal).success).toBe(false);
    expect(AuditEventInput.safeParse({ ...reveal, reason: 'Primary source check' }).success).toBe(
      true,
    );
  });

  it('never lets a service or AI actor produce an approval', () => {
    const approval = {
      ...mutation,
      category: 'approval',
      action: 'privilege_set.approve',
      targetTable: 'privilege_set',
      diff: null,
    };
    expect(AuditEventInput.safeParse(approval).success).toBe(true);
    expect(
      AuditEventInput.safeParse({
        ...approval,
        actorType: 'service',
        actorUserId: null,
        onBehalfOfId: PERSON,
      }).success,
    ).toBe(false);
  });

  it('requires services to record the human they act for', () => {
    const svc = { ...mutation, actorType: 'service', actorUserId: null, actorPersonId: null };
    expect(AuditEventInput.safeParse(svc).success).toBe(false);
    expect(AuditEventInput.safeParse({ ...svc, onBehalfOfId: PERSON }).success).toBe(true);
  });

  it('does not log denied integration or system events', () => {
    const run = {
      ...mutation,
      category: 'integration',
      action: 'screening_run.complete',
      outcome: 'denied',
      diff: null,
    };
    expect(AuditEventInput.safeParse(run).success).toBe(false);
  });

  it('requires network details on auth events', () => {
    const login = {
      ...mutation,
      category: 'auth',
      action: 'session.login',
      targetTable: null,
      targetId: null,
      diff: null,
    };
    expect(AuditEventInput.safeParse(login).success).toBe(true);
    expect(AuditEventInput.safeParse({ ...login, ipAddress: null }).success).toBe(false);
  });

  it('rejects caller-supplied chain fields', () => {
    expect(AuditEventInput.safeParse({ ...mutation, chainSeq: 1 }).success).toBe(false);
  });
});

describe('AuditEvent (stored row)', () => {
  it('parses a stored row with chain fields', () => {
    const row = {
      ...mutation,
      id: ID(99),
      chainSeq: 2,
      occurredAt: TS,
      schemaVersion: 1,
      prevHash: HASH,
      rowHash: 'b'.repeat(64),
    };
    expect(AuditEvent.safeParse(row).success).toBe(true);
    expect(AuditEvent.safeParse({ ...row, prevHash: 'XYZ' }).success).toBe(false);
    expect(AuditEvent.safeParse({ ...row, chainSeq: 0 }).success).toBe(false);
  });
});
