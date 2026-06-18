'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, X } from 'lucide-react';

export type OnboardingStep = {
  key: string;
  title: string;
  description: string;
  href: string;
  cta: string;
  done: boolean;
};

// Renders a real, data-driven setup checklist. Each step's `done` is computed
// server-side from the workspace's actual data — nothing is faked. The whole
// card hides once every step is done or the user dismisses it (cookie-backed).
export function OnboardingChecklist({ steps }: { steps: OnboardingStep[] }) {
  const [dismissed, setDismissed] = useState(false);
  const completed = steps.filter((s) => s.done).length;
  const total = steps.length;
  const allDone = completed === total;

  if (dismissed || allDone) return null;

  const pct = Math.round((completed / total) * 100);
  // The first not-yet-done step is the "next" highlighted action.
  const nextKey = steps.find((s) => !s.done)?.key;

  async function dismiss() {
    setDismissed(true);
    try {
      await fetch('/api/onboarding/dismiss', { method: 'POST' });
    } catch {
      /* best-effort; UI already hidden */
    }
  }

  return (
    <div className="onb-card">
      <div className="onb-head">
        <div>
          <h2 className="onb-title">Get started with VPS Fleet</h2>
          <p className="onb-sub">
            {completed} of {total} steps done · finish setup to unlock the full platform
          </p>
        </div>
        <button type="button" className="onb-dismiss" onClick={dismiss} aria-label="Dismiss setup guide" title="Dismiss">
          <X size={16} />
        </button>
      </div>

      <div className="onb-progress">
        <div className="onb-progress-fill" style={{ width: `${pct}%` }} />
      </div>

      <ol className="onb-steps">
        {steps.map((step, i) => {
          const isNext = step.key === nextKey;
          return (
            <li key={step.key} className={`onb-step${step.done ? ' onb-step-done' : ''}${isNext ? ' onb-step-next' : ''}`}>
              <span className="onb-check" aria-hidden>
                {step.done ? <Check size={14} /> : <span className="onb-num">{i + 1}</span>}
              </span>
              <span className="onb-step-text">
                <strong>{step.title}</strong>
                <span>{step.description}</span>
              </span>
              {step.done ? (
                <span className="onb-step-status">Done</span>
              ) : (
                <Link href={step.href} className={isNext ? 'btn-primary onb-step-cta' : 'btn-ghost onb-step-cta'}>
                  {step.cta}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
