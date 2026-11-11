package com.glasslauncher.tv.data

import android.content.Context
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * The words of the song that is playing, timed to it: lrclib.net (open, no key), asked once per song and kept on
 * the TV so the same song comes up at once next time. Only the music page uses it; nothing is sent but the title,
 * the artist, the album and the song's length.
 */
object Lyrics {
    /** One line, with the moment it starts (0 for words without timings). */
    class Line(val at: Long, val text: String)
    class Page(val lines: List<Line>, val synced: Boolean)

    /** What is here now for the song on screen (null while it is being fetched, or when there are none). */
    val page = kotlinx.coroutines.flow.MutableStateFlow<Page?>(null)
    /** The song [page] belongs to ("package|title|artist"). */
    @Volatile private var pageKey: String? = null
    @Volatile private var askedKey: String? = null

    /** A song's key, as NowPlaying's artwork cache uses one. */
    fun keyOf(t: NowPlaying.Track): String = "${t.pkg}|${t.title}|${t.artist}"

    /** The words shown now, when they belong to [t] (a song change clears them until its own arrive). */
    fun pageFor(t: NowPlaying.Track): Page? = if (pageKey == keyOf(t)) page.value else null

    /**
     * Looks the song's words up (off the main thread, once per song). [ctx] is only for the cache folder.
     * A song with no words clears the page (the player then has the whole width); "none" is remembered too, so a
     * song without words is asked for once and not on every visit.
     */
    fun load(ctx: Context, t: NowPlaying.Track) {
        val key = keyOf(t)
        if (key == pageKey || key == askedKey) return
        askedKey = key
        val cached = diskGet(ctx, key)
        if (cached != null) { pageKey = key; page.value = cached.takeIf { it.lines.isNotEmpty() }; return }
        Thread {
            val got = runCatching { fetch(t) }.getOrNull()
            diskPut(ctx, key, got ?: Page(emptyList(), false))
            if (askedKey != key) return@Thread
            pageKey = key
            page.value = got
            Glog.i("Lyrics for \"${t.title}\": ${got?.lines?.size ?: 0} lines${if (got?.synced == true) " (timed)" else ""}")
        }.apply { isDaemon = true; name = "glass-lyrics" }.start()
    }

    /** Nothing playing any more. */
    fun clear() { pageKey = null; askedKey = null; page.value = null }

    private fun fetch(t: NowPlaying.Track): Page? {
        val dur = if (t.duration > 0) (t.duration / 1000).toInt() else 0
        // The exact song first (lrclib matches title, artist, album and length), then a search.
        val exact = "https://lrclib.net/api/get?track_name=${enc(t.title)}&artist_name=${enc(t.artist)}" +
            (if (t.album.isNotBlank()) "&album_name=${enc(t.album)}" else "") + (if (dur > 0) "&duration=$dur" else "")
        json(exact)?.let { return parse(it) }
        val found = json("https://lrclib.net/api/search?q=${enc("${t.title} ${t.artist}")}") ?: return null
        // The search answers with a list; the first hit with words is the one.
        for (item in splitObjects(found)) {
            val p = runCatching { parse(item) }.getOrNull()
            if (p != null && p.lines.isNotEmpty()) return p
        }
        return null
    }

    private fun enc(s: String): String = URLEncoder.encode(s, "UTF-8")

