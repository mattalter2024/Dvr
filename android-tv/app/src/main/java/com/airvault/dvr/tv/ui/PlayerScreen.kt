package com.airvault.dvr.tv.ui

import android.view.KeyEvent
import androidx.annotation.OptIn
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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

private val TivoCapsuleTop = Color(0xEE0B2252)
private val TivoCapsuleBottom = Color(0xF505102B)
private val TivoSkipGreen = Color(0xFF22C55E)
private val TivoGold = Color(0xFFFACC15)
private val TivoBlueBtn = Color(0xFF1D4ED8)
private val TivoBorder = Color(0x7793C5FD)

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

    LaunchedEffect(request) {
        lastSkippedSegId = null
        skipToast = null
        try {
            when (request) {
                is TvPlaybackRequest.Live -> {
                    commercials = emptyList()
                    val session = api.startLive(request.channel.id)
                    liveSession = session
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

    // 400ms playback monitor: Automatic TiVo SkipMode commercial skipping + Whole-House Resume Sync
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
                        delay(6_500)
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

    LaunchedEffect(hudVisible) {
        if (hudVisible) {
            delay(5500)
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

                    // Iconic TiVo 30-Second Advance on Right / FF
                    KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> {
                        exoPlayer.seekTo((exoPlayer.currentPosition + 30_000L).coerceAtLeast(0L))
                        true
                    }

                    // Iconic TiVo 8-Second Instant Replay (or Undo SkipMode if toast active) on Left / Rewind
                    KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_MEDIA_REWIND -> {
                        val toast = skipToast
                        if (toast != null) {
                            autoSkip = false
                            exoPlayer.seekTo(toast.second)
                            skipToast = null
                        } else {
                            exoPlayer.seekTo((exoPlayer.currentPosition - 8_000L).coerceAtLeast(0L))
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
                    useController = false // Custom TiVo-style TrickPlay & SkipMode OSD
                }
            },
            modifier = Modifier.fillMaxSize(),
        )

        if (statusText.isNotBlank()) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(statusText, color = Color(0xFFB6C9E8), fontSize = 18.sp)
            }
        }

        // TiVo SkipMode™ Toast
        skipToast?.let { (skippedSec, undoMs) ->
            Row(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(top = 84.dp, end = 32.dp)
                    .background(Color(0xEE062E18), RoundedCornerShape(16.dp))
                    .border(2.dp, TivoSkipGreen, RoundedCornerShape(16.dp))
                    .padding(horizontal = 20.dp, vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Column {
                    Text(
                        "SkipMode™ jumped ${formatClock(skippedSec * 1000L)} of commercials",
                        color = TivoSkipGreen,
                        fontWeight = FontWeight.ExtraBold,
                        fontSize = 16.sp,
                    )
                    Text(
                        "Press LEFT (8s Instant Replay) to undo",
                        color = Color(0xFFD1FAE5),
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
                    Text("Undo", color = Color.White, fontWeight = FontWeight.Bold)
                }
            }
        }

        if (hudVisible) {
            // Top TiVo Broadcast Bar
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .align(Alignment.TopCenter)
                    .background(Brush.verticalGradient(listOf(Color(0xE604102B), Color.Transparent)))
                    .padding(horizontal = 32.dp, vertical = 22.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column {
                    val heading = when (request) {
                        is TvPlaybackRequest.Live ->
                            "LIVE TV  •  ${request.channel.guideNumber} ${request.channel.guideName}"
                        is TvPlaybackRequest.Recording ->
                            "SKIPMODE  •  ${request.recording.title}"
                    }
                    Text(heading, color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold)
                    if (request is TvPlaybackRequest.Recording && request.recording.subtitle != null) {
                        Text(request.recording.subtitle, color = Color(0xFFB6C9E8), fontSize = 14.sp)
                    }
                }

                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (request is TvPlaybackRequest.Recording) {
                        Button(
                            onClick = { autoSkip = !autoSkip },
                            colors = ButtonDefaults.buttonColors(
                                containerColor = if (autoSkip) TivoSkipGreen else Color(0xFF153474),
                                contentColor = if (autoSkip) Color(0xFF032212) else Color.White,
                            ),
                        ) {
                            Text("Auto-SkipMode: ${if (autoSkip) "ON" else "OFF"}", fontWeight = FontWeight.Bold)
                        }
                    }
                    Button(
                        onClick = onClose,
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF153474)),
                    ) {
                        Text("Back")
                    }
                }
            }

            // Iconic TiVo Rounded TrickPlay Capsule Dock
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .align(Alignment.BottomCenter)
                    .padding(horizontal = 32.dp, vertical = 24.dp)
                    .background(
                        Brush.verticalGradient(listOf(TivoCapsuleTop, TivoCapsuleBottom)),
                        RoundedCornerShape(22.dp),
                    )
                    .border(2.dp, TivoBorder, RoundedCornerShape(22.dp))
                    .padding(horizontal = 24.dp, vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (request is TvPlaybackRequest.Recording && durationMs > 0L) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        Text(formatClock(positionMs), color = Color(0xFF86EFAC), fontWeight = FontWeight.Bold, fontSize = 14.sp)

                        Canvas(
                            modifier = Modifier
                                .weight(1f)
                                .height(14.dp),
                        ) {
                            drawRect(color = Color(0xDD020A1C), size = size)
                            // TiVo 20% tick marks
                            for (tickPct in listOf(0.2f, 0.4f, 0.6f, 0.8f)) {
                                drawLine(
                                    color = Color(0x44FFFFFF),
                                    start = Offset(size.width * tickPct, 0f),
                                    end = Offset(size.width * tickPct, size.height),
                                    strokeWidth = 2f,
                                )
                            }
                            // Gold commercial break segments
                            for (seg in commercials) {
                                val leftX = ((seg.startSec * 1000.0) / durationMs).toFloat().coerceIn(0f, 1f) * size.width
                                val rightX = ((seg.endSec * 1000.0) / durationMs).toFloat().coerceIn(0f, 1f) * size.width
                                drawRect(
                                    color = TivoGold,
                                    topLeft = Offset(leftX, 0f),
                                    size = Size((rightX - leftX).coerceAtLeast(5f), size.height),
                                )
                            }
                            // TiVo TrickPlay green progress bar
                            val progW = (positionMs.toFloat() / durationMs.toFloat()).coerceIn(0f, 1f) * size.width
                            drawRect(color = TivoSkipGreen, size = Size(progW, size.height))
                        }

                        Text(formatClock(durationMs), color = Color.White, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                    }
                }

                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (request is TvPlaybackRequest.Recording) {
                        Button(
                            onClick = { exoPlayer.seekTo((exoPlayer.currentPosition - 8_000L).coerceAtLeast(0L)) },
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF153474)),
                        ) { Text("↺ 8s Replay") }
                    }
                    Button(
                        onClick = { if (exoPlayer.isPlaying) exoPlayer.pause() else exoPlayer.play() },
                        colors = ButtonDefaults.buttonColors(containerColor = TivoBlueBtn),
                    ) {
                        Text(if (isPlaying) "Pause" else "Play", fontWeight = FontWeight.Bold)
                    }
                    if (request is TvPlaybackRequest.Recording) {
                        Button(
                            onClick = { exoPlayer.seekTo(exoPlayer.currentPosition + 30_000L) },
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF153474)),
                        ) { Text("+30s Advance") }
                        if (activeCommercial != null) {
                            Button(
                                onClick = { exoPlayer.seekTo((activeCommercial.endSec * 1000.0).toLong()) },
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = TivoSkipGreen,
                                    contentColor = Color(0xFF032212),
                                ),
                            ) { Text("SKIP COMMERCIAL", fontWeight = FontWeight.ExtraBold) }
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
