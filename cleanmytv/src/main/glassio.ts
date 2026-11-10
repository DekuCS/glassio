// GlassMyTV, the launcher in glassio/. Unlike the launcher it replaces, it carries its own settings
// screen on the TV: nothing comes in over ADB. This file only puts the APK on the TV and hands it Home,
// and it grants the three rights the launcher cannot grant itself.
import { existsSync, readFileSync } from 'node:fs'
import { log } from './log'
import { paths } from './paths'
import * as T from './tv'
import { HOME_PKG, OLD_PKG, LEGACY_HOME_PKG, StockUnknown, addService, detectStock, handOver, rememberStock, toSwitchOff } from './launcher'
import type { HomeStatus, InstallResult } from '@shared/api'

const TASK = 'install'
const MAIN = `${HOME_PKG}/.MainActivity`
/** Opens GlassMyTV when the Home button lands on the stock launcher (System → Home button). */
const KEY_SERVICE = `${HOME_PKG}/.HomeKeyService`
/** Android 8: GlassMyTV's minSdk (glassio/app/build.gradle.kts). */
export const MIN_SDK = 26

function bundledVersion(): string | undefined {
  try {
    return JSON.parse(readFileSync(paths.bundledGlassioInfo, 'utf8')).versionName
  } catch {
    return undefined
  }
}

export async function status(): Promise<HomeStatus> {
  const dump = await T.tv().shell(`dumpsys package ${HOME_PKG} | grep -m1 versionName`)
  const versionName = /versionName=(\S+)/.exec(dump)?.[1]
  const home = await T.homeComponent()
  const { installed } = await T.packageSets()
  return {
    oldLauncher: installed.has(OLD_PKG) || installed.has(LEGACY_HOME_PKG),
    installed: !!versionName,
    versionName,
    isHome: !!home && home.startsWith(HOME_PKG + '/'),
    bundled: existsSync(paths.bundledGlassioApk),
    bundledVersion: bundledVersion(),
    unsupported: unsupported() ?? undefined
  }
}

/** Why GlassMyTV can't go on the connected TV, or null when it can. */
export function unsupported(): string | null {
  const probe = T.getStatus().probe
  // An unknown SDK (0) is let through: pm install gives its own answer.
  if (!probe?.sdk || probe.sdk >= MIN_SDK) return null
  return `GlassMyTV needs Android 8 or newer, and this TV runs Android ${probe.release || '?'} (SDK ${probe.sdk}). Clean up still works on it.`
}

// "Requested internal only, but not enough space" on older Android, INSTALL_FAILED_INSUFFICIENT_STORAGE on newer (#48).
const SPACE_RE = /not enough space|INSUFFICIENT_STORAGE/i

function noSpace(free: number, need: number): string {
  const mb = (kb: number): string => `${Math.max(0, kb / 1024).toFixed(kb < 10240 ? 1 : 0)} MB`
  const has = Number.isFinite(free) ? `has ${mb(free)} free and ` : ''
  return `The TV is out of storage: it ${has}GlassMyTV needs about ${mb(need)}. The app already cleared every app's cache. Uninstall an app you don't use, then try again.`
}

/**
 * The rights GlassMyTV can't take for itself: secure settings (its settings screen changes the TV's
 * screensaver, sleep timer and DNS), usage stats (Continue watching, Recents) and the overlay that lets
 * the boot receiver open it. The notification listener it turns on itself once secure settings are set.
 */
async function grant(): Promise<string[]> {
  const out = await T.sh(TASK, [
    `pm grant ${HOME_PKG} android.permission.WRITE_SECURE_SETTINGS`,
    `pm grant ${HOME_PKG} android.permission.READ_MEDIA_IMAGES`,
    `appops set ${HOME_PKG} GET_USAGE_STATS allow`,
    `appops set ${HOME_PKG} SYSTEM_ALERT_WINDOW allow`,
    'echo granted'
  ].join(' 2>/dev/null; '))
  return out.includes('granted') ? [] : [out.trim()]
}

/** Installs or updates GlassMyTV, starts it, and only then makes it Home. */
export async function install(chosen?: string): Promise<InstallResult> {
  if (!existsSync(paths.bundledGlassioApk)) {
    return { ok: false, summary: 'This copy of the app has no GlassMyTV bundled.', warnings: [] }
  }
  const tooOld = unsupported()
  if (tooOld) return { ok: false, summary: tooOld, warnings: [] }
  let stock: string
  try {
    stock = await detectStock(chosen)
  } catch (e) {
    if (e instanceof StockUnknown) return { ok: false, summary: e.message, warnings: [], stockChoices: e.candidates }
    throw e
  }
  log(TASK, 'info', `stock launcher: ${stock}`)
  const apk = readFileSync(paths.bundledGlassioApk)
  // The upload's base64 copy, the APK, Android's own copy of it and the compiled code all sit on /data.
  const need = Math.ceil((apk.length * 5) / 1024)
  let trimmed = false
  if ((await T.freeKb(TASK)) < need) {
    await T.trimCaches(TASK)
    trimmed = true
    const free = await T.freeKb(TASK)
    if (free < need) return { ok: false, summary: noSpace(free, need), warnings: [] }
  }
  const tmp = '/data/local/tmp/glassmytv.apk'
  await T.pushB64(TASK, apk, tmp)
  // -d: an older copy of this app may put its older launcher back over a newer one. An uninstall would
  // be the only other way, and it wipes the launcher's settings.
  const installCmd = `pm install -r -d ${tmp}`
  let out = await T.sh(TASK, installCmd, { timeoutMs: 300000 })
  if (SPACE_RE.test(out) && !trimmed) {
    await T.trimCaches(TASK)
    trimmed = true
    out = await T.sh(TASK, installCmd, { timeoutMs: 300000 })
  }
  await T.sh(TASK, `rm -f ${tmp}`)
  if (SPACE_RE.test(out)) return { ok: false, summary: noSpace(await T.freeKb(TASK), need), warnings: [out.trim()] }
  if (!out.includes('Success')) {
    return { ok: false, summary: 'Install failed; Home was left as it was.', warnings: [out.trim()] }
  }
  const denied = await grant()
  const start = await T.sh(TASK, `am start -W -n ${MAIN}`)
  if (!start.includes('Status: ok') || /^Error/im.test(start)) {
    return { ok: false, summary: 'GlassMyTV did not start, so Home was left as it was.', warnings: [start.trim(), ...denied] }
  }
  const { failed, notes } = await handOver(toSwitchOff(stock), MAIN)
  if (failed) return { ...failed, warnings: [...failed.warnings, ...denied] }
  rememberStock(stock)
  // Android switches accessibility services off when their app is reinstalled: turn the Home button one
  // back on. The launcher's own settings screen has the switch too.
  await addService(KEY_SERVICE).catch((e: Error) => log(TASK, 'warn', `Home button service not enabled: ${e.message}`))
  return {
    ok: true,
    summary: 'GlassMyTV is Home now. Press Home on the remote to see it.',
    warnings: notes
  }
}
