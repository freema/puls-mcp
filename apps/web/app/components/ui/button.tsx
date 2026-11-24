import type { ButtonHTMLAttributes } from 'react';
import { cn } from '~/lib/utils';

const base =
  'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 disabled:pointer-events-none disabled:opacity-50';

const variants = {
  default: 'bg-cyan-600 text-white hover:bg-cyan-500',
  secondary: 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700',
} as const;

export function Button({
  className = '',
  variant = 'default',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants;
}) {
  return (
    <button
      className={cn(base, variants[variant], 'px-4 py-2', className)}
      {...props}
    />
  );
}
