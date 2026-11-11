package com.glasslauncher.tv.data

import android.content.Intent
import com.glasslauncher.tv.GlassApp

/**
 * Fire TV's Netflix and Prime Video buttons.
 *
 * On Fire OS those two buttons never reach an app at all: the firmware starts the store's app on its own, before
 * any app (not even the accessibility service) sees the key. Nothing without root can take the key. What GlassMyTV
 * can do is let that happen and open what the button was set to right after it: the store's app gets a blink of the
 * screen and then makes way. Settings → Remote mapping sets both buttons like any other.
 */
object StoreKeys {
    /** The button's own number: negative, so it can't be mistaken for a real key code. */
    const val NETFLIX = -101
    const val PRIME = -102
    const val YOUTUBE = -103

    /** The app each Fire TV button starts by itself. */
    val STORES: Map<String, Int> = mapOf(
        "com.netflix.ninja" to NETFLIX,
        "com.amazon.amazonvideo.livingroom" to PRIME,
    )

    /** The TV's own app that a button belongs to (for the row's name). */
    val TITLES: Map<Int, String> = mapOf(NETFLIX to "Netflix button", PRIME to "Prime Video button")

    /** An app GlassMyTV opened itself; the store button is not what brought it, so it is left alone. */
    @Volatile private var oursPkg: String? = null
    @Volatile private var oursAt = 0L

    /** Marks an app as opened from GlassMyTV (its own tile, the menu, a mapped button). */
    fun opened(pkg: String) {
        oursPkg = pkg
        oursAt = android.os.SystemClock.uptimeMillis()
    }

    private fun wasOurs(pkg: String): Boolean {
        // The marker only covers the launch it was set for, and never an old one.
        if (pkg != oursPkg) return false
        val fresh = android.os.SystemClock.uptimeMillis() - oursAt < 60_000
        oursPkg = null
        return fresh
    }

    /**
     * The store's app just came to the front. True when GlassMyTV took over (the button is mapped to something
     * else) and the caller should stop right there.
     */
    fun onFront(app: GlassApp, pkg: String): Boolean {
        val code = STORES[pkg] ?: return false
        if (wasOurs(pkg)) return false
        val m = RemoteMap.find(app.settings, code) ?: run {
            Glog.i("$pkg on screen (the TV's own button, not set here)")
            return false
        }
        // Set to its own app: the TV's own doing is right.
        if (m.action == "app:$pkg") return false
        Glog.i("${TITLES[code] ?: pkg} pressed: opening ${m.action} instead of $pkg")
        // The mapped app is opened over it (the store's app then goes behind). For everything else GlassMyTV comes
        // back first, so the folder / recent apps / input opens on the home screen and not over Netflix.
        if (m.action.startsWith("app:")) {
            opened(m.action.removePrefix("app:"))
            RemoteMap.run(app, m)
        } else {
            runCatching {
                app.startActivity(Intent(app, com.glasslauncher.tv.MainActivity::class.java)
                    .setAction(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP))
            }.onFailure { Glog.w("Store button", it) }
            android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({ RemoteMap.run(app, m) }, 450)
        }
        return true
    }
}
