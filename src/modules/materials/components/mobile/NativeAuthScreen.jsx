import { useState } from 'react';
import { AlertCircle, BriefcaseBusiness, ChevronLeft, ClipboardList, Eye, EyeOff, Shield } from 'lucide-react';

const ROLES = {
  worker: { label: 'Worker access', icon: ClipboardList },
  manager: { label: 'Manager access', icon: BriefcaseBusiness },
  admin: { label: 'Admin access', icon: Shield },
};

/**
 * Text field for native screens: visible label, optional leading icon,
 * inline error wired to aria-describedby, and a show/hide toggle for
 * passwords that keeps the keyboard open.
 */
export function NativeTextField({
  id,
  label,
  icon: Icon,
  error,
  hint,
  type = 'text',
  tone,
  inputRef,
  ...inputProps
}) {
  const [visible, setVisible] = useState(false);
  const isPassword = type === 'password';
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className="n-field" data-invalid={error ? 'true' : undefined} data-tone={tone}>
      <label className="n-field__label" htmlFor={id}>
        {label}
      </label>
      <div className="n-field__control">
        {Icon ? <Icon className="n-field__icon h-[19px] w-[19px]" strokeWidth={2} aria-hidden /> : null}
        <input
          id={id}
          ref={inputRef}
          className="n-field__input"
          type={isPassword ? (visible ? 'text' : 'password') : type}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...inputProps}
        />
        {isPassword ? (
          <button
            type="button"
            className="n-field__toggle"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? 'Hide password' : 'Show password'}
            aria-pressed={visible}
            aria-controls={id}
          >
            {visible ? <EyeOff className="h-5 w-5" aria-hidden /> : <Eye className="h-5 w-5" aria-hidden />}
          </button>
        ) : null}
      </div>
      {error ? (
        <p id={errorId} className="n-field__error">
          <AlertCircle className="mt-px h-[15px] w-[15px] shrink-0" aria-hidden />
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="n-field__hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Inline banner for form-level messages (wrong password, offline, …). */
export function NativeAlert({ children, tone = 'danger' }) {
  return (
    <div className="n-alert" data-tone={tone} role="alert">
      <AlertCircle className="h-[18px] w-[18px]" aria-hidden />
      <span>{children}</span>
    </div>
  );
}

/** Primary button with an in-place spinner. */
export function NativeButton({ loading = false, showSpinner = loading, tone, className = '', children, ...props }) {
  return (
    <button
      className={`n-btn ${className}`}
      data-tone={tone}
      data-loading={loading ? 'true' : undefined}
      aria-busy={loading || undefined}
      {...props}
    >
      {showSpinner ? <span className="n-spinner" aria-hidden /> : null}
      {children}
    </button>
  );
}

/**
 * Native-app sign-in screen: brand, role, heading and one glass card that
 * holds the form. The website keeps its own LoginForm.
 */
export default function NativeAuthScreen({
  role = 'worker',
  title,
  subtitle,
  onBack,
  backLabel = 'Back',
  children,
  footer,
}) {
  const roleInfo = ROLES[role] || ROLES.worker;
  const RoleIcon = roleInfo.icon;

  return (
    <div className="n-auth" data-role={role}>
      <div className="n-auth__ambient" aria-hidden />
      <div className="n-auth__bar">
        {onBack ? (
          <button type="button" className="n-navbar__back" onClick={onBack}>
            <ChevronLeft className="h-[26px] w-[26px] shrink-0" strokeWidth={2.4} aria-hidden />
            <span>{backLabel}</span>
          </button>
        ) : null}
      </div>

      <main className="n-auth__body">
        <div className="n-auth__brand">
          <img
            src="/Akk-logo.jpg"
            alt="AKK Engineering"
            className="n-auth__logo"
            width={56}
            height={56}
            decoding="async"
          />
          <span className="n-auth__role">
            <RoleIcon className="h-[15px] w-[15px]" strokeWidth={2.2} aria-hidden />
            {roleInfo.label}
          </span>
        </div>
        <h1 className="n-auth__title">{title}</h1>
        {subtitle ? <p className="n-auth__sub">{subtitle}</p> : null}
        <div className="n-auth__card">{children}</div>
        {footer ? <p className="n-auth__foot">{footer}</p> : null}
      </main>

      <footer className="n-auth__legal">
        AKK ENGINEERING PTE. LTD.
        <br />
        15 Kaki Bukit Rd 4, #01-50, Singapore 417808
      </footer>
    </div>
  );
}
