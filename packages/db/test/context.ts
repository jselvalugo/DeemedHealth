/** Values the global setup hands to the test files through vitest's provide/inject. */
export interface DbTestContext {
  available: boolean;
  skipReason?: string;
  source?: string;
  /** Migration credentials (superuser in the throwaway cluster). */
  adminUrl?: string;
  /** Runtime roles, logging in directly with test-only passwords. */
  appUserUrl?: string;
  platformUrl?: string;
  ownerUrl?: string;
  /** Password of every seeded persona account (test-only, random per run). */
  personaPassword?: string;
  tenants?: {
    xyz: {
      organizationId: string;
      userIds: Record<string, string>;
      personIds: Record<string, string>;
      siteIds: Record<string, string>;
    };
    gulf: {
      organizationId: string;
      userIds: Record<string, string>;
      personIds: Record<string, string>;
      siteIds: Record<string, string>;
    };
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    db: DbTestContext;
  }
}
