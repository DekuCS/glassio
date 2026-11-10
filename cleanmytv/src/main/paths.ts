import { join } from 'node:path'

let resourcesDir = join(process.cwd(), 'resources')
let dataDir = join(process.cwd(), '.cytv-data')

/** resources: bundled upstream lists, GlassMyTV's APK and the signing key. data: the app's own writable folder. */
export function configurePaths(resources: string, data: string): void {
  resourcesDir = resources
  dataDir = data
}

export const paths = {
  get resources(): string { return resourcesDir },
  get data(): string { return dataDir },
  get upstream(): string { return join(resourcesDir, 'upstream') },
  get examples(): string { return join(resourcesDir, 'upstream', 'examples') },
  get bundledGlassioApk(): string { return join(resourcesDir, 'glassio.apk') },
  get bundledGlassioInfo(): string { return join(resourcesDir, 'glassio.json') },
  get adbKey(): string { return join(dataDir, 'adbkey') },
  get tools(): string { return join(dataDir, 'tools') },
  get settings(): string { return join(dataDir, 'settings.json') }
}
