// The contract between the main process (talks to the TV) and the renderer (the UI).
// Every call goes through window.cytv, which the preload script builds from this interface.

export type PackageState = 'enabled' | 'disabled' | 'absent'

export interface Probe {
  host: string
  model: string
  device: string
  product: string
  manufacturer: string
  /** Android version, e.g. "11". */
  release: string
  sdk: number
  build: string
  /** "0" means port 5555 accepts any device on the network without the Allow prompt. */
  adbSecure: string
}

export type ConnState = 'idle' | 'connecting' | 'waiting-auth' | 'connected' | 'error'

export interface ConnStatus {
  state: ConnState
  host?: string
  /** Plain-language reason when state is error. */
  error?: string
  /** The port answered but asked for TLS: Wireless debugging needs a one-time pairing. */
  needsPairing?: boolean
  /**
   * Set by reconnect: the saved TV is not (or no longer) at the saved address. The user picks it from a
   * scan; the app never handshakes with scanned devices on its own.
   */
  moved?: boolean
  probe?: Probe
}

export interface ScanHit {
  host: string
}

/** A TV that advertised itself on the network. Finding one never logs in to it. */
export interface FoundTv {
  host: string
  /** The TV's own name, when it advertises one. */
  name: string
  /** Port 5555 is open: no pairing needed. */
  ready: boolean
  /** Wireless debugging's connect port, when it is on. */
  connectPort?: number
  /** Only while the TV's pairing screen is open. */
  pairPort?: number
}

export type CheckStatus = 'ok' | 'missing' | 'warn' | 'optional' | 'checking'

export interface CheckItem {
  id: 'network' | 'tv' | 'auth' | 'apk' | 'jdk' | 'sdk' | 'source' | 'platform-tools'
  label: string
  status: CheckStatus
  detail: string
  /** A download the app can do for the user, by ToolId. */
  download?: ToolId
}

export type ToolId = 'jdk' | 'sdk' | 'platform-tools'

export interface DebloatListSummary {
  /** Folder name in upstream examples/, or "custom". */
  id: string
  /** First header line of the list, without the leading "# ". */
  title: string
  /** Higher is a better match for the connected TV; 0 = no match. */
  score: number
}

export interface DebloatEntry {
  pkg: string
  /** The list's inline comment for this package. */
  note: string
  /** In the list as an active line (true) or commented out by the author (false). */
  suggested: boolean
  /** Live state on the TV; absent when the package is not installed. */
  state: PackageState
  /** State in the recovery record, when one exists for this TV and list. */
  recorded?: PackageState
  /** How many of the upstream lists disable this package. */
  common: number
  /**
   * Set when switching this package off loses something people use (the phone remote, casting, voice)
   * or the list puts it under "Personal choice"/"Optional": not ticked unless the user ticks it.
   */
  choice?: string
  /** Added by the owner, not from the list. */
  added?: boolean
}

export interface DebloatPlan {
  listId: string
  title: string
  header: string[]
  entries: DebloatEntry[]
  /** Recovery record for this TV and list, if one was written earlier. */
  record?: { path: string; created: string }
  /** Package that owns Home right now. */
  homePackage: string | null
  /** Packages this app switched off on this TV that are on again, like after a firmware update. */
  cameBack?: string[]
}

export interface DebloatApplyRequest {
  listId: string
  /** Packages to disable, from the plan's entries. */
  disable: string[]
  /** Packages to switch back on now (unticked after an earlier run). */
  enable: string[]
  forceHome?: boolean
  forceSetupwraith?: boolean
}

export interface ApplyResult {
  ok: boolean
  /** One line for the user. */
  summary: string
  /** Things that were skipped or need the user's attention. */
  warnings: string[]
  /** The stock launcher couldn't be found: the apps that can be Home, for the owner to pick from. */
  stockChoices?: string[]
}

/** The newest release of this app on GitHub. */
export interface UpdateInfo {
  current: string
  /** The newest release on GitHub, if the app has heard. */
  latest?: string
  available: boolean
  /** Its release page. */
  url?: string
}

export interface BootCheckResult {
  ok: boolean
  /** The app got the TV back after the restart. */
  reconnected: boolean
  summary: string
  /** What to do next when it failed. */
  advice?: string
}

/** GlassMyTV on the TV. Everything it can be configured for is on the TV itself. */
export interface HomeStatus {
  installed: boolean
  versionName?: string
  isHome: boolean
  /** This copy of the desktop app carries it. */
  bundled: boolean
  bundledVersion?: string
  /** A launcher from an earlier version of this app (CleanYourTV or CleanMyTV Home) is still on the TV. */
  oldLauncher: boolean
  /** Why GlassMyTV can't go on this TV (Android older than 8). */
  unsupported?: string
}

/** A TV this app has connected to before. */
export interface KnownTv {
  host: string
  device?: string
  model?: string
  manufacturer?: string
  /** A small JPEG snapshot of the TV screen, as a data URL. */
  thumb?: string
  thumbAt?: number
  lastUsed: number
}

export interface InstallResult extends ApplyResult {
  /** The installed launcher was signed with another key; ask before replacing it. */
  incompatible?: boolean
}

export interface ImageFile {
  name: string
  /** JPEG bytes, base64, already sized for the TV by the renderer. */
  base64: string
}

export interface SystemState {
  sdk: number
  privateDnsMode: string
  privateDnsHost: string
  /** window_animation_scale; "null" when never set. */
  animationScale: string
  /** /data in KB; null when df can't tell. */
  storage: { freeKb: number; totalKb: number } | null
}