    private fun json(url: String): String? = runCatching {
        val c = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 8000; readTimeout = 10000
            setRequestProperty("User-Agent", "GlassMyTV (https://github.com/DekuCS/glassio)")
            setRequestProperty("Accept", "application/json")
        }
        try {
            if (c.responseCode != 200) return@runCatching null
            c.inputStream.bufferedReader().use { it.readText() }
        } finally { c.disconnect() }
    }.getOrNull()

    /** syncedLyrics (with [mm:ss.xx]) is preferred; plainLyrics is shown as it is, with no highlight. */
    private fun parse(body: String): Page? {
        val synced = field(body, "syncedLyrics")
        if (!synced.isNullOrBlank()) {
            val lines = synced.lineSequence().mapNotNull { l ->
                val close = l.indexOf(']')
                if (!l.startsWith("[") || close < 0) return@mapNotNull null
                val at = stamp(l.substring(1, close)) ?: return@mapNotNull null
                Line(at, l.substring(close + 1).trim())
            }.filter { it.text.isNotBlank() }.sortedBy { it.at }.toList()
            if (lines.isNotEmpty()) return Page(lines, true)
        }
        val plain = field(body, "plainLyrics")
        if (!plain.isNullOrBlank()) {
            val lines = plain.lineSequence().map { Line(0, it.trim()) }.filter { it.text.isNotBlank() }.toList()
            if (lines.isNotEmpty()) return Page(lines, false)
        }
        return null
    }

    /** "02:41.53" or "1:02:41.5" as milliseconds. */
    private fun stamp(s: String): Long? {
        val parts = s.split(':')
        if (parts.isEmpty()) return null
        var ms = 0L
        for (p in parts) {
            val v = p.toDoubleOrNull() ?: return null
            ms = ms * 60 + (v * 1000).toLong()
        }
        return ms
    }

    /** The string value of one JSON field, its escapes decoded (\n, \r, \t, \", \\, \uXXXX). */
    private fun field(body: String, name: String): String? {
        val k = body.indexOf("\"$name\"")
        if (k < 0) return null
        var i = body.indexOf(':', k).let { if (it < 0) return null else it + 1 }
        while (i < body.length && body[i].isWhitespace()) i++
        if (i >= body.length || body[i] != '"') return null
        val sb = StringBuilder(); i++
        while (i < body.length) {
            val c = body[i]
            if (c == '\\' && i + 1 < body.length) {
                val e = body[i + 1]
                if (e == 'u' && i + 6 <= body.length) {
                    // A song's line can carry an accent (é, ø) as \u00e9: kept as its character.
                    body.substring(i + 2, i + 6).toIntOrNull(16)?.let { sb.append(it.toChar()) }
                    i += 6
                } else {
                    sb.append(when (e) { 'n' -> '\n'; 'r' -> '\r'; 't' -> '\t'; 'b' -> '\b'; 'f' -> '\u000C'; else -> e })
                    i += 2
                }
                continue
            }
            if (c == '"') return sb.toString()
            sb.append(c); i++
        }
        return null
    }

    /** The objects of a JSON array of objects, as their own text. */
    private fun splitObjects(a: String): List<String> {
        val out = ArrayList<String>()
        var depth = 0; var start = -1; var inStr = false; var esc = false
        for ((i, c) in a.withIndex()) {
            if (inStr) { if (esc) esc = false else if (c == '\\') esc = true else if (c == '"') inStr = false; continue }
            when (c) {
                '"' -> inStr = true
                '{' -> { if (depth == 0) start = i; depth++ }
                '}' -> { depth--; if (depth == 0 && start >= 0) out.add(a.substring(start, i + 1)) }
            }
        }
        return out
    }

    // One small file per song in the app's own folder, so the same song needs no network next time.
    private fun dir(ctx: Context): File = File(ctx.filesDir, "lyrics").apply { mkdirs() }
    // "2-": the first format's files held the words of a song as one line (the escapes were not decoded).
    private fun file(ctx: Context, key: String): File =
        File(dir(ctx), "2-" + key.hashCode().toUInt().toString(16) + ".lrc")

    private fun diskGet(ctx: Context, key: String): Page? = runCatching {
        val f = file(ctx, key)
        if (!f.isFile) return@runCatching null
        // The file's first line is the key: a hash collision must not hand over another song's words.
        val text = f.readText()
        val nl = text.indexOf('\n')
        if (nl < 0 || text.substring(0, nl) != key) return@runCatching null
        val body = text.substring(nl + 1)
        if (body.isBlank()) return@runCatching Page(emptyList(), false)
        val lines = body.lineSequence().mapNotNull { l ->
            val p = l.split('|', limit = 2)
            if (p.size < 2) null else Line(p[0].toLongOrNull() ?: 0L, p[1])
        }.toList()
        Page(lines, lines.any { it.at > 0 })
    }.getOrNull()

    private fun diskPut(ctx: Context, key: String, p: Page?) = runCatching {
        val f = file(ctx, key)
        if (p == null) { f.delete(); return@runCatching }
        f.writeText(key + "\n" + p.lines.joinToString("\n") { "${it.at}|${it.text}" })
        // The folder stays small: the newest 200 songs.
        val all = dir(ctx).listFiles()?.sortedByDescending { it.lastModified() } ?: return@runCatching
        all.drop(200).forEach { it.delete() }
    }
}
