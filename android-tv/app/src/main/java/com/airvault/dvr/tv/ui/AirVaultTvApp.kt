package com.airvault.dvr.tv.ui

import android.content.Context
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.airvault.dvr.tv.data.*
import kotlinx.coroutines.launch

private val BgCanvas = Color(0xFF070B14)
private val BgSurface = Color(0xFF0F1624)
private val BgCard = Color(0xFF172136)
private val AccentCyan = Color(0xFF38BDF8)
private val AdAmber = Color(0xFFF59E0B)
private val RecRed = Color(0xFFEF4444)

private enum class TvSection(val label: String) {
    GUIDE("Live TV & Guide"),
    RECORDINGS("DVR Library"),
    SCHEDULE("Schedule & Passes"),
    SERVER("Server Setup"),
}

@Composable
fun AirVaultTvApp() {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("airvault_tv", Context.MODE_PRIVATE) }
    val scope = rememberCoroutineScope()

    var serverUrl by remember { mutableStateOf(prefs.getString("server_url", null)) }
    var serverName by remember { mutableStateOf("AirVault Home DVR") }
    var activeSection by remember { mutableStateOf(TvSection.GUIDE) }
    var playbackRequest by remember { mutableStateOf<TvPlaybackRequest?>(null) }

    var guideRows by remember { mutableStateOf<List<GuideRow>>(emptyList()) }
    var recordings by remember { mutableStateOf<List<DvrRecording>>(emptyList()) }
    var seriesPasses by remember { mutableStateOf<List<SeriesPass>>(emptyList()) }
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
        }.onFailure {
            showBanner("Connection error: ${it.message}")
        }
    }

    LaunchedEffect(api) {
        if (api != null) refreshData(api)
    }

    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = AccentCyan,
            background = BgCanvas,
            surface = BgSurface,
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
                .background(BgCanvas),
        ) {
            // Left 10-foot TV Navigation Rail
            Column(
                modifier = Modifier
                    .width(220.dp)
                    .fillMaxHeight()
                    .background(BgSurface)
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text("AirVault", fontSize = 24.sp, fontWeight = FontWeight.ExtraBold, color = Color.White)
                Text(serverName, fontSize = 12.sp, color = AccentCyan, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Spacer(Modifier.height(12.dp))

                TvSection.entries.forEach { section ->
                    val isSelected = section == activeSection
                    Button(
                        onClick = { activeSection = section },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (isSelected) Color(0x3338BDF8) else Color.Transparent,
                            contentColor = if (isSelected) Color.White else Color(0xFF94A3B8),
                        ),
                        border = if (isSelected) BorderStroke(1.dp, AccentCyan) else null,
                    ) {
                        Text(section.label, modifier = Modifier.fillMaxWidth(), fontWeight = FontWeight.SemiBold)
                    }
                }

                Spacer(Modifier.weight(1f))
                Button(
                    onClick = { scope.launch { refreshData(api) } },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = BgCard),
                ) {
                    Text("Refresh DVR")
                }
            }

            // Main TV Content Stage
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .padding(28.dp),
            ) {
                when (activeSection) {
                    TvSection.GUIDE -> {
                        GuideTvView(
                            rows = guideRows,
                            onWatchChannel = { ch -> playbackRequest = TvPlaybackRequest.Live(ch) },
                            onSelectProgram = { ch, prog -> selectedProgram = ch to prog },
                        )
                    }

                    TvSection.RECORDINGS -> {
                        RecordingsTvView(
                            recordings = recordings.filter { it.status == "completed" || it.status == "recording" },
                            onPlay = { rec -> playbackRequest = TvPlaybackRequest.Recording(rec) },
                            onScanCommercials = { rec ->
                                scope.launch {
                                    runCatching { api.scanCommercials(rec.id) }
                                        .onSuccess { count ->
                                            showBanner("Detected $count commercial break(s)")
                                            refreshData(api)
                                        }
                                }
                            },
                        )
                    }

                    TvSection.SCHEDULE -> {
                        ScheduleTvView(
                            upcoming = recordings.filter { it.status == "scheduled" || it.status == "conflict" || it.status == "recording" },
                            passes = seriesPasses,
                        )
                    }

                    TvSection.SERVER -> {
                        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                            Text("Connected DVR Server", fontSize = 26.sp, fontWeight = FontWeight.Bold)
                            Text("Server: $serverName", color = Color(0xFF94A3B8), fontSize = 16.sp)
                            Text("URL: ${api.baseUrl}", color = AccentCyan, fontSize = 16.sp)
                            Button(
                                onClick = {
                                    prefs.edit().remove("server_url").apply()
                                    serverUrl = null
                                },
                                colors = ButtonDefaults.buttonColors(containerColor = RecRed),
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
                            .background(Color(0xEE13223B), RoundedCornerShape(12.dp))
                            .border(1.dp, AccentCyan, RoundedCornerShape(12.dp))
                            .padding(horizontal = 18.dp, vertical = 12.dp),
                    ) {
                        Text(msg, color = Color.White, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }

        // Program Action Dialog (Watch Live / Record Episode / Series Pass)
        selectedProgram?.let { (channel, program) ->
            AlertDialog(
                onDismissRequest = { selectedProgram = null },
                containerColor = BgSurface,
                title = {
                    Column {
                        Text("${channel.guideNumber} ${channel.guideName}", color = AccentCyan, fontSize = 13.sp)
                        Text(program.title, fontWeight = FontWeight.ExtraBold, fontSize = 22.sp)
                    }
                },
                text = {
                    Text(
                        program.description ?: "Over-the-air broadcast program.",
                        color = Color(0xFFCBD5E1),
                        fontSize = 15.sp,
                    )
                },
                confirmButton = {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = {
                                selectedProgram = null
                                playbackRequest = TvPlaybackRequest.Live(channel)
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = AccentCyan),
                        ) { Text("Watch Live", color = Color.Black) }

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
                            colors = ButtonDefaults.buttonColors(containerColor = RecRed),
                        ) { Text("Record") }

                        Button(
                            onClick = {
                                selectedProgram = null
                                scope.launch {
                                    runCatching { api.createSeriesPass(program.title, channel.id, newOnly = true) }
                                        .onSuccess {
                                            showBanner("Series Pass added for \"${program.title}\"")
                                            refreshData(api)
                                        }
                                }
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = BgCard),
                        ) { Text("Series Pass") }
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
            .background(BgCanvas)
            .padding(48.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        Text("AirVault Whole-House DVR", fontSize = 32.sp, fontWeight = FontWeight.ExtraBold, color = Color.White)
        Text(
            if (scanning) "Scanning your home Wi-Fi for AirVault DVR servers..."
            else "Select a discovered DVR server or enter its LAN address:",
            color = Color(0xFF94A3B8),
            fontSize = 16.sp,
        )

        if (discovered.isNotEmpty()) {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                items(discovered) { server ->
                    Button(
                        onClick = { onConnected(server.baseUrl) },
                        shape = RoundedCornerShape(14.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = BgCard),
                        border = BorderStroke(1.dp, AccentCyan),
                        modifier = Modifier.height(92.dp),
                    ) {
                        Column(Modifier.padding(horizontal = 12.dp)) {
                            Text(server.serverName, fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Color.White)
                            Text(server.baseUrl, fontSize = 13.sp, color = AccentCyan)
                        }
                    }
                }
            }
        }

        Row(
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedTextField(
                value = manualIp,
                onValueChange = { manualIp = it },
                label = { Text("DVR Server URL") },
                singleLine = true,
                modifier = Modifier.width(360.dp),
            )
            Button(
                onClick = {
                    scope.launch {
                        runCatching { DvrApiClient(manualIp.trim()).pingHealth() }
                            .onSuccess { onConnected(manualIp.trim()) }
                            .onFailure { errorMsg = "Unable to connect: ${it.message}" }
                    }
                },
                colors = ButtonDefaults.buttonColors(containerColor = AccentCyan),
            ) {
                Text("Connect", color = Color.Black, fontWeight = FontWeight.Bold)
            }
            Button(
                onClick = { scan() },
                colors = ButtonDefaults.buttonColors(containerColor = BgCard),
            ) {
                Text("Re-Scan LAN")
            }
        }

        errorMsg?.let { Text(it, color = RecRed) }
    }
}

@Composable
private fun GuideTvView(
    rows: List<GuideRow>,
    onWatchChannel: (TvChannel) -> Unit,
    onSelectProgram: (TvChannel, TvProgram) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("Live TV Guide", fontSize = 26.sp, fontWeight = FontWeight.ExtraBold)
        LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            items(rows, key = { it.channel.id }) { row ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Surface(
                        color = BgSurface,
                        shape = RoundedCornerShape(12.dp),
                        border = BorderStroke(1.dp, Color(0x3338BDF8)),
                        modifier = Modifier
                            .width(160.dp)
                            .height(78.dp)
                            .clickable { onWatchChannel(row.channel) },
                    ) {
                        Column(
                            modifier = Modifier.padding(12.dp),
                            verticalArrangement = Arrangement.Center,
                        ) {
                            Text(row.channel.guideNumber, color = AccentCyan, fontWeight = FontWeight.ExtraBold, fontSize = 18.sp)
                            Text(row.channel.guideName, color = Color(0xFFCBD5E1), fontSize = 13.sp, maxLines = 1)
                        }
                    }

                    LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        items(row.programs.take(8), key = { it.id }) { prog ->
                            Surface(
                                color = BgCard,
                                shape = RoundedCornerShape(12.dp),
                                modifier = Modifier
                                    .width(240.dp)
                                    .height(78.dp)
                                    .clickable { onSelectProgram(row.channel, prog) },
                            ) {
                                Column(
                                    modifier = Modifier.padding(12.dp),
                                    verticalArrangement = Arrangement.Center,
                                ) {
                                    Text(
                                        prog.title,
                                        color = Color.White,
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 15.sp,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                    Text(
                                        listOfNotNull(prog.category, prog.episodeNum, if (prog.isNew) "NEW" else null)
                                            .joinToString(" · "),
                                        color = Color(0xFF94A3B8),
                                        fontSize = 12.sp,
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

@Composable
private fun RecordingsTvView(
    recordings: List<DvrRecording>,
    onPlay: (DvrRecording) -> Unit,
    onScanCommercials: (DvrRecording) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("DVR Library (Commercial-Skip Ready)", fontSize = 26.sp, fontWeight = FontWeight.ExtraBold)
        if (recordings.isEmpty()) {
            Text(
                "No recordings yet. Select any program in the Live TV Guide to record it.",
                color = Color(0xFF94A3B8),
                fontSize = 16.sp,
            )
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                items(recordings, key = { it.id }) { rec ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(BgCard, RoundedCornerShape(14.dp))
                            .padding(18.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(
                                "${rec.channelNumber} ${rec.channelName}  •  ${
                                    if (rec.commercialCount > 0) "${rec.commercialCount} ads marked"
                                    else rec.commercialScanStatus
                                }",
                                color = if (rec.commercialCount > 0) AdAmber else AccentCyan,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                            )
                            Text(rec.title, fontSize = 19.sp, fontWeight = FontWeight.Bold, color = Color.White)
                            rec.subtitle?.let {
                                Text(it, color = Color(0xFF94A3B8), fontSize = 13.sp)
                            }
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Button(
                                onClick = { onPlay(rec) },
                                colors = ButtonDefaults.buttonColors(containerColor = AccentCyan),
                            ) {
                                Text(if (rec.watchedPositionSec > 5) "Resume" else "Watch", color = Color.Black)
                            }
                            Button(
                                onClick = { onScanCommercials(rec) },
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF78350F)),
                            ) {
                                Text("Scan Ads", color = Color(0xFFFCD34D))
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ScheduleTvView(upcoming: List<DvrRecording>, passes: List<SeriesPass>) {
    LazyColumn(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        item { Text("Upcoming Recordings (${upcoming.size})", fontSize = 24.sp, fontWeight = FontWeight.ExtraBold) }
        items(upcoming, key = { it.id }) { rec ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(BgCard, RoundedCornerShape(12.dp))
                    .padding(16.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Column {
                    Text(rec.title, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                    Text("CH ${rec.channelNumber} ${rec.channelName}", color = Color(0xFF94A3B8), fontSize = 13.sp)
                }
                Text(
                    rec.status.uppercase(),
                    color = if (rec.status == "conflict") AdAmber else RecRed,
                    fontWeight = FontWeight.Bold,
                )
            }
        }
        item {
            Spacer(Modifier.height(8.dp))
            Text("Series Passes (${passes.size})", fontSize = 24.sp, fontWeight = FontWeight.ExtraBold)
        }
        items(passes, key = { it.id }) { pass ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(BgSurface, RoundedCornerShape(12.dp))
                    .padding(16.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(pass.title, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                Text(
                    if (pass.newOnly) "New Episodes Only" else "All Episodes",
                    color = AccentCyan,
                    fontSize = 13.sp,
                )
            }
        }
    }
}
