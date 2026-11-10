# GlassMyTV

Ein Android-TV-Launcher und sein Desktop-Begleiter, in einem Repository.

**GlassMyTV** ist der Startbildschirm: keine Werbung, eigene Kacheln, eigene Reihen, Glass-Look,
Bildschirmschoner, Kameras, Hue, Home Assistant, Musik, Handy-Fernbedienung — alles auf dem
Fernseher selbst einstellbar. **GlassMyTV Desktop** ist das Programm für Windows und macOS, das den
Fernseher entrümpelt (Debloat), den Launcher installiert, ihm Home übergibt und ihn notfalls wieder
zurückgibt.

Beides ist ein Fork: der Launcher aus [Glassio](https://github.com/mohammadmrh12/glassio) (GPL-3.0),
der Desktop-Begleiter aus [CleanMyTV](https://github.com/wingedpanther/cleanmytv) (MIT). Deutsche
Übersetzung vollständig, Englisch bleibt die Quellsprache.

## Aufbau

```
glassio/     Launcher (Kotlin, Jetpack Compose) — com.glasslauncher.tv
cleanmytv/   Desktop-Begleiter (Electron, React, TypeScript)
.github/     Release-Workflow: Tag → APK + Installer → Draft-Release
```

| Teil | Sprache | Version | Lizenz |
|---|---|---|---|
| `glassio/` | Kotlin / Compose, minSdk 26 | `1.0.1` | GPL-3.0 |
| `cleanmytv/` | Electron 44 / React 19 / TS | `1.0.1` | MIT |

Die Versionen stehen in `glassio/app/build.gradle.kts` (`versionName`/`versionCode`) und in
`cleanmytv/package.json` (`version`). Der Release-Workflow prüft, dass Tag, `package.json` und
`build.gradle.kts` zusammenpassen.

## Voraussetzungen

- JDK 17
- Android SDK mit Platform 36 und Build-Tools 36.0.0 (`sdk.dir` in `glassio/local.properties`)
- Node.js 22+

## Launcher bauen

```bash
cd glassio
# Windows
gradlew.bat :app:assembleRelease
# macOS / Linux
./gradlew :app:assembleRelease
```

Das signierte APK liegt danach in `glassio/app/build/outputs/apk/release/app-release.apk`.

Für ein Release-APK wird ein Schlüssel gebraucht, sonst fällt der Build auf den Debug-Schlüssel
zurück (Updates über die alte Kopie schlagen dann fehl). `glassio/local.properties` oder die
Umgebung liefern:

```properties
GLASSIO_STORE_FILE=keystore/glassio.jks
GLASSIO_STORE_PASSWORD=…
GLASSIO_KEY_ALIAS=glassio
GLASSIO_KEY_PASSWORD=…
```

`GLASSIO_STORE_FILE` ist relativ zum `glassio/`-Ordner. `keystore/` ist nicht im Repository.

## Desktop-App bauen

```bash
cd cleanmytv
npm ci
npm run launcher          # baut das Release-APK aus ../glassio und legt es in resources/ ab
npm run dist:win          # oder dist:mac
```

`npm run launcher` kopiert das APK nach `cleanmytv/resources/glassio.apk` und schreibt
`glassio.json` mit der Versionsnummer daneben; beides wird beim Paketieren mitgeliefert und beim
Start gelesen. Ohne diese Dateien meldet der Launcher-Schritt „This copy of the app has no
GlassMyTV bundled“.

Weitere Skripte:

```bash
npm run typecheck   # TypeScript, strict
npm test            # vitest (146 Tests)
npm run sync        # Upstream-Listen auf den gepinnten Commit ziehen
npm run dev         # Electron im Entwicklungsmodus
```

## Releases

Ein Tag `v1.0.1` löst `.github/workflows/release.yml` aus:

1. **apk** — baut das signierte Release-APK auf Ubuntu, mit `GLASSIO_STORE_BASE64`,
   `GLASSIO_STORE_PASSWORD` und `GLASSIO_KEY_PASSWORD` aus den Repository-Secrets.
2. **test** — Typecheck und Tests des Desktop-Begleiters.
3. **app** — baut `.exe` (NSIS) und `.dmg`, mit dem APK im Gepäck.
4. **release** — legt einen **Draft**-Release mit APK, Installern und `SHA256SUMS.txt` an.

Der Launcher liest `releases/latest` von `DekuCS/glassio` und nimmt das **erste** Asset, dessen Name
auf `.apk` endet — ein Release darf deshalb genau ein APK enthalten. Der Desktop-Begleiter prüft
dieselbe Quelle und verlinkt nur auf die Release-Seite.

Nach dem Prüfen den Draft veröffentlichen; erst dann sehen ihn der Updater und die Nutzer.

## Deutsche Übersetzung

Der Launcher hat zwei Ressourcen-Sprachen (`values/`, `values-de/`) und zusätzlich eine vollständige
Tabelle in `glassio/.../data/I18nDe.kt`: die Oberfläche baut viele Texte zur Laufzeit zusammen, und
`I18n.tr` schlägt für Deutsch zuerst dort nach, dann in der Tabelle, dann im englischen Original.
Fehlt ein Eintrag, bleibt Englisch stehen. Neue Texte gehören in `values-de/strings.xml`, wenn sie
aus Ressourcen kommen, sonst als Paar in `I18nDe.MAP`.

## Lizenzen

- `glassio/` — **GPL-3.0**, siehe `glassio/LICENSE`. Der Launcher stammt von Glassio und bleibt unter
  der GPL.
- `cleanmytv/` — **MIT**, siehe `cleanmytv/LICENSE`, Copyright (c) 2026 Vivek und Mitwirkende.
- Das Gesamtwerk, das beides zusammen ausliefert, steht unter der **GPL-3.0** (`LICENSE` im
  Wurzelverzeichnis), weil das mitgelieferte Launcher-APK unter dieser Lizenz steht. Wer das Projekt
  weiterverbreitet, muss Quellen und Lizenz mitgeben.

## Marken

„GlassMyTV“ ist der Name dieses Forks. Das Projekt steht in keiner Verbindung zu Glassio, CleanMyTV,
CleanYourTV oder Google, und wird von deren Autoren weder unterstützt noch geprüft. „Android TV“,
„Google TV“ und „Chromecast“ sind Marken von Google LLC. Siehe `glassio/TRADEMARKS.md` für die
Markenhinweise des Launchers.

## Danke

- [mohammadmrh12/glassio](https://github.com/mohammadmrh12/glassio) — der Launcher
- [wingedpanther/cleanmytv](https://github.com/wingedpanther/cleanmytv) — der Desktop-Begleiter
- [Gathin23/cleanyourtv](https://github.com/Gathin23/cleanyourtv) — die Bereinigungslisten
