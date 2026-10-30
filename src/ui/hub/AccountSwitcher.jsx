/**
 * Switch between accounts saved on this device (see core/auth/accounts.js) — like switching
 * profiles in Instagram: add an account once by signing in, then switch with one tap.
 *
 *   <AccountSwitchChip />        name chip + chevron for a top bar; opens the switcher
 *   <AccountSwitcherSheet … />   the sheet itself
 *   <AccountsList />             inline list for the Account page
 *   <SavedAccountsDock />        signed out (Home / sign-in): "Continue as …"
 */
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, LogIn, Plus, Trash2 } from 'lucide-react';
import { ROLE_LABELS, useIdentity } from '@/core/auth/identity';
import {
    accountKey,
    addAccount,
    otherAccounts,
    removeSavedAccount,
    resumeAccount,
    switchAccount,
    useSavedAccounts,
} from '@/core/auth/accounts';
import { confirmAction } from '@/ui/native/NativeConfirm';
import Sheet from '@/ui/hub/Sheet';
import { cn } from '@/ui/utils';

function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'A';
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function Avatar({ name, role, size = 40 }) {
    return (
        <span className="g-acct-avatar" data-role={role} style={{ width: size, height: size, fontSize: size * 0.36 }} aria-hidden>
            {initials(name)}
        </span>
    );
}

function roleLine(account) {
    const role = ROLE_LABELS[account.role] || account.role;
    const id = account.email || account.id;
    return id && id !== account.name ? `${role} · ${id}` : role;
}

/** Full-screen veil while the app reloads into the other account. */
function SwitchingVeil({ account }) {
    if (!account) return null;
    return createPortal(
        <div className="g-switch-veil" role="status" aria-live="polite">
            <Avatar name={account.name} role={account.role} size={64} />
            <p className="g-switch-veil__title">Switching to {account.name}</p>
            <p className="g-switch-veil__sub">{ROLE_LABELS[account.role]}</p>
        </div>,
        document.body,
    );
}

function useSwitch() {
    const identity = useIdentity();
    const [switching, setSwitching] = useState(null);
    const go = (account) => {
        setSwitching(account);
        // Let the veil paint before the page reloads.
        window.setTimeout(() => {
            const ok = identity ? switchAccount(identity, account.key) : resumeAccount(account.key);
            if (!ok) setSwitching(null);
        }, 260);
    };
    return { switching, go };
}

/** Rows: the signed-in account (ticked), saved ones (tap to switch), "Add account". */
export function AccountsList({ onPicked, compact = false }) {
    const identity = useIdentity();
    const accounts = useSavedAccounts();
    const { switching, go } = useSwitch();
    const others = otherAccounts(accounts, identity);
    const activeKey = accountKey(identity);

    const remove = async (account) => {
        const ok = await confirmAction({
            title: `Remove ${account.name}?`,
            message: 'This account is removed from this device. You can add it again by signing in.',
            confirmLabel: 'Remove',
            destructive: true,
        });
        if (ok) removeSavedAccount(account.key);
    };

    return (
        <>
            <div className={cn('g-list g-acct-list', compact && 'g-list--compact')}>
                {identity ? (
                    <div className="g-row g-acct-row is-active" aria-current="true">
                        <Avatar name={identity.name} role={identity.role} />
                        <span className="g-row__body">
                            <span className="g-row__title block">{identity.name}</span>
                            <span className="g-row__hint block">{roleLine({ ...identity, key: activeKey })}</span>
                        </span>
                        <span className="g-acct-check" aria-label="Signed in">
                            <Check aria-hidden />
                        </span>
                    </div>
                ) : null}
                {others.map((account) => (
                    <div key={account.key} className="g-row g-acct-row">
                        <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center gap-3 text-left"
                            onClick={() => {
                                onPicked?.();
                                go(account);
                            }}
                        >
                            <Avatar name={account.name} role={account.role} />
                            <span className="g-row__body">
                                <span className="g-row__title block">{account.name}</span>
                                <span className="g-row__hint block">{roleLine(account)}</span>
                            </span>
                        </button>
                        <button
                            type="button"
                            className="g-icon-btn g-icon-btn--plain shrink-0"
                            aria-label={`Remove ${account.name} from this device`}
                            onClick={() => remove(account)}
                        >
                            <Trash2 aria-hidden />
                        </button>
                    </div>
                ))}
                {identity ? (
                    <button type="button" className="g-row g-acct-row" onClick={() => addAccount(identity)}>
                        <span className="g-acct-add" aria-hidden>
                            <Plus />
                        </span>
                        <span className="g-row__body">
                            <span className="g-row__title block">Add account</span>
                            <span className="g-row__hint block">Sign in once — then switch without signing in</span>
                        </span>
                    </button>
                ) : null}
            </div>
            <SwitchingVeil account={switching} />
        </>
    );
}

