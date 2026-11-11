package com.glasslauncher.tv.data

import android.content.Context
import android.content.Intent

/**
 * The TV-side settings GlassMyTV needs, set through the TV's own debugging connection (ADB, [LocalShell]):
 * the Home button service, GlassMyTV as the home app and as the TV screensaver, and starting with the TV.
 * Used by the setup's System step (Settings → System has the same switches one by one).
 */
object SystemSetup {
    private fun pkg(ctx: Context) = ctx.packageName

    /** Fire TV's own home screen. It takes the Home key and swallows the Netflix and Prime buttons. */
    private const val AMAZON_LAUNCHER = "com.amazon.tv.launcher"

    /** What Settings → System's one button did. */
    class Done(val home: Boolean, val keys: Boolean, val music: Boolean, val amazonOff: Boolean)

    /** This TV runs Fire OS (Amazon), where the Home key and the app buttons are handled by the stock launcher. */
    fun isFireTv(): Boolean = runCatching {
        android.os.Build.MANUFACTURER.equals("Amazon", true) || android.os.Build.BRAND.equals("Amazon", true) ||
            android.os.Build.MODEL.orEmpty().startsWith("AFT", true)
    }.getOrDefault(false)

    fun installed(ctx: Context, p: String): Boolean = runCatching {
        ctx.packageManager.getApplicationInfo(p, 0); true
    }.getOrDefault(false)

    /** The Amazon launcher is switched off (its package disabled). */
    fun amazonLauncherOff(ctx: Context): Boolean = runCatching {
        ctx.packageManager.getApplicationEnabledSetting(AMAZON_LAUNCHER) ==
            android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_DISABLED_USER
    }.getOrDefault(false)

    /**
     * Everything GlassMyTV needs on the TV, in one go: the secure-settings right, the Home button service,
     * GlassMyTV as the home app, and the music access. On Fire TV, where the stock launcher keeps Home and
     * the Netflix / Prime buttons to itself, that launcher is switched off when becoming the home app
     * doesn't take. Blocking.
     */
    fun setupAll(ctx: Context, st: Settings): Done {
        val p = pkg(ctx)
        // The writes below go through the secure settings: the right comes first. WRITE_SETTINGS (Screen → sleep
        // time, the screensaver's idle time) is an app-op on Android TV and is given the same way.
        LocalShell.run(ctx, "pm grant $p android.permission.WRITE_SECURE_SETTINGS 2>/dev/null; appops set $p WRITE_SETTINGS allow 2>/dev/null; true")
        enableHomeKey(ctx)
        st.interceptHome = true
        setHomeActivity(ctx)
        // Fire TV: Amazon's launcher keeps Home, whatever the preferred home app says. Switch it off so the
        // system falls back to GlassMyTV (and lets the store buttons through to the service).
        var amazonOff = amazonLauncherOff(ctx)
        if (!isHomeApp(ctx) && isFireTv() && installed(ctx, AMAZON_LAUNCHER)) {
            LocalShell.run(ctx, "pm disable-user --user 0 $AMAZON_LAUNCHER; true")
            amazonOff = amazonLauncherOff(ctx)
            setHomeActivity(ctx)
        }
        if (!isHomeApp(ctx)) LocalShell.run(ctx, "cmd role add-role-holder android.app.role.HOME $p 2>/dev/null; true")
        val music = NowPlaying.grant(ctx)
        return Done(isHomeApp(ctx), homeKeyOn(ctx) && st.interceptHome, music, amazonOff)
    }

    /** Fire TV: turns the Amazon launcher back on (after [setupAll] switched it off). Blocking. */
    fun restoreAmazonLauncher(ctx: Context): Boolean {
        LocalShell.run(ctx, "pm enable $AMAZON_LAUNCHER; true")
        return !amazonLauncherOff(ctx)
    }

    private fun setHomeActivity(ctx: Context) {
        val p = pkg(ctx)
        LocalShell.run(ctx, "cmd package set-home-activity $p/com.glasslauncher.tv.MainActivity >/dev/null 2>&1; true")
    }

