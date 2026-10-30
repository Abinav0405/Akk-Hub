/**
 * Account — one page for every role (employee, supervisor, manager, admin); the sections adapt to
 * the signed-in identity:
 *
 *   profile header · digital ID card (live QR) · account details · role shortcuts (from the
 *   role's own menu) · preferences · linked modules · security & privacy · about · sign out
 *
 * Phones / the app: one column. Website with the sidebar (≥1024 px): a full-width profile hero,
 * then a main column (ID card, details, settings) and a sticky side column (identity summary,
 * shortcuts, account actions). Building blocks live in pages/account/sections.jsx.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Fingerprint, GraduationCap, KeyRound, Languages, ScrollText, ShieldCheck } from 'lucide-react';
import { HubPage } from '@/ui/PortalShell';
import { List, ListRow, SectionLabel } from '@/ui/hub/primitives';
import LanguageSwitcher from '@/core-i18n/LanguageSwitcher';
import { useLanguage } from '@/core/i18n';
import { useIdentity } from '@/core/auth/identity';
import { getBiometricPrefs, getBiometricSupport, getUnsupportedMessage } from '@/core/auth/biometric';
import BiometricLoginSettings from '@/ui/biometric/BiometricLoginSettings';
import { isNativeApp, useWideLayout } from '@/core/platform';
import { UNIFIED } from '@/core/supabase';
import { paths } from '@/app/paths';
import { MyInfoTasksBanner } from '@/features/workerInfo/MyInfo';
import DigitalCard from '@/features/cards/DigitalCard';
import { cardStatus } from '@/features/cards/CardFaces';
import { cardsMe } from '@/features/cards/api';
import {
    AccountDetails,
    AccountProfileHeader,
    IdentitySummary,
    ModuleLinkRow,
    Panel,
    RoleShortcuts,
    SignOutButton,
    accountStatus,
} from '@/pages/account/sections';

export default function Account() {
    const identity = useIdentity();
    const { t } = useLanguage();
    const wide = useWideLayout() && !isNativeApp();
    const [bioOpen, setBioOpen] = useState(false);
    const [bioSupport, setBioSupport] = useState(null);
    const role = identity?.role;
    const isWorker = role === 'worker';

    // The holder's own card (designation, status). DigitalCard below loads its own copy with the live QR.
    const cardQuery = useQuery({
        queryKey: ['hub', 'my-card', role, identity?.id],
        enabled: UNIFIED && Boolean(role),
        staleTime: 60_000,
        retry: 0,
        queryFn: () => cardsMe.card(null),
    });
    const card = cardQuery.data || null;
    const status = accountStatus(card, cardStatus);

    useEffect(() => {
        if (!isWorker) return;
        getBiometricSupport().then(setBioSupport);
    }, [isWorker]);

    const bioPrefs = getBiometricPrefs();
    const bioAvailable = isNativeApp() && bioSupport?.available;
    const bioHint = !isNativeApp()
        ? getUnsupportedMessage('web')
        : bioSupport?.available
          ? bioPrefs.enabled && bioPrefs.workerId === String(identity?.id)
              ? t('hub.account.bioOn')
              : t('hub.account.bioOff')
          : getUnsupportedMessage(bioSupport?.reason);

    const preferences = (
        <List>
            <ListRow as="div" icon={Languages} title={t('hub.account.language')} hint={wide ? 'Menus and labels across AKK Hub' : undefined} trailing={<LanguageSwitcher />} />
        </List>
    );
    const modules =
        role !== 'supervisor' ? (
            <List>
                <ModuleLinkRow role={role} module="materials" />
                <ModuleLinkRow role={role} module="progress" />
            </List>
        ) : null;
    const security = (
        <List>
            {isWorker ? (
                <ListRow
                    icon={Fingerprint}
                    title={t('hub.account.biometric')}
                    hint={bioHint}
                    onClick={bioAvailable ? () => setBioOpen(true) : undefined}
                    as={bioAvailable ? undefined : 'div'}
                    trailing={bioAvailable ? undefined : null}
                />
            ) : null}
            {isWorker ? <ListRow to={`${paths.hubs.worker}?open=password`} icon={KeyRound} title="Change password" hint="Update the password you sign in with" /> : null}
            <ListRow to={paths.privacy} icon={ScrollText} title={t('hub.privacyPdpa')} hint="How AKK uses and protects your data" />
        </List>
    );
    const about = (
        <List>
            <ListRow to={paths.verify} icon={ShieldCheck} title="Verify a photo" hint="Check whether a site photo is genuine" />
            {isWorker ? <ListRow to={`${paths.hubs.worker}?open=tutorial`} icon={GraduationCap} title="App tutorial" hint="A quick tour of the home screen" /> : null}
        </List>
    );
    const biometricSheet = isWorker ? (
        <BiometricLoginSettings
            open={bioOpen}
            onOpenChange={setBioOpen}
            workerId={identity.id}
            workerType={identity.workerType}
            workerName={identity.name}
        />
    ) : null;

    if (wide) {
        return (
            <HubPage title={t('hub.account.pageTitle')} eyebrow={t('hub.brand')} className="g-acct-page g-acctd">
                <div className="g-acct-stagger" style={{ '--i': 0 }}>
                    <AccountProfileHeader identity={identity} card={card} status={status} wide />
                </div>

                <div className="g-acctd__grid">
                    <div className="g-acctd__main">
                        <div className="g-acct-stagger" style={{ '--i': 1 }}>
                            <Panel id="acct-card" title="Digital ID card" sub="Flip it, or show the QR to be scanned" className="g-panel--card">
                                <div className="space-y-3">
                                    <DigitalCard canEditPhoto={isWorker} />
                                    {isWorker ? <MyInfoTasksBanner /> : null}
                                </div>
                            </Panel>
                        </div>
                        <div className="g-acct-stagger" style={{ '--i': 2 }}>
                            <AccountDetails identity={identity} card={card} wide />
                        </div>
                        <div className="g-acct-stagger" style={{ '--i': 3 }}>
                            <Panel id="acct-settings" title="Settings" sub="Preferences and linked modules">
                                <p className="g-panel__label">{t('hub.account.preferences')}</p>
                                {preferences}
                                {modules ? (
                                    <>
                                        <p className="g-panel__label">{t('hub.account.linkedModules')}</p>
                                        {modules}
                                        <p className="g-panel__note">Module links are saved in this browser only.</p>
                                    </>
                                ) : null}
                            </Panel>
                        </div>
                        <div className="g-acctd__pair g-acct-stagger" style={{ '--i': 4 }}>
                            <Panel id="acct-security" title="Security & privacy">
                                {security}
                            </Panel>
                            <Panel id="acct-about" title={t('hub.account.about')}>
                                {about}
                            </Panel>
                        </div>
                    </div>

                    <aside className="g-acctd__side" aria-label="Account summary">
                        <div className="g-acct-stagger" style={{ '--i': 1 }}>
                            <IdentitySummary identity={identity} card={card} status={status} />
                        </div>
                        <div className="g-acct-stagger" style={{ '--i': 2 }}>
                            <RoleShortcuts role={role} max={6} className="g-acct-shortcuts--side" />
                        </div>
                        <div className="g-acct-stagger" style={{ '--i': 3 }}>
                            <Panel id="acct-actions" title="Account actions">
                                <p className="g-panel__note !mt-0">Signs you out of AKK Hub and every module in this browser.</p>
                                <SignOutButton />
                            </Panel>
                        </div>
                    </aside>
                </div>
                <p className="g-company-foot">{t('hub.account.foot')}</p>
                {biometricSheet}
            </HubPage>
        );
    }

    return (
        <HubPage title={t('hub.account.pageTitle')} eyebrow={t('hub.brand')} narrow className="g-acct-page">
            <div className="g-acct-stagger" style={{ '--i': 0 }}>
                <AccountProfileHeader identity={identity} card={card} status={status} />
            </div>

            <div className="g-acct-stagger mt-4 space-y-3" style={{ '--i': 1 }}>
                {/* Own ID card: workers, and staff whose login an admin linked to their employee ID. */}
                <DigitalCard canEditPhoto={isWorker} />
                {isWorker ? <MyInfoTasksBanner /> : null}
                <AccountDetails identity={identity} card={card} />
            </div>

            <div className="g-acct-stagger mt-5" style={{ '--i': 3 }}>
                <RoleShortcuts role={role} />
            </div>

            <div className="g-acct-stagger" style={{ '--i': 4 }}>
                <SectionLabel>{t('hub.account.preferences')}</SectionLabel>
                {preferences}

                {modules ? (
                    <>
                        <SectionLabel>{t('hub.account.linkedModules')}</SectionLabel>
                        {modules}
                    </>
                ) : null}

                <SectionLabel>Security &amp; privacy</SectionLabel>
                {security}

                <SectionLabel>{t('hub.account.about')}</SectionLabel>
                {about}

                <SignOutButton />
                <p className="g-company-foot">{t('hub.account.foot')}</p>
            </div>

            {biometricSheet}
        </HubPage>
    );
}
