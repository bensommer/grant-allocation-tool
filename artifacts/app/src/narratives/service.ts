import { prisma } from '@/lib/db';
import { recordAudit, toJson } from '@/lib/audit';
import { buildPacket, type GroundingPacket } from './packet';
import { narrativeSchema, type NarrativeDraft } from './schema';
import { promptFor, promptVersion, templates, type Template } from './prompts';
import type { NarrativeModel } from './client';
import { verifyDraft } from './verify';

export function parseDraft(raw: unknown): NarrativeDraft {
  return narrativeSchema.parse(raw);
}

export async function getNarrative(orgId: string, grantId: string, id: string) {
  return prisma.narrative.findFirst({ where: { id, orgId, grantId } });
}

export async function createNarrative(
  orgId: string,
  grantId: string,
  input: {
    template: Template;
    from: string;
    to: string;
    contextNotes: string;
  },
  model: NarrativeModel,
) {
  if (!(input.template in templates)) throw new Error('Select a valid template.');
  const packet = await buildPacket(orgId, grantId, input.from, input.to, input.contextNotes);
  const draft = parseDraft(await model.generate(await promptFor(input.template), packet));
  const verification = verifyDraft(draft, packet);
  return prisma.$transaction(async (tx) => {
    const row = await tx.narrative.create({
      data: {
        orgId,
        grantId,
        computeRunId: packet.computeRunId,
        template: input.template,
        promptVersion,
        model: model.model,
        periodFrom: new Date(`${input.from}T00:00:00Z`),
        periodTo: new Date(`${input.to}T00:00:00Z`),
        contextNotes: input.contextNotes,
        packetJson: toJson(packet),
        draftJson: toJson(draft),
        verification: toJson(verification),
      },
    });
    await recordAudit(tx, {
      orgId,
      entity: 'Narrative',
      entityId: row.id,
      action: 'create',
      after: row,
    });
    return row;
  });
}

export async function saveNarrative(
  orgId: string,
  grantId: string,
  id: string,
  draft: NarrativeDraft,
  acknowledged: string[],
  approve = false,
) {
  const parsed = parseDraft(draft);
  return prisma.$transaction(async (tx) => {
    const prior = await tx.narrative.findFirst({ where: { id, orgId, grantId } });
    if (!prior) throw new Error('Narrative not found.');
    const packet = prior.packetJson as unknown as GroundingPacket;
    const verified = verifyDraft(parsed, packet).map((v) => ({
      ...v,
      acknowledged: !v.matched && acknowledged.includes(`${v.sectionIndex}:${v.start}:${v.text}`),
    }));
    if (approve && verified.some((v) => !v.matched && !v.acknowledged))
      throw new Error('Acknowledge or correct every unverified number before approval.');
    // Editing an approved record forks a new draft rather than changing its approved text.
    const data = { editedJson: toJson(parsed), verification: toJson(verified) };
    if (prior.status === 'approved') {
      if (approve) throw new Error('Approved narratives cannot be approved again.');
      const latest = await tx.narrative.aggregate({
        where: {
          orgId,
          grantId,
          template: prior.template,
          periodFrom: prior.periodFrom,
          periodTo: prior.periodTo,
        },
        _max: { version: true },
      });
      const next = await tx.narrative.create({
        data: {
          orgId,
          grantId,
          computeRunId: prior.computeRunId,
          template: prior.template,
          promptVersion: prior.promptVersion,
          model: prior.model,
          periodFrom: prior.periodFrom,
          periodTo: prior.periodTo,
          contextNotes: prior.contextNotes,
          packetJson: toJson(prior.packetJson),
          draftJson: toJson(prior.draftJson),
          ...data,
          version: (latest._max.version ?? prior.version) + 1,
        },
      });
      await recordAudit(tx, {
        orgId,
        entity: 'Narrative',
        entityId: next.id,
        action: 'create',
        after: next,
      });
      return next;
    }
    const next = await tx.narrative.update({
      where: { id: prior.id },
      data: {
        ...data,
        ...(approve
          ? { status: 'approved', approvedAt: new Date(), approvedBy: 'local-user' }
          : {}),
      },
    });
    await recordAudit(tx, {
      orgId,
      entity: 'Narrative',
      entityId: next.id,
      action: 'update',
      before: prior,
      after: next,
    });
    return next;
  });
}

export async function regenerateSection(
  orgId: string,
  grantId: string,
  id: string,
  sectionIndex: number,
  model: NarrativeModel,
) {
  const prior = await getNarrative(orgId, grantId, id);
  if (!prior) throw new Error('Narrative not found.');
  if (prior.status === 'approved')
    throw new Error('Approved narratives are immutable; save an edit first.');
  const existing = parseDraft(prior.editedJson ?? prior.draftJson);
  if (
    !Number.isInteger(sectionIndex) ||
    sectionIndex < 0 ||
    sectionIndex >= existing.sections.length
  )
    throw new Error('Invalid section.');
  const prompt = `${await promptFor(prior.template as Template)}\nRegenerate only this section: ${existing.sections[sectionIndex]!.heading}. Return exactly one section.`;
  const generated = parseDraft(await model.generate(prompt, prior.packetJson));
  if (generated.sections.length !== 1) throw new Error('Model must return exactly one section.');
  existing.sections[sectionIndex] = generated.sections[0]!;
  return saveNarrative(orgId, grantId, id, existing, []);
}
