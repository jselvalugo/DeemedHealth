import { z } from 'zod';

/**
 * Module ids, one per row of the module table in `docs/product/module-map.md`
 * (in that order). The UI registry (`packages/ui/module-registry.ts`) keys its
 * entries by these ids; names, icons, and routes live in the registry, not here.
 * A test fails if this list and the module map drift apart.
 */
export const MODULES = [
  { id: 'command-center', moduleMapName: 'Command Center', status: 'mvp' },
  { id: 'readiness', moduleMapName: 'HRSA Readiness', status: 'mvp' },
  { id: 'providers', moduleMapName: 'Providers & Credentialing', status: 'mvp' },
  { id: 'enrollment', moduleMapName: 'Enrollment', status: 'mvp' },
  { id: 'screening', moduleMapName: 'Screening', status: 'mvp' },
  { id: 'governance', moduleMapName: 'Governance', status: 'mvp' },
  { id: 'scope', moduleMapName: 'Scope & Sites', status: 'next' },
  { id: 'contracts', moduleMapName: 'Contracts & Agreements', status: 'next' },
  { id: 'finance', moduleMapName: 'Finance & Grants', status: 'next' },
  { id: 'ftca', moduleMapName: 'FTCA & Risk', status: 'mvp' },
  { id: 'quality', moduleMapName: 'Quality & UDS', status: 'next' },
  { id: 'experience', moduleMapName: 'Patient Experience', status: 'next' },
  { id: 'learning', moduleMapName: 'Learning', status: 'next' },
  { id: 'tasks', moduleMapName: 'Tasks & Workflows', status: 'mvp' },
  { id: 'self-service', moduleMapName: 'Self-Service', status: 'next' },
  { id: 'admin', moduleMapName: 'Administration', status: 'mvp' },
] as const satisfies readonly {
  id: string;
  moduleMapName: string;
  status: 'mvp' | 'next' | 'planned';
}[];

export type ModuleId = (typeof MODULES)[number]['id'];
export const MODULE_IDS = MODULES.map((m) => m.id) as unknown as readonly [ModuleId, ...ModuleId[]];
export const ModuleIdSchema = z.enum(MODULE_IDS);
