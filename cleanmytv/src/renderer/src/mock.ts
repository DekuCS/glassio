// A fake TV for viewing the UI in a plain browser (npm run dev without Electron, or vite preview).
// Installed only when the preload script did not provide window.cytv.
import type {
  ApplyResult,
  CheckItem,
  ConnStatus,
  CytvApi,
  KnownTv,
  DebloatEntry,
  DebloatPlan,
  DownloadProgress,
  LogLine,
  Probe,
  SystemState,
  ToolId
} from '@shared/api'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export function installMock(): void {
  if (window.cytv) return

  const logs = new Set<(l: LogLine) => void>()
  const progress = new Set<(p: DownloadProgress) => void>()
  const statuses = new Set<(s: ConnStatus) => void>()
  const log = (task: string, level: LogLine['level'], text: string): void =>
    logs.forEach((cb) => cb({ task, level, text, time: Date.now() }))

  const probe: Probe = {
    host: '192.168.1.50',
    model: 'K-65XR90M2',
    device: 'BRAVIA_AE3',
    product: 'BRAVIA_AE3_PA',
    manufacturer: 'Sony',
    release: '14',
    sdk: 34,
    build: 'UKN4.250422.001',
    adbSecure: '1'
  }
  // ?connected opens the mock already connected, for looking at the later steps.
  let status: ConnStatus = new URLSearchParams(location.search).has('connected')
    ? { state: 'connected', host: probe.host, probe }
    : { state: 'idle' }
  const setStatus = (s: ConnStatus): void => {
    status = s
    statuses.forEach((cb) => cb(s))
  }

  const tools: Record<ToolId, boolean> = { jdk: false, sdk: false, 'platform-tools': false }
  let launcherInstalled = false
  let launcherHome = false
  let homeInstalled = false
  let homeIsHome = false
  let tvs: KnownTv[] = [
    { host: '192.168.1.50', device: 'BRAVIA_AE3', model: 'K-65XR90M2', manufacturer: 'Sony', lastUsed: Date.now() - 3600_000 },
    { host: '192.168.1.62', device: 'oneday', model: 'MIBOX4', manufacturer: 'Xiaomi', lastUsed: Date.now() - 86400_000 }
  ]

  const entries: DebloatEntry[] = [
    ['com.sony.dtv.promos', 'sponsored rows on Home', true, 'enabled', 41],
    ['com.google.android.apps.tv.launcherx', 'stock launcher; disable after the new one is Home', true, 'enabled', 38],
    ['com.google.android.tungsten.setupwraith', 'its RecoveryActivity otherwise takes over Home', true, 'enabled', 33],
    ['com.sony.dtv.discovery', 'Discover row', true, 'enabled', 12],
    ['com.google.android.apps.tv.dreamx', 'Google screensaver', true, 'enabled', 29],
    ['com.google.android.feedback', 'feedback reporter', true, 'disabled', 52],
    ['com.sony.dtv.smarthelp', 'Help app', true, 'enabled', 9],
    ['com.sony.dtv.analytics', 'usage analytics', true, 'enabled', 11],
    ['com.google.android.tts', 're-enable if you use accessibility speech', false, 'enabled', 18],
    ['com.sony.dtv.airplayapp', 'AirPlay; kept by owner', false, 'enabled', 3],
    ['com.sony.dtv.bravia.cam', 'BRAVIA CAM', false, 'absent', 2],
    ['com.sony.dtv.osat.album', 'Album app', true, 'enabled', 6]
  ].map(([pkg, note, suggested, state, common]) => ({
    pkg: pkg as string,
    note: note as string,
    suggested: suggested as boolean,
    state: state as DebloatEntry['state'],
    common: common as number
  }))
  let record: DebloatPlan['record']

  const ok = (summary: string, warnings: string[] = []): ApplyResult => ({ ok: true, summary, warnings })

  const sys: SystemState = {
    sdk: 34,
    privateDnsMode: 'opportunistic',
    privateDnsHost: '',
    animationScale: '1.0',
    storage: { freeKb: 831000, totalKb: 5806884 }
  }

  async function fakeDownload(tool: keyof typeof tools): Promise<ApplyResult> {
    const total = tool === 'jdk' ? 190e6 : tool === 'sdk' ? 160e6 : 12e6
    for (let r = 0; r <= total; r += total / 20) {
      progress.forEach((cb) => cb({ tool, received: r, total, phase: 'download' }))
      await wait(80)
    }
    progress.forEach((cb) => cb({ tool, received: total, total, phase: 'extract' }))
    await wait(400)
    progress.forEach((cb) => cb({ tool, received: total, total, phase: 'done' }))
    tools[tool] = true
    log('download', 'ok', `${tool} ready`)
    return ok(`${tool} downloaded`)
  }

  const api: CytvApi = {
    platform: 'darwin',
    async scan() {
      await wait(1200)
      return [{ host: '192.168.1.50' }, { host: '192.168.1.73' }]
    },
    async discover() {
      return [
        { host: '192.168.1.50', name: 'Living Room TV', ready: true },
        { host: '192.168.1.73', name: 'Bedroom Chromecast', ready: false, connectPort: 41827, pairPort: 37145 },
        { host: '192.168.1.81', name: 'Den TV', ready: false }
      ]
    },
    async stopDiscovery() {},
    async connect(host) {
      setStatus({ state: 'connecting', host })
      await wait(700)
      if (host === '192.168.1.73') {
        const s: ConnStatus = { state: 'error', host, needsPairing: true, error: 'The TV answered but wants Wireless debugging pairing first.' }
        setStatus(s)
        return s
      }
      setStatus({ state: 'waiting-auth', host })
      await wait(2500)
      const s: ConnStatus = { state: 'connected', host, probe: { ...probe, host } }
      setStatus(s)
      log('connect', 'ok', `Connected to ${probe.manufacturer} ${probe.model}`)
      return s
    },
    async disconnect() {
      setStatus({ state: 'idle' })
    },
    async status() {
      return status
    },
    async lastHost() {
      return '192.168.1.50'
    },
    async reconnect() {
      return null
    },
    async checkAdbClosed(host) {
      await wait(800)
      return { closed: true, message: `${host}:5555 is closed: the TV refused the connection.` }
    },
    async checkUpdate() {
      return { current: '0.2.1', latest: '0.3.0', available: true, url: 'https://github.com/wingedpanther/cleanmytv/releases/tag/v0.3.0' }
    },
    async bootCheck() {
      await wait(2500)
      return { ok: true, reconnected: true, summary: 'The TV restarted and its home screen came up (io.github.wingedpanther.cleanmytv.home).' }
    },
    async pair(host) {
      log('pair', 'cmd', `adb pair ${host}`)
      await wait(1500)
      return ok('Paired. Port 5555 is open until the next reboot.')
    },
    async checks() {
      await wait(300)
      const connected = status.state === 'connected'
      const items: CheckItem[] = [
        { id: 'network', label: 'This computer is on a network', status: 'ok', detail: 'Wi-Fi, 192.168.1.20' },
        { id: 'tv', label: 'TV answers on port 5555', status: connected ? 'ok' : 'missing', detail: connected ? `${status.host}` : 'Turn on USB debugging on the TV, then find it below.' },
        { id: 'auth', label: 'TV allows this computer', status: connected ? 'ok' : 'missing', detail: connected ? 'Allowed' : 'The TV asks once. Choose Allow.' },
        { id: 'platform-tools', label: "Google's adb (only for pairing)", status: tools['platform-tools'] ? 'ok' : 'optional', detail: 'Some Google TVs need a one-time pairing code.', download: tools['platform-tools'] ? undefined : 'platform-tools' }
      ]
      return items
    },
    async bugReport() {
      return 'GlassMyTV 0.0.0-dev, darwin 25.0.0 arm64\nTV: Sony BRAVIA 4K VH2 (device BRAVIA_VH2, product BRAVIA_VH2_EU), Android 12 (SDK 31), build mock'
    },
    download: (tool) => fakeDownload(tool),
    async lists() {
      await wait(200)
      return [
        { id: 'custom', title: 'My TV is not listed: pick from packages other TVs disable', score: 0 },
        { id: 'sony-bravia-9-ii', title: 'Sony BRAVIA 9 II, K-65XR90M2 (2026, device BRAVIA_AE3, MediaTek MT5838)', score: 9 },
        { id: 'sony-bravia-4k-ae2', title: 'Sony BRAVIA 4K AE2 (BRAVIA_AE2, MediaTek MT5897), North America', score: 3 },
        { id: 'tcl-g10-google-tv', title: 'TCL 55" 4K Google TV, 2023 (G10, Realtek RTD2875P)', score: 0 },
        { id: 'xiaomi-mi-box-s', title: 'Xiaomi Mi Box S (MIBOX4, oneday), streaming box', score: 0 },
        { id: 'philips-r8g-google-tv', title: 'Philips R8G Google TV (MOKA, Realtek RTD2851F), US', score: 0 }
      ]
    },
    async tvPackages() {
      await wait(300)
      return ['com.tcl.tguard', 'com.tcl.usercenter', 'com.android.vending', 'com.netflix.ninja'].map((pkg) => ({ pkg, note: '', suggested: true, state: 'enabled' as const, common: pkg === 'com.tcl.tguard' ? 12 : 0, added: true }))
    },
    async plan(listId) {
      await wait(500)
      return {
        listId,
        title: 'Sony BRAVIA 9 II, K-65XR90M2 (2026, device BRAVIA_AE3, MediaTek MT5838)',
        header: ['Google TV 14 (API 34), build UKN4.250422.001.', 'Everything is DISABLED, not uninstalled.'],
        entries: entries.map((e) => ({ ...e })),
        record,
        homePackage: launcherHome ? 'com.gathin.tvhome' : 'com.google.android.apps.tv.launcherx'
      }
    },
    async applyDebloat(req) {
      log('debloat', 'info', 'Recording the current state first')
      await wait(500)
      if (!record) record = { path: '~/.cleanyourtv/recovery-192.168.1.50-3fa1b2c4.json', created: new Date().toISOString() }
      const warnings: string[] = []
      for (const pkg of req.disable) {
        const e = entries.find((x) => x.pkg === pkg)
        if (pkg === 'com.google.android.apps.tv.launcherx' && !launcherHome && !req.forceHome) {
          warnings.push('Skipped com.google.android.apps.tv.launcherx: it owns Home. Install the new launcher first, then apply again.')
          continue
        }
        log('debloat', 'cmd', `pm disable-user --user 0 ${pkg}`)
        await wait(120)
        if (e) {
          e.recorded ??= e.state
          e.state = 'disabled'
        }
      }
      for (const pkg of req.enable) {
        log('debloat', 'cmd', `pm enable ${pkg}`)
        const e = entries.find((x) => x.pkg === pkg)
        if (e) e.state = 'enabled'
      }
      return ok(`Disabled ${req.disable.length - warnings.length} packages, switched ${req.enable.length} back on.`, warnings)
    },
    async restore() {
      await wait(900)
      entries.forEach((e) => {
        if (e.recorded) e.state = e.recorded
      })
      log('restore', 'ok', 'Restored the recorded state')
      return ok('Put back the state recorded before the first change.')
    },
    async useStockLauncher() {
      launcherHome = false
      homeIsHome = false
      return ok('Home belongs to com.google.android.apps.tv.launcherx again.')
    },
    async launcherStatus() {
      await wait(200)
      return { oldLauncher: launcherInstalled, installed: homeInstalled, versionName: homeInstalled ? '1.0.0' : undefined, isHome: homeIsHome, bundled: true, bundledVersion: '1.0.0' }
    },
    async removeOldLauncher() {
      await wait(800)
      launcherInstalled = false
      return ok('Removed from the TV: com.gathin.tvhome.')
    },
    async installLauncher() {
      for (const text of ['pm install -r -d /data/local/tmp/glassmytv.apk', 'am start -W -n com.glasslauncher.tv/.MainActivity']) {
        log('install', 'cmd', text)
        await wait(500)
      }
      homeInstalled = true
      homeIsHome = true
      launcherHome = false
      return ok('GlassMyTV is Home now. Press Home on the remote to see it.')
    },
    async useLauncher() {
      await wait(600)
      homeIsHome = true
      launcherHome = false
      return ok('Switched. Press Home on the remote to see it.')
    },
    async knownTvs() {
      return tvs.map((t) => ({ ...t }))
    },
    async connectKnown(host) {
      return api.connect(host)
    },
    async forgetTv(host) {
      tvs = tvs.filter((t) => t.host !== host)
      return tvs.map((t) => ({ ...t }))
    },
    async saveTvThumb(host, dataUrl) {
      tvs = tvs.map((t) => (t.host === host ? { ...t, thumb: dataUrl, thumbAt: Date.now() } : t))
      return tvs.map((t) => ({ ...t }))
    },
    async screenshot() {
      await wait(900)
      return gradientUrl('#101820', '#0b2a3a', '#000000')
    },
    async thumbShot() {
      return gradientUrl('#101820', '#0b2a3a', '#000000')
    },
    async webGet(url) {
      if (!url.startsWith('https://geocoding-api.open-meteo.com/')) throw new Error('Background sources need the desktop app.')
      const results = [{ name: 'Dublin', admin1: 'Leinster', country: 'Ireland', latitude: 53.3331, longitude: -6.2489 }, { name: 'Dublin', admin1: 'Ohio', country: 'United States', latitude: 40.0992, longitude: -83.1141 }]
      return { status: 200, contentType: 'application/json', base64: btoa(JSON.stringify({ results })) }
    },
    async systemState() {
      return { ...sys }
    },
    async setPrivateDns(host) {
      sys.privateDnsMode = host ? 'hostname' : 'opportunistic'
      sys.privateDnsHost = host ?? ''
      return ok(host ? `Private DNS set to ${host}.` : 'Private DNS back to automatic.')
    },
    async clearCaches() {
      if (sys.storage) sys.storage = { ...sys.storage, freeKb: sys.storage.freeKb + 412000 }
      return ok("Cleared every app's cache: 402 MB back, 1210 MB free now.")
    },
    async sideloadInfo(path) {
      await wait(400)
      return { file: path.split('/').pop() ?? 'app.apk', size: 24_500_000, package: 'org.videolan.vlc', versionName: '3.6.4', installed: null }
    },
    async sideload() {
      for (let i = 1; i <= 20; i++) { await wait(80); progress.forEach((cb) => cb({ tool: 'sideload', received: i, total: 20, phase: 'install' })) }
      progress.forEach((cb) => cb({ tool: 'sideload', received: 1, total: 1, phase: 'done' }))
      return { ok: true, summary: "Installed org.videolan.vlc 3.6.4. It's in Home's app list now.", warnings: [] }
    },
    pathForFile(file) { return '/Users/you/Downloads/' + file.name },
    async fixScreensaver() {
      await wait(900)
      return { ok: true, summary: "Google's screensaver is back: 2 apps switched on again, and it is the screensaver now.", warnings: ["Choose your albums in the TV's Settings → System → Ambient mode."] }
    },
    async setAnimationScale(scale) {
      sys.animationScale = String(scale)
      return ok(`Animation speed set to ${scale}x.`)
    },
    async key(code) {
      log('system', 'cmd', `input keyevent ${code}`)
    },
    async reboot() {
      log('system', 'cmd', 'reboot')
      setStatus({ state: 'idle' })
    },
    onLog(cb) {
      logs.add(cb)
      return () => logs.delete(cb)
    },
    onProgress(cb) {
      progress.add(cb)
      return () => progress.delete(cb)
    },
    onStatus(cb) {
      statuses.add(cb)
      return () => statuses.delete(cb)
    }
  }
  window.cytv = api
}

function gradientUrl(a: string, b: string, c: string): string {
  const canvas = document.createElement('canvas')
  canvas.width = 320
  canvas.height = 180
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  const g = ctx.createLinearGradient(0, 0, 320, 180)
  g.addColorStop(0, a)
  g.addColorStop(0.55, b)
  g.addColorStop(1, c)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 320, 180)
  return canvas.toDataURL('image/jpeg', 0.8)
}
