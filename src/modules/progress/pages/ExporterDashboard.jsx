import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, ClipboardList, FileText } from 'lucide-react';
import { AppShell, PageHeader } from '@/ui/layout';
import { Button } from '@/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/ui/tabs';
import PackageReviewBoard from '@/modules/progress/components/PackageReviewBoard';
import NativeBottomNav from '@/modules/progress/components/mobile/NativeBottomNav';
import ClientPortalPanel from '@/modules/progress/components/jsr/ClientPortalPanel';
import { useRoleGuard } from '@/ui/useRoleGuard';
import { useLoginWelcome } from '@/modules/progress/hooks/useLoginWelcome';
import { endLoginCurtain, isLoginCurtainOpen } from '@/core/auth/loginCurtain';
import { isNativeApp } from '@/core/platform';
import AuthChecking from '@/ui/AuthChecking';
import { MyAccountHeaderButton } from '@/modules/progress/components/MyAccountPanel';
import { signOutExporter } from '@/core/auth/progress/exporterSession';
import { createPageUrl } from '@/modules/progress/lib/utils';


export default function ExporterDashboard() {
    const session = useRoleGuard('exporter');
    const navigate = useNavigate();
    const native = isNativeApp();
    const [tab, setTab] = useState('packages');
    const { overlay } = useLoginWelcome({ ready: Boolean(session) });

    // ClientLogin starts LoginCurtain; Export Only sits outside HubLayout guards, so end it here.
    useEffect(() => {
        if (!session) return undefined;
        if (!isLoginCurtainOpen()) return undefined;
        const raf = window.requestAnimationFrame(() => endLoginCurtain());
        const t = window.setTimeout(endLoginCurtain, 1500);
        return () => {
            window.cancelAnimationFrame(raf);
            window.clearTimeout(t);
        };
    }, [session]);

    if (session === undefined) return overlay || <AuthChecking />;
    if (!session) return overlay || <AuthChecking />;

    // Standalone portal (outside HubLayout) — clients need an in-page sign-out.
    const handleLogout = async () => {
        await signOutExporter();
        navigate(createPageUrl('ExporterLogin'), { replace: true });
    };

    return (
        <>
            {overlay}
            <AppShell
                tabBar={native}
                header={
                    <PageHeader
                        title={`Welcome, ${session.display_name || 'Export Only'}`}
                        description="Packages and client reports"
                        variant="exporter"
                        actions={
                            <>
                                <MyAccountHeaderButton role="exporter" native={native} />
                                <Button
                                    variant="outline"
                                    size={native ? 'icon' : 'sm'}
                                    className={native ? 'h-11 w-11' : 'min-h-11'}
                                    onClick={handleLogout}
                                    aria-label="Log out"
                                >
                                    <LogOut className={native ? 'h-4 w-4' : 'mr-1.5 h-4 w-4'} />
                                    {!native && 'Log out'}
                                </Button>
                            </>
                        }
                    />
                }
                maxWidth="6xl"
            >
                <Tabs value={tab} onValueChange={setTab}>
                    {!native && (
                        <TabsList className="w-full sm:w-auto">
                            <TabsTrigger value="packages">Packages</TabsTrigger>
                            <TabsTrigger value="reports">Client reports</TabsTrigger>
                        </TabsList>
                    )}
                    <TabsContent value="packages" className={native ? 'mt-0' : undefined}>
                        <PackageReviewBoard role="exporter" />
                    </TabsContent>
                    <TabsContent value="reports" className={native ? 'mt-0' : undefined}>
                        {/* Direct ClientPortalPanel — same as CommercialHub role=exporter, without staff JSR chrome */}
                        <ClientPortalPanel />
                    </TabsContent>
                </Tabs>
            </AppShell>
            {native ? (
                <NativeBottomNav
                    items={[
                        { id: 'packages', icon: ClipboardList, label: 'Packages', active: tab === 'packages', onClick: () => setTab('packages') },
                        { id: 'reports', icon: FileText, label: 'Reports', active: tab === 'reports', onClick: () => setTab('reports') },
                    ]}
                />
            ) : null}
        </>
    );
}
