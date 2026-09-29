// Generated from the record type registry (packages/domain/src/records) by `pnpm --filter @deemed/db generate`. Do not edit by hand.

/** Record-type audit actions not in BASE_AUDIT_ACTIONS (ADR-0014 section 2.9). */
export const RECORD_AUDIT_ACTIONS = {
  'site.restore': { category: 'mutation', description: 'Site restored' },
  'site.import': { category: 'mutation', description: 'Site import run committed (summary event)' },
  'site.export': { category: 'export', description: 'Site list exported' },
  'person.restore': { category: 'mutation', description: 'Person restored' },
  'person.import': {
    category: 'mutation',
    description: 'Person import run committed (summary event)',
  },
  'person.export': { category: 'export', description: 'Person list exported' },
  'user_account.export': { category: 'export', description: 'User account list exported' },
  'role_assignment.export': { category: 'export', description: 'Role assignment list exported' },
  'requirement_instance.archive': {
    category: 'mutation',
    description: 'Requirement instance archived',
  },
  'requirement_instance.restore': {
    category: 'mutation',
    description: 'Requirement instance restored',
  },
  'requirement_instance.export': {
    category: 'export',
    description: 'Requirement instance list exported',
  },
} as const;
