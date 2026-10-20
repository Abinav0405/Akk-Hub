import React, { useEffect, useMemo, useState } from "react";
import Joyride, { ACTIONS, EVENTS, STATUS } from "react-joyride";

export default function AppTour({ run, steps, onClose, onStepChange }) {
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (run) {
      setStepIndex(0);
    }
  }, [run, steps]);

  const stepIndexById = useMemo(() => {
    const map = new Map();
    (steps || []).forEach((step, index) => {
      if (step?.id) {
        map.set(step.id, index);
      }
    });
    return map;
  }, [steps]);

  const handlePromptNo = (stepId) => {
    const targetIndex = stepIndexById.get(stepId);
    if (typeof targetIndex === "number") {
      setStepIndex(targetIndex);
    }
  };

  useEffect(() => {
    if (!run) return;
    const currentStep = (steps || [])[stepIndex];
    if (!currentStep) return;
    onStepChange?.(currentStep, stepIndex);
  }, [run, stepIndex, steps, onStepChange]);

  const handleCallback = (data) => {
    const { status, type, action, index } = data;

    if ([EVENTS.STEP_AFTER, EVENTS.TARGET_NOT_FOUND].includes(type)) {
      const nextIndex = index + (action === ACTIONS.PREV ? -1 : 1);
      setStepIndex(Math.max(0, nextIndex));
    }

    if (action === ACTIONS.CLOSE) {
      onClose?.();
      return;
    }

    if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
      setStepIndex(0);
      onClose?.();
    }
  };

  const Tooltip = (props) => {
    const { step, backProps, closeProps, primaryProps, skipProps, index, size } = props;
    const promptConfig = step?.data?.prompt;
    const isPrompt = !!promptConfig;

    return (
      <div
        className="max-w-sm rounded-2xl border border-amber-200/80 bg-white/95 p-4 shadow-[0_18px_50px_-28px_rgba(15,23,42,0.45)] backdrop-blur-xl"
        {...props.tooltipProps}
      >
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-amber-700">
          Step {index + 1} of {size}
        </div>
        {step.title ? <h4 className="mb-1 text-base font-semibold tracking-tight text-slate-900">{step.title}</h4> : null}
        <div className="text-sm leading-6 text-slate-700">{step.content}</div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            className="text-xs text-slate-500 hover:text-slate-700"
            {...skipProps}
          >
            Exit tutorial
          </button>
          <div className="flex items-center gap-2">
            {index > 0 ? (
              <button
                type="button"
                className="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                {...backProps}
              >
                Back
              </button>
            ) : null}
            {isPrompt ? (
              <>
                <button
                  type="button"
                  className="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                  onClick={() => handlePromptNo(promptConfig.noGoToId)}
                >
                  {promptConfig.noLabel || "No, continue"}
                </button>
                <button
                  type="button"
                  className="rounded-full bg-amber-600 px-3 py-1.5 text-xs text-white hover:bg-amber-700"
                  {...primaryProps}
                >
                  {promptConfig.yesLabel || "Yes, show me"}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="rounded-full bg-amber-600 px-3 py-1.5 text-xs text-white hover:bg-amber-700"
                {...primaryProps}
              >
                {primaryProps?.title || "Next"}
              </button>
            )}
            <button type="button" className="hidden" {...closeProps}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <Joyride
      run={run}
      steps={steps}
      stepIndex={stepIndex}
      continuous
      showProgress
      showSkipButton
      scrollToFirstStep
      disableScrolling={false}
      disableScrollParentFix
      spotlightPadding={8}
      callback={handleCallback}
      tooltipComponent={Tooltip}
      locale={{
        back: "Back",
        close: "Close",
        last: "Finish",
        next: "Next",
        skip: "Exit tutorial",
      }}
      styles={{
        options: {
          zIndex: 10000,
          primaryColor: "#d97706",
          textColor: "#0f172a",
          arrowColor: "#ffffff",
          backgroundColor: "#ffffff",
          overlayColor: "rgba(15, 23, 42, 0.45)",
        },
        tooltip: {
          borderRadius: 12,
          boxShadow: "0 10px 30px rgba(2,6,23,0.18)",
        },
        buttonNext: {
          borderRadius: 8,
          padding: "8px 14px",
        },
        buttonBack: {
          color: "#64748b",
          marginRight: 8,
        },
        buttonSkip: {
          color: "#64748b",
        },
      }}
    />
  );
}

