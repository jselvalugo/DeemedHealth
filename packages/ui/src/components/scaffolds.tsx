import { ArrowRight, Inbox, Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../cn.js';
import { Badge } from './Badge.js';
import { Card } from './Card.js';
import { Eyebrow } from './misc.js';

/** Module home header (§4.4): eyebrow, heading, description, actions on the right. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  display = false,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Serif display heading. Use at most once per page (welcome greetings only). */
  display?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h1
          id="page-title"
          tabIndex={-1}
          className={cn(
            'mt-1 text-navy-900 outline-none',
            display ? 'font-serif text-4xl font-semibold' : 'text-3xl font-semibold',
          )}
        >
          {title}
        </h1>
        {description && <p className="mt-2 max-w-3xl text-lg text-gray-700">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-3">{actions}</div>}
    </div>
  );
}

export type Step = {
  title: string;
  body: string;
  /** A link rendered by the app (e.g. next/link) so routing stays client-side. */
  link?: ReactNode;
  planned?: boolean;
};

/** Numbered step card (`01`–`05` in mono gray) with an optional Planned badge. */
export function StepCard({
  index,
  step,
  plannedLabel,
}: {
  index: number;
  step: Step;
  plannedLabel: string;
}) {
  return (
    <li className="flex flex-col gap-2 rounded-card border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <span aria-hidden="true" className="font-mono text-sm font-medium text-gray-500">
          {String(index + 1).padStart(2, '0')}
        </span>
        {step.planned && <Badge status="info">{plannedLabel}</Badge>}
      </div>
      <h3 className="font-semibold text-navy-900">{step.title}</h3>
      <p className="text-sm text-gray-700">{step.body}</p>
      {step.link && <div className="mt-auto pt-1 text-sm">{step.link}</div>}
    </li>
  );
}

export function HowItWorks({
  title,
  steps,
  plannedLabel,
}: {
  title: string;
  steps: readonly Step[];
  plannedLabel: string;
}) {
  return (
    <section aria-labelledby="how-it-works" className="rounded-card bg-gray-25 p-6">
      <h2 id="how-it-works" className="text-xl font-semibold text-navy-900">
        {title}
      </h2>
      <ol className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {steps.map((s, i) => (
          <StepCard key={s.title} index={i} step={s} plannedLabel={plannedLabel} />
        ))}
      </ol>
    </section>
  );
}

/** Classes for an inline text link with an arrow (step cards, "View …" links). */
export const textLinkClasses =
  'focus-ring inline-flex min-h-10 items-center gap-1 rounded-sm font-semibold text-blue-600 underline-offset-4 hover:underline active:text-blue-700';

export function LinkArrow() {
  return <ArrowRight aria-hidden="true" size={16} strokeWidth={1.75} />;
}

/** Empty state: gradient icon disc, title, body, optional action. */
export function EmptyState({
  title,
  body,
  action,
  icon = 'inbox',
  headingLevel = 2,
}: {
  title: string;
  body: string;
  action?: ReactNode;
  icon?: 'inbox' | 'lock';
  headingLevel?: 1 | 2 | 3;
}) {
  const Glyph = icon === 'lock' ? Lock : Inbox;
  const Heading = ({ 1: 'h1', 2: 'h2', 3: 'h3' } as const)[headingLevel];
  return (
    <Card className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <span
        aria-hidden="true"
        className="bg-brand-gradient inline-flex size-14 items-center justify-center rounded-full text-white"
      >
        <Glyph size={24} strokeWidth={1.75} />
      </span>
      <Heading
        className={cn('font-semibold text-navy-900', headingLevel === 1 ? 'text-2xl' : 'text-lg')}
      >
        {title}
      </Heading>
      <p className="max-w-prose text-gray-700">{body}</p>
      {action && <div className="mt-2">{action}</div>}
    </Card>
  );
}
