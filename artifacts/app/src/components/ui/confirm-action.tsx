import type { ReactNode } from 'react';
import { Button, ButtonLink } from './actions';
import { DangerZone, PageHeader } from './layout';

/** GET confirmation page; the action is only invoked by the POST form. */
export function ConfirmPage({
  entityName,
  description,
  cancelHref,
  action,
  submitLabel = 'Confirm',
  children,
}: {
  entityName: string;
  description: string;
  cancelHref: string;
  action: (formData: FormData) => void | Promise<void>;
  submitLabel?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-2xl py-8">
      <PageHeader title={`Confirm: ${entityName}`} />
      <DangerZone>
        <p>{description}</p>
        {children}
        <div className="page-actions mt-4">
          <ButtonLink variant="secondary" href={cancelHref}>
            Cancel
          </ButtonLink>
          <form action={action}>
            <Button variant="danger">{submitLabel}</Button>
          </form>
        </div>
      </DangerZone>
    </div>
  );
}
