/**
 * Vector Face ID and fingerprint glyphs. Each part (brackets, eyes, nose, smile, ridges,
 * spinner, checkmark) is its own element so it can animate on its own.
 *
 * Status: 'idle' | 'scanning' | 'processing' | 'success' | 'failure'
 *
 * Only transform and opacity animate, so the motion stays on the GPU. Under Reduce Motion
 * every move becomes a plain cross-fade.
 */
import { motion, useReducedMotion } from 'framer-motion';

/** Spring with a damping ratio of about 0.7. */
export const BIO_SPRING = { type: 'spring', bounce: 0.3, duration: 0.5 };
const FADE = { duration: 0.25, ease: 'easeOut' };

const STROKE = {
    fill: 'none',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
};

function toneFor(status) {
    if (status === 'success') return 'var(--bio-green)';
    if (status === 'failure') return 'var(--bio-red)';
    return 'var(--bio-blue)';
}

/** Three quick horizontal oscillations (~0.4 s, ease-out). */
function shakeFor(status, reduceMotion) {
    if (status !== 'failure' || reduceMotion) return { x: 0 };
    return { x: [0, -12, 10, -8, 6, -3, 0], transition: { duration: 0.4, ease: 'easeOut' } };
}

/** Thin activity ring + stroke-drawn checkmark, shared by both glyphs. */
function StatusMark({ status, reduceMotion }) {
    const spinning = status === 'processing';
    const done = status === 'success';

    return (
        <>
            <motion.g
                initial={false}
                animate={{ opacity: spinning ? 1 : 0, scale: spinning || reduceMotion ? 1 : 0.6 }}
                transition={reduceMotion ? FADE : BIO_SPRING}
            >
                <circle
                    className={spinning ? 'akk-bio__spinner' : undefined}
                    cx="50"
                    cy="50"
                    r="18"
                    strokeWidth="3"
                    strokeDasharray="88 200"
                    style={{ stroke: 'var(--bio-blue)' }}
                    {...STROKE}
                />
            </motion.g>
            <motion.path
                d="M33 51 L45 63 L68 38"
                strokeWidth="5"
                data-tone=""
                style={{ stroke: 'var(--bio-green)' }}
                {...STROKE}
                initial={false}
                animate={
                    reduceMotion
                        ? { opacity: done ? 1 : 0, pathLength: 1 }
                        : { opacity: done ? 1 : 0, pathLength: done ? 1 : 0 }
                }
                transition={
                    reduceMotion
                        ? FADE
                        : {
                              pathLength: { duration: 0.4, ease: 'easeOut', delay: done ? 0.08 : 0 },
                              opacity: { duration: done ? 0.05 : 0.15, delay: done ? 0.08 : 0 },
                          }
                }
            />
        </>
    );
}

/** Classic Face ID mark: four corner brackets, two eyes, nose, smile. */
export function FaceIdGlyph({ status = 'idle', label }) {
    const reduceMotion = useReducedMotion();
    const tone = toneFor(status);
    const scanning = status === 'scanning';
    const busy = status === 'processing' || status === 'success';

    // Brackets: gentle 1.0 → 1.04 pulse while scanning, pull in while processing.
    // On success the brackets fade so only the green checkmark remains.
    const bracketOpacity = status === 'success' ? 0 : 1;
    let brackets;
    if (reduceMotion) brackets = { scale: 1, opacity: bracketOpacity, transition: FADE };
    else if (scanning)
        brackets = {
            scale: [1, 1.04, 1],
            opacity: 1,
            transition: { duration: 1.2, ease: 'easeInOut', repeat: Infinity },
        };
    else
        brackets = {
            scale: status === 'processing' ? 0.86 : 1,
            opacity: bracketOpacity,
            transition: { ...BIO_SPRING, opacity: FADE },
        };

    // Face features stay subtle while searching (a soft "shimmer"), fade out once matched.
    let features;
    if (busy) features = { opacity: 0, transition: FADE };
    else if (scanning && !reduceMotion)
        features = {
            opacity: [0.45, 0.8, 0.45],
            transition: { duration: 2.4, ease: 'easeInOut', repeat: Infinity },
        };
    else features = { opacity: scanning ? 0.6 : 1, transition: FADE };

    return (
        <motion.svg
            viewBox="0 0 100 100"
            className="akk-bio__glyph"
            role="img"
            aria-label={label}
            initial={false}
            animate={shakeFor(status, reduceMotion)}
        >
            <motion.g data-tone="" style={{ stroke: tone }} strokeWidth="4.5" {...STROKE} initial={false} animate={brackets}>
                <path d="M6 30 V18 A12 12 0 0 1 18 6 H30" />
                <path d="M70 6 H82 A12 12 0 0 1 94 18 V30" />
                <path d="M94 70 V82 A12 12 0 0 1 82 94 H70" />
                <path d="M30 94 H18 A12 12 0 0 1 6 82 V70" />
            </motion.g>
            <motion.g data-tone="" style={{ stroke: tone }} strokeWidth="4.5" {...STROKE} initial={false} animate={features}>
                <path d="M33 35 V42" />
                <path d="M67 35 V42" />
                <path d="M51 36 V55 C51 58 49 60 46 60 H45" />
                <path d="M34 69 C39 75 45 77 50 77 C55 77 61 75 66 69" />
            </motion.g>
            <StatusMark status={status} reduceMotion={reduceMotion} />
        </motion.svg>
    );
}

