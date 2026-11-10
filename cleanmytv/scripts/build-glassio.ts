// Builds GlassMyTV's release APK from ../glassio and lays it where the desktop app reads it at launch:
// resources/glassio.apk plus glassio.json (its versionName, so the Launcher step can tell when the TV
// runs an older copy). Signing comes from ../glassio/local.properties or the environment, as the
// launcher's own build.gradle.kts reads it; without a key the build falls back to the debug key.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const launcher = join(process.cwd(), '..', 'glassio')
const gradlew = join(launcher, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')
const gradleFile = join(launcher, 'app', 'build.gradle.kts')
const apk = join(launcher, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
const out = join(process.cwd(), 'resources')

if (!existsSync(gradleFile)) {
  throw new Error(`no launcher at ${launcher}: clone it next to cleanmytv, or set the path in glassio/local.properties.`)
}

const build = readFileSync(gradleFile, 'utf8')
const versionName = /versionName\s*=\s*"([^"]+)"/.exec(build)?.[1]
const versionCode = /versionCode\s*=\s*(\d+)/.exec(build)?.[1]
if (!versionName || !versionCode) throw new Error(`no versionCode/versionName in ${gradleFile}`)

console.log(`building GlassMyTV ${versionName} (${versionCode})`)
execFileSync(gradlew, [':app:assembleRelease', '--console=plain'], { cwd: launcher, stdio: 'inherit' })
if (!existsSync(apk)) throw new Error(`the build finished without ${apk}`)

mkdirSync(out, { recursive: true })
copyFileSync(apk, join(out, 'glassio.apk'))
writeFileSync(join(out, 'glassio.json'), JSON.stringify({ versionName, versionCode: Number(versionCode) }, null, 2) + '\n')
const mb = (statSync(apk).size / (1024 * 1024)).toFixed(1)
console.log(`resources/glassio.apk and resources/glassio.json written (${mb} MB)`)
