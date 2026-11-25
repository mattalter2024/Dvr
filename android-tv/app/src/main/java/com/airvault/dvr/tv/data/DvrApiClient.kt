package com.airvault.dvr.tv.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class DvrApiClient(rawBaseUrl: String) {
    val baseUrl: String = rawBaseUrl.trimEnd('/')

    private val client = OkHttpClient.Builder()
        .connectTimeout(6, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    private val jsonType = "application/json; charset=utf-8".toMediaType()

    private suspend fun getJson(path: String): JSONObject = withContext(Dispatchers.IO) {
        val req = Request.Builder().url("$baseUrl$path").get().build()
        client.newCall(req).execute().use { res ->
            if (!res.isSuccessful) error("HTTP ${res.code}: ${res.message}")
            JSONObject(res.body?.string().orEmpty())
        }
    }

    private suspend fun postJson(path: String, body: JSONObject = JSONObject()): JSONObject =
        withContext(Dispatchers.IO) {
            val req = Request.Builder()
                .url("$baseUrl$path")
                .post(body.toString().toRequestBody(jsonType))
                .build()
            client.newCall(req).execute().use { res ->
                if (!res.isSuccessful) error("HTTP ${res.code}: ${res.message}")
                val text = res.body?.string().orEmpty()
                if (text.isBlank()) JSONObject() else JSONObject(text)
            }
        }

    private suspend fun patchJson(path: String, body: JSONObject): JSONObject =
        withContext(Dispatchers.IO) {
            val req = Request.Builder()
                .url("$baseUrl$path")
                .patch(body.toString().toRequestBody(jsonType))
                .build()
            client.newCall(req).execute().use { res ->
                if (!res.isSuccessful) error("HTTP ${res.code}: ${res.message}")
                val text = res.body?.string().orEmpty()
                if (text.isBlank()) JSONObject() else JSONObject(text)
            }
        }

    private suspend fun delete(path: String) = withContext(Dispatchers.IO) {
        val req = Request.Builder().url("$baseUrl$path").delete().build()
        client.newCall(req).execute().close()
    }

    suspend fun pingHealth(): String {
        val obj = getJson("/api/health")
        return obj.optString("serverName", "AirVault Home DVR")
    }

    suspend fun fetchGuide(hours: Int = 6): List<GuideRow> {
        val obj = getJson("/api/guide?hours=$hours")
        val rows = obj.optJSONArray("rows") ?: JSONArray()
        return buildList {
            for (i in 0 until rows.length()) {
                val row = rows.getJSONObject(i)
                val ch = parseChannel(row.getJSONObject("channel"))
                val progsArr = row.optJSONArray("programs") ?: JSONArray()
                val progs = buildList {
                    for (j in 0 until progsArr.length()) {
                        add(parseProgram(progsArr.getJSONObject(j)))
                    }
                }
                add(GuideRow(ch, progs))
            }
        }
    }

    suspend fun fetchRecordings(): List<DvrRecording> {
        val obj = getJson("/api/recordings")
        val arr = obj.optJSONArray("recordings") ?: JSONArray()
        return buildList {
            for (i in 0 until arr.length()) {
                add(parseRecording(arr.getJSONObject(i)))
            }
        }
    }

    suspend fun fetchRecordingDetails(recordingId: String): Pair<DvrRecording, List<CommercialSegment>> {
        val obj = getJson("/api/recordings/$recordingId")
        val rec = parseRecording(obj.getJSONObject("recording"))
        val segArr = obj.optJSONArray("commercials") ?: JSONArray()
        val segs = buildList {
            for (i in 0 until segArr.length()) {
                val s = segArr.getJSONObject(i)
                add(
                    CommercialSegment(
                        id = s.getString("id"),
                        startSec = s.getDouble("startSec"),
                        endSec = s.getDouble("endSec"),
                        confidence = s.optDouble("confidence", 0.9),
                        source = s.optString("source", "comskip"),
                    ),
                )
            }
        }
        return rec to segs
    }

    suspend fun startLive(channelId: String): LiveSession {
        val obj = postJson("/api/live/start", JSONObject().put("channelId", channelId))
        val s = obj.getJSONObject("session")
        return LiveSession(
            id = s.getString("id"),
            channelId = s.getString("channelId"),
            channelNumber = s.getString("channelNumber"),
            channelName = s.getString("channelName"),
            playlistUrl = "$baseUrl${s.getString("playlistUrl")}",
            directStreamUrl = s.optString("directStreamUrl", "").takeIf { it.isNotBlank() }?.let { "$baseUrl$it" },
            mode = s.optString("mode", "hls-ffmpeg"),
        )
    }

    suspend fun heartbeatLive(sessionId: String) {
        postJson("/api/live/$sessionId/heartbeat")
    }

    suspend fun stopLive(sessionId: String) {
        delete("/api/live/$sessionId")
    }

    suspend fun scheduleProgram(programId: String) {
        postJson("/api/recordings/schedule", JSONObject().put("programId", programId))
    }

    suspend fun recordNow(channelId: String, durationMinutes: Int = 30) {
        postJson(
            "/api/recordings/now",
            JSONObject()
                .put("channelId", channelId)
                .put("durationMinutes", durationMinutes),
        )
    }

    suspend fun createSeriesPass(title: String, channelId: String?, newOnly: Boolean) {
        postJson(
            "/api/series-passes",
            JSONObject()
                .put("title", title)
                .put("channelId", channelId)
                .put("newOnly", newOnly),
        )
    }

    suspend fun fetchSeriesPasses(): List<SeriesPass> {
        val obj = getJson("/api/series-passes")
        val arr = obj.optJSONArray("seriesPasses") ?: JSONArray()
        return buildList {
            for (i in 0 until arr.length()) {
                val p = arr.getJSONObject(i)
                add(
                    SeriesPass(
                        id = p.getString("id"),
                        title = p.getString("title"),
                        newOnly = p.optBoolean("newOnly", false),
                        keepLimit = p.optInt("keepLimit", 0),
                    ),
                )
            }
        }
    }

    suspend fun saveProgress(recordingId: String, positionSec: Long) {
        patchJson(
            "/api/recordings/$recordingId/progress",
            JSONObject().put("positionSec", positionSec),
        )
    }

    suspend fun scanCommercials(recordingId: String): Int {
        val obj = postJson("/api/recordings/$recordingId/scan-commercials")
        return obj.optJSONArray("commercials")?.length() ?: 0
    }

    fun recordingStreamUrl(recordingId: String): String =
        "$baseUrl/api/recordings/$recordingId/stream"

    private fun parseChannel(c: JSONObject) = TvChannel(
        id = c.getString("id"),
        guideNumber = c.getString("guideNumber"),
        guideName = c.getString("guideName"),
        network = c.optString("network", "OTA"),
        hd = c.optBoolean("hd", true),
        favorite = c.optBoolean("favorite", false),
    )

    private fun parseProgram(p: JSONObject) = TvProgram(
        id = p.getString("id"),
        channelId = p.getString("channelId"),
        title = p.getString("title"),
        subtitle = p.optString("subtitle", "").takeIf { it.isNotBlank() && it != "null" },
        description = p.optString("description", "").takeIf { it.isNotBlank() && it != "null" },
        startTime = p.getString("startTime"),
        endTime = p.getString("endTime"),
        category = p.optString("category", "General"),
        episodeNum = p.optString("episodeNum", "").takeIf { it.isNotBlank() && it != "null" },
        isNew = p.optBoolean("isNew", false),
        isLive = p.optBoolean("isLive", false),
    )

    private fun parseRecording(r: JSONObject) = DvrRecording(
        id = r.getString("id"),
        channelId = r.getString("channelId"),
        channelNumber = r.getString("channelNumber"),
        channelName = r.getString("channelName"),
        title = r.getString("title"),
        subtitle = r.optString("subtitle", "").takeIf { it.isNotBlank() && it != "null" },
        episodeNum = r.optString("episodeNum", "").takeIf { it.isNotBlank() && it != "null" },
        scheduledStart = r.getString("scheduledStart"),
        scheduledEnd = r.getString("scheduledEnd"),
        status = r.getString("status"),
        durationSec = r.optDouble("durationSec", 0.0),
        commercialScanStatus = r.optString("commercialScanStatus", "pending"),
        commercialCount = r.optInt("commercialCount", 0),
        watchedPositionSec = r.optDouble("watchedPositionSec", 0.0),
        watched = r.optBoolean("watched", false),
        hasMediaFile = !r.isNull("filePath") && r.optString("filePath").isNotBlank(),
    )
}
