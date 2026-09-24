import Link from 'next/link';
import type {
  ComponentProps,
  HTMLAttributes,
  ReactNode,
  ThHTMLAttributes,
  TdHTMLAttributes,
} from 'react';
import { Money } from './display';

export function DataTable({
  caption,
  stickyFirstColumn = false,
  children,
}: {
  caption?: string;
  stickyFirstColumn?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`table-wrap overflow-x-auto${stickyFirstColumn ? ' sticky-first' : ''}`}>
      <table>
        {caption ? <caption>{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}

/** Always provide visible children or aria-label; empty header cells are forbidden. */
export function Th({
  num,
  children,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & { num?: boolean }) {
  if (!children && !props['aria-label'])
    throw new Error('Th requires visible text or an aria-label');
  return (
    <th
      scope={props.scope ?? 'col'}
      className={`${num ? 'num ' : ''}${props.className ?? ''}`}
      {...props}
    >
      {children}
    </th>
  );
}
export function Td({ children, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td {...props}>{children}</td>;
}
export function NumTd({
  cents,
  children,
  dollar,
  ...props
}:
  | (TdHTMLAttributes<HTMLTableCellElement> & { cents: number; children?: never; dollar?: boolean })
  | (TdHTMLAttributes<HTMLTableCellElement> & {
      cents?: never;
      children: ReactNode;
      dollar?: never;
    })) {
  return (
    <td {...props} className={`num ${props.className ?? ''}`} data-cents={cents}>
      {cents !== undefined ? <Money cents={cents} dollar={dollar} /> : children}
    </td>
  );
}
export function TotalRow({ children, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr {...props} className={`total ${props.className ?? ''}`}>
      {children}
    </tr>
  );
}
export function LinkCell({
  href,
  children,
  ...props
}: Omit<ComponentProps<typeof Link>, 'href' | 'children'> & { href: string; children: ReactNode }) {
  return (
    <Link href={href} prefetch={false} className="drill-link" {...props}>
      {children}
    </Link>
  );
}
