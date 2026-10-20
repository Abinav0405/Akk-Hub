/**
 * Settings → "Biometric Login": on/off toggle plus Face ID / Fingerprint choice
 * (only the methods this device supports are listed).
 *
 * Turning it on asks for the password once (verified with the server), then stores it behind
 * biometrics via the BiometricPrompt. Turning it off deletes the stored credential.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/ui/dialog';
import BiometricPrompt from '@/modules/timesheet/components/biometric/BiometricPrompt';
import { parseLoginError, verifyWorkerPassword } from '@/core/auth/timesheetSession';
import {
    disableBiometricLogin,
    enableBiometricLogin,
    getBiometricCopy,
    getBiometricErrorMessage,
    getBiometricPrefs,
    getBiometricSupport,
    getUnsupportedMessage,
    setBiometricMode,
} from '@/core/auth/biometric';
import { cn } from '@/modules/timesheet/lib/utils';

export default function BiometricLoginSettings({ open, onOpenChange, workerId, workerType, workerName }) {
    const [support, setSupport] = useState(null);
    const [prefs, setPrefs] = useState(getBiometricPrefs);
    const [mode, setMode] = useState('fingerprint');
    const [confirming, setConfirming] = useState(false);
    const [password, setPassword] = useState('');
    const [verifying, setVerifying] = useState(false);
    const [error, setError] = useState('');
    const [prompt, setPrompt] = useState({ open: false, status: 'idle', message: undefined, canRetry: true });
    /** Verified password, kept in memory only so "Try Again" works; cleared when the prompt closes. */
    const pendingPasswordRef = useRef(null);

    const enabledHere = prefs.enabled && prefs.workerId === String(workerId);
    const otherWorkerEnrolled = prefs.enabled && !enabledHere;

    useEffect(() => {
        if (!open) return;
        const current = getBiometricPrefs();
        setPrefs(current);
        setConfirming(false);
        setPassword('');
        setError('');
        getBiometricSupport().then((s) => {
            setSupport(s);
            const saved = current.enabled && current.workerId === String(workerId) ? current.mode : null;
            setMode(saved && s.modes.includes(saved) ? saved : s.primary || 'fingerprint');
        });
    }, [open, workerId]);

    const chooseMode = (next) => {
        setMode(next);
        if (enabledHere) {
            setBiometricMode(next);
            setPrefs(getBiometricPrefs());
        }
    };

    const turnOff = async () => {
        await disableBiometricLogin();
        setPrefs(getBiometricPrefs());
        toast.success('Biometric login turned off');
    };

    const storeCredential = async (verifiedPassword) => {
        setPrompt({ open: true, status: 'scanning', message: 'Confirm to turn it on', canRetry: true });
        try {
            await enableBiometricLogin({ workerId, workerType, workerName, password: verifiedPassword, mode });
            setPrefs(getBiometricPrefs());
            setPrompt((p) => ({ ...p, status: 'success', message: `${getBiometricCopy(mode).name} is on` }));
        } catch (err) {
            const code = err?.code;
            setPrompt((p) => ({
                ...p,
                status: code === 'cancel' ? 'idle' : 'failure',
                canRetry: !['lockout', 'lockout_temporary', 'not_enrolled', 'passcode_not_set', 'unavailable'].includes(code),
                message: getBiometricErrorMessage(code, mode),
            }));
        }
    };

    const confirmPassword = async (e) => {
        e.preventDefault();
        if (!password) return;
        setVerifying(true);
        setError('');
        try {
            const result = await verifyWorkerPassword({ workerId, password, workerType });
            if (!result.ok) {
                setError('That password is incorrect.');
                return;
            }
            // Hand over to the full-screen prompt (the dialog's focus trap would block it).
            const verified = password;
            setPassword('');
            onOpenChange(false);
            pendingPasswordRef.current = verified;
            void storeCredential(verified);
        } catch (err) {
            setError(parseLoginError(err, 'Could not check your password. Try again.'));
        } finally {
            setVerifying(false);
        }
    };

    const available = !!support?.available;
    const copy = getBiometricCopy(mode);

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="rounded-2xl border-slate-200/80 sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Biometric Login</DialogTitle>
                        <DialogDescription>
                            Log in with your face or fingerprint instead of typing your password.
                        </DialogDescription>
                    </DialogHeader>

                    {!support ? (
                        <div className="flex justify-center py-6">
                            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 px-4 py-3">
                                <div className="min-w-0">
                                    <p id="bio-toggle-label" className="text-[15px] font-medium text-slate-900">
                                        Biometric Login
                                    </p>
                                    <p className="text-xs text-slate-500">
                                        {available
                                            ? enabledHere
                                                ? `On · ${getBiometricCopy(prefs.mode).name}`
                                                : 'Off'
                                            : getUnsupportedMessage(support.reason)}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={enabledHere || confirming}
                                    aria-labelledby="bio-toggle-label"
                                    disabled={!available && !enabledHere}
                                    onClick={() => {
                                        if (enabledHere) void turnOff();
                                        else setConfirming((c) => !c);
                                    }}
                                    className={cn(
                                        'relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40',
                                        enabledHere || confirming ? 'bg-[#34c759]' : 'bg-slate-300',
                                    )}
                                >
                                    <span
                                        className={cn(
                                            'absolute left-[2px] top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow transition-transform duration-200',
                                            (enabledHere || confirming) && 'translate-x-[20px]',
                                        )}
                                    />
                                </button>
                            </div>

                            {available && support.modes.length > 1 && (enabledHere || confirming) && (
                                <fieldset className="overflow-hidden rounded-xl border border-slate-200">
                                    <legend className="sr-only">Log in with</legend>
                                    {support.modes.map((m) => {
                                        const selected = mode === m;
                                        return (
                                            <button
                                                key={m}
                                                type="button"
                                                role="radio"
                                                aria-checked={selected}
                                                onClick={() => chooseMode(m)}
                                                className="flex min-h-[44px] w-full items-center justify-between border-b border-slate-100 px-4 text-left text-[15px] text-slate-900 last:border-b-0"
                                            >
                                                {getBiometricCopy(m).name}
                                                {selected && <Check className="h-4 w-4 text-[#007aff]" />}
                                            </button>
                                        );
                                    })}
                                </fieldset>
                            )}

                            {available && support.modes.length > 1 && (
                                <p className="text-xs text-slate-500">
                                    Your phone decides which of its enrolled biometrics it accepts; this choice sets which
                                    one the login screen asks for.
                                </p>
                            )}

                            {confirming && !enabledHere && (
                                <form onSubmit={confirmPassword} className="space-y-3">
                                    {otherWorkerEnrolled && (
                                        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                                            Biometric login on this phone is set up for employee {prefs.workerId}. Turning it on
                                            for you replaces that.
                                        </p>
                                    )}
                                    <label htmlFor="bio-password" className="text-sm font-medium text-slate-700">
                                        Enter your password to turn on {copy.name}
                                    </label>
                                    <Input
                                        id="bio-password"
                                        type="password"
                                        autoComplete="current-password"
                                        value={password}
                                        onChange={(e) => {
                                            setPassword(e.target.value);
                                            setError('');
                                        }}
                                        autoFocus
                                    />
                                    {error && <p className="text-sm text-red-600">{error}</p>}
                                    <Button
                                        type="submit"
                                        disabled={!password || verifying}
                                        className="h-11 w-full rounded-xl bg-[#007aff] hover:bg-[#0062cc]"
                                    >
                                        {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : `Turn On ${copy.name}`}
                                    </Button>
                                </form>
                            )}
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            <BiometricPrompt
                open={prompt.open}
                mode={mode}
                status={prompt.status}
                message={prompt.message}
                actions={{
                    primary: prompt.canRetry
                        ? { label: 'Try Again', onClick: () => void storeCredential(pendingPasswordRef.current) }
                        : undefined,
                    secondary: { label: 'Cancel', onClick: () => setPrompt((p) => ({ ...p, open: false })) },
                }}
                onSuccessShown={() => {
                    setPrompt((p) => ({ ...p, open: false }));
                    toast.success(`${getBiometricCopy(mode).name} login is on`);
                }}
                onExitComplete={() => {
                    pendingPasswordRef.current = null;
                    setPrompt({ open: false, status: 'idle', message: undefined, canRetry: true });
                }}
            />
        </>
    );
}

