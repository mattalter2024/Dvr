package com.airvault.dvr.tv.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.ImageLoader
import coil.compose.AsyncImage
import coil.decode.SvgDecoder
import coil.disk.DiskCache
import coil.memory.MemoryCache
import java.io.File
import com.airvault.dvr.tv.data.*
import kotlinx.coroutines.launch

// Restrained Modern Dark Midnight-Slate Palette (subtle TiVo navy undertone)
private val TivoBgDeep = Color(0xFF0B101B)
private val TivoBgRail = Color(0xFF0E1422)
private val TivoPanel = Color(0xFF121A29)
private val TivoCard = Color(0xFF172133)
private val TivoAccent = Color(0xFF60A5FA)
private val TivoSkipGreen = Color(0xFF34D399)
private val TivoRecRed = Color(0xFFEF4444)
private val TivoMuted = Color(0xFF98A6BD)

private enum class TvSection(val label: String) {
    HOME("Home"),
    MY_SHOWS("My Shows"),
    GUIDE("Guide"),
    APPS("Streaming Apps"),
    TODO("To Do & OnePass"),
    SERVER("Settings"),
}

@Composable
private fun ShowScreenshot(
    url: String,
    contentDescription: String,
    imageLoader: ImageLoader,
    width: Dp,
    height: Dp,
    modifier: Modifier = Modifier,
) {
    AsyncImage(
        model = url,
        imageLoader = imageLoader,
        contentDescription = contentDescription,
        contentScale = ContentScale.Crop,
        modifier = modifier
            .size(width = width, height = height)
            .clip(RoundedCornerShape(8.dp))
            .background(Color(0xFF080C15))
            .border(1.dp, Color(0x18FFFFFF), RoundedCornerShape(8.dp)),
    )
}

