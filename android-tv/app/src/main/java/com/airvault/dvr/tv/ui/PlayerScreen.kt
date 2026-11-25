package com.airvault.dvr.tv.ui

import android.view.KeyEvent
import androidx.annotation.OptIn
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import com.airvault.dvr.tv.data.*
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

sealed interface TvPlaybackRequest {
    data class Live(val channel: TvChannel) : TvPlaybackRequest
    data class Recording(val recording: DvrRecording) : TvPlaybackRequest
}

@OptIn(UnstableApi::class)
@Composable
fun PlayerScreen(
    api: DvrApiClient,
    request: TvPlaybackRequest,
    channels: List<TvChannel>,
    onClose: () -> Unit,
    onSwitchChannel: (TvChannel) -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var liveSession by remember(request) { mutableStateOf<LiveSession?>(null) }
    var commercials by remember(request) { mutableStateOf<List<CommercialSegment>>(emptyList()) }
    var autoSkip by remember { mutableStateOf(true) }
    var statusText by remember(request) { mutableStateOf("Tuning OTA stream...") }
    var positionMs by remember { mutableLongStateOf(0L) }
    var durationMs by remember { mutableLongStateOf(0L) }
    var isPlaying by remember { mutableStateOf(true) }
    var hudVisible by remember { mutableStateOf(true) }
    var skipToast by remember { mutableStateOf<Pair<Int, Long>?>(null) } // (skippedSec, undoReturnMs)
    var lastSkippedSegId by remember(request) { mutableStateOf<String?>(null) }

    val exoPlayer = remember {
        ExoPlayer.Builder(context).build().apply {
            playWhenReady = true
        }
    }

    // Load MediaItem (Live HLS / Direct MPEG-TS or Recording HTTP Range MP4 + Commercials)
    LaunchedEffect(request) {
        lastSkippedSegId = null
        skipToast = null
        try {
            when (request) {
                is TvPlaybackRequest.Live -> {
                    commercials = emptyList()
                    val session = api.startLive(request.channel.id)
                    liveSession = session
                    // Native ExoPlayer can play direct HDHomeRun MPEG-TS OR server HLS!
                    val mediaUrl = session.directStreamUrl ?: session.playlistUrl
                    exoPlayer.setMediaItem(MediaItem.fromUri(mediaUrl))
                    exoPlayer.prepare()
                    statusText = ""
                }

                is TvPlaybackRequest.Recording -> {
                    liveSession = null
                    val (rec, segs) = api.fetchRecordingDetails(request.recording.id)
                    commercials = segs
                    if (rec.hasMediaFile) {
                        exoPlayer.setMediaItem(MediaItem.fromUri(api.recordingStreamUrl(rec.id)))
                        exoPlayer.prepare()
                        if (rec.watchedPositionSec > 3.0) {
                            exoPlayer.seekTo((rec.watchedPositionSec * 1000).toLong())
                        }
                        statusText = ""
                    } else {
                        statusText =
                            "No video file on server yet (install FFmpeg or run Docker on the DVR server)."
                    }
                }
            }
        } catch (e: Exception) {
            statusText = e.message ?: "Unable to start playback"
        }
    }

    // Live TV heartbeat + clean release of tuner & ExoPlayer on exit
    DisposableEffect(liveSession?.id) {
        val sessId = liveSession?.id
        val job = if (sessId != null) {
            scope.launch {
                while (true) {
                    delay(12_000)
                    runCatching { api.heartbeatLive(sessId) }
                }
            }
        } else null

        onDispose {
            job?.cancel()
            if (sessId != null) {
                scope.launch { runCatching { api.stopLive(sessId) } }
            }
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            if (request is TvPlaybackRequest.Recording && positionMs > 2_000L) {
                val sec = positionMs / 1000L
                scope.launch { runCatching { api.saveProgress(request.recording.id, sec) } }
            }
            exoPlayer.release()
        }
    }

    // 400ms playback monitor: Automatic Commercial Skipping + Whole-House Resume Sync!
    LaunchedEffect(request, commercials, autoSkip) {
        var tick = 0
        while (true) {
            positionMs = exoPlayer.currentPosition.coerceAtLeast(0L)
            durationMs = exoPlayer.duration.coerceAtLeast(0L)
            isPlaying = exoPlayer.isPlaying

            if (request is TvPlaybackRequest.Recording) {
                val posSec = positionMs / 1000.0
                val hit = commercials.firstOrNull { posSec >= it.startSec && posSec < it.endSec - 0.5 }
                if (autoSkip && hit != null && hit.id != lastSkippedSegId) {
                    val returnMs = positionMs
                    val skippedSec = (hit.endSec - hit.startSec).toInt().coerceAtLeast(1)
                    lastSkippedSegId = hit.id
                    exoPlayer.seekTo((hit.endSec * 1000.0).toLong())
                    skipToast = skippedSec to returnMs
                    scope.launch {
                        delay(6_000)
                        if (skipToast?.second == returnMs) skipToast = null
                    }
                }

                tick++
                if (tick % 12 == 0 && positionMs > 2_000L) {
                    runCatching { api.saveProgress(request.recording.id, positionMs / 1000L) }
                }
            }
            delay(400)
        }
    }

    // Auto-hide HUD after 5 seconds of inactivity
    LaunchedEffect(hudVisible) {
        if (hudVisible) {
            delay(5000)
            hudVisible = false
        }
    }

    val activeCommercial = remember(positionMs, commercials) {
        val posSec = positionMs / 1000.0
        commercials.firstOrNull { posSec >= it.startSec && posSec < it.endSec - 0.5 }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
            .onPreviewKeyEvent { keyEvent ->
                if (keyEvent.nativeKeyEvent.action != KeyEvent.ACTION_DOWN) return@onPreviewKeyEvent false
                hudVisible = true
                when (keyEvent.nativeKeyEvent.keyCode) {
                    KeyEvent.KEYCODE_BACK -> {
                        onClose()
                        true
                    }

                    KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_DPAD_CENTER -> {
                        if (exoPlayer.isPlaying) exoPlayer.pause() else exoPlayer.play()
                        true
                    }

                    KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> {
                        exoPlayer.seekTo((exoPlayer.currentPosition + 15_000L).coerceAtLeast(0L))
                        true
                    }

                    KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_MEDIA_REWIND -> {
                        val toast = skipToast
                        if (toast != null) {
                            // Pressing LEFT immediately after auto-skip undoes the skip
                            autoSkip = false
                            exoPlayer.seekTo(toast.second)
                            skipToast = null
                        } else {
                            exoPlayer.seekTo((exoPlayer.currentPosition - 10_000L).coerceAtLeast(0L))
                        }
                        true
                    }

                    KeyEvent.KEYCODE_CHANNEL_UP -> {
                        if (request is TvPlaybackRequest.Live && channels.size > 1) {
                            val idx = channels.indexOfFirst { it.id == request.channel.id }
                            if (idx >= 0) onSwitchChannel(channels[(idx - 1 + channels.size) % channels.size])
                            true
                        } else false
                    }

                    KeyEvent.KEYCODE_CHANNEL_DOWN -> {
                        if (request is TvPlaybackRequest.Live && channels.size > 1) {
                            val idx = channels.indexOfFirst { it.id == request.channel.id }
                            if (idx >= 0) onSwitchChannel(channels[(idx + 1) % channels.size])
                            true
                        } else false
                    }

                    else -> false
                }
            },
    ) {
        AndroidView(
            factory = { ctx ->
                PlayerView(ctx).apply {
                    player = exoPlayer
                    useController = false // Custom 10-foot DVR OSD with amber commercial markers
                }
            },
            modifier = Modifier.fillMaxSize(),
        )

        if (statusText.isNotBlank()) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(statusText, color = Color(0xFF94A3B8), fontSize = 18.sp)
            }
        }

        // Auto-Skip Commercial Undo Toast
        skipToast?.let { (skippedSec, undoMs) ->
            Row(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(top = 84.dp, end = 32.dp)
                    .background(Color(0xEE0F172A), RoundedCornerShape(14.dp))
                    .padding(horizontal = 20.dp, vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Column {
                    Text(
                        "Skipped ${formatClock(skippedSec * 1000L)} commercial",
                        color = Color(0xFFFCD34D),
                        fontWeight = FontWeight.Bold,
                        fontSize = 16.sp,
                    )
                    Text(
                        "Press LEFT on remote to undo",
                        color = Color(0xFF94A3B8),
                        fontSize = 13.sp,
                    )
                }
                Button(
                    onClick = {
                        autoSkip = false
                        exoPlayer.seekTo(undoMs)
                        skipToast = null
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFD97706)),
                ) {
                    Text("Undo", color = Color.White)
                }
            }
        }

        if (hudVisible) {
            // Top Bar
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .align(Alignment.TopCenter)
                    .background(Brush.verticalGradient(listOf(Color(0xDD000000), Color.Transparent)))
                    .padding(horizontal = 32.dp, vertical = 22.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column {
                    val heading = when (request) {
                        is TvPlaybackRequest.Live ->
                            "LIVE  •  ${request.channel.guideNumber} ${request.channel.guideName}"
                        is TvPlaybackRequest.Recording ->
                            "DVR  •  ${request.recording.title}"
                    }
                    Text(heading, color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold)
                    if (request is TvPlaybackRequest.Recording && request.recording.subtitle != null) {
                        Text(request.recording.subtitle, color = Color(0xFF94A3B8), fontSize = 14.sp)
                    }
                }

                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (request is TvPlaybackRequest.Recording) {
                        Button(
                            onClick = { autoSkip = !autoSkip },
                            colors = ButtonDefaults.buttonColors(
                                containerColor = if (autoSkip) Color(0xFFD97706) else Color(0xFF1E293B),
                            ),
                        ) {
                            Text("Auto-Skip Ads: ${if (autoSkip) "ON" else "OFF"}")
                        }
                    }
                    Button(
                        onClick = onClose,
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1E293B)),
                    ) {
                        Text("Back")
                    }
                }
            }

            // Bottom Scrub Bar with Amber Commercial Break Markers
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .align(Alignment.BottomCenter)
                    .background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xEE000000))))
                    .padding(horizontal = 32.dp, vertical = 24.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (request is TvPlaybackRequest.Recording && durationMs > 0L) {
                    Canvas(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(10.dp),
                    ) {
                        drawRect(color = Color(0x44FFFFFF), size = size)
                        // Paint detected commercial segments in bright amber
                        for (seg in commercials) {
                            val leftX = ((seg.startSec * 1000.0) / durationMs).toFloat().coerceIn(0f, 1f) * size.width
                            val rightX = ((seg.endSec * 1000.0) / durationMs).toFloat().coerceIn(0f, 1f) * size.width
                            drawRect(
                                color = Color(0xFFF59E0B),
                                topLeft = Offset(leftX, 0f),
                                size = Size((rightX - leftX).coerceAtLeast(4f), size.height),
                            )
                        }
                        val progW = (positionMs.toFloat() / durationMs.toFloat()).coerceIn(0f, 1f) * size.width
                        drawRect(color = Color(0xFF38BDF8), size = Size(progW, size.height))
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(formatClock(positionMs), color = Color.White, fontSize = 13.sp)
                        Text(
                            if (commercials.isNotEmpty()) "${commercials.size} ad breaks marked in amber"
                            else "No ad breaks detected",
                            color = Color(0xFFFCD34D),
                            fontSize = 13.sp,
                        )
                        Text(formatClock(durationMs), color = Color.White, fontSize = 13.sp)
                    }
                }

                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Button(
                        onClick = { if (exoPlayer.isPlaying) exoPlayer.pause() else exoPlayer.play() },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0EA5E9)),
                    ) {
                        Text(if (isPlaying) "Pause" else "Play")
                    }
                    if (request is TvPlaybackRequest.Recording) {
                        Button(
                            onClick = { exoPlayer.seekTo((exoPlayer.currentPosition - 15_000L).coerceAtLeast(0L)) },
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1E293B)),
                        ) { Text("-15s") }
                        Button(
                            onClick = { exoPlayer.seekTo(exoPlayer.currentPosition + 30_000L) },
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1E293B)),
                        ) { Text("+30s") }
                        if (activeCommercial != null) {
                            Button(
                                onClick = { exoPlayer.seekTo((activeCommercial.endSec * 1000.0).toLong()) },
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFD97706)),
                            ) { Text("Skip Commercial") }
                        }
                    }
                }
            }
        }
    }
}

private fun formatClock(ms: Long): String {
    val totalSec = (ms / 1000L).coerceAtLeast(0L)
    val hrs = totalSec / 3600
    val mins = (totalSec % 3600) / 60
    val secs = totalSec % 60
    return if (hrs > 0) "%d:%02d:%02d".format(hrs, mins, secs) else "%d:%02d".format(mins, secs)
}
