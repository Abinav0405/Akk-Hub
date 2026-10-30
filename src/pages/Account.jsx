/**
 * Account — one page for every role (employee, supervisor, manager, admin); the sections adapt to
 * the signed-in identity:
 *
 *   profile header · digital ID card (live QR) · account details · accounts on this device ·
 *   role shortcuts (from the role's own menu) · preferences · linked modules ·
 *   security & privacy · about & support · sign out
 *
 * Building blocks live in pages/account/sections.jsx.
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
import { isNativeApp } from '@/core/platform';
import { UNIFIED } from '@/core/supabase';
import { paths } from '@/app/paths';
import { MyInfoTasksBanner } from '@/features/workerInfo/MyInfo';
import DigitalCard from '@/features/cards/DigitalCard';
import { cardStatus } from '@/features/cards/CardFaces';
import { cardsMe } from '@/features/cards/api';
import { AccountSwitchChip, AccountsList } from '@/ui/hub/AccountSwitcher';
import {
    AccountDetails,
    AccountProfileHeader,
    ModuleLinkRow,
    RoleShortcuts,
    SignOutButton,
    accountStatus,
} from '@/pages/account/sections';

export default function Account() {
    const identity = useIdentity();
    const { t } = useLanguage();
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

    return (
        <HubPage title={t('hub.account.pageTitle')} eyebrow={t('hub.brand')} narrow trailing={<AccountSwitchChip />} className="g-acct-page">
            <div className="g-acct-stagger" style={{ '--i': 0 }}>
                <AccountProfileHeader identity={identity} card={card} status={status} />
            </div>

            <div className="g-acct-stagger mt-4 space-y-3" style={{ '--i': 1 }}>
                {/* Own ID card: workers, and staff whose login an admin linked to their employee ID. */}
                <DigitalCard canEditPhoto={isWorker} />
                {isWorker ? <MyInfoTasksBanner /> : null}
                <AccountDetails identity={identity} card={card} />
            </div>

            <div className="g-acct-stagger" style={{ '--i': 2 }}>
                <SectionLabel>Accounts on this device</SectionLabel>
                <AccountsList />
            </div>

            <div className="g-acct-stagger mt-5" style={{ '--i': 3 }}>
                <RoleShortcuts role={role} />
            </div>

            <div className="g-acct-stagger" style={{ '--i': 4 }}>
                <SectionLabel>{t('hub.account.preferences')}</SectionLabel>
                <List>
                    <ListRow as="div" icon={Languages} title={t('hub.account.language')} trailing={<LanguageSwitcher />} />
                </List>

                {role !== 'supervisor' ? (
                    <>
                        <SectionLabel>{t('hub.account.linkedModules')}</SectionLabel>
                        <List>
                            <ModuleLinkRow role={role} module="materials" />
                            <ModuleLinkRow role={role} module="progress" />
                        </List>
                    </>
                ) : null}

                <SectionLabel>Security &amp; privacy</SectionLabel>
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

                <SectionLabel>{t('hub.account.about')}</SectionLabel>
                <List>
                    <ListRow to={paths.verify} icon={ShieldCheck} title="Verify a photo" hint="Check whether a site photo is genuine" />
                    {isWorker ? <ListRow to={`${paths.hubs.worker}?open=tutorial`} icon={GraduationCap} title="App tutorial" hint="A quick tour of the home screen" /> : null}
                </List>

                <SignOutButton identity={identity} />
                <p className="g-company-foot">{t('hub.account.foot')}</p>
            </div>

            {isWorker ? (
                <BiometricLoginSettings
                    open={bioOpen}
                    onOpenChange={setBioOpen}
                    workerId={identity.id}
                    workerType={identity.workerType}
                    workerName={identity.name}
                />
            ) : null}
        </HubPage>
    );
}
