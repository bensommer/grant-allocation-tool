import Link from 'next/link';
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';
const styles = (variant: ButtonVariant, size: ButtonSize) =>
  `btn ${variant !== 'primary' ? `btn-${variant}` : ''} ${size === 'sm' ? 'btn-sm' : ''}`;

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  type = 'submit',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={`${styles(variant, size)} ${className}`} {...props} />;
}

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link prefetch={false} className={`${styles(variant, size)} ${className}`} {...props} />;
}

export function FilterBar({
  action,
  children,
  submitLabel = 'Apply',
}: {
  action?: string;
  children: ReactNode;
  submitLabel?: string;
}) {
  return (
    <form method="get" action={action} className="filter-bar">
      {children}
      <Button size="sm">{submitLabel}</Button>
    </form>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="toolbar no-print">{children}</div>;
}