    /** GlassMyTV may use the TV's debugging connection (asks "Allow USB debugging?" on the TV the first time). Blocking. */
    fun adb(ctx: Context): Boolean = LocalShell.run(ctx, "echo ok").getOrNull()?.contains("ok") == true

    fun developerOn(ctx: Context): Boolean = runCatching {
        android.provider.Settings.Global.getInt(ctx.contentResolver, android.provider.Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0) == 1 &&
            android.provider.Settings.Global.getInt(ctx.contentResolver, android.provider.Settings.Global.ADB_ENABLED, 0) == 1
    }.getOrDefault(false)

    fun homeKeyOn(ctx: Context): Boolean = runCatching {
        android.provider.Settings.Secure.getString(ctx.contentResolver, "enabled_accessibility_services").orEmpty()
            .contains("${pkg(ctx)}/com.glasslauncher.tv.HomeKeyService")
    }.getOrDefault(false)

    /** Turns on the Home button service. Blocking. */
    fun enableHomeKey(ctx: Context): Boolean {
        val svc = "${pkg(ctx)}/com.glasslauncher.tv.HomeKeyService"
        val cmd = "cur=\$(settings get secure enabled_accessibility_services); " +
            "case \"\$cur\" in *$svc*) ;; null|'') settings put secure enabled_accessibility_services $svc ;; " +
            "*) settings put secure enabled_accessibility_services \"\$cur:$svc\" ;; esac; " +
            "settings put secure accessibility_enabled 1; appops set ${pkg(ctx)} ACCESS_RESTRICTED_SETTINGS allow 2>/dev/null; " +
            "pm grant ${pkg(ctx)} android.permission.WRITE_SECURE_SETTINGS 2>/dev/null; true"
        LocalShell.run(ctx, cmd)
        return homeKeyOn(ctx)
    }

