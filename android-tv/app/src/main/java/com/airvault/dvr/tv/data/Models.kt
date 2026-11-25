package com.airvault.dvr.tv.data

data class DiscoveredServer(
    val serverName: String,
    val baseUrl: String,
    val version: String,
)

data class TvChannel(
    val id: String,
    val guideNumber: String,
    val guideName: String,
    val network: String,
    val hd: Boolean,
    val favorite: Boolean,
)

data class TvProgram(
    val id: String,
    val channelId: String,
    val title: String,
    val subtitle: String?,
    val description: String?,
    val startTime: String,
    val endTime: String,
    val category: String,
    val episodeNum: String?,
    val posterUrl: String?,
    val isNew: Boolean,
    val isLive: Boolean,
)

data class GuideRow(
    val channel: TvChannel,
    val programs: List<TvProgram>,
)

data class CommercialSegment(
    val id: String,
    val startSec: Double,
    val endSec: Double,
    val confidence: Double,
    val source: String,
)

data class DvrRecording(
    val id: String,
    val channelId: String,
    val channelNumber: String,
    val channelName: String,
    val title: String,
    val subtitle: String?,
    val episodeNum: String?,
    val scheduledStart: String,
    val scheduledEnd: String,
    val status: String,
    val durationSec: Double,
    val commercialScanStatus: String,
    val commercialCount: Int,
    val watchedPositionSec: Double,
    val watched: Boolean,
    val hasMediaFile: Boolean,
)

data class LiveSession(
    val id: String,
    val channelId: String,
    val channelNumber: String,
    val channelName: String,
    val playlistUrl: String,
    val directStreamUrl: String?,
    val mode: String,
)

data class SeriesPass(
    val id: String,
    val title: String,
    val newOnly: Boolean,
    val keepLimit: Int,
)

data class StreamingApp(
    val id: String,
    val name: String,
    val tagline: String,
    val category: String,
    val webUrl: String,
    val androidPackage: String,
    val fallbackAndroidPackage: String?,
    val brandColor: String,
    val monogram: String,
    val pinned: Boolean,
)
