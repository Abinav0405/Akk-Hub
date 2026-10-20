import React from 'react'
import { Card } from '@/ui/card'
import { isNativeApp } from '@/core/platform'
import { NativeNavBar } from '@/ui/native/NativeChrome'

export default function LegalNotice() {
  const effectiveDate = '2026-05-08'
  const nativeApp = isNativeApp()
  const body = (
          <div className="space-y-6">
            {nativeApp ? null : (
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
                Privacy Policy
              </h1>
              <p className="text-sm text-slate-600">Effective date: {effectiveDate}</p>
            </div>
            )}

            <div className="space-y-3 text-[15px] leading-7 text-slate-700">
              <p>
                AKK Hub (&quot;the App&quot;) is used by AKK Engineering to manage attendance, materials, site photos,
                timesheets, shifts, and related workplace records.
              </p>
            </div>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-slate-900">Information we collect</h2>
              <ul className="list-disc space-y-1 pl-5 text-[15px] leading-7 text-slate-700">
                <li>
                  Account and work data you provide (for example: name, employee ID, role, timesheets, shift
                  records, leave records, and related administrative notes).
                </li>
                <li>
                  Device/app data required for the App to function (for example: identifiers used for session
                  management, and basic diagnostics when necessary to troubleshoot issues).
                </li>
                <li>
                  Location data only if you choose to allow it, and only when used by your organization&apos;s
                  workflow (for example: to support attendance/clock-in verification).
                </li>
              </ul>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-slate-900">How we use information</h2>
              <ul className="list-disc space-y-1 pl-5 text-[15px] leading-7 text-slate-700">
                <li>Provide core app features (login, timesheets, shifts, attendance, and reporting).</li>
                <li>Enable admin/manager operations and workforce reporting.</li>
                <li>Maintain security, prevent misuse, and improve reliability.</li>
              </ul>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-slate-900">Sharing</h2>
              <div className="space-y-2 text-[15px] leading-7 text-slate-700">
                <p>We do not sell your personal data.</p>
                <p>
                  Data may be processed by service providers we use to operate the App (for example: hosting and
                  database services).
                </p>
              </div>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-slate-900">Data retention</h2>
              <p className="text-[15px] leading-7 text-slate-700">
                We retain data for business, legal, and operational needs. Where applicable, you can request
                access, correction, or deletion through your organization.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-slate-900">Security</h2>
              <p className="text-[15px] leading-7 text-slate-700">
                We use reasonable technical and organizational safeguards designed to protect information.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-slate-900">Children</h2>
              <p className="text-[15px] leading-7 text-slate-700">
                The App is intended for workplace use and is not directed to children under 13.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-slate-900">Contact</h2>
              <p className="text-[15px] leading-7 text-slate-700">
                If you have questions, contact your organization&apos;s administrator or AKK Engineering.
              </p>
            </section>
          </div>
  )

  if (nativeApp) {
    return (
      <div className="akk-screen">
        <NativeNavBar backTo="/" backLabel="Back" title="Privacy Policy" subtitle={`Effective ${effectiveDate}`} />
        <main className="akk-content mx-auto max-w-4xl">
          <div className="akk-surface p-5">{body}</div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
        <Card className="p-6 sm:p-8">
          {body}
        </Card>
      </div>
    </div>
  )
}