/** An .apk the owner picked, read before it goes to the TV. */
export interface SideloadInfo {
  file: string
  size: number
  package: string
  versionName: string | null
  /** The version on the TV now, or null when it isn't installed. */
  installed: string | null
}

export interface DownloadProgress {
  /** A tool download, or 'sideload' while an app goes up to the TV. */
  tool: ToolId | 'sideload'
  received: number
  total: number
  phase: 'download' | 'extract' | 'install' | 'done' | 'error'
  message?: string
}

export interface LogLine {
  /** Which job wrote it: 'debloat', 'restore', 'install', 'theme', 'build', 'pair', 'system'. */
  task: string
  level: 'info' | 'cmd' | 'warn' | 'error' | 'ok'
  text: string
  time: number
}

/** A download for the background sources, made by the main process. */
export interface WebResponse {
  status: number
  contentType: string
  base64: string
}

export interface CytvApi {
  platform: 'darwin' | 'win32' | 'linux'

  // Connection
  scan(): Promise<ScanHit[]>
  /** TVs advertising themselves right now. Starts listening on the first call. */
  discover(): Promise<FoundTv[]>
  stopDiscovery(): Promise<void>
  connect(host: string): Promise<ConnStatus>
  disconnect(): Promise<void>
  status(): Promise<ConnStatus>
  lastHost(): Promise<string | null>
  /**
   * Connects to the TV used last time, at the address saved then, and checks the same model answers.
   * If it doesn't, the status has `moved` set and the user picks the TV from a scan. Null when no TV was saved.
   */
  reconnect(): Promise<ConnStatus | null>
  /** Port 5555 refuses or ignores connections (after debugging was switched off). */
  checkAdbClosed(host: string): Promise<{ closed: boolean; message: string }>
  /** Asks GitHub for a newer GlassMyTV, at most every 12 hours. */
  checkUpdate(): Promise<UpdateInfo>
  /** Restarts the TV, reconnects, and checks a home screen comes up; puts the stock launcher back if not. */
  bootCheck(): Promise<BootCheckResult>
  /** Wireless-debugging pairing with Google's adb (downloaded on demand), then opens port 5555. */
  pair(host: string, pairPort: number, code: string, connectPort: number): Promise<ApplyResult>

  /** App, computer and TV details for a bug report: no address, serial or settings. */
  bugReport(): Promise<string>

  // Readiness
  checks(): Promise<CheckItem[]>
  download(tool: ToolId): Promise<ApplyResult>

  // Debloat
  lists(): Promise<DebloatListSummary[]>
  plan(listId: string): Promise<DebloatPlan>
  /** Every package on the TV, to add one to a list by hand. */
  tvPackages(): Promise<DebloatEntry[]>
  applyDebloat(req: DebloatApplyRequest): Promise<ApplyResult>
  restore(listId: string): Promise<ApplyResult>

  // GlassMyTV
  /** Give Home back to the stock launcher, leaving GlassMyTV installed. */
  useStockLauncher(): Promise<ApplyResult>
  /** Uninstall the launchers earlier versions of this app installed, once one of them isn't Home. */
  removeOldLauncher(): Promise<ApplyResult>
  launcherStatus(): Promise<HomeStatus>
  /**
   * Installs or updates GlassMyTV and makes it Home, putting the TV's own launcher back if that fails.
   * `stock`: the TV's own launcher, when the owner picked it.
   */
  installLauncher(stock?: string): Promise<InstallResult>
  /** Makes the installed GlassMyTV the Home screen. */
  useLauncher(stock?: string): Promise<ApplyResult>

  // TVs
  /** TVs connected before, most recent first. */
  knownTvs(): Promise<KnownTv[]>
  /** Connect to a TV from that list, checking the same model answers there. */
  connectKnown(host: string): Promise<ConnStatus>
  forgetTv(host: string): Promise<KnownTv[]>
  /** Saves a small snapshot (JPEG data URL, under 200 KB) for the connected TV. */
  saveTvThumb(host: string, dataUrl: string): Promise<KnownTv[]>

  /** PNG of the TV screen as a data URL. */
  screenshot(): Promise<string>
  /** The same for the TV list's picture, taken in the background: null instead of an error. */
  thumbShot(): Promise<string | null>
  /** HTTPS GET from Bing only (the page itself has no network access). */
  webGet(url: string): Promise<WebResponse>

  // TV extras
  systemState(): Promise<SystemState>
  setPrivateDns(host: string | null): Promise<ApplyResult>
  setAnimationScale(scale: number): Promise<ApplyResult>
  /** Switches Google's Ambient screensaver apps back on and makes it the screensaver (#57). */
  fixScreensaver(): Promise<ApplyResult>
  /** What an .apk on this computer is, and the version the TV has. */
  sideloadInfo(path: string): Promise<SideloadInfo>
  /** Installs an .apk on this computer on the TV. */
  sideload(path: string): Promise<ApplyResult>
  /** The path of a file dropped on or picked in the window. */
  pathForFile(file: File): string
  /** Clears every app's cache on the TV. */
  clearCaches(): Promise<ApplyResult>
  key(keycode: number): Promise<void>
  reboot(): Promise<void>

  // Events
  onLog(cb: (line: LogLine) => void): () => void
  onProgress(cb: (p: DownloadProgress) => void): () => void
  onStatus(cb: (s: ConnStatus) => void): () => void
}

declare global {
  interface Window {
    cytv: CytvApi
  }
}
