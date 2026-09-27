import { CircleCheck, Info, OctagonAlert, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../cn.js';

export type AlertTone = 'info' | 'ok' | 'warn' | 'critical';

const TONES: Record<AlertTone, { box: string; icon: string; Icon: LucideIcon }> = {
  info: {
    box: 'border-status-info-icon bg-status-info-bg',
    icon: 'text-status-info-icon',
    Icon: Info,
  },
  ok: {
    box: 'border-status-ok-icon bg-status-ok-bg',
    icon: 'text-status-ok-icon',
    Icon: CircleCheck,
  },
  warn: {
    box: 'border-status-warn-icon bg-status-warn-bg',
    icon: 'text-status-warn-icon',
    Icon: TriangleAlert,
  },
  critical: {
    box: 'border-status-critical-icon bg-status-critical-bg',
    icon: 'text-status-critical-icon',
    Icon: OctagonAlert,
  },
};

/**
 * Inline message with icon + title + body. `critical` uses role="alert" (announced
 * immediately); other tones use role="status" (polite).
 */
export function Alert({
  tone,
  title,
  children,
  className,
  id,
}: {
  tone: AlertTone;
  title: string;
  children?: ReactNode;
  className?: string;
  id?: string;
}) {
  const s = TONES[tone];
  return (
    <div
      id={id}
      role={tone === 'critical' ? 'alert' : 'status'}
      className={cn(
        'flex gap-3 rounded-control border-l-4 p-3 text-sm text-gray-900',
        s.box,
        className,
      )}
    >
      <s.Icon aria-hidden="true" size={20} strokeWidth={1.75} className={cn('shrink-0', s.icon)} />
      <div className="min-w-0">
        <p className="font-semibold">{title}</p>
        {children && <div className="mt-0.5 text-gray-700">{children}</div>}
      </div>
    </div>
  );
}
