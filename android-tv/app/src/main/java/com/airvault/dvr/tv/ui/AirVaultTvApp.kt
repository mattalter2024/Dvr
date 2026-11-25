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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.airvault.dvr.tv.data.*
import kotlinx.coroutines.launch

// Restrained Modern Dark Midnight-Slate Palette (subtle TiVo navy undertone)
private val TivoBgDeep = Color(0xFF0B101B)
private val TivoBgRail = Color(0xFF0E1422)
private val TivoPanel = Color(0xFF121A29)
private val TivoCard = Color(0xFF172133)
private val TivoGold = Color(0xFF60A5FA)
private val TivoSkipGreen = Color(0xFF34D399)
private val TivoRecRed = Color(0xFFEF4444)
private val TivoCyan = Color(0xFF93C5FD)

private enum class TvSection(val label: String) {
    MY_SHOWS("My Shows"),
    GUIDE("Live TV Guide"),
    TODO("To Do & OnePass"),
    SERVER("Server Setup"),
}

@Composable
fun AirVaultTvApp() {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("airvault_tv", Context.MODE_PRIVATE) }
    val scope = rememberCoroutineScope()

    var serverUrl by remember { mutableStateOf(prefs.getString("server_url", null)) }
    var serverName by remember { mutableStateOf("AirVault Home DVR") }
    var activeSection by remember { mutableStateOf(TvSection.MY_SHOWS) }
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
            primary = TivoGold,
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
            // Classic TiVo Central Left Navigation Rail
            Column(
                modifier = Modifier
                    .width(236.dp)
                    .fillMaxHeight()
                    .background(TivoBgRail)
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text("AirVault", fontSize = 25.sp, fontWeight = FontWeight.Black, color = Color.White)
                Text(
                    "TiVo Central · $serverName",
                    fontSize = 12.sp,
                    color = TivoGold,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(10.dp))

                TvSection.entries.forEach { section ->
                    val isSelected = section == activeSection
                    Button(
                        onClick = { activeSection = section },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(999.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (isSelected) Color(0xFF1D4ED8) else Color.Transparent,
                            contentColor = if (isSelected) Color.White else Color(0xFFB6C9E8),
                        ),
                        border = if (isSelected) BorderStroke(2.dp, TivoGold) else null,
                    ) {
                        Text(section.label, modifier = Modifier.fillMaxWidth(), fontWeight = FontWeight.Bold)
                    }
                }

                Spacer(Modifier.weight(1f))
                Button(
                    onClick = { scope.launch { refreshData(api) } },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(999.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = TivoCard),
                ) {
                    Text("Refresh DVR", fontWeight = FontWeight.Bold)
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
                    TvSection.MY_SHOWS -> {
                        MyShowsTvView(
                            recordings = recordings.filter { it.status == "completed" || it.status == "recording" },
                            onPlay = { rec -> playbackRequest = TvPlaybackRequest.Recording(rec) },
                            onScanCommercials = { rec ->
                                scope.launch {
                                    runCatching { api.scanCommercials(rec.id) }
                                        .onSuccess { count ->
                                            showBanner("SkipMode™ ready: $count ad break(s) tagged")
                                            refreshData(api)
                                        }
                                }
                            },
                        )
                    }

                    TvSection.GUIDE -> {
                        GuideTvView(
                            rows = guideRows,
                            onWatchChannel = { ch -> playbackRequest = TvPlaybackRequest.Live(ch) },
                            onSelectProgram = { ch, prog -> selectedProgram = ch to prog },
                        )
                    }

                    TvSection.TODO -> {
                        ScheduleTvView(
                            upcoming = recordings.filter {
                                it.status == "scheduled" || it.status == "conflict" || it.status == "recording"
                            },
                            passes = seriesPasses,
                        )
                    }

                    TvSection.SERVER -> {
                        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                            Text("Connected DVR Server", fontSize = 26.sp, fontWeight = FontWeight.Black)
                            Text("Server: $serverName", color = Color(0xFFB6C9E8), fontSize = 16.sp)
                            Text("URL: ${api.baseUrl}", color = TivoGold, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                            Button(
                                onClick = {
                                    prefs.edit().remove("server_url").apply()
                                    serverUrl = null
                                },
                                shape = RoundedCornerShape(999.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = TivoRecRed),
                            ) {
                                Text("Switch DVR Server", fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }

                statusBanner?.let { msg ->
                    Box(
                        modifier = Modifier
                            .align(Alignment.BottomEnd)
                            .background(Color(0xEE0F2961), RoundedCornerShape(14.dp))
                            .border(2.dp, TivoGold, RoundedCornerShape(14.dp))
                            .padding(horizontal = 18.dp, vertical = 12.dp),
                    ) {
                        Text(msg, color = Color.White, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }

        // Program Action Dialog (Watch Live / Record (R) / OnePass (RR))
        selectedProgram?.let { (channel, program) ->
            AlertDialog(
                onDismissRequest = { selectedProgram = null },
                containerColor = TivoPanel,
                title = {
                    Column {
                        Text("${channel.guideNumber} ${channel.guideName}", color = TivoGold, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                        Text(program.title, fontWeight = FontWeight.Black, fontSize = 22.sp)
                    }
                },
                text = {
                    Text(
                        program.description ?: "Over-the-air broadcast program.",
                        color = Color(0xFFDBEAFE),
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
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1D4ED8)),
                        ) { Text("Watch Live", color = Color.White, fontWeight = FontWeight.Bold) }

                        Button(
                            onClick = {
                                selectedProgram = null
                                scope.launch {
                                    runCatching { api.scheduleProgram(program.id) }
                                        .onSuccess {
                                            showBanner("Added to To Do List: \"${program.title}\"")
                                            refreshData(api)
                                        }
                                }
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = TivoRecRed),
                        ) { Text("Record (R)", fontWeight = FontWeight.Bold) }

                        Button(
                            onClick = {
                                selectedProgram = null
                                scope.launch {
                                    runCatching { api.createSeriesPass(program.title, channel.id, newOnly = true) }
                                        .onSuccess {
                                            showBanner("OnePass™ created for \"${program.title}\"")
                                            refreshData(api)
                                        }
                                }
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = TivoGold, contentColor = Color.Black),
                        ) { Text("OnePass (RR)", fontWeight = FontWeight.Black) }
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
            .background(Brush.verticalGradient(listOf(Color(0xFF0A2257), TivoBgDeep)))
            .padding(48.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        Text("AirVault — TiVo-Style Whole-House DVR", fontSize = 32.sp, fontWeight = FontWeight.Black, color = Color.White)
        Text(
            if (scanning) "Scanning your home Wi-Fi for AirVault DVR servers..."
            else "Select your home DVR server or enter its LAN address:",
            color = Color(0xFFB6C9E8),
            fontSize = 16.sp,
        )

        if (discovered.isNotEmpty()) {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                items(discovered) { server ->
                    Button(
                        onClick = { onConnected(server.baseUrl) },
                        shape = RoundedCornerShape(16.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = TivoCard),
                        border = BorderStroke(2.dp, TivoGold),
                        modifier = Modifier.height(92.dp),
                    ) {
                        Column(Modifier.padding(horizontal = 12.dp)) {
                            Text(server.serverName, fontSize = 18.sp, fontWeight = FontWeight.ExtraBold, color = Color.White)
                            Text(server.baseUrl, fontSize = 13.sp, color = TivoGold)
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
                colors = ButtonDefaults.buttonColors(containerColor = TivoGold, contentColor = Color.Black),
            ) {
                Text("Connect", fontWeight = FontWeight.Black)
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
        Text("Live TV Guide", fontSize = 26.sp, fontWeight = FontWeight.Black)

        // Signature TiVo Top Synopsis Banner
        highlighted?.let { (ch, prog) ->
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(TivoPanel, RoundedCornerShape(16.dp))
                    .border(1.dp, TivoGold, RoundedCornerShape(16.dp))
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    "${ch.guideNumber} ${ch.guideName}  •  ${prog.category}${prog.episodeNum?.let { " · $it" } ?: ""}",
                    color = TivoGold,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                )
                Text(prog.title, fontSize = 20.sp, fontWeight = FontWeight.Black, color = Color.White)
                Text(
                    prog.description ?: "Over-the-air broadcast television program.",
                    color = Color(0xFFB6C9E8),
                    fontSize = 13.sp,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }

        LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(rows, key = { it.channel.id }) { row ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Surface(
                        color = TivoPanel,
                        shape = RoundedCornerShape(12.dp),
                        border = BorderStroke(1.dp, Color(0x5593C5FD)),
                        modifier = Modifier
                            .width(156.dp)
                            .height(74.dp)
                            .clickable { onWatchChannel(row.channel) },
                    ) {
                        Column(
                            modifier = Modifier.padding(12.dp),
                            verticalArrangement = Arrangement.Center,
                        ) {
                            Text(row.channel.guideNumber, color = TivoGold, fontWeight = FontWeight.Black, fontSize = 18.sp)
                            Text(row.channel.guideName, color = Color(0xFFDBEAFE), fontSize = 13.sp, maxLines = 1)
                        }
                    }

                    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(row.programs.take(8), key = { it.id }) { prog ->
                            val isCurrentHighlight = highlighted?.second?.id == prog.id
                            Surface(
                                color = if (isCurrentHighlight) Color(0xFF1D4ED8) else TivoCard,
                                shape = RoundedCornerShape(12.dp),
                                border = if (isCurrentHighlight) BorderStroke(2.dp, TivoGold) else null,
                                modifier = Modifier
                                    .width(236.dp)
                                    .height(74.dp)
                                    .clickable {
                                        highlighted = row.channel to prog
                                        onSelectProgram(row.channel, prog)
                                    },
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
                                        color = Color(0xFFB6C9E8),
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
private fun MyShowsTvView(
    recordings: List<DvrRecording>,
    onPlay: (DvrRecording) -> Unit,
    onScanCommercials: (DvrRecording) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("My Shows (SkipMode™ Ready)", fontSize = 26.sp, fontWeight = FontWeight.Black)
        if (recordings.isEmpty()) {
            Text(
                "No recordings yet. Select any program in the Live TV Guide to record it.",
                color = Color(0xFFB6C9E8),
                fontSize = 16.sp,
            )
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(recordings, key = { it.id }) { rec ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(TivoCard, RoundedCornerShape(14.dp))
                            .border(1.dp, Color(0x4493C5FD), RoundedCornerShape(14.dp))
                            .padding(16.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Row(
                            modifier = Modifier.weight(1f),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(14.dp),
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(12.dp)
                                    .background(
                                        if (rec.status == "recording") TivoRecRed else TivoSkipGreen,
                                        CircleShape,
                                    ),
                            )
                            Column {
                                Row(
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Text(
                                        "CH ${rec.channelNumber} ${rec.channelName}",
                                        color = TivoGold,
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.Bold,
                                    )
                                    if (rec.commercialCount > 0) {
                                        Text(
                                            "SKIP (${rec.commercialCount} ads)",
                                            color = Color(0xFF032212),
                                            fontSize = 11.sp,
                                            fontWeight = FontWeight.Black,
                                            modifier = Modifier
                                                .background(TivoSkipGreen, RoundedCornerShape(999.dp))
                                                .padding(horizontal = 8.dp, vertical = 2.dp),
                                        )
                                    }
                                }
                                Text(rec.title, fontSize = 19.sp, fontWeight = FontWeight.ExtraBold, color = Color.White)
                                rec.subtitle?.let {
                                    Text(it, color = Color(0xFFB6C9E8), fontSize = 13.sp)
                                }
                            }
                        }

                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Button(
                                onClick = { onPlay(rec) },
                                shape = RoundedCornerShape(999.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1D4ED8)),
                            ) {
                                Text(
                                    if (rec.watchedPositionSec > 5) "Resume" else "Watch",
                                    color = Color.White,
                                    fontWeight = FontWeight.Bold,
                                )
                            }
                            Button(
                                onClick = { onScanCommercials(rec) },
                                shape = RoundedCornerShape(999.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF78350F)),
                            ) {
                                Text("Scan Ads", color = TivoGold, fontWeight = FontWeight.Bold)
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
    LazyColumn(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item { Text("To Do List (${upcoming.size})", fontSize = 24.sp, fontWeight = FontWeight.Black) }
        items(upcoming, key = { it.id }) { rec ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(TivoCard, RoundedCornerShape(14.dp))
                    .padding(16.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column {
                    Text(rec.title, fontWeight = FontWeight.ExtraBold, fontSize = 17.sp)
                    Text("CH ${rec.channelNumber} ${rec.channelName}", color = Color(0xFFB6C9E8), fontSize = 13.sp)
                }
                Text(
                    if (rec.status == "conflict") "CONFLICT" else "R",
                    color = Color.White,
                    fontWeight = FontWeight.Black,
                    modifier = Modifier
                        .background(if (rec.status == "conflict") Color(0xFFD97706) else TivoRecRed, RoundedCornerShape(6.dp))
                        .padding(horizontal = 10.dp, vertical = 4.dp),
                )
            }
        }
        item {
            Spacer(Modifier.height(8.dp))
            Text("OnePass™ Manager (${passes.size})", fontSize = 24.sp, fontWeight = FontWeight.Black)
        }
        items(passes, key = { it.id }) { pass ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(TivoPanel, RoundedCornerShape(14.dp))
                    .padding(16.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("RR  ${pass.title}", fontWeight = FontWeight.ExtraBold, fontSize = 17.sp)
                Text(
                    if (pass.newOnly) "New Episodes Only" else "New & Reruns",
                    color = TivoCyan,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                )
            }
        }
    }
}
