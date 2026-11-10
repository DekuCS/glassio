import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Server } from 'node:net'
import { configurePaths } from '../src/main/paths'
import * as T from '../src/main/tv'
import * as L from '../src/main/launcher'
import * as G from '../src/main/glassio'
import * as D from '../src/main/debloat'
import { bugReport } from '../src/main/report'
import * as S from '../src/main/system'
import { bootCheck } from '../src/main/bootcheck'
import { FakeTv, newTv, startFakeAdbd } from './fake-adbd'

const OURS = 'com.glasslauncher.tv/.MainActivity'
const home = mkdtempSync(join(tmpdir(), 'cytv-test-'))
process.env.HOME = home
// A resources folder of its own: the real lists and a stand-in APK, so this runs without the launcher
// having been built (CI builds it in a separate job).
const resources = join(home, 'resources')
mkdirSync(resources)
symlinkSync(resolve('resources/upstream'), join(resources, 'upstream'))
writeFileSync(join(resources, 'glassio.apk'), randomBytes(100 * 1024))
writeFileSync(join(resources, 'glassio.json'), JSON.stringify({ versionName: '1.0.0' }))
configurePaths(resources, join(home, 'data'))

describe('GlassMyTV', () => {
  let tv: FakeTv
  let server: Server
  beforeAll(async () => {
    tv = newTv()
    tv.maxData = 256 * 1024
    for (const p of ['com.google.android.apps.tv.launcherx', 'com.netflix.ninja', 'com.google.android.youtube.tv']) tv.packages.set(p, 'enabled')
    tv.home = 'com.google.android.apps.tv.launcherx/.home.HomeActivity'
    tv.homeClaims = ['com.google.android.apps.tv.launcherx/.home.HomeActivity']
    tv.leanback = ['com.netflix.ninja', 'com.google.android.youtube.tv']
    let port: number
    ;({ server, port } = await startFakeAdbd(tv))
    T.init(join(home, 'data', 'adbkey'), () => {})
    expect((await T.connect(`127.0.0.1:${port}`)).state).toBe('connected')
  })
  afterAll(() => { T.disconnect(); server.close() })

  it('installs, starts, then hands Home over and disables the stock launcher', async () => {
    const r = await G.install()
    expect(r.ok).toBe(true)
    expect(tv.home).toBe(OURS)
    expect(tv.packages.get('com.google.android.apps.tv.launcherx')).toBe('disabled')
    const order = tv.commands.filter((c) => /pm install|am start -W|pm disable-user|set-home-activity/.test(c))
    expect(order.map((c) => c.split(' ').slice(0, 2).join(' '))).toEqual(['pm install', 'am start', 'pm disable-user', 'cmd package'])
    // The rights GlassMyTV can't take for itself go on over adb, after the APK lands.
    const grants = tv.commands.find((c) => c.includes('echo granted'))
    expect(grants).toContain('pm grant com.glasslauncher.tv android.permission.WRITE_SECURE_SETTINGS')
    expect(grants).toContain('appops set com.glasslauncher.tv GET_USAGE_STATS allow')
    expect(grants).toContain('appops set com.glasslauncher.tv SYSTEM_ALERT_WINDOW allow')
    const installedAt = tv.commands.findIndex((c) => c.startsWith('pm install'))
    expect(tv.commands.indexOf(grants as string)).toBeGreaterThan(installedAt)
    // Android switches its accessibility services off when the app is reinstalled: the Home-key one goes back on.
    expect(tv.settings.get('enabled_accessibility_services')).toBe('com.glasslauncher.tv/.HomeKeyService')
    expect(await G.status()).toMatchObject({ installed: true, isHome: true, versionName: '1.0.0', bundledVersion: '1.0.0', oldLauncher: false })
  })

  it('gives Home back to the stock launcher, then switches to GlassMyTV again', async () => {
    expect((await L.useStock()).ok).toBe(true)
    expect(tv.home).toBe('com.google.android.apps.tv.launcherx/.home.HomeActivity')
    expect(tv.packages.get('com.google.android.apps.tv.launcherx')).toBe('enabled')
    // The launcher's accessibility service goes with it, so no dead entry is left behind.
    expect(tv.settings.get('enabled_accessibility_services') ?? 'null').toBe('null')
    expect((await G.install()).ok).toBe(true)
    expect(tv.home).toBe(OURS)
  })

  it('removes the launchers earlier versions of this app installed, once they are not Home', async () => {
    tv.packages.set('com.gathin.tvhome', 'enabled')
    tv.packages.set('io.github.wingedpanther.cleanmytv.home', 'enabled')
    tv.homeClaims.push('com.gathin.tvhome/.MainActivity', 'io.github.wingedpanther.cleanmytv.home/.MainActivity')
    tv.settings.set('enabled_accessibility_services', 'com.gathin.tvhome/.InputKeyService:com.other/.Svc')
    tv.home = 'com.gathin.tvhome/.MainActivity'
    expect((await G.status()).oldLauncher).toBe(true)
    expect((await L.removeOld()).ok).toBe(false)
    expect(tv.packages.has('com.gathin.tvhome')).toBe(true)
    // Installing over it: the stock launcher is already off, so nothing else is disabled.
    const before = tv.commands.length
    expect((await G.install()).ok).toBe(true)
    expect(tv.commands.slice(before).some((c) => c.startsWith('pm disable-user'))).toBe(false)
    expect((await L.removeOld()).ok).toBe(true)
    expect(tv.packages.has('com.gathin.tvhome')).toBe(false)
    expect(tv.packages.has('io.github.wingedpanther.cleanmytv.home')).toBe(false)
    expect(tv.settings.get('enabled_accessibility_services')).toBe('com.other/.Svc:com.glasslauncher.tv/.HomeKeyService')
  })

  it('leaves Home where it was when the switch does not stick', async () => {
    expect((await L.useStock()).ok).toBe(true)
    tv.homeStuck = true
    const r = await L.switchTo(OURS)
    tv.homeStuck = false
    expect(r.ok).toBe(false)
    expect(tv.home).toBe('com.google.android.apps.tv.launcherx/.home.HomeActivity')
    expect((await G.install()).ok).toBe(true)
  })

  it('describes the TV for a bug report without its address or the owner\'s settings', async () => {
    const text = await bugReport('9.9.9')
    expect(text).toMatch(/^GlassMyTV 9\.9\.9, /)
    expect(text).toContain('TV: Sony BRAVIA 4K VH2')
    expect(text).toMatch(/Home: \S+\/\S+/)
    expect(text).toMatch(/GlassMyTV: \S+ installed/)
    expect(text).not.toContain(T.host())
  })

  it('gives Home back to the stock launcher from GlassMyTV', async () => {
    expect((await L.useStock()).ok).toBe(true)
    expect(tv.home).toBe('com.google.android.apps.tv.launcherx/.home.HomeActivity')
    expect(tv.packages.get('com.google.android.apps.tv.launcherx')).toBe('enabled')
  })

  it('switches the stock launcher off when using an installed GlassMyTV (#27)', async () => {
    const r = await L.switchTo(OURS)
    expect(r.ok).toBe(true)
    expect(tv.home).toBe(OURS)
    expect(tv.packages.get('com.google.android.apps.tv.launcherx')).toBe('disabled')
  })

  it('switches setupwraith off only once GlassMyTV is Home (#33)', async () => {
    tv.packages.set(D.SETUPWRAITH, 'enabled')
    await L.useStock()
    let r = await D.apply({ listId: 'custom', disable: [D.SETUPWRAITH], enable: [] })
    expect(r.warnings.join('\n')).toMatch(/Kept on for now: com.google.android.tungsten.setupwraith/)
    expect(r.summary).toBe('Nothing switched off yet: com.google.android.tungsten.setupwraith stayed on for now. The notes below say why.')
    expect(tv.packages.get(D.SETUPWRAITH)).toBe('enabled')
    expect((await L.switchTo(OURS)).ok).toBe(true)
    r = await D.apply({ listId: 'custom', disable: [D.SETUPWRAITH], enable: [] })
    expect(r.ok).toBe(true)
    expect(tv.packages.get(D.SETUPWRAITH)).toBe('disabled')
  })

  const instant = { sleep: async () => {}, portOpen: async () => true }

  it('restarts the TV, reconnects and finds the home screen running', async () => {
    const r = await bootCheck(instant)
    expect(r).toMatchObject({ ok: true, reconnected: true })
    expect(tv.commands).toContain('reboot')
    expect(T.getStatus().state).toBe('connected')
  })

  it('puts the stock launcher back when no home screen comes up after the restart', async () => {
    tv.crashing = ['com.glasslauncher.tv']
    const r = await bootCheck(instant)
    tv.crashing = []
    expect(r).toMatchObject({ ok: false, reconnected: true })
    expect(r.advice).toMatch(/switched com.google.android.apps.tv.launcherx back on/)
    expect(tv.packages.get('com.google.android.apps.tv.launcherx')).toBe('enabled')
    expect(tv.home).toBe('com.google.android.apps.tv.launcherx/.home.HomeActivity')
  })

  it("doesn't take Settings' FallbackHome for a home screen after the restart", async () => {
    tv.packages.set('com.android.tv.settings', 'enabled')
    tv.home = 'com.android.tv.settings/.FallbackHome'
    const r = await bootCheck(instant)
    tv.packages.delete('com.android.tv.settings')
    expect(r).toMatchObject({ ok: false, reconnected: true })
    expect(r.summary).toMatch(/Home resolves to com.android.tv.settings\/.FallbackHome/)
    expect(r.advice).toMatch(/switched com.google.android.apps.tv.launcherx back on/)
    expect(tv.home).toBe('com.google.android.apps.tv.launcherx/.home.HomeActivity')
  })

  it('says so when the TV does not come back after the restart', async () => {
    const r = await bootCheck({ sleep: async () => {}, portOpen: async () => false })
    expect(r).toMatchObject({ ok: false, reconnected: false })
    expect(T.getStatus().state).not.toBe('connected')
    expect((await T.connect(String(T.getStatus().host))).state).toBe('connected')
  })

  it('refuses to install on Android older than 8 (#30)', async () => {
    const host = String(T.getStatus().host)
    tv.sdk = '24'
    expect((await T.connect(host)).state).toBe('connected')
    const r = await G.install()
    expect(r.ok).toBe(false)
    expect(r.summary).toMatch(/needs Android 8 or newer, and this TV runs Android 7\.0 \(SDK 24\)/)
    expect((await G.status()).unsupported).toMatch(/Android 8/)
    tv.sdk = undefined
    expect((await T.connect(host)).state).toBe('connected')
    expect((await G.status()).unsupported).toBeUndefined()
  })

  describe('a TV low on storage (#48)', () => {
    afterEach(() => { tv.freeKb = undefined; tv.cacheKb = undefined })

    it('clears the caches first when space is short, then installs', async () => {
      // The test APK is 100 KB, so the install wants 500 KB.
      tv.freeKb = 300; tv.cacheKb = 300000
      const before = tv.commands.length
      expect((await G.install()).ok).toBe(true)
      const cmds = tv.commands.slice(before)
      expect(cmds.indexOf('pm trim-caches 4096G')).toBeLessThan(cmds.findIndex((c) => c.startsWith('pm install')))
    })

    it('stops before uploading when clearing the caches is not enough, and says how much is needed', async () => {
      tv.freeKb = 300; tv.cacheKb = 100
      const before = tv.commands.length
      const r = await G.install()
      expect(r.ok).toBe(false)
      expect(r.summary).toMatch(/out of storage: it has 0.4 MB free and GlassMyTV needs about 0.5 MB.*Uninstall an app/)
      expect(tv.commands.slice(before).some((c) => c.startsWith('pm install') || c.includes('glassmytv.apk.b64'))).toBe(false)
    })

    it('clears the caches and retries when pm install still runs out of space', async () => {
      // df says there's room, but pm wants more than that.
      tv.freeKb = 10100; tv.cacheKb = 50000
      const before = tv.commands.length
      expect((await G.install()).ok).toBe(true)
      expect(tv.commands.slice(before).filter((c) => c.startsWith('pm install'))).toHaveLength(2)
      expect(tv.commands).toContain('rm -f /data/local/tmp/glassmytv.apk')
    })

    it('shows free space in TV extras and clears the caches from there', async () => {
      tv.freeKb = 200000; tv.cacheKb = 300000
      expect((await S.state()).storage).toEqual({ freeKb: 200000, totalKb: 5806884 })
      const r = await S.clearCaches()
      expect(r).toEqual({ ok: true, summary: "Cleared every app's cache: 293 MB back, 488 MB free now. Apps rebuild some of it as you use them.", warnings: [] })
      tv.freeKb = undefined
      expect((await S.state()).storage).toBeNull()
    })

    it('says so plainly when the retry fails too', async () => {
      tv.freeKb = 10100; tv.cacheKb = 0
      const r = await G.install()
      expect(r.ok).toBe(false)
      expect(r.summary).toMatch(/out of storage/)
      expect(r.warnings[0]).toMatch(/not enough space/)
    })
  })
})

