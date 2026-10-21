import { LayoutGroup, motion } from 'framer-motion';
import { UserCog, Users } from 'lucide-react';
import { cn } from '@/ui/utils';

export default function ManagementRoleToggle({ value, onChange }) {
    const options = [
        { id: 'manager', label: 'Manager', icon: UserCog },
        { id: 'supervisor', label: 'Supervisor', icon: Users },
    ];

    return (
        <LayoutGroup id="management-role-toggle">
            <div
                className="akk-role-toggle relative mb-3 grid grid-cols-2 rounded-xl bg-slate-100 p-1"
                role="radiogroup"
                aria-label="Management role"
            >
                {options.map((option) => {
                    const Icon = option.icon;
                    const active = value === option.id;
                    return (
                        <button
                            key={option.id}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            aria-pressed={active}
                            onClick={() => {
                                if (option.id === value) return;
                                onChange(option.id);
                            }}
                            className={cn(
                                'relative z-10 flex min-h-[42px] items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a50f2d]',
                                active ? 'text-slate-900' : 'text-slate-500 hover:text-slate-800',
                            )}
                        >
                            {active && (
                                <motion.span
                                    layoutId="akk-mgmt-role-pill"
                                    className="absolute inset-0 rounded-lg bg-white shadow-sm"
                                    transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
                                />
                            )}
                            <span className="relative z-10 flex items-center gap-1.5">
                                <Icon className="h-4 w-4" aria-hidden />
                                {option.label}
                            </span>
                        </button>
                    );
                })}
            </div>
        </LayoutGroup>
    );
}
