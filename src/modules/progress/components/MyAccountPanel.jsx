// TODO(claude): session helpers + layout for MyAccountPanel
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Camera, History, Loader2, User } from 'lucide-react';
import { Button } from '@/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import PasswordInput from '@/modules/progress/components/PasswordInput';
import NativeBottomNav from '@/modules/progress/components/mobile/NativeBottomNav';
import { createPageUrl } from '@/modules/progress/lib/utils';
import { isNativeApp } from '@/core/platform';
import { updateOwnDisplayName, updateOwnPassword } from '@/modules/progress/lib/myAccount';
import { friendlyDbError } from '@/modules/progress/lib/networkError';

export const ACCOUNT_ROLE_META = {
  worker: {
    label: 'Employee/Technician',
    userIdLabel: 'Employee ID',
    portal: createPageUrl('WorkerPortal'),
    variant: 'default',
  },
  manager: {
    label: 'Manager',
    userIdLabel: 'Login ID',
    portal: createPageUrl('ManagerDashboard'),
    variant: 'manager',
  },
  admin: {
    label: 'Admin',
    userIdLabel: 'Email',
    portal: createPageUrl('AdminDashboard'),
    variant: 'admin',
  },
  exporter: {
    label: 'Export Only',
    userIdLabel: 'Sign-in name',
    portal: createPageUrl('ExporterDashboard'),
    variant: 'exporter',
  },
};

export function createMyAccountUrl(role) {
  if (role === 'exporter') return '/progress/client?tab=account';
  return `${createPageUrl('MyAccount')}?role=${encodeURIComponent(role)}`;
}

/**
 * Account shortcut in Progress headers.
 * Export Only stays standalone (outside HubLayout) — always show.
 * Staff roles inside Hub: hub `/account` tab owns account; hide on web to avoid dual chrome.
 */
export function MyAccountHeaderButton({ role, native: nativeProp }) {
  const native = nativeProp ?? isNativeApp();
  if (role !== 'exporter' && !native) return null;
  const to = role === 'exporter' ? createMyAccountUrl(role) : '/account';
  return (
    <Button
      asChild
      variant="outline"
      size={native ? 'icon' : 'sm'}
      className={native ? 'h-11 w-11' : undefined}
    >
      <Link to={to} aria-label="My Account">
        <User className={native ? 'h-4 w-4' : 'mr-1.5 h-4 w-4'} />
        {!native && 'My Account'}
      </Link>
    </Button>
  );
}

/** Native-only Progress worker dock — hub TabBar replaces this on web (and CSS-hides it in .g-shell). */
export function WorkerNativeNav({ unread }) {
  if (!isNativeApp()) return null;
  return (
    <NativeBottomNav
      items={[
        { to: createPageUrl('WorkerPortal'), icon: Camera, label: 'Submit' },
        { to: createPageUrl('MySubmissions'), icon: History, label: 'History', badge: unread },
        { to: '/account', icon: User, label: 'Account' },
      ]}
    />
  );
}

export default function MyAccountPanel({
  role,
  userId,
  displayName,
  onUserIdChange,
  onDisplayNameChange,
}) {
  const native = isNativeApp();
  const meta = ACCOUNT_ROLE_META[role] || ACCOUNT_ROLE_META.worker;
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const handleSaveName = async (e) => {
    e.preventDefault();
    const name = (displayName || '').trim();
    if (!name) {
      toast.error('Display name is required.');
      return;
    }
    setSavingName(true);
    try {
      const next = await updateOwnDisplayName(role, name);
      onDisplayNameChange?.(next);
      if (role === 'exporter') onUserIdChange?.(next);
      toast.success('Name updated.');
    } catch (err) {
      toast.error(friendlyDbError(err, 'Could not update name'));
    } finally {
      setSavingName(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (!newPassword || newPassword.length < 6) {
      toast.error('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match.');
      return;
    }
    setSavingPassword(true);
    try {
      await updateOwnPassword(role, { currentPassword, newPassword, confirmPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('Password changed.');
    } catch (err) {
      toast.error(friendlyDbError(err, 'Could not change password'));
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>
          {role === 'exporter'
            ? 'Your display name is also the name you use to sign in.'
            : 'Your user ID cannot be changed here.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSaveName} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="acct-user-id">{meta.userIdLabel}</Label>
            <Input id="acct-user-id" value={userId} disabled readOnly autoComplete="username" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acct-role">Portal</Label>
            <Input id="acct-role" value={meta.label} disabled readOnly />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acct-name">Display name</Label>
            <Input
              id="acct-name"
              value={displayName}
              onChange={(e) => onDisplayNameChange?.(e.target.value)}
              required
              autoComplete="name"
              className={native ? 'h-12 text-base' : undefined}
            />
          </div>
          <Button type="submit" variant="outline" className="min-h-11 w-full sm:w-auto" disabled={savingName}>
            {savingName ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            Save name
          </Button>
        </form>

        <div className="my-6 border-t border-border" />

        <form onSubmit={handleChangePassword} className="space-y-4">
          <div>
            <h3 className="text-[15px] font-semibold text-slate-900">Change password</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter your current password, then a new one (at least 6 characters). Other devices stay signed in.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acct-current">Current password</Label>
            <PasswordInput
              id="acct-current"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acct-new">New password (min 6)</Label>
            <PasswordInput
              id="acct-new"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acct-confirm">Confirm new password</Label>
            <PasswordInput
              id="acct-confirm"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
            />
          </div>
          <Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={savingPassword}>
            {savingPassword ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            Change password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

