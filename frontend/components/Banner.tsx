import type { LucideIcon } from 'lucide-react';

/**
 * Dark-teal banner with a faint, rotated watermark icon. Use for hero/CTA strips.
 */
export function Banner({
  title,
  subtitle,
  icon: Icon,
  action,
}: {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl bg-brand-dark p-6 text-white">
      {Icon && (
        <Icon
          className="pointer-events-none absolute right-5 top-1/2 h-24 w-24 -translate-y-1/2 rotate-12 text-white/10"
          strokeWidth={1.25}
        />
      )}
      <div className="relative">
        <h2 className="text-lg font-bold">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-white/70">{subtitle}</p>}
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}

/**
 * Faint light-grey rotated watermark icon for the corner of a card.
 * The parent must be `relative overflow-hidden`.
 */
export function DecoIcon({ icon: Icon, className = '' }: { icon: LucideIcon; className?: string }) {
  return (
    <Icon
      className={`pointer-events-none absolute right-3 top-1/2 h-12 w-12 -translate-y-1/2 rotate-12 text-slate-100 sm:right-4 sm:h-20 sm:w-20 ${className}`}
      strokeWidth={1.25}
    />
  );
}