export function AccountSwitcherSheet({ open, onClose }) {
    return (
        <Sheet open={open} onClose={onClose} title="Switch account" subtitle="Accounts on this device">
            <AccountsList onPicked={onClose} />
        </Sheet>
    );
}

/** Top-bar chip: current account's initials + chevron. Opens the switcher. */
export function AccountSwitchChip({ className }) {
    const identity = useIdentity();
    const accounts = useSavedAccounts();
    const [open, setOpen] = useState(false);
    if (!identity) return null;
    const count = otherAccounts(accounts, identity).length;
    return (
        <>
            <button
                type="button"
                className={cn('g-acct-chip', className)}
                onClick={() => setOpen(true)}
                aria-label={count ? `Switch account (${count} more on this device)` : 'Switch or add account'}
            >
                <Avatar name={identity.name} role={identity.role} size={30} />
                <ChevronDown className="g-acct-chip__chev" aria-hidden />
                {count ? <span className="g-acct-chip__count">{count + 1}</span> : null}
            </button>
            <AccountSwitcherSheet open={open} onClose={() => setOpen(false)} />
        </>
    );
}

/** Signed out with saved accounts: quick "Continue as" on Home / sign-in. */
export function SavedAccountsDock() {
    const accounts = useSavedAccounts().filter((a) => a.bundle);
    const { switching, go } = useSwitch();
    const [open, setOpen] = useState(false);
    if (!accounts.length) return null;
    const [first, ...rest] = accounts;
    return (
        <>
            {/* Room to scroll the page's last row above the fixed dock. */}
            <div className="g-saved-dock-spacer" aria-hidden />
            <div className="g-saved-dock" role="region" aria-label="Saved accounts">
                <button type="button" className="g-saved-dock__main" onClick={() => go(first)}>
                    <Avatar name={first.name} role={first.role} size={36} />
                    <span className="min-w-0 flex-1 text-left">
                        <span className="block truncate text-[14px] font-semibold text-[var(--g-ink)]">Continue as {first.name}</span>
                        <span className="block truncate text-[12px] text-[var(--g-muted)]">{roleLine(first)}</span>
                    </span>
                    <LogIn className="h-5 w-5 shrink-0 text-[var(--g-brand)]" aria-hidden />
                </button>
                {rest.length ? (
                    <button type="button" className="g-saved-dock__more" onClick={() => setOpen(true)}>
                        +{rest.length}
                    </button>
                ) : null}
            </div>
            <Sheet open={open} onClose={() => setOpen(false)} title="Saved accounts" subtitle="Continue without signing in">
                <div className="g-list g-acct-list">
                    {accounts.map((account) => (
                        <button
                            key={account.key}
                            type="button"
                            className="g-row g-acct-row"
                            onClick={() => {
                                setOpen(false);
                                go(account);
                            }}
                        >
                            <Avatar name={account.name} role={account.role} />
                            <span className="g-row__body">
                                <span className="g-row__title block">{account.name}</span>
                                <span className="g-row__hint block">{roleLine(account)}</span>
                            </span>
                        </button>
                    ))}
                </div>
            </Sheet>
            <SwitchingVeil account={switching} />
        </>
    );
}
