import type { ReactNode } from 'react';
import type { Tone } from './display';

export function Card({
  title,
  action,
  className,
  children,
}: {
  title?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={className ? `card ${className}` : 'card'}>
      {title || action ? (
        <div className="card-heading">
          {title ? <h2>{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function KeyFigure({
  label,
  value,
  hint,
  tone,
  lead = false,
  quiet = false,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  /** The figure the page is about: larger type. */
  lead?: boolean;
  /** Supporting figure: smaller type, no accent. */
  quiet?: boolean;
}) {
  return (
    <div
      className={`key-figure ${tone ? `key-figure-${tone}` : ''}${lead ? ' key-figure-lead' : ''}${quiet ? ' key-figure-quiet' : ''}`}
    >
      <span className="muted">{label}</span>
      <strong>{value}</strong>
      {hint ? <div className="key-figure-hint muted">{hint}</div> : null}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  primaryAction,
  secondaryActions,
  breadcrumb,
}: {
  title: string;
  subtitle?: ReactNode;
  primaryAction?: ReactNode;
  secondaryActions?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {breadcrumb ? <div className="breadcrumb">{breadcrumb}</div> : null}
        <h1>{title}</h1>
        {subtitle ? <p className="muted mt-1">{subtitle}</p> : null}
      </div>
      {primaryAction || secondaryActions ? (
        <div className="page-actions no-print">
          {secondaryActions ? <div className="secondary-actions">{secondaryActions}</div> : null}
          {primaryAction}
        </div>
      ) : null}
    </header>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      {hint ? <p className="muted">{hint}</p> : null}
      {action}
    </div>
  );
}

export function Banner({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <div role={tone === 'bad' ? 'alert' : 'status'} className={`banner banner-${tone}`}>
      {children}
    </div>
  );
}

export function DangerZone({
  title = 'Danger zone',
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <section className="danger-zone" aria-label={title}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}
