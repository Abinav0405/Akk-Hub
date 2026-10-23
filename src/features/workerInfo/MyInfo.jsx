/**
 * Worker side of worker information:
 *   <MyIdCard/>          — the worker's own Employee Identification Card (Account tab)
 *   <MyInfoTasksBanner/> — "Your employer needs some information" (Home + Account), only when there is a task
 *   <MyInfoPage/>        — /me/info: answer requests (only the asked fields) and information checks
 *                          (read-only review → approve, or decline with a reason)
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, ClipboardCheck, Loader2, ShieldCheck } from 'lucide-react';
import { HubPage } from '@/ui/PortalShell';
import { Banner, EmptyState, Spinner } from '@/ui/hub/primitives';
import { Button } from '@/ui/button';
import { UNIFIED } from '@/core/supabase';
import { paths } from '@/app/paths';
import EmployeeIdCard from './EmployeeIdCard';
import DateInput from '@/ui/DateInput';
import { ASKABLE_BY_KEY, BASE_FIELDS, GROUPS, INFO_FIELDS, customFieldDefs, formatValue, isCustomKey, showField } from './fields';
import { workerInfoMe } from './api';

const INFO_PATH = '/me/info';

export function MyIdCard() {
    const [card, setCard] = useState(null);
    const [error, setError] = useState('');
    useEffect(() => {
        if (!UNIFIED) return;
        workerInfoMe.card().then(setCard).catch((e) => setError(e.message));
    }, []);
    if (!UNIFIED) return null;
    if (error) return <Banner tone="danger">{error}</Banner>;
    if (!card) return <div className="eic-skeleton mx-auto aspect-[1.586] w-full max-w-[440px] animate-pulse rounded-[18px] bg-slate-200/70" aria-busy="true" aria-label="Loading your ID card" />;
    return (
        <div className="flex justify-center">
            <EmployeeIdCard card={card} />
        </div>
    );
}

function useTasks() {
    const [tasks, setTasks] = useState(null);
    const load = useCallback(() => {
        if (!UNIFIED) return;
        workerInfoMe.tasks().then(setTasks).catch(() => setTasks({ requests: [], check: null }));
    }, []);
    useEffect(() => {
        load();
    }, [load]);
    return [tasks, load, setTasks];
}

export function MyInfoTasksBanner() {
    const [tasks] = useTasks();
    if (!UNIFIED || !tasks) return null;
    const n = (tasks.requests?.length || 0) + (tasks.check ? 1 : 0);
    if (!n) return null;
    return (
        <Link to={INFO_PATH} className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 transition-colors hover:bg-amber-100/70">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-amber-700 shadow-sm">
                <ClipboardCheck className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">Your employer needs some information</span>
                <span className="block text-xs text-amber-800/90">
                    {tasks.requests?.length ? `${tasks.requests.length} request${tasks.requests.length === 1 ? '' : 's'}` : ''}
                    {tasks.requests?.length && tasks.check ? ' · ' : ''}
                    {tasks.check ? 'Please check your details' : ''}
                </span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0" aria-hidden />
        </Link>
    );
}

function SuccessTick({ text }) {
    return (
        <div className="flex flex-col items-center gap-3 py-8 text-center" role="status">
            <div className="wi-tick-wrap">
                <svg className="wi-tick" viewBox="0 0 84 84" aria-hidden>
                    <circle cx="42" cy="42" r="38" />
                    <path d="M26 43 l11 11 l21 -24" />
                </svg>
            </div>
            <p className="text-lg font-semibold text-slate-900">{text}</p>
        </div>
    );
}

function RequestForm({ request, onDone }) {
    const fields = request.fields
        .map((k) => ASKABLE_BY_KEY[k] || (isCustomKey(k) ? { key: k, label: request.custom_labels?.[k] || k, kind: 'text' } : null))
        .filter(Boolean);
    const [values, setValues] = useState(() => Object.fromEntries(fields.map((f) => [f.key, ''])));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [done, setDone] = useState(false);

    const submit = async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
            await workerInfoMe.submit(request.id, values);
            setDone(true);
            setTimeout(onDone, 1800);
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    const needsApproval = fields.some((x) => x.approval);
    if (done) return <section className="g-card g-card--pad"><SuccessTick text={needsApproval ? 'Employee Information Sent' : 'Employee Information Updated'} />{needsApproval ? <p className="-mt-4 pb-4 text-center text-sm text-slate-600">The office will check your NRIC / bank details and save them.</p> : null}</section>;
    return (
        <form onSubmit={submit} className="g-card g-card--pad space-y-3">
            <div>
                <h2 className="text-lg font-semibold">{request.auto ? 'Missing details' : 'Information requested'}</h2>
                {request.message ? <p className="mt-0.5 text-sm text-slate-600">{request.message}</p> : null}
            </div>
            {fields.map((f) => {
                const fid = `wi-${request.id}-${f.key}`;
                const set = (val) => setValues((v) => ({ ...v, [f.key]: val }));
                return (
                    <div key={f.key}>
                        <label htmlFor={fid} className="mb-1 block text-sm font-medium text-slate-700">
                            {f.label}
                        </label>
                        {f.approval ? <span className="mb-1 block text-xs text-slate-500">The office will check this before it is saved.</span> : null}
                        {f.kind === 'textarea' ? (
                            <textarea id={fid} required rows={3} value={values[f.key]} onChange={(e) => set(e.target.value)} className="w-full rounded-xl border border-[var(--g-hairline)] bg-white p-3 text-base" />
                        ) : f.kind === 'date' ? (
                            <DateInput id={fid} required value={values[f.key]} onChange={set} />
                        ) : (
                            <input
                                id={fid}
                                required
                                type={f.kind === 'tel' ? 'tel' : 'text'}
                                inputMode={f.kind === 'tel' ? 'tel' : undefined}
                                value={values[f.key]}
                                onChange={(e) => set(e.target.value)}
                                className="h-12 w-full rounded-xl border border-[var(--g-hairline)] bg-white px-3 text-base"
                            />
                        )}
                    </div>
                );
            })}
            {error ? <Banner tone="danger">{error}</Banner> : null}
            <Button type="submit" className="w-full" disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Submit
            </Button>
        </form>
    );
}

function CheckReview({ check, onDone }) {
    const d = check.details;
    const [mode, setMode] = useState('view'); // view | decline | done-approve | done-decline
    const [reason, setReason] = useState('');
    const [wrong, setWrong] = useState([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    // Every detail on file: the whole employee record + the worker information + custom details, grouped.
    const groups = GROUPS.map((g) => ({
        ...g,
        rows: [
            ...BASE_FIELDS.filter((f) => f.group === g.key && showField(f, d.worker_type, d[f.key])),
            ...INFO_FIELDS.filter((f) => f.group === g.key && showField(f, d.worker_type, d[f.key])),
            ...(g.key === 'custom' ? customFieldDefs(d.custom_labels) : []),
        ].map((f) => [f.key, f.label, formatValue(f.key, d[f.key])]),
    })).filter((g) => g.rows.length);
    const rows = groups.flatMap((g) => g.rows);

    const respond = async (approve) => {
        setBusy(true);
        setError('');
        try {
            await workerInfoMe.respondCheck(check.id, approve, reason, wrong);
            setMode(approve ? 'done-approve' : 'done-decline');
            setTimeout(onDone, 2000);
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(false);
        }
    };

    if (mode === 'done-approve') return <section className="g-card g-card--pad"><SuccessTick text="Your employee information has been confirmed" /></section>;
    if (mode === 'done-decline') return <section className="g-card g-card--pad"><SuccessTick text="Sent — your employer will correct it" /></section>;

    return (
        <section className="g-card g-card--pad space-y-3">
            <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[var(--g-brand)]" />
                <div>
                    <h2 className="text-lg font-semibold">Check your employee information</h2>
                    <p className="text-sm text-slate-600">Is everything below correct? You can’t change it here — if something is wrong, tell us and the office will fix it.</p>
                </div>
            </div>
            {groups.map((g) => (
                <div key={g.key}>
                    <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{g.label}</h3>
                    <dl className="divide-y divide-[var(--g-hairline)] rounded-xl border border-[var(--g-hairline)]">
                        {g.rows.map(([key, label, value]) => (
                            <div key={key} className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:gap-3">
                                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 sm:w-52 sm:shrink-0 sm:pt-0.5">{label}</dt>
                                <dd className={value ? 'text-sm font-medium text-slate-900' : 'text-sm italic text-slate-400'}>{value || 'Not provided'}</dd>
                            </div>
                        ))}
                    </dl>
                </div>
            ))}
            {mode === 'decline' ? (
                <div className="space-y-2 rounded-xl border border-red-200 bg-red-50/50 p-3">
                    <label className="block text-sm font-semibold text-red-900" htmlFor="wi-reason">
                        What is wrong?
                    </label>
                    <textarea id="wi-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded-xl border border-red-200 bg-white p-3 text-base" placeholder="e.g. My passport expiry date is 2033, not 2032" />
                    <p className="text-xs font-semibold text-red-900">Which details? (optional)</p>
                    <div className="flex flex-wrap gap-1.5">
                        {rows.filter(([k]) => k !== 'employee_id').map(([k, label]) => (
                            <button
                                key={k}
                                type="button"
                                aria-pressed={wrong.includes(k)}
                                onClick={() => setWrong((w) => (w.includes(k) ? w.filter((x) => x !== k) : [...w, k]))}
                                className={`min-h-9 rounded-full border px-3 text-xs font-semibold ${wrong.includes(k) ? 'border-red-400 bg-red-100 text-red-800' : 'border-slate-200 bg-white text-slate-600'}`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
            ) : null}
            {error ? <Banner tone="danger">{error}</Banner> : null}
            {mode === 'decline' ? (
                <div className="grid grid-cols-2 gap-2">
                    <Button type="button" variant="outline" onClick={() => setMode('view')} disabled={busy}>
                        Back
                    </Button>
                    <Button type="button" onClick={() => respond(false)} disabled={busy || reason.trim().length < 3}>
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Send correction
                    </Button>
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-2">
                    <Button type="button" variant="outline" onClick={() => setMode('decline')} disabled={busy}>
                        Decline — something is wrong
                    </Button>
                    <Button type="button" onClick={() => respond(true)} disabled={busy}>
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Approve information
                    </Button>
                </div>
            )}
        </section>
    );
}

export default function MyInfoPage() {
    const [tasks, reload] = useTasks();
    const empty = tasks && !tasks.requests?.length && !tasks.check;
    return (
        <HubPage title="My information" backTo={paths.account} narrow>
            {!UNIFIED ? <Banner tone="warning">Available on the one AKK Hub backend.</Banner> : null}
            {!tasks && UNIFIED ? (
                <div className="mt-8 flex justify-center">
                    <Spinner />
                </div>
            ) : null}
            {empty ? <EmptyState icon={ShieldCheck} title="You’re all up to date">Nothing to fill in right now.</EmptyState> : null}
            <div className="space-y-3">
                {(tasks?.requests || []).map((r) => (
                    <RequestForm key={r.id} request={r} onDone={reload} />
                ))}
                {tasks?.check ? <CheckReview key={tasks.check.id} check={tasks.check} onDone={reload} /> : null}
            </div>
        </HubPage>
    );
}
