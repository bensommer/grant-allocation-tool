import { ButtonLink } from '@/components/ui';

/** "Edit grant" lives top-right of every grant page header, not in the tab strip (JPH-25 A5). */
export function EditGrantButton({ id }: { id: string }) {
  return (
    <ButtonLink href={`/grants/${id}/edit`} variant="secondary" data-testid="edit-grant">
      Edit grant
    </ButtonLink>
  );
}
