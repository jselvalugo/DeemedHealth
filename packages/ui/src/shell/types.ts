import type { ComponentType, ReactNode } from 'react';

/**
 * The props the shell passes to links. `next/link` and a plain `<a>` both accept
 * them. (Radix `asChild` adds event handlers and ARIA props at runtime; both
 * components forward those to the anchor.)
 */
export type LinkLikeProps = {
  href: string;
  className?: string;
  children?: ReactNode;
  'aria-label'?: string;
  'aria-current'?: 'page' | undefined;
};

/** The app passes `next/link` here so shell navigation stays client-side. */
export type LinkComponent = ComponentType<LinkLikeProps>;

export type ShellUser = {
  name: string;
  email: string;
  /** Already-translated role label, e.g. "Compliance officer". */
  roleLabel: string;
};

export type ShellTenant = {
  name: string;
  /** Optional tenant logo; initials are shown when absent. */
  logoSrc?: string;
};
