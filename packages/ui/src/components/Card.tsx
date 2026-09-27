import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn.js';

/** White card with a 1px gray-200 border and no shadow (design system §3). */
export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-card border border-gray-200 bg-white p-6', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardTitle({
  as: Tag = 'h2',
  className,
  children,
  id,
}: {
  as?: 'h2' | 'h3' | 'h4';
  className?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <Tag id={id} className={cn('text-xl font-semibold text-navy-900', className)}>
      {children}
    </Tag>
  );
}
