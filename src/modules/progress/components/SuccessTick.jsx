export default function SuccessTick({ title = 'Submitted!', description }) {
    return (
        <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="success-tick-wrap">
                <div className="success-tick-core">
                    <svg viewBox="0 0 24 24" className="success-tick-svg">
                        <path d="M5 13l4 4L19 7" className="success-tick-path" pathLength="1" />
                    </svg>
                </div>
            </div>
            <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
            {description && <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">{description}</p>}
        </div>
    );
}