/** Ridges from the centre outward, so the scan pulse can run in that order. */
const RIDGES = [
    'M50 44 c0 9 -1 18 -4 26',
    'M42 72 c2.6 -6 3.6 -13 3.6 -22 a4.4 4.4 0 0 1 8.8 0 c0 10 -1.2 19 -4.4 27',
    'M37 66 c1 -5 1.4 -10 1.4 -16 a11.6 11.6 0 0 1 23.2 0 c0 11 -1.4 21 -5 30',
    'M30 58 c0.6 -2.6 0.8 -5.3 0.8 -8 a19.2 19.2 0 0 1 38.4 0 c0 9 -0.8 17.5 -3 25.6',
    'M23.4 56 c0.4 -2 0.6 -4 0.6 -6 a26 26 0 0 1 52 0 c0 6.5 -0.4 12.8 -1.4 19',
    'M27 22.6 a36 36 0 0 1 46 0',
];

/** iOS-style fingerprint: concentric rounded ridge arcs. */
export function FingerprintGlyph({ status = 'idle', label }) {
    const reduceMotion = useReducedMotion();
    const tone = toneFor(status);
    const scanning = status === 'scanning';
    const busy = status === 'processing' || status === 'success';

    const ridgeAnim = (i) => {
        if (busy) return { opacity: status === 'success' ? 0.28 : 0.18, transition: { ...FADE, delay: status === 'success' ? 0.1 : 0 } };
        if (scanning && !reduceMotion)
            return {
                // Fill in one ridge after another, centre → outside, then breathe out again.
                opacity: [0.28, 1, 0.28],
                transition: { duration: 1.8, ease: 'easeInOut', repeat: Infinity, repeatDelay: 0.3, delay: i * 0.12 },
            };
        return { opacity: scanning ? 0.7 : 1, transition: FADE };
    };

    return (
        <motion.svg
            viewBox="0 0 100 100"
            className="akk-bio__glyph"
            role="img"
            aria-label={label}
            initial={false}
            animate={shakeFor(status, reduceMotion)}
        >
            {/* Plain wrapper: framer's CSS transform would replace an SVG transform attribute. */}
            <g transform="translate(0 3)">
                <motion.g
                    data-tone=""
                    style={{ stroke: tone }}
                    strokeWidth="4"
                    {...STROKE}
                    initial={false}
                    animate={{ scale: status === 'processing' && !reduceMotion ? 0.9 : 1 }}
                    transition={BIO_SPRING}
                >
                    {RIDGES.map((d, i) => (
                        <motion.path key={d} d={d} initial={false} animate={ridgeAnim(i)} />
                    ))}
                </motion.g>
            </g>
            <StatusMark status={status} reduceMotion={reduceMotion} />
        </motion.svg>
    );
}

export default function BiometricGlyph({ mode, ...props }) {
    return mode === 'face' ? <FaceIdGlyph {...props} /> : <FingerprintGlyph {...props} />;
}
