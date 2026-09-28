import Link from 'next/link';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/ui';
import { WIZARD_STEPS, type WizardStep } from '@/domain/grant-draft';
import type { FormState } from '@/lib/forms';

/** Progress bar: five numbered steps, the current one marked, earlier ones linked. */
export function WizardProgress({ step, reached }: { step: WizardStep; reached: WizardStep }) {
  return (
    <nav aria-label="Setup steps" data-testid="wizard-progress" data-step={step}>
      <ol className="mb-4 grid grid-cols-5 gap-1 text-xs sm:text-sm">
        {WIZARD_STEPS.map((s) => {
          const state = s.n === step ? 'current' : s.n < step ? 'done' : 'todo';
          const cls =
            state === 'current'
              ? 'border-ink font-semibold text-ink'
              : state === 'done'
                ? 'border-ok text-ink'
                : 'border-line muted';
          const label = (
            <>
              <span className="block text-[11px] uppercase tracking-wide">Step {s.n}</span>
              <span className="block truncate">{s.title}</span>
            </>
          );
          return (
            <li
              key={s.n}
              className={`border-t-4 pt-1 ${cls}`}
              aria-current={state === 'current' ? 'step' : undefined}
              data-state={state}
            >
              {s.n <= reached && s.n !== step ? (
                <Link href={`/grants/new/${s.n}`} className="block no-underline">
                  {label}
                </Link>
              ) : (
                label
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * The frame every step shares: heading, progress, one real form posting to the step action,
 * and the Back / Save and finish later / Continue row. Server-rendered; no JavaScript needed.
 */
export function WizardShell({
  step,
  reached,
  title,
  lede,
  action,
  state,
  continueLabel = 'Continue',
  continueIntent = 'continue',
  children,
}: {
  step: WizardStep;
  reached: WizardStep;
  title: string;
  lede?: ReactNode;
  action: (formData: FormData) => Promise<void>;
  state: FormState;
  continueLabel?: string;
  continueIntent?: string;
  children: ReactNode;
}) {
  return (
    <>
      <PageHeader
        title="Set up a grant"
        subtitle={
          <>
            Five short steps. You can stop at any point and pick up where you left off.{' '}
            <Link href="/grants/new?mode=form">Use the single-page form instead</Link>
          </>
        }
      />
      <WizardProgress step={step} reached={reached} />
      <form action={action} className="grid max-w-3xl gap-4" data-testid={`wizard-step-${step}`}>
        <div>
          <h2 className="text-lg font-semibold">
            Step {step} of 5 — {title}
          </h2>
          {lede ? <p className="muted mt-1 text-sm">{lede}</p> : null}
        </div>
        {state.errors['_'] ? (
          <p className="banner banner-warn" role="alert" data-testid="wizard-error">
            {state.errors['_']}
          </p>
        ) : null}
        {children}
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          {step > 1 ? (
            <Link
              href={`/grants/new/${step - 1}`}
              className="btn btn-secondary"
              data-testid="wizard-back"
            >
              Back
            </Link>
          ) : null}
          <button
            type="submit"
            name="intent"
            value={continueIntent}
            className="btn"
            data-testid="wizard-continue"
          >
            {continueLabel}
          </button>
          <button
            type="submit"
            name="intent"
            value="save"
            className="btn btn-secondary"
            data-testid="wizard-save"
            formNoValidate
          >
            Save and finish later
          </button>
        </div>
      </form>
    </>
  );
}
