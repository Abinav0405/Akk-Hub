/** Code 128 barcode as crisp SVG (vector — sharp at any size). */
import { useMemo } from 'react';
import { encodeCode128B } from '@/modules/progress/lib/code128';

/** '1'/'0' module string → [[x, width], …] bars */
export function barRuns(text) {
    const bits = encodeCode128B(String(text));
    const runs = [];
    let i = 0;
    while (i < bits.length) {
        if (bits[i] === '1') {
            let j = i;
            while (j < bits.length && bits[j] === '1') j += 1;
            runs.push([i, j - i]);
            i = j;
        } else i += 1;
    }
    return { runs, modules: bits.length };
}

export default function Barcode({ value, className = '', color = 'currentColor' }) {
    const data = useMemo(() => {
        try {
            return value ? barRuns(value) : null;
        } catch {
            return null;
        }
    }, [value]);
    if (!data) return null;
    const quiet = 10;
    const w = data.modules + quiet * 2;
    return (
        <svg className={className} viewBox={`0 0 ${w} 40`} preserveAspectRatio="none" role="img" aria-label={`Barcode ${value}`}>
            {data.runs.map(([x, width]) => (
                <rect key={x} x={x + quiet} y="0" width={width} height="40" fill={color} />
            ))}
        </svg>
    );
}