@Composable
fun AirVaultTvApp() {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("airvault_tv", Context.MODE_PRIVATE) }
    val scope = rememberCoroutineScope()

    val imageLoader = remember(context) {
        ImageLoader.Builder(context)
            .components { add(SvgDecoder.Factory()) }
            .memoryCache {
                MemoryCache.Builder(context)
                    .maxSizePercent(0.20)
                    .build()
            }
            .diskCache {
                DiskCache.Builder()
                    .directory(File(context.cacheDir, "show_artwork"))
                    .maxSizeBytes(64L * 1024 * 1024)
                    .build()
            }
            .crossfade(120)
            .build()
    }

    var serverUrl by remember { mutableStateOf(prefs.getString("server_url", null)) }
    var serverName by remember { mutableStateOf("AirVault DVR") }
    var activeSection by remember { mutableStateOf(TvSection.HOME) }
    var playbackRequest by remember { mutableStateOf<TvPlaybackRequest?>(null) }

    var guideRows by remember { mutableStateOf<List<GuideRow>>(emptyList()) }
    var recordings by remember { mutableStateOf<List<DvrRecording>>(emptyList()) }
    var seriesPasses by remember { mutableStateOf<List<SeriesPass>>(emptyList()) }
    var streamingApps by remember { mutableStateOf<List<StreamingApp>>(emptyList()) }
    var selectedProgram by remember { mutableStateOf<Pair<TvChannel, TvProgram>?>(null) }
    var statusBanner by remember { mutableStateOf<String?>(null) }

    val api = remember(serverUrl) { serverUrl?.let { DvrApiClient(it) } }

    fun showBanner(msg: String) {
        statusBanner = msg
        scope.launch {
            kotlinx.coroutines.delay(4000)
            if (statusBanner == msg) statusBanner = null
        }
    }

    suspend fun refreshData(client: DvrApiClient) {
        runCatching {
            serverName = client.pingHealth()
            guideRows = client.fetchGuide(6)
            recordings = client.fetchRecordings()
            seriesPasses = client.fetchSeriesPasses()
            streamingApps = client.fetchApps()
        }.onFailure {
            showBanner("Connection error: ${it.message}")
        }
    }

    LaunchedEffect(api) {
        if (api != null) refreshData(api)
    }

    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = TivoAccent,
            background = TivoBgDeep,
            surface = TivoPanel,
            onBackground = Color.White,
            onSurface = Color.White,
        ),
    ) {
        if (api == null) {
            ServerConnectScreen(
                onConnected = { url ->
                    prefs.edit().putString("server_url", url).apply()
                    serverUrl = url
                },
            )
            return@MaterialTheme
        }

        val currentPlayback = playbackRequest
        if (currentPlayback != null) {
            PlayerScreen(
                api = api,
                request = currentPlayback,
                channels = guideRows.map { it.channel },
                onClose = {
                    playbackRequest = null
                    scope.launch { refreshData(api) }
                },
                onSwitchChannel = { ch -> playbackRequest = TvPlaybackRequest.Live(ch) },
            )
            return@MaterialTheme
        }

        Row(
            modifier = Modifier
                .fillMaxSize()
                .background(TivoBgDeep),
        ) {
            // Restrained Left Navigation Rail
            Column(
                modifier = Modifier
                    .width(216.dp)
                    .fillMaxHeight()
                    .background(TivoBgRail)
                    .padding(18.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text("AirVault", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Color.White)
                Text(
                    serverName,
                    fontSize = 12.sp,
                    color = TivoMuted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(14.dp))

                TvSection.entries.forEach { section ->
                    val isSelected = section == activeSection
                    Button(
                        onClick = { activeSection = section },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(10.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (isSelected) Color(0x2660A5FA) else Color.Transparent,
                            contentColor = if (isSelected) Color.White else TivoMuted,
                        ),
                    ) {
                        Text(
                            section.label,
                            modifier = Modifier.fillMaxWidth(),
                            fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Medium,
                        )
                    }
                }

                Spacer(Modifier.weight(1f))
                Button(
                    onClick = { scope.launch { refreshData(api) } },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(10.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = TivoCard),
                ) {
                    Text("Refresh")
                }
            }

            // Main Stage
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .padding(26.dp),
            ) {
                when (activeSection) {
                    TvSection.HOME -> {
                        HomeTvView(
                            api = api,
                            imageLoader = imageLoader,
                            guideRows = guideRows,
                            recordings = recordings,
                            apps = streamingApps,
                            onWatchChannel = { ch -> playbackRequest = TvPlaybackRequest.Live(ch) },
                            onPlayRecording = { rec -> playbackRequest = TvPlaybackRequest.Recording(rec) },
                            onLaunchApp = { app ->
                                val ok = launchStreamingApp(context, app)
                                if (!ok) showBanner("Unable to launch ${app.name} on this TV")
                            },
                            onOpenGuide = { activeSection = TvSection.GUIDE },
                        )
                    }

                    TvSection.MY_SHOWS -> {
                        MyShowsTvView(
                            api = api,
                            imageLoader = imageLoader,
                            recordings = recordings.filter { it.status == "completed" || it.status == "recording" },
                            onPlay = { rec -> playbackRequest = TvPlaybackRequest.Recording(rec) },
                            onScanCommercials = { rec ->
                                scope.launch {
                                    runCatching { api.scanCommercials(rec.id) }
                                        .onSuccess { count ->
                                            showBanner("Commercial scan complete: $count ad break(s)")
                                            refreshData(api)
                                        }
                                }
                            },
                        )
                    }

                    TvSection.GUIDE -> {
                        GuideTvView(
                            api = api,
                            imageLoader = imageLoader,
                            rows = guideRows,
                            onWatchChannel = { ch -> playbackRequest = TvPlaybackRequest.Live(ch) },
                            onSelectProgram = { ch, prog -> selectedProgram = ch to prog },
                        )
                    }

                    TvSection.APPS -> {
                        StreamingAppsTvView(
                            apps = streamingApps,
                            onLaunch = { app ->
                                val ok = launchStreamingApp(context, app)
                                if (!ok) showBanner("Unable to launch ${app.name} on this TV")
                            },
                        )
                    }

                    TvSection.TODO -> {
                        ScheduleTvView(
                            api = api,
                            imageLoader = imageLoader,
                            upcoming = recordings.filter {
                                it.status == "scheduled" || it.status == "conflict" || it.status == "recording"
                            },
                            passes = seriesPasses,
                        )
                    }

                    TvSection.SERVER -> {
                        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                            Text("Server Settings", fontSize = 22.sp, fontWeight = FontWeight.Bold)
                            Text("Server: $serverName", color = TivoMuted, fontSize = 15.sp)
                            Text("URL: ${api.baseUrl}", color = TivoAccent, fontSize = 15.sp)
                            Button(
                                onClick = {
                                    prefs.edit().remove("server_url").apply()
                                    serverUrl = null
                                },
                                shape = RoundedCornerShape(10.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = TivoCard),
                            ) {
                                Text("Switch DVR Server")
                            }
                        }
                    }
                }

                statusBanner?.let { msg ->
                    Box(
                        modifier = Modifier
                            .align(Alignment.BottomEnd)
                            .background(TivoCard, RoundedCornerShape(10.dp))
                            .border(1.dp, Color(0x33FFFFFF), RoundedCornerShape(10.dp))
                            .padding(horizontal = 16.dp, vertical = 10.dp),
                    ) {
                        Text(msg, color = Color.White, fontSize = 14.sp)
                    }
                }
            }
        }

        // Program Action Dialog with 16:9 Show Screenshot
        selectedProgram?.let { (channel, program) ->
            AlertDialog(
                onDismissRequest = { selectedProgram = null },
                containerColor = TivoPanel,
                title = {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        AsyncImage(
                            model = api.programScreenshotUrl(program, channel),
                            imageLoader = imageLoader,
                            contentDescription = program.title,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier
                                .fillMaxWidth()
                                .aspectRatio(16f / 9f)
                                .clip(RoundedCornerShape(10.dp))
                                .background(Color(0xFF080C15)),
                        )
                        Text("${channel.guideNumber} ${channel.guideName}", color = TivoAccent, fontSize = 13.sp)
                        Text(program.title, fontWeight = FontWeight.Bold, fontSize = 20.sp)
                    }
                },
                text = {
                    Text(
                        program.description ?: "Over-the-air broadcast program.",
                        color = TivoMuted,
                        fontSize = 14.sp,
                    )
                },
                confirmButton = {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = {
                                selectedProgram = null
                                playbackRequest = TvPlaybackRequest.Live(channel)
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF2563EB)),
                        ) { Text("Watch Live", color = Color.White) }

                        Button(
                            onClick = {
                                selectedProgram = null
                                scope.launch {
                                    runCatching { api.scheduleProgram(program.id) }
                                        .onSuccess {
                                            showBanner("Scheduled \"${program.title}\"")
                                            refreshData(api)
                                        }
                                }
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0x33EF4444), contentColor = Color(0xFFFCA5A5)),
                        ) { Text("Record") }

                        Button(
                            onClick = {
                                selectedProgram = null
                                scope.launch {
                                    runCatching { api.createSeriesPass(program.title, channel.id, newOnly = true) }
                                        .onSuccess {
                                            showBanner("OnePass created for \"${program.title}\"")
                                            refreshData(api)
                                        }
                                }
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = TivoCard),
                        ) { Text("OnePass") }
                    }
                },
            )
        }
    }
}