describe('stock launchers other than Google\'s (#39)', () => {
  let tv: FakeTv
  let server: Server
  beforeAll(async () => {
    tv = newTv()
    tv.maxData = 256 * 1024
    for (const p of ['com.tcl.cyberui', 'com.netflix.ninja', 'com.tcl.tguard']) tv.packages.set(p, 'enabled')
    tv.home = 'com.tcl.cyberui/.Launcher'
    tv.homeClaims = ['com.tcl.cyberui/.Launcher', 'com.android.tv.settings/.FallbackHome']
    tv.packages.set('com.android.tv.settings', 'enabled')
    let port: number
    ;({ server, port } = await startFakeAdbd(tv))
    expect((await T.connect(`127.0.0.1:${port}`)).state).toBe('connected')
  })
  afterAll(() => { T.disconnect(); server.close() })

  it('knows the vendor launchers upstream lists name', () => {
    expect(D.stockLaunchers()).toEqual(expect.arrayContaining(['com.tcl.cyberui', 'com.jamdeo.tv.vod', 'ru.sberdevices.starlauncher']))
    expect(D.stockLaunchers()).not.toContain('com.android.tv.settings')
  })

  it('makes GlassMyTV Home and leaves a vendor launcher on, then gives Home back to it', async () => {
    const r = await G.install()
    expect(r.ok).toBe(true)
    expect(tv.home).toBe(OURS)
    expect(tv.packages.get('com.tcl.cyberui')).toBe('enabled')
    expect((await L.useStock()).ok).toBe(true)
    expect(tv.home).toBe('com.tcl.cyberui/.Launcher')
  })

  it('takes a launcher no list names as the stock one, and remembers it for Undo', async () => {
    tv.packages.delete('com.tcl.cyberui')
    tv.packages.set('com.acme.home', 'enabled')
    tv.homeClaims.push('com.acme.home/.Main')
    tv.home = 'com.acme.home/.Main'
    expect((await G.install()).ok).toBe(true)
    expect(tv.home).toBe(OURS)
    expect(tv.packages.get('com.acme.home')).toBe('enabled')
    expect((await L.useStock()).ok).toBe(true)
    expect(tv.home).toBe('com.acme.home/.Main')
  })

  it("asks which launcher is the TV's own when Android's chooser can't tell, and uses the pick", async () => {
    tv.packages.set('com.acme.other', 'enabled')
    tv.homeClaims.push('com.acme.other/.Main')
    tv.home = 'android/com.android.internal.app.ResolverActivity'
    const r = await G.install()
    expect(r.ok).toBe(false)
    expect(r.stockChoices).toEqual(['com.acme.home', 'com.acme.other'])
    expect(tv.home).toBe('android/com.android.internal.app.ResolverActivity')
    await expect(G.install('com.netflix.ninja')).rejects.toThrow(/can't be Home/)
    expect((await G.install('com.acme.home')).ok).toBe(true)
    expect(tv.home).toBe(OURS)
    expect(tv.packages.get('com.acme.home')).toBe('enabled')
  })

  it('switches off a package added by hand, shows it in the list after, and restores it', async () => {
    const all = await D.tvPackages()
    expect(all.map((e) => e.pkg)).toContain('com.tcl.tguard')
    expect(all.map((e) => e.pkg)).not.toContain('com.android.tv.settings')
    expect((await D.apply({ listId: 'custom', disable: ['com.tcl.tguard'], enable: [] })).ok).toBe(true)
    expect(tv.packages.get('com.tcl.tguard')).toBe('disabled')
    const plan = await D.plan('custom')
    expect(plan.entries.find((e) => e.pkg === 'com.tcl.tguard')).toMatchObject({ added: true, state: 'disabled', recorded: 'enabled' })
    expect((await D.restore('custom')).ok).toBe(true)
    expect(tv.packages.get('com.tcl.tguard')).toBe('enabled')
  })
})

describe('Google TV 14, where setupwraith outranks the Home preference (#40)', () => {
  let tv: FakeTv
  let server: Server
  const LX = 'com.google.android.apps.tv.launcherx/.home.HomeActivity'
  beforeAll(async () => {
    tv = newTv()
    tv.maxData = 256 * 1024
    for (const p of ['com.google.android.apps.tv.launcherx', D.SETUPWRAITH, 'com.android.tv.settings']) tv.packages.set(p, 'enabled')
    tv.home = LX
    tv.homeClaims = [LX, `${D.SETUPWRAITH}/.RecoveryActivity`, 'com.android.tv.settings/.FallbackHome']
    tv.homeOutranks = [LX, `${D.SETUPWRAITH}/.RecoveryActivity`]
    tv.wifiOwners = `cname=${D.SETUPWRAITH}`
    let port: number
    ;({ server, port } = await startFakeAdbd(tv))
    expect((await T.connect(`127.0.0.1:${port}`)).state).toBe('connected')
  })
  afterAll(() => { T.disconnect(); server.close() })

  it('leaves both on and says to re-join the Wi-Fi when the saved network belongs to setupwraith', async () => {
    const r = await G.install()
    expect(r.ok).toBe(false)
    expect(r.warnings.join('\n')).toMatch(/forget the network and join it again/)
    expect(tv.home).toBe(LX)
    expect(tv.packages.get('com.google.android.apps.tv.launcherx')).toBe('enabled')
    expect(tv.packages.get(D.SETUPWRAITH)).toBe('enabled')
  })

  it('switches setupwraith off itself once the Wi-Fi is the system\'s, so Home sticks', async () => {
    // Joined again after setup: the network in use is the system's, an old one is setupwraith's.
    tv.wifiOwners = 'WifiConfigManager - Configured networks Begin ----\n' +
      `- DSBLE ID: 0 SSID: "Old" PROVIDER-NAME: null\n cuid=10023 cname=${D.SETUPWRAITH}\n` +
      '* ID: 1 SSID: "Home" PROVIDER-NAME: null\n cuid=1000 cname=android.uid.system:1000\n' +
      'WifiConfigManager - Configured networks End ----\n'
    const r = await G.install()
    expect(r.ok).toBe(true)
    expect(r.warnings.join('\n')).toMatch(/One other saved Wi-Fi network from the TV's first setup went with setupwraith/)
    expect(tv.home).toBe(OURS)
    expect(tv.packages.get('com.google.android.apps.tv.launcherx')).toBe('disabled')
    expect(tv.packages.get(D.SETUPWRAITH)).toBe('disabled')
  })

  it('turns setupwraith back on when Home goes back to the stock launcher', async () => {
    expect((await L.useStock()).ok).toBe(true)
    expect(tv.home).toBe(LX)
    expect(tv.packages.get(D.SETUPWRAITH)).toBe('enabled')
  })

  it('puts both back when Home still does not stick', async () => {
    tv.homeOutranks = [LX, `${D.SETUPWRAITH}/.RecoveryActivity`, 'com.android.tv.settings/.FallbackHome']
    const r = await G.install()
    tv.homeOutranks = [LX, `${D.SETUPWRAITH}/.RecoveryActivity`]
    expect(r.ok).toBe(false)
    expect(tv.home).toBe(LX)
    expect(tv.packages.get('com.google.android.apps.tv.launcherx')).toBe('enabled')
    expect(tv.packages.get(D.SETUPWRAITH)).toBe('enabled')
  })
})
