/**
 * Account — profile, accounts on this device (switch without signing in), language, biometric
 * sign-in (employees in the app), module links, privacy and sign-out. Same page for every role.
 */
import { useEffect, useState } from 'react';
import { signOutWithAnimation } from '@/core/auth/signOutFlow';
import MyPhotoAvatar from '@/ui/MyPhotoAvatar';
import { useNavigate } from 'react-router-dom';
import { CircleCheck, Fingerprint, Languages, Link2, LogOut, ScrollText, ShieldCheck, Unlink } from 'lucide-react';
import { HubPage } from '@/ui/PortalShell';
import { List, ListRow, SectionLabel } from '@/ui/hub/primitives';
import LanguageSwitcher from '@/core-i18n/LanguageSwitcher';
import { useLanguage } from '@/core/i18n';
import { ROLE_LABELS, useIdentity } from '@/core/auth/identity';
import { MODULE_LABELS, disconnectModule, useModuleConnection } from '@/core/auth/bridges';
import { getBiometricPrefs, getBiometricSupport, getUnsupportedMessage } from '@/core/auth/biometric';
import BiometricLoginSettings from '@/ui/biometric/BiometricLoginSettings';
import { confirmAction } from '@/ui/native/NativeConfirm';
import { isNativeApp } from '@/core/platform';
import { paths } from '@/app/paths';
import { MyInfoTasksBanner } from '@/features/workerInfo/MyInfo';
import DigitalCard from '@/features/cards/DigitalCard';
import { AccountSwitchChip, AccountsList } from '@/ui/hub/AccountSwitcher';

function ModuleLinkRow({ role, module }) {
    const { t } = useLanguage();
    const status = useModuleConnection(role, module);
    if (status === 'unavailable') return null;
    if (status === 'connected') {
        return (
            <ListRow
                icon={CircleCheck}
                tone={module}
                title={MODULE_LABELS[module]}
                hint={t('hub.account.linkedHint')}
                onClick={async () => {
                    const ok = await confirmAction({
                        title: t('hub.account.unlinkTitle', { module: MODULE_LABELS[module] }),
                        message: t('hub.account.unlinkMsg', { module: MODULE_LABELS[module] }),
                        confirmLabel: t('hub.account.unlink'),
                        destructive: true,
                    });
                    if (ok) await disconnectModule(module);
                }}
                trailing={<Unlink className="g-row__chev" aria-hidden />}
            />
        );
    }
    return (
        <ListRow
            to={status === 'not-configured' ? undefined : paths.connect(module)}
            as={status === 'not-configured' ? 'div' : undefined}
            icon={Link2}
            tone={module}
            title={MODULE_LABELS[module]}
            hint={status === 'not-configured' ? t('hub.account.notConfigured') : t('hub.account.notLinked')}
        />
    );
}

export default function Account() {
    const identity = useIdentity();
    const { t } = useLanguage();
    const navigate = useNavigate();
    const [bioOpen, setBioOpen] = useState(false);
    const [bioSupport, setBioSupport] = useState(null);
    const isWorker = identity?.role === 'worker';

    useEffect(() => {
        if (!isWorker) return;
        getBiometricSupport().then(setBioSupport);
    }, [isWorker]);

    const bioPrefs = getBiometricPrefs();
    const bioHint = !isNativeApp()
        ? getUnsupportedMessage('web')
        : bioSupport?.available
          ? bioPrefs.enabled && bioPrefs.workerId === String(identity?.id)
              ? t('hub.account.bioOn')
              : t('hub.account.bioOff')
          : getUnsupportedMessage(bioSupport?.reason);

    const signOut = async () => {
        const ok = await confirmAction({
            title: t('hub.account.signOutTitle'),
            message: t('hub.account.signOutMsg'),
            confirmLabel: t('hub.account.signOut'),
            destructive: true,
        });
        if (!ok) return;
        await signOutWithAnimation(navigate);
    };

    const workerTypeLabel = isWorker ? (identity.workerType === 'local' ? t('hub.account.local') : t('hub.account.foreign')) : null;

    return (
        <HubPage title={t('hub.account.pageTitle')} eyebrow={t('hub.brand')} narrow trailing={<AccountSwitchChip />}>
            <section className="g-acct-hero g-rise" data-role={identity?.role}>
                <MyPhotoAvatar name={identity?.name} isWorker={isWorker} />
                <div className="min-w-0 flex-1">
                    <p className="g-acct-hero__name">{identity?.name}</p>
                    <div className="g-acct-hero__chips">
                        <span className="g-acct-hero__chip">{ROLE_LABELS[identity?.role]}</span>
                        {identity?.id ? <span className="g-acct-hero__chip g-acct-hero__chip--plain">{identity.id}</span> : null}
                        {workerTypeLabel ? <span className="g-acct-hero__chip g-acct-hero__chip--plain">{workerTypeLabel}</span> : null}
                    </div>
                </div>
            </section>

            <div className="mt-3 space-y-3">
                {/* Own ID card: workers, and staff whose login an admin linked to their employee ID. */}
                <DigitalCard canEditPhoto={isWorker} />
                {isWorker ? <MyInfoTasksBanner /> : null}
            </div>

            <SectionLabel>Accounts on this device</SectionLabel>
            <AccountsList />

            <SectionLabel>{t('hub.account.preferences')}</SectionLabel>
            <List>
                <ListRow as="div" icon={Languages} title={t('hub.account.language')} trailing={null} hint={<span className="mt-2 block"><LanguageSwitcher /></span>} />
                {isWorker ? (
                    <ListRow
                        icon={Fingerprint}
                        title={t('hub.account.biometric')}
                        hint={bioHint}
                        onClick={isNativeApp() && bioSupport?.available ? () => setBioOpen(true) : undefined}
                        as={isNativeApp() && bioSupport?.available ? undefined : 'div'}
                        trailing={isNativeApp() && bioSupport?.available ? undefined : null}
                    />
                ) : null}
            </List>

            {identity?.role !== 'supervisor' ? (
                <>
                    <SectionLabel>{t('hub.account.linkedModules')}</SectionLabel>
                    <List>
                        <ModuleLinkRow role={identity?.role} module="materials" />
                        <ModuleLinkRow role={identity?.role} module="progress" />
                    </List>
                </>
            ) : null}

            <SectionLabel>{t('hub.account.about')}</SectionLabel>
            <List>
                <ListRow to={paths.privacy} icon={ScrollText} title={t('hub.privacyPdpa')} />
                <ListRow to={paths.verify} icon={ShieldCheck} title="Verify a photo" hint="Check a site photo is genuine" />
            </List>

            <button type="button" className="g-btn g-btn--secondary g-btn--block mt-6 text-[var(--g-danger)]" onClick={signOut}>
                <LogOut aria-hidden /> {t('hub.account.signOut')}
            </button>
            <p className="g-company-foot">{t('hub.account.foot')}</p>

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
