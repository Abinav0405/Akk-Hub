// LEGACY-PAGES port — AuthGuard dropped; login → /login
import { cn } from '@/modules/timesheet/lib/utils';
import { User, Briefcase } from 'lucide-react';
import { motion, LayoutGroup } from 'framer-motion';

/** Foreign / Local employee switch (worker login and the quick-login setup screen). */
export default function WorkerTypeToggle({ value, onChange }) {
    const select = (type) => {
        if (type === value) return;
        onChange(type);
    };

    return (
        <LayoutGroup id="worker-type-toggle">
            <div className="akk-role-toggle relative mb-5 grid grid-cols-2 rounded-xl bg-slate-100 p-1" role="group" aria-label="Employee type">
                {[
                    { id: 'foreign', label: 'Foreign', icon: Briefcase },
                    { id: 'local', label: 'Local', icon: User },
                ].map((option) => {
                    const Icon = option.icon;
                    const active = value === option.id;
                    return (
                        <button
                            key={option.id}
                            type="button"
                            aria-pressed={active}
                            onClick={() => select(option.id)}
                            className={cn(
                                'relative z-10 flex items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                                active ? 'text-slate-900' : 'text-slate-500 hover:text-slate-800'
                            )}
                        >
                            {active && (
                                <motion.span
                                    layoutId="akk-worker-type-pill"
                                    className="absolute inset-0 rounded-lg bg-white shadow-sm"
                                    transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
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
