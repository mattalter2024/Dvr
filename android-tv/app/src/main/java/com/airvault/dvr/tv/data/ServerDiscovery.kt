package com.airvault.dvr.tv.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.SocketTimeoutException

/**
 * Broadcasts an `AIRVAULT_DVR_DISCOVER` UDP packet on the local home network so Android TV,
 * Google TV, and Fire TV devices find the whole-house AirVault DVR server automatically.
 */
object ServerDiscovery {
    private const val DISCOVERY_PORT = 41234
    private const val DISCOVERY_MAGIC = "AIRVAULT_DVR_DISCOVER"

    suspend fun discover(timeoutMs: Int = 2500): List<DiscoveredServer> = withContext(Dispatchers.IO) {
        val found = LinkedHashMap<String, DiscoveredServer>()
        var socket: DatagramSocket? = null
        try {
            socket = DatagramSocket().apply {
                broadcast = true
                soTimeout = 500
            }
            val payload = DISCOVERY_MAGIC.toByteArray(Charsets.UTF_8)
            val request = DatagramPacket(
                payload,
                payload.size,
                InetAddress.getByName("255.255.255.255"),
                DISCOVERY_PORT,
            )
            socket.send(request)

            val deadline = System.currentTimeMillis() + timeoutMs
            val buf = ByteArray(2048)
            while (System.currentTimeMillis() < deadline) {
                try {
                    val reply = DatagramPacket(buf, buf.size)
                    socket.receive(reply)
                    val json = JSONObject(String(reply.data, 0, reply.length, Charsets.UTF_8))
                    if (json.optString("service") != "airvault-dvr") continue

                    val port = json.optInt("port", 8096)
                    val host = reply.address.hostAddress ?: continue
                    val url = "http://$host:$port"
                    found[url] = DiscoveredServer(
                        serverName = json.optString("serverName", "AirVault Home DVR"),
                        baseUrl = url,
                        version = json.optString("version", "1.0.0"),
                    )
                } catch (_: SocketTimeoutException) {
                    // Continue waiting until deadline
                }
            }
        } catch (_: Exception) {
            // Network or permission error; manual IP entry remains available
        } finally {
            socket?.close()
        }
        found.values.toList()
    }
}
