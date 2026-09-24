import { z } from 'zod';

export const narrativeSchema = z.object({
  sections: z.array(z.object({ heading: z.string().min(1), body: z.string().min(1) })).min(1),
});
export type NarrativeDraft = z.infer<typeof narrativeSchema>;