@Composable
private fun ServerConnectScreen(onConnected: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    var discovered by remember { mutableStateOf<List<DiscoveredServer>>(emptyList()) }
    var scanning by remember { mutableStateOf(true) }
    var manualIp by remember { mutableStateOf("http://192.168.1.100:8096") }
    var errorMsg by remember { mutableStateOf<String?>(null) }

    fun scan() {
        scanning = true
        errorMsg = null
        scope.launch {
            discovered = ServerDiscovery.discover()
            scanning = false
        }
    }

    LaunchedEffect(Unit) { scan() }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(TivoBgDeep)
            .padding(48.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Text("AirVault DVR", fontSize = 28.sp, fontWeight = FontWeight.Bold, color = Color.White)
        Text(
            if (scanning) "Scanning your home Wi-Fi for AirVault DVR servers..."
            else "Select your home DVR server or enter its LAN address:",
            color = TivoMuted,
            fontSize = 15.sp,
        )

        if (discovered.isNotEmpty()) {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                items(discovered) { server ->
                    Button(
                        onClick = { onConnected(server.baseUrl) },
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = TivoCard),
                        border = BorderStroke(1.dp, TivoAccent),
                        modifier = Modifier.height(84.dp),
                    ) {
                        Column(Modifier.padding(horizontal = 10.dp)) {
                            Text(server.serverName, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
                            Text(server.baseUrl, fontSize = 13.sp, color = TivoAccent)
                        }
                    }
                }
            }
        }

        Row(
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedTextField(
                value = manualIp,
                onValueChange = { manualIp = it },
                label = { Text("DVR Server URL") },
                singleLine = true,
                modifier = Modifier.width(340.dp),
            )
            Button(
                onClick = {
                    scope.launch {
                        runCatching { DvrApiClient(manualIp.trim()).pingHealth() }
                            .onSuccess { onConnected(manualIp.trim()) }
                            .onFailure { errorMsg = "Unable to connect: ${it.message}" }
                    }
                },
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF2563EB)),
            ) {
                Text("Connect", color = Color.White)
            }
            Button(
                onClick = { scan() },
                colors = ButtonDefaults.buttonColors(containerColor = TivoCard),
            ) {
                Text("Re-Scan LAN")
            }
        }

        errorMsg?.let { Text(it, color = TivoRecRed) }
    }
}

