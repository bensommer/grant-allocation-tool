import type { ReactNode } from 'react';
import { PageHeader as NewPageHeader } from './ui/layout';

/** Legacy actions map to secondaryActions; new pages should import from components/ui. */
export function PageHeader({
  actions,
  secondaryActions,
  ...props
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  secondaryActions?: ReactNode;
  primaryAction?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return <NewPageHeader {...props} secondaryActions={secondaryActions ?? actions} />;
}
