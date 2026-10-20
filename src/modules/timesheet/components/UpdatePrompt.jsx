import React, { useEffect, useState } from 'react'
import { ArrowUpCircle } from 'lucide-react'
import {
  checkForPlayStoreUpdate,
  startPlayStoreUpdate,
  rememberUpdatePromptDismissed,
} from '@/modules/timesheet/lib/appUpdate.js'

/**
 * Shown once per session on native Android when Google Play reports a newer
 * version. `active` should become true after the splash screen finishes so the
 * prompt never fights the splash for attention.
 */
export default function UpdatePrompt({ active }) {
  const [updateInfo, setUpdateInfo] = useState(null)
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!active || checked) return
    setChecked(true)
    let cancelled = false
    void checkForPlayStoreUpdate().then((info) => {
      if (!cancelled && info) setUpdateInfo(info)
    })
    return () => {
      cancelled = true
    }
  }, [active, checked])

  if (!updateInfo) return null

  const dismiss = () => {
    rememberUpdatePromptDismissed()
    setUpdateInfo(null)
  }

  const handleUpdate = async () => {
    if (busy) return
    setBusy(true)
    try {
      await startPlayStoreUpdate(updateInfo)
    } finally {
      setBusy(false)
      dismiss()
    }
  }

  return (
    <div className="akk-scrim fixed inset-0 z-[9000] flex items-end justify-center" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="akk-update-title"
        aria-describedby="akk-update-body"
        className="akk-sheet akk-sheet--enter w-full max-w-[640px] px-5 pb-[calc(20px+var(--akk-safe-bottom,0px))] pt-1"
      >
        <div className="akk-sheet__grabber" aria-hidden="true" />
        <div className="mt-5 flex items-center gap-3">
          <span className="akk-row__icon akk-tone-brand !h-12 !w-12 !rounded-2xl">
            <ArrowUpCircle aria-hidden />
          </span>
          <h2 id="akk-update-title" className="text-[20px] font-semibold tracking-tight text-slate-900">
            Update available
          </h2>
        </div>
        <p id="akk-update-body" className="mt-3 text-[15px] leading-[21px] text-slate-600">
          A newer version of AKK Hub is available on Google
          Play. Update now to get the latest features and fixes.
        </p>
        <div className="mt-5 grid gap-2">
          <button
            type="button"
            onClick={handleUpdate}
            disabled={busy}
            aria-busy={busy || undefined}
            className="akk-cta"
          >
            {busy ? 'Opening…' : 'Update now'}
          </button>
          <button
            type="button"
            onClick={dismiss}
            disabled={busy}
            className="akk-cta akk-cta--plain"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  )
}
