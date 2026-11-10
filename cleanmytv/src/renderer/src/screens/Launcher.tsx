// GlassMyTV on the TV: one card to put it there and take Home back. Everything it can be configured
// for (layout, apps, look, screensaver, cameras, music) is set on the TV itself, with the remote.
import { useEffect, useState, type ReactNode } from 'react'
import type { ApplyResult, HomeStatus } from '@shared/api'
import type { ScreenProps } from '../App'
import { ActionButton, Busy, Confirm, ResultNotice, StatusChip, errorText } from '../components/ui'
import { thumbnail } from '../lib/image'

/** The TV has an older GlassMyTV than this app carries. */
const outdated = (h: HomeStatus): boolean => h.installed && !!h.bundledVersion && h.versionName !== h.bundledVersion

interface StockPick {
  label: string
  choices: string[]
  retry: (stock: string) => Promise<ApplyResult>
}

export function Launcher({ markDone, refreshTvs, status, homeSeen }: ScreenProps): ReactNode {
  const [home, setHome] = useState<HomeStatus | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<ApplyResult | null>(null)
  const [askStock, setAskStock] = useState(false)
  const [stockPick, setStockPick] = useState<StockPick | null>(null)
  const [shot, setShot] = useState<string | null>(null)
  const [shooting, setShooting] = useState(false)
  const [shotError, setShotError] = useState<string | null>(null)

  async function load(): Promise<void> {
    try {
      const h = await window.cytv.launcherStatus()
      setHome(h)
      homeSeen(h)
    } catch (e) {
      setResult({ ok: false, summary: errorText(e), warnings: [] })
    }
  }
  useEffect(() => {
    load()
  }, [])

  /** `retry` runs the same step again with the stock launcher the owner picks, when the app can't tell (#39). */
  async function run(label: string, fn: () => Promise<ApplyResult>, retry?: (stock: string) => Promise<ApplyResult>): Promise<void> {
    setBusy(label)
    setResult(null)
    setStockPick(null)
    try {
      const r = await fn()
      setResult(r)
      if (r.stockChoices && retry) setStockPick({ label, choices: r.stockChoices, retry })
      if (r.ok) markDone('home')
    } catch (e) {
      setResult({ ok: false, summary: errorText(e), warnings: [] })
    } finally {
      setBusy(null)
      load()
    }
  }

  async function snapshot(): Promise<void> {
    setShooting(true)
    setShotError(null)
    try {
      const s = await window.cytv.screenshot()
      setShot(s)
      if (status.host) {
        await window.cytv.saveTvThumb(status.host, await thumbnail(s))
        refreshTvs()
      }
    } catch (e) {
      setShot(null)
      setShotError(errorText(e))
    } finally {
      setShooting(false)
    }
  }

  return (
    <>
      <h1>Launcher</h1>
      <p className="lede">
        GlassMyTV is the TV's new home screen: no ads, your apps, your layout. Install it once here; everything else — layout,
        apps, look, screensaver, cameras, music — is set on the TV itself with the remote (the gear in the top right).
      </p>
      <ResultNotice result={result} onDismiss={() => setResult(null)} />
      {stockPick && !busy && (
        <StockPicker
          pick={stockPick}
          onPick={(stock) => run(stockPick.label, () => stockPick.retry(stock), stockPick.retry)}
          onCancel={() => setStockPick(null)}
        />
      )}
      {busy && (
        <div className="notice">
          <Busy text={busy} />
        </div>
      )}

      {!home ? (
        <Busy text="Asking the TV about GlassMyTV" />
      ) : (
        <>
          <div className="card white">
            <div className="card-head">
              <h2>On this TV</h2>
              <StatusChip status={home.isHome ? 'ok' : home.installed ? 'warn' : 'optional'} text={home.isHome ? 'Is Home' : home.installed ? 'Installed, not Home' : 'Not installed'} />
            </div>
            <div className="facts">
              <div>
                <span>On the TV</span>
                <b>{home.installed ? `version ${home.versionName ?? '?'}` : 'not installed'}</b>
              </div>
              <div>
                <span>In this app</span>
                <b>{home.bundled ? `version ${home.bundledVersion ?? '?'}` : 'no bundled copy'}</b>
              </div>
            </div>
            {home.unsupported && (
              <div className="notice warn" style={{ marginTop: 16, marginBottom: 0 }}>
                {home.unsupported}
              </div>
            )}
            <div className="row" style={{ marginTop: 16 }}>
              {(!home.installed || outdated(home)) && (
                <ActionButton
                  primary
                  phase={busy?.startsWith('Installing') ? 'busy' : 'idle'}
                  label={home.installed ? 'Update and use' : 'Install and use'}
                  busyLabel={home.installed ? 'Updating' : 'Installing'}
                  disabled={!!busy || !home.bundled || !!home.unsupported}
                  onClick={() => run('Installing GlassMyTV. Keep the TV on.', () => window.cytv.installLauncher(), (s) => window.cytv.installLauncher(s))}
                />
              )}
              {home.installed && !home.isHome && (
                <button className="btn primary" disabled={!!busy} onClick={() => run('Switching Home to GlassMyTV', () => window.cytv.useLauncher(), (s) => window.cytv.useLauncher(s))}>
                  Use GlassMyTV
                </button>
              )}
              {home.isHome && (
                <button className="btn" disabled={!!busy} onClick={() => setAskStock(true)}>
                  Give Home back to the stock launcher
                </button>
              )}
            </div>
            {home.oldLauncher && (
              <div className="notice" style={{ marginTop: 16, marginBottom: 0 }}>
                <p style={{ margin: '0 0 10px' }}>
                  A launcher from an earlier version of this app is still on the TV. GlassMyTV replaces it.
                  {!home.isHome && ' Install or switch to GlassMyTV first.'}
                </p>
                <button className="btn small" disabled={!!busy || !home.isHome} onClick={() => run('Removing the old launcher', () => window.cytv.removeOldLauncher())}>
                  Remove the old launcher
                </button>
              </div>
            )}
          </div>

          <div className="card">
            <h2>What's on the TV</h2>
            <p className="small muted">
              Press <b>Home</b> on the remote, then the gear in the top right. GlassMyTV's own settings cover the carousel and its
              catalogs, the dock and icons, the menu and its themes, the glass, the screensaver, cameras, Hue lights, Home Assistant,
              music, the phone remote, backups and the update check.
            </p>
            <p className="small muted">
              Two of its sections borrow this connection: System → TV access (ADB) for the Nuvio log, and System → Home button for the
              Home-key service. Both are granted here when GlassMyTV is installed.
            </p>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>What the TV shows</h2>
              <button className="btn small" onClick={snapshot} disabled={shooting}>
                {shooting ? 'Taking a snapshot…' : 'Take a snapshot'}
              </button>
            </div>
            {shotError && <div className="notice warn">{shotError}</div>}
            {shot ? (
              <img src={shot} alt="The TV screen" style={{ width: '100%', borderRadius: 10, border: '1px solid var(--line)' }} />
            ) : (
              <p className="muted small">A picture of the TV screen right now. It also becomes this TV's thumbnail in the sidebar.</p>
            )}
          </div>
        </>
      )}

      {askStock && (
        <Confirm
          title="Use the stock launcher again?"
          confirmLabel="Switch back"
          onConfirm={() => {
            setAskStock(false)
            run('Giving Home back to the stock launcher', () => window.cytv.useStockLauncher())
          }}
          onCancel={() => setAskStock(false)}
        >
          <p>The app switches the TV's own launcher back on and makes it Home. GlassMyTV stays installed, so you can switch again.</p>
        </Confirm>
      )}
    </>
  )
}

function StockPicker({ pick, onPick, onCancel }: { pick: StockPick; onPick: (stock: string) => void; onCancel: () => void }): ReactNode {
  const [chosen, setChosen] = useState(pick.choices.length === 1 ? pick.choices[0] : '')
  return (
    <div className="card white">
      <h2>Which one is the TV's own launcher?</h2>
      {pick.choices.length === 0 ? (
        <p className="muted">
          Nothing on the TV can be Home apart from GlassMyTV, so there is no launcher to fall back on. Leave it as it is and report
          your TV model on GitHub.
        </p>
      ) : (
        <>
          <p className="small muted">
            These apps can be Home on this TV. Pick the one the TV came with. It stays on, and Undo and the restart check give Home
            back to it.
          </p>
          <div className="place-list" role="radiogroup">
            {pick.choices.map((c) => (
              <label key={c} className="row" style={{ gap: 8 }}>
                <input type="radio" name="stock" checked={chosen === c} onChange={() => setChosen(c)} />
                <span className="mono">{c}</span>
              </label>
            ))}
          </div>
        </>
      )}
      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn primary" disabled={!chosen} onClick={() => onPick(chosen)}>
          Use this one and carry on
        </button>
        <button className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