    fun isHomeApp(ctx: Context): Boolean = runCatching {
        ctx.packageManager.resolveActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), 0)?.activityInfo?.packageName == pkg(ctx)
    }.getOrDefault(false)

    /** GlassMyTV as the TV's home app (the Home button then lands here too). Blocking. */
    fun makeHomeApp(ctx: Context): Boolean {
        LocalShell.run(ctx, "cmd package set-home-activity ${pkg(ctx)}/com.glasslauncher.tv.MainActivity >/dev/null 2>&1; true")
        return isHomeApp(ctx)
    }

    /**
     * Asks Android to make GlassMyTV the home app through its own dialog, so no ADB is needed: the TV
     * puts up "Use GlassMyTV as Home?" and the owner presses OK. False when this TV doesn't offer the
     * role for Home (then the home-app settings page is the way).
     */
    @android.annotation.SuppressLint("NewApi")
    fun askForHomeRole(ctx: Context): Boolean {
        if (android.os.Build.VERSION.SDK_INT < 29) return false
        val rm = runCatching { ctx.getSystemService(android.app.role.RoleManager::class.java) }.getOrNull() ?: return false
        val role = android.app.role.RoleManager.ROLE_HOME
        if (!runCatching { rm.isRoleAvailable(role) }.getOrDefault(false)) return false
        if (runCatching { rm.isRoleHeld(role) }.getOrDefault(false)) return true
        return runCatching {
            ctx.startActivity(rm.createRequestRoleIntent(role).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            true
        }.getOrDefault(false)
    }

    fun isScreensaver(ctx: Context): Boolean = runCatching {
        val cr = ctx.contentResolver
        android.provider.Settings.Secure.getInt(cr, "screensaver_enabled", 1) == 1 &&
            android.provider.Settings.Secure.getString(cr, "screensaver_components").orEmpty().startsWith(pkg(ctx))
    }.getOrDefault(false)

    private const val DREAM = "com.glasslauncher.tv.saver.GlassDreamService"

    /** One secure setting, written straight from the app (the setup granted it that right). False when it may not. */
    private fun sec(ctx: Context, key: String, value: String): Boolean =
        runCatching { android.provider.Settings.Secure.putString(ctx.contentResolver, key, value) }.getOrDefault(false)

    /** The TV's idle time, written straight from the app; needs WRITE_SETTINGS (given over ADB by the setup). */
    private fun sysMs(ctx: Context, ms: Int): Boolean = runCatching {
        android.provider.Settings.System.putInt(ctx.contentResolver, "screen_off_timeout", ms)
    }.getOrDefault(false)

    /**
     * GlassMyTV as the TV screensaver (in every app), as Settings → Screensaver does it. Blocking.
     *
     * Written straight into the secure settings first: on Fire OS the debugging connection the app keeps in
     * its own name can't be made (the TV never asks "Allow USB debugging?" for it), so the ADB route alone left
     * the switch off. The shell is only the fallback for a TV where that right is missing.
     */
    fun makeScreensaver(ctx: Context): Boolean {
        val dream = "${pkg(ctx)}/$DREAM"
        val direct = sec(ctx, "screensaver_components", dream) && sec(ctx, "screensaver_enabled", "1") &&
            sec(ctx, "screensaver_activate_on_sleep", "1")
        if (direct) {
            // The TV's "undim detector" kept the screen on for 10 minutes after a couple of key presses, so the
            // screensaver often didn't start at its time: switched off here. With the screensaver time at (or past)
            // the TV's sleep time the TV just went to sleep: give it 5 minutes then.
            val t = runCatching { android.provider.Settings.System.getInt(ctx.contentResolver, "screen_off_timeout") }.getOrDefault(0)
            val sl = runCatching { android.provider.Settings.Secure.getInt(ctx.contentResolver, "sleep_timeout") }.getOrDefault(0).let { if (it <= 0) 1_800_000 else it }
            if (t >= sl || t >= 1_800_000) sysMs(ctx, 300_000)
            LocalShell.run(ctx, "device_config put attention_manager_service keep_screen_on_enabled false 2>/dev/null; true")
            return isScreensaver(ctx)
        }
        LocalShell.run(ctx, "settings put secure screensaver_components $dream && settings put secure screensaver_enabled 1 && settings put secure screensaver_activate_on_sleep 1; " +
            "t=\$(settings get system screen_off_timeout); sl=\$(settings get secure sleep_timeout); case \$sl in ''|null|-1|0) sl=1800000;; esac; " +
            "if [ \"\$t\" -ge \"\$sl\" ] 2>/dev/null || [ \"\$t\" -ge 1800000 ] 2>/dev/null; then settings put system screen_off_timeout 300000; fi; " +
            "device_config put attention_manager_service keep_screen_on_enabled false 2>/dev/null; true")
        return isScreensaver(ctx)
    }

    /**
     * The TV screensaver off. With no screensaver the TV goes to sleep at that idle time, so the screen then stays
     * on until the TV's own sleep time instead. Blocking.
     */
    fun screensaverOff(ctx: Context): Boolean {
        val direct = sec(ctx, "screensaver_enabled", "0")
        if (direct) {
            val sl = runCatching { android.provider.Settings.Secure.getInt(ctx.contentResolver, "sleep_timeout") }.getOrDefault(0).let { if (it <= 0) 1_800_000 else it }
            sysMs(ctx, sl)
            return true
        }
        return LocalShell.run(ctx, "settings put secure screensaver_enabled 0 && s=\$(settings get secure sleep_timeout) && case \$s in ''|null|-1|0) s=1800000;; esac && settings put system screen_off_timeout \$s").isSuccess
    }

    /** The TV's idle time before its screensaver, in any app. Blocking. */
    fun screensaverAfter(ctx: Context, ms: Int): Boolean {
        val direct = sysMs(ctx, ms)
        sec(ctx, "screensaver_activate_on_sleep", "1")
        if (direct) {
            LocalShell.run(ctx, "device_config put attention_manager_service keep_screen_on_enabled false 2>/dev/null; true")
            return true
        }
        return LocalShell.run(ctx, "settings put system screen_off_timeout $ms && settings put secure screensaver_activate_on_sleep 1; device_config put attention_manager_service keep_screen_on_enabled false 2>/dev/null; true").isSuccess
    }

    /** GlassMyTV opens when the TV starts. Blocking. */
    fun startWithTv(ctx: Context, st: Settings): Boolean {
        st.bootStart = true
        return LocalShell.run(ctx, "appops set ${pkg(ctx)} SYSTEM_ALERT_WINDOW allow; true").isSuccess
    }
}
