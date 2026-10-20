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
            <div className="akk-role-toggle relative mb-3 grid grid-cols-2 rounded-xl bg-slate-100 p-1" role="group" aria-label="Management role">
                {options.map((option) => {
                    const Icon = option.icon;
                    const active = value === option.id;
                    return (
                        <button
                            key={option.id}
                            type="button"
                            aria-pressed={active}
                            onClick={() => {
                                if (option.id === value) return;
                                onChange(option.id);
                            }}
                            className={cn(
                                'relative z-10 flex items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                                active ? 'text-slate-900' : 'text-slate-500 hover:text-slate-800',
                            )}
                        >
                            {active && (
                                <motion.span
                                    layoutId="akk-mgmt-role-pill"
                                    className="absolute inset-0 rounded-lg bg-white shadow-sm"
                                    transition={{ type: 'spring', stiffness: 520, damping: 40, mass: 0.65 }}
                                />
                            )}
                            <span className="relative z-10 flex items-center gap-1.5">
                                <Icon className="h-4 w-4" />
                                {option.label}
                            </span>
                        </button>
                    );
                })}
            </div>
        </LayoutGroup>
    );
}