@Composable
private fun GuideTvView(
    api: DvrApiClient,
    imageLoader: ImageLoader,
    rows: List<GuideRow>,
    onWatchChannel: (TvChannel) -> Unit,
    onSelectProgram: (TvChannel, TvProgram) -> Unit,
) {
    var highlighted by remember(rows) {
        mutableStateOf(
            rows.firstOrNull()?.let { r -> r.programs.firstOrNull()?.let { r.channel to it } },
        )
    }

    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("Guide", fontSize = 22.sp, fontWeight = FontWeight.Bold)

        // Top Program Synopsis Banner with 16:9 Show Screenshot
        highlighted?.let { (ch, prog) ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(TivoPanel, RoundedCornerShape(14.dp))
                    .border(1.dp, Color(0x1EFFFFFF), RoundedCornerShape(14.dp))
                    .padding(14.dp),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                ShowScreenshot(
                    url = api.programScreenshotUrl(prog, ch),
                    contentDescription = prog.title,
                    imageLoader = imageLoader,
                    width = 160.dp,
                    height = 90.dp,
                )
                Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(
                        "${ch.guideNumber} ${ch.guideName}  ·  ${prog.category}${prog.episodeNum?.let { " · $it" } ?: ""}",
                        color = TivoAccent,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(prog.title, fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Color.White)
                    Text(
                        prog.description ?: "Over-the-air broadcast television program.",
                        color = TivoMuted,
                        fontSize = 13.sp,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }

        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(rows, key = { it.channel.id }) { row ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Surface(
                        color = TivoPanel,
                        shape = RoundedCornerShape(10.dp),
                        border = BorderStroke(1.dp, Color(0x18FFFFFF)),
                        modifier = Modifier
                            .width(146.dp)
                            .height(68.dp)
                            .clickable { onWatchChannel(row.channel) },
                    ) {
                        Column(
                            modifier = Modifier.padding(10.dp),
                            verticalArrangement = Arrangement.Center,
                        ) {
                            Text(row.channel.guideNumber, color = TivoAccent, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                            Text(row.channel.guideName, color = TivoMuted, fontSize = 12.sp, maxLines = 1)
                        }
                    }

                    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(row.programs.take(8), key = { it.id }) { prog ->
                            val isCurrentHighlight = highlighted?.second?.id == prog.id
                            Surface(
                                color = if (isCurrentHighlight) Color(0xFF1D2A40) else TivoCard,
                                shape = RoundedCornerShape(10.dp),
                                border = if (isCurrentHighlight) BorderStroke(1.5.dp, TivoAccent) else null,
                                modifier = Modifier
                                    .width(248.dp)
                                    .height(68.dp)
                                    .clickable {
                                        highlighted = row.channel to prog
                                        onSelectProgram(row.channel, prog)
                                    },
                            ) {
                                Row(
                                    modifier = Modifier.padding(8.dp),
                                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    ShowScreenshot(
                                        url = api.programScreenshotUrl(prog, row.channel),
                                        contentDescription = prog.title,
                                        imageLoader = imageLoader,
                                        width = 72.dp,
                                        height = 41.dp,
                                    )
                                    Column(verticalArrangement = Arrangement.Center) {
                                        Text(
                                            prog.title,
                                            color = Color.White,
                                            fontWeight = FontWeight.SemiBold,
                                            fontSize = 13.sp,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis,
                                        )
                                        Text(
                                            listOfNotNull(prog.category, prog.episodeNum)
                                                .joinToString(" · "),
                                            color = TivoMuted,
                                            fontSize = 11.sp,
                                            maxLines = 1,
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MyShowsTvView(
    api: DvrApiClient,
    imageLoader: ImageLoader,
    recordings: List<DvrRecording>,
    onPlay: (DvrRecording) -> Unit,
    onScanCommercials: (DvrRecording) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("My Shows", fontSize = 22.sp, fontWeight = FontWeight.Bold)
        if (recordings.isEmpty()) {
            Text(
                "No recordings yet. Select any program in the Guide to record it.",
                color = TivoMuted,
                fontSize = 15.sp,
            )
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(recordings, key = { it.id }) { rec ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(TivoPanel, RoundedCornerShape(12.dp))
                            .border(1.dp, Color(0x16FFFFFF), RoundedCornerShape(12.dp))
                            .padding(12.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Row(
                            modifier = Modifier.weight(1f),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(14.dp),
                        ) {
                            ShowScreenshot(
                                url = api.recordingThumbnailUrl(rec.id),
                                contentDescription = rec.title,
                                imageLoader = imageLoader,
                                width = 124.dp,
                                height = 70.dp,
                            )
                            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                Row(
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Box(
                                        modifier = Modifier
                                            .size(8.dp)
                                            .background(
                                                if (rec.status == "recording") TivoRecRed else TivoSkipGreen,
                                                CircleShape,
                                            ),
                                    )
                                    Text(rec.title, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
                                    if (rec.commercialCount > 0) {
                                        Text(
                                            "Skip (${rec.commercialCount})",
                                            color = TivoSkipGreen,
                                            fontSize = 11.sp,
                                            fontWeight = FontWeight.SemiBold,
                                            modifier = Modifier
                                                .background(Color(0x2234D399), RoundedCornerShape(5.dp))
                                                .padding(horizontal = 6.dp, vertical = 2.dp),
                                        )
                                    }
                                }
                                Text(
                                    "Ch ${rec.channelNumber} ${rec.channelName}${rec.subtitle?.let { " · $it" } ?: ""}",
                                    color = TivoMuted,
                                    fontSize = 12.sp,
                                )
                            }
                        }

                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(
                                onClick = { onPlay(rec) },
                                shape = RoundedCornerShape(8.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF2563EB)),
                            ) {
                                Text(if (rec.watchedPositionSec > 5) "Resume" else "Watch", color = Color.White)
                            }
                            Button(
                                onClick = { onScanCommercials(rec) },
                                shape = RoundedCornerShape(8.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = TivoCard),
                            ) {
                                Text("Scan Ads")
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ScheduleTvView(
    api: DvrApiClient,
    imageLoader: ImageLoader,
    upcoming: List<DvrRecording>,
    passes: List<SeriesPass>,
) {
    LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Text("To Do List (${upcoming.size})", fontSize = 20.sp, fontWeight = FontWeight.Bold) }
        items(upcoming, key = { it.id }) { rec ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(TivoPanel, RoundedCornerShape(12.dp))
                    .padding(12.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    ShowScreenshot(
                        url = api.recordingThumbnailUrl(rec.id),
                        contentDescription = rec.title,
                        imageLoader = imageLoader,
                        width = 96.dp,
                        height = 54.dp,
                    )
                    Column {
                        Text(rec.title, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                        Text("Ch ${rec.channelNumber} ${rec.channelName}", color = TivoMuted, fontSize = 12.sp)
                    }
                }
                Text(
                    if (rec.status == "conflict") "Conflict" else "R",
                    color = Color.White,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier
                        .background(if (rec.status == "conflict") Color(0xFFD97706) else TivoRecRed, RoundedCornerShape(5.dp))
                        .padding(horizontal = 8.dp, vertical = 3.dp),
                )
            }
        }
        item {
            Spacer(Modifier.height(6.dp))
            Text("OnePass Manager (${passes.size})", fontSize = 20.sp, fontWeight = FontWeight.Bold)
        }
        items(passes, key = { it.id }) { pass ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(TivoPanel, RoundedCornerShape(12.dp))
                    .padding(12.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    ShowScreenshot(
                        url = api.titleScreenshotUrl(pass.title, "Drama", "OnePass"),
                        contentDescription = pass.title,
                        imageLoader = imageLoader,
                        width = 96.dp,
                        height = 54.dp,
                    )
                    Text("RR  ${pass.title}", fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                }
                Text(
                    if (pass.newOnly) "New Only" else "New & Reruns",
                    color = TivoMuted,
                    fontSize = 12.sp,
                )
            }
        }
    }
}

@Composable
private fun HomeTvView(
    api: DvrApiClient,
    imageLoader: ImageLoader,
    guideRows: List<GuideRow>,
    recordings: List<DvrRecording>,
    apps: List<StreamingApp>,
    onWatchChannel: (TvChannel) -> Unit,
    onPlayRecording: (DvrRecording) -> Unit,
    onLaunchApp: (StreamingApp) -> Unit,
    onOpenGuide: () -> Unit,
) {
    val frequentRows = remember(guideRows) {
        guideRows.sortedWith(
            compareByDescending<GuideRow> { it.channel.watchCount }
                .thenByDescending { it.channel.favorite },
        )
    }
    var heroRow by remember(frequentRows) { mutableStateOf(frequentRows.firstOrNull()) }

    val latestRecordings = remember(recordings) {
        val active = recordings.filter { it.status == "recording" }
        val completed = recordings.filter { it.status == "completed" }
        (active + completed).take(10)
    }

    LazyColumn(verticalArrangement = Arrangement.spacedBy(20.dp)) {
        // 1. DIRECTV Stream-style "Your TV" Hero Preview + Frequent Channels Strip
        item {
            val activeHero = heroRow ?: frequentRows.firstOrNull()
            if (activeHero != null) {
                val heroProg = activeHero.programs.firstOrNull()
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(14.dp))
                        .background(TivoPanel)
                        .border(1.dp, Color(0x18FFFFFF), RoundedCornerShape(14.dp)),
                ) {
                    if (heroProg != null) {
                        AsyncImage(
                            model = api.programScreenshotUrl(heroProg, activeHero.channel),
                            imageLoader = imageLoader,
                            contentDescription = heroProg.title,
                            contentScale = ContentScale.Crop,
                            alpha = 0.42f,
                            modifier = Modifier.matchParentSize(),
                        )
                    }
                    Box(
                        modifier = Modifier
                            .matchParentSize()
                            .background(
                                Brush.verticalGradient(
                                    listOf(Color(0x550B101B), Color(0xEE0B101B)),
                                ),
                            ),
                    )
                    Column(
                        modifier = Modifier.padding(18.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(
                                "${activeHero.channel.guideNumber} ${activeHero.channel.guideName}",
                                color = TivoAccent,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.SemiBold,
                            )
                            Text(
                                heroProg?.title ?: "${activeHero.channel.guideName} Live",
                                fontSize = 24.sp,
                                fontWeight = FontWeight.Bold,
                                color = Color.White,
                            )
                            heroProg?.description?.let {
                                Text(
                                    it,
                                    color = TivoMuted,
                                    fontSize = 13.sp,
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                            Row(
                                horizontalArrangement = Arrangement.spacedBy(10.dp),
                                modifier = Modifier.padding(top = 6.dp),
                            ) {
                                Button(
                                    onClick = { onWatchChannel(activeHero.channel) },
                                    shape = RoundedCornerShape(8.dp),
                                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF2563EB)),
                                ) { Text("Watch Live", color = Color.White) }
                                Button(
                                    onClick = onOpenGuide,
                                    shape = RoundedCornerShape(8.dp),
                                    colors = ButtonDefaults.buttonColors(containerColor = TivoCard),
                                ) { Text("Full Guide") }
                            }
                        }

                        Text("Frequent Channels", color = TivoMuted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            items(frequentRows, key = { it.channel.id }) { row ->
                                val selected = activeHero.channel.id == row.channel.id
                                val mark = row.channel.network
                                    .takeIf { it.isNotBlank() && it != "OTA" }
                                    ?.removePrefix("The ")
                                    ?: row.channel.guideName.substringBefore("-")
                                Surface(
                                    color = if (selected) Color(0xFF1D2A40) else Color(0xCC121A29),
                                    shape = RoundedCornerShape(12.dp),
                                    border = BorderStroke(
                                        if (selected) 1.5.dp else 1.dp,
                                        if (selected) TivoAccent else Color(0x18FFFFFF),
                                    ),
                                    modifier = Modifier
                                        .size(width = 104.dp, height = 74.dp)
                                        .clickable {
                                            if (selected) onWatchChannel(row.channel)
                                            else heroRow = row
                                        },
                                ) {
                                    Column(
                                        modifier = Modifier.fillMaxSize().padding(8.dp),
                                        horizontalAlignment = Alignment.CenterHorizontally,
                                        verticalArrangement = Arrangement.Center,
                                    ) {
                                        Text(
                                            mark,
                                            color = Color.White,
                                            fontSize = 17.sp,
                                            fontWeight = FontWeight.ExtraBold,
                                            maxLines = 1,
                                        )
                                        Text(
                                            row.channel.guideNumber,
                                            color = TivoMuted,
                                            fontSize = 11.sp,
                                            fontWeight = FontWeight.SemiBold,
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // 2. Latest Recordings Row
        item {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Latest Recordings", fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = TivoMuted)
                if (latestRecordings.isEmpty()) {
                    Text(
                        "No recordings yet. Pick a show from the Guide to record.",
                        color = TivoMuted,
                        fontSize = 13.sp,
                    )
                } else {
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        items(latestRecordings, key = { it.id }) { rec ->
                            Surface(
                                color = TivoPanel,
                                shape = RoundedCornerShape(10.dp),
                                border = BorderStroke(1.dp, Color(0x16FFFFFF)),
                                modifier = Modifier
                                    .width(220.dp)
                                    .clickable { onPlayRecording(rec) },
                            ) {
                                Column {
                                    ShowScreenshot(
                                        url = api.recordingThumbnailUrl(rec.id),
                                        contentDescription = rec.title,
                                        imageLoader = imageLoader,
                                        width = 220.dp,
                                        height = 124.dp,
                                    )
                                    Column(Modifier.padding(10.dp)) {
                                        Text(
                                            rec.title,
                                            color = Color.White,
                                            fontSize = 14.sp,
                                            fontWeight = FontWeight.SemiBold,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis,
                                        )
                                        Text(
                                            "Ch ${rec.channelNumber} · ${if (rec.commercialCount > 0) "Skip (${rec.commercialCount})" else rec.channelName}",
                                            color = if (rec.commercialCount > 0) TivoSkipGreen else TivoMuted,
                                            fontSize = 11.sp,
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // 3. Streaming Apps Row
        if (apps.isNotEmpty()) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Streaming Apps", fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = TivoMuted)
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        items(apps.filter { it.pinned }, key = { it.id }) { app ->
                            val tint = remember(app.brandColor) {
                                runCatching { Color(android.graphics.Color.parseColor(app.brandColor)) }
                                    .getOrDefault(TivoCard)
                            }
                            Surface(
                                color = TivoPanel,
                                shape = RoundedCornerShape(10.dp),
                                border = BorderStroke(1.dp, Color(0x18FFFFFF)),
                                modifier = Modifier
                                    .width(188.dp)
                                    .clickable { onLaunchApp(app) },
                            ) {
                                Row(
                                    modifier = Modifier.padding(12.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                                ) {
                                    Box(
                                        modifier = Modifier
                                            .size(38.dp)
                                            .clip(RoundedCornerShape(8.dp))
                                            .background(tint.copy(alpha = 0.35f)),
                                        contentAlignment = Alignment.Center,
                                    ) {
                                        Text(app.monogram, color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                                    }
                                    Column {
                                        Text(app.name, color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                                        Text(app.category, color = TivoMuted, fontSize = 11.sp)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun StreamingAppsTvView(
    apps: List<StreamingApp>,
    onLaunch: (StreamingApp) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("Streaming Apps", fontSize = 22.sp, fontWeight = FontWeight.Bold)
        if (apps.isEmpty()) {
            Text(
                "No streaming apps configured yet. Add them from the DVR web interface.",
                color = TivoMuted,
                fontSize = 15.sp,
            )
        } else {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                items(apps, key = { it.id }) { app ->
                    val tint = remember(app.brandColor) {
                        runCatching { Color(android.graphics.Color.parseColor(app.brandColor)) }
                            .getOrDefault(TivoCard)
                    }
                    Surface(
                        color = TivoPanel,
                        shape = RoundedCornerShape(14.dp),
                        border = BorderStroke(1.dp, Color(0x1CFFFFFF)),
                        modifier = Modifier
                            .width(240.dp)
                            .clickable { onLaunch(app) },
                    ) {
                        Column {
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(124.dp)
                                    .background(tint.copy(alpha = 0.28f)),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    app.monogram,
                                    color = Color.White,
                                    fontSize = if (app.monogram.length > 3) 24.sp else 34.sp,
                                    fontWeight = FontWeight.ExtraBold,
                                    letterSpacing = 2.sp,
                                )
                            }
                            Column(
                                modifier = Modifier.padding(14.dp),
                                verticalArrangement = Arrangement.spacedBy(4.dp),
                            ) {
                                Text(app.name, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
                                Text(
                                    app.tagline.ifBlank { app.category },
                                    fontSize = 12.sp,
                                    color = TivoMuted,
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

private fun launchStreamingApp(context: Context, app: StreamingApp): Boolean {
    val pm = context.packageManager
    val candidates = listOfNotNull(
        app.androidPackage.takeIf { it.isNotBlank() },
        app.fallbackAndroidPackage?.takeIf { it.isNotBlank() },
    )
    for (pkg in candidates) {
        val intent = pm.getLeanbackLaunchIntentForPackage(pkg) ?: pm.getLaunchIntentForPackage(pkg)
        if (intent != null) {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            return true
        }
    }
    // Fallback: open Play Store / Appstore listing or web URL if not yet installed on this TV
    val fallbackUri = if (candidates.isNotEmpty()) {
        Uri.parse("market://details?id=${candidates.first()}")
    } else {
        Uri.parse(app.webUrl)
    }
    return runCatching {
        context.startActivity(Intent(Intent.ACTION_VIEW, fallbackUri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
    }.getOrElse {
        runCatching {
            context.startActivity(
                Intent(Intent.ACTION_VIEW, Uri.parse(app.webUrl)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            true
        }.getOrDefault(false)
    }
}
