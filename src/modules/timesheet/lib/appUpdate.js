import { Capacitor } from '@capacitor/core'
import { storageKey } from '@/core/storage'

/**
 * Google Play in-app update check (Android app only).
 *
 * IMPORTANT: the web bundle is served remotely (capacitor.config.json server.url),
 * so this code also runs inside OLD installed shells that do not contain the
 * AppUpdate plugin yet. Every call is guarded with isPluginAvailable + try/catch
 * so older apps, the website, emulators without Play Services, and sideloads
 * all degrade silently to "no prompt".
 */

const PROMPT_DISMISSED_KEY = storageKey('timesheet', 'akk_update_prompt_dismissed')

function wasPromptDismissedThisSession() {
  try {
    return sessionStorage.getItem(PROMPT_DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

export function rememberUpdatePromptDismissed() {
  try {
    sessionStorage.setItem(PROMPT_DISMISSED_KEY, '1')
  } catch {
    /* ignore */
  }
}

/**
 * Returns the plugin's AppUpdateInfo when a newer version is live on Google Play,
 * otherwise null. Never throws.
 */
export async function checkForPlayStoreUpdate() {
  if (Capacitor.getPlatform() !== 'android') return null
  if (!Capacitor.isPluginAvailable('AppUpdate')) return null
  if (wasPromptDismissedThisSession()) return null

  try {
    const { AppUpdate, AppUpdateAvailability } = await import('@capawesome/capacitor-app-update')
    const info = await AppUpdate.getAppUpdateInfo()
    if (info?.updateAvailability !== AppUpdateAvailability.UPDATE_AVAILABLE) return null
    return info
  } catch {
    // Play Services unavailable (sideload / emulator) or network failure.
    return null
  }
}

/**
 * Starts the update: Play's full-screen immediate update when allowed,
 * otherwise falls back to opening the Play Store listing.
 */
export async function startPlayStoreUpdate(updateInfo) {
  if (!Capacitor.isPluginAvailable('AppUpdate')) return

  let AppUpdate
  try {
    ;({ AppUpdate } = await import('@capawesome/capacitor-app-update'))
  } catch {
    return
  }

  if (updateInfo?.immediateUpdateAllowed) {
    try {
      await AppUpdate.performImmediateUpdate()
      return
    } catch {
      // User cancelled Play's update UI or it failed — fall through to the store page.
    }
  }

  try {
    await AppUpdate.openAppStore()
  } catch {
    /* ignore */
  }
}
