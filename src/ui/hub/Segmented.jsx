import { LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { useId } from 'react';
import { cn } from '@/ui/utils';

/**
 * iOS-style segmented control with a sliding white pill.
 * options: [{ id, label, icon? }]
 */
export default function Segmented({ options, value, onChange, ariaLabel, className }) {
    const groupId = useId();
    const reduce = useReducedMotion();
    return (
        <LayoutGroup id={groupId}>
            <div role="radiogroup" aria-label={ariaLabel} className={cn('g-segmented', className)}>
                {options.map((option) => {
                    const active = option.id === value;
                    const Icon = option.icon;
                    return (
                        <button
                            key={option.id}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            aria-pressed={active}
                            className="g-segmented__opt"
                            onClick={() => {
                                if (!active) onChange(option.id);
                            }}
                        >
                            {active ? (
                                <motion.span
                                    layoutId={`${groupId}-pill`}
                                    className="g-segmented__pill"
                                    transition={reduce ? { duration: 0 } : { duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
                                />
                            ) : null}
                            {Icon ? <Icon aria-hidden /> : null}
                            <span className="truncate">{option.label}</span>
                        </button>
                    );
                })}
            </div>
        </LayoutGroup>
    );
}
