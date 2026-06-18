/** The 4-step progress header (dark-pill active step). Click a completed/earlier
 *  step to jump back. Ported to match the simulation-frontend prototype. */
import { Fragment } from "react";
import { useTranslation } from "react-i18next";

import type { WizardStep } from "./types";

const STEPS: WizardStep[] = [1, 2, 3, 4];

export function StepNav({ step, goTo }: { step: WizardStep; goTo: (s: WizardStep) => void }) {
  const { t } = useTranslation("simulation");
  const check = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
  return (
    <ol className="sw-nav">
      {STEPS.map((s) => {
        const state = s === step ? "active" : s < step ? "done" : "todo";
        return (
          <Fragment key={s}>
            <li className={`sw-nav-item ${state}`}>
              <button type="button" disabled={s > step} onClick={() => goTo(s)}>
                <span className="sw-nav-num">{s < step ? check : s}</span>
                <span className="sw-nav-tx">
                  <span className="sw-nav-label">{t(`wizard.steps.${s}`)}</span>
                  <span className="sw-nav-sub">{t(`wizard.stepSubs.${s}`)}</span>
                </span>
              </button>
            </li>
            {s < 4 && <li className={`sw-nav-bar${s < step ? " filled" : ""}`} aria-hidden />}
          </Fragment>
        );
      })}
    </ol>
  );
}
