/**
 * Month-end close checklist (JPH-28 D2): a vertical stepper, one primary button per step, the
 * first non-green step expanded. Server-rendered; the detail blocks are plain markup.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ButtonLink } from '@/components/ui';
import type { CloseStep, StepTone } from '@/domain/close-status';

const TONE_PILL: Record<StepTone, string> = {
  green: 'pill pill-ok',
  amber: 'pill pill-warn',
  red: 'pill pill-bad',
};

const TONE_RING: Record<StepTone, string> = {
  green: 'border-ok bg-ok-soft text-ok',
  amber: 'border-warn bg-warn-soft text-warn',
  red: 'border-bad bg-bad-soft text-bad',
};

const TONE_WORD: Record<StepTone, string> = { green: 'done', amber: 'to do', red: 'blocked' };

export function CloseChecklist({
  steps,
  open,
  details,
}: {
  steps: CloseStep[];
  open: CloseStep['key'] | null;
  /** Detail block per step, shown when the step is expanded. */
  details?: Partial<Record<CloseStep['key'], ReactNode>>;
}) {
  return (
    <ol className="space-y-3" data-testid="close-checklist">
      {steps.map((step) => {
        const expanded = step.key === open;
        const detail = details?.[step.key];
        return (
          <li
            key={step.key}
            className="card"
            data-step={step.key}
            data-tone={step.tone}
            data-expanded={expanded ? 'true' : 'false'}
            aria-current={expanded ? 'step' : undefined}
          >
            <div className="flex flex-wrap items-start gap-3">
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${TONE_RING[step.tone]}`}
                aria-hidden="true"
              >
                {step.tone === 'green' ? '✓' : step.n}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold text-ink">
                  <span className="sr-only">Step {step.n}, </span>
                  {step.title}
                  <span className="sr-only">, {TONE_WORD[step.tone]}</span>
                </h2>
                <p
                  className="mt-0.5 text-sm text-ink-soft"
                  data-testid={`step-${step.key}-status`}
                  data-cents={step.cents}
                  data-count={step.count}
                  data-volatile={step.key === 'import' ? true : undefined}
                >
                  {step.status}
                </p>
              </div>
              <span
                className={TONE_PILL[step.tone]}
                data-testid={`step-${step.key}-badge`}
                data-volatile={step.key === 'import' ? true : undefined}
              >
                {step.badge}
              </span>
              <ButtonLink
                href={step.button.href}
                size="sm"
                variant={expanded ? 'primary' : 'secondary'}
                data-testid={`step-${step.key}-button`}
              >
                {step.button.label}
              </ButtonLink>
            </div>
            {expanded && detail ? (
              <div className="mt-4 border-t border-line pt-4" data-testid={`step-${step.key}-detail`}>
                {detail}
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export function ClosedBanner({ through, reportsHref }: { through: string; reportsHref: string }) {
  return (
    <div className="banner banner-ok" data-testid="closed-banner">
      <strong>Closed through {through}.</strong> Every step is complete.{' '}
      <Link href={reportsHref}>Go to reports →</Link>
    </div>
  );
}
