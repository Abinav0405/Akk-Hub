import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Camera, History, ArrowRight } from 'lucide-react';
import { AppShell, PageHeader } from '@/ui/layout';
import { Button } from '@/ui/button';
import NativeActionRow from '@/modules/progress/components/mobile/NativeActionRow';
import NotificationBell from '@/modules/progress/components/NotificationBell';
import { useRoleGuard } from '@/ui/useRoleGuard';
import { useNotifications } from '@/modules/progress/hooks/useNotifications';
import { registerPushForCurrentSession } from '@/core/push';
import { isNativeApp } from '@/core/platform';
import { useLoginWelcome } from '@/modules/progress/hooks/useLoginWelcome';
import AuthChecking from '@/ui/AuthChecking';
import { MyAccountHeaderButton, WorkerNativeNav } from '@/modules/progress/components/MyAccountPanel';
import { prefetchWorkerRoutes } from '@/modules/progress/lib/prefetchRoutes';

export default function WorkerPortal() {
    const session = useRoleGuard('worker');
    const native = isNativeApp();
    const inbox = useNotifications(session ? 'worker' : null);
    const { unread } = inbox;
    const { overlay } = useLoginWelcome({ ready: Boolean(session) });

    useEffect(() => {
        if (session) {
            registerPushForCurrentSession('worker');
            prefetchWorkerRoutes();
        }
    }, [session]);

    if (session === undefined) return overlay || <AuthChecking />;
    if (!session) return overlay;


    return (
        <>
        {overlay}
        <AppShell
            tabBar={native}
            header={
                <PageHeader
                    title={session.display_name || 'Site progress'}
                    description={native ? 'Employee / technician' : undefined}
                    actions={
                        <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
                            <NotificationBell role="worker" inbox={inbox} />
                            <MyAccountHeaderButton role="worker" native={native} />
                        </div>
                    }
                />
            }
            maxWidth="4xl"
        >
            {native ? (
                <div className="space-y-3">
                    <p className="mb-1 px-1 text-sm font-medium text-slate-500">
                        What do you want to do?
                    </p>
                    <NativeActionRow
                        to={"/progress/submit"}
                        icon={Camera}
                        iconClass="bg-orange-100 text-[#dc6b2f]"
                        title="Submit site photos"
                        hint="Save photos, then send the package."
                    />
                    <NativeActionRow
                        to={"/progress/submissions"}
                        icon={History}
                        iconClass="bg-slate-100 text-slate-700"
                        title="My submissions"
                        hint={unread > 0
                            ? 'A package was approved or declined — open to see the update.'
                            : 'See what was approved, declined, or still saved.'}
                        badge={unread}
                    />
                </div>
            ) : (
            <>
            <p className="mb-5 text-sm leading-relaxed text-muted-foreground">
                Capture a visit, then check whether it was approved.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                <Link
                    to={"/progress/submit"}
                    className="group flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-md"
                >
                    <div className="h-1 bg-brand" />
                    <div className="flex flex-1 flex-col items-start p-6">
                        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-muted">
                            <Camera className="h-6 w-6 text-brand" />
                        </div>
                        <h3 className="mb-1 text-lg font-semibold tracking-tight text-slate-900">
                            Submit site photos
                        </h3>
                        <p className="mb-5 flex-1 text-sm leading-relaxed text-muted-foreground">
                            Capture site photos. OK saves. Submit to Admin sends the package.
                        </p>
                        <span className="inline-flex items-center text-sm font-medium text-brand">
                            Get started <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                        </span>
                    </div>
                </Link>

                <Link
                    to={"/progress/submissions"}
                    className={
                        unread > 0
                            ? 'group flex h-full flex-col overflow-hidden rounded-2xl border border-brand/40 bg-brand-muted/30 shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand/60 hover:shadow-md'
                            : 'group flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-400/60 hover:shadow-md'
                    }
                >
                    <div className="h-1 bg-slate-800" />
                    <div className="flex flex-1 flex-col items-start p-6">
                        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
                            <History className="h-6 w-6 text-slate-700" />
                        </div>
                        <h3 className="mb-1 flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-900">
                            My submissions
                            {unread > 0 && (
                                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-semibold text-white">
                                    {unread > 9 ? '9+' : unread}
                                </span>
                            )}
                        </h3>
                        <p className="mb-5 flex-1 text-sm leading-relaxed text-muted-foreground">
                            {unread > 0
                                ? 'A package was approved or declined — open to see the update.'
                                : 'See what was approved, declined, or still saved.'}
                        </p>
                        <span className="inline-flex items-center text-sm font-medium text-slate-700">
                            View history <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                        </span>
                    </div>
                </Link>
            </div>
            </>
            )}
        </AppShell>
        <WorkerNativeNav unread={unread} />
        </>
    );
}
