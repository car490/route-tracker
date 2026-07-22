package com.example.wifidirectpoc // update to match your project's package

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.wifi.p2p.WifiP2pConfig
import android.net.wifi.p2p.WifiP2pDevice
import android.net.wifi.p2p.WifiP2pInfo
import android.net.wifi.p2p.WifiP2pManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.widget.Button
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintWriter
import java.net.ServerSocket
import java.net.Socket
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Throwaway bench-test harness for de-risking WiFi Direct as the .Driver <-> .NextStop
 * transport before committing to hardware. Not part of the RouteTracker product build —
 * see wifi-direct-poc/README.md for what this is testing and how to read the results.
 *
 * One APK, two roles, selected at runtime:
 *
 * DRIVER — creates a fixed-identity autonomous P2P group (same network name and
 * passphrase every launch, so re-pairing after a reboot doesn't require a fresh
 * manual pairing step in Android Settings) and runs a plain TCP server, accepting
 * any number of simultaneous clients and pinging each one every few seconds.
 *
 * NEXTSTOP — discovers the Driver device, joins its group, connects to the TCP
 * server, and logs every ping received (with an ack sent back), so the log makes
 * it obvious whether the link carries real data, not just whether P2P "connected".
 */
class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "WifiDirectPOC"

        // Must start with "DIRECT-xy-" (any two chars for xy) — Android's P2P
        // framework enforces this prefix on any manually-chosen network name.
        private const val NETWORK_NAME = "DIRECT-nt-NextStopPOC"
        private const val PASSPHRASE = "nextstop-poc-2026" // WPA2 rules: 8-63 chars
        private const val SERVER_PORT = 8988

        // NextStop picks the first peer whose WiFi Direct device name contains this
        // (rename the device under Settings > WiFi > WiFi Direct if you want to be
        // explicit about which physical unit is which) — falls back to "first peer
        // found" if nothing matches, since some devices don't expose a rename option.
        private const val DEVICE_NAME_MATCH = "NextStopPOC"
    }

    private lateinit var manager: WifiP2pManager
    private lateinit var channel: WifiP2pManager.Channel
    private var receiver: BroadcastReceiver? = null
    private val intentFilter = IntentFilter().apply {
        addAction(WifiP2pManager.WIFI_P2P_STATE_CHANGED_ACTION)
        addAction(WifiP2pManager.WIFI_P2P_PEERS_CHANGED_ACTION)
        addAction(WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION)
        addAction(WifiP2pManager.WIFI_P2P_THIS_DEVICE_CHANGED_ACTION)
    }

    private val running = AtomicBoolean(false)
    private var serverSocket: ServerSocket? = null
    private val clientWriters = CopyOnWriteArrayList<PrintWriter>()
    private var clientSocket: Socket? = null

    private lateinit var statusText: TextView
    private lateinit var logText: TextView
    private lateinit var logScroll: ScrollView
    private lateinit var roleGroup: RadioGroup
    private lateinit var startStopBtn: Button

    private val timeFmt = SimpleDateFormat("HH:mm:ss.SSS", Locale.UK)

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { results ->
        if (results.values.all { it }) {
            log("Permissions granted.")
        } else {
            log("Permissions DENIED — WiFi Direct will not work: $results")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        statusText   = findViewById(R.id.statusText)
        logText      = findViewById(R.id.logText)
        logScroll    = findViewById(R.id.logScroll)
        roleGroup    = findViewById(R.id.roleGroup)
        startStopBtn = findViewById(R.id.startStopBtn)

        manager = getSystemService(Context.WIFI_P2P_SERVICE) as WifiP2pManager
        channel = manager.initialize(this, mainLooper, null)

        startStopBtn.setOnClickListener {
            if (running.get()) stopTest() else startTest()
        }

        requestNeededPermissions()
        log("Ready. Pick a role and tap Start. See README.md for the test sequence.")
    }

    private fun requestNeededPermissions() {
        val needed = mutableListOf(
            Manifest.permission.ACCESS_WIFI_STATE,
            Manifest.permission.CHANGE_WIFI_STATE,
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            needed.add(Manifest.permission.NEARBY_WIFI_DEVICES)
        } else {
            needed.add(Manifest.permission.ACCESS_FINE_LOCATION)
        }
        val toRequest = needed.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (toRequest.isNotEmpty()) permissionLauncher.launch(toRequest.toTypedArray())

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            val lm = getSystemService(Context.LOCATION_SERVICE) as LocationManager
            if (!lm.isProviderEnabled(LocationManager.GPS_PROVIDER) &&
                !lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
            ) {
                Toast.makeText(
                    this,
                    "Enable Location Services — required for WiFi Direct discovery on this Android version",
                    Toast.LENGTH_LONG
                ).show()
            }
        }
    }

    private fun isDriver() = roleGroup.checkedRadioButtonId == R.id.roleDriver

    private fun startTest() {
        running.set(true)
        roleGroup.isEnabled = false
        startStopBtn.text = "Stop"
        registerReceiverCompat()

        if (isDriver()) startDriver() else startNextStop()
    }

    private fun stopTest() {
        running.set(false)
        roleGroup.isEnabled = true
        startStopBtn.text = "Start"
        statusText.text = "Idle"

        try { serverSocket?.close() } catch (_: Exception) {}
        serverSocket = null
        clientWriters.clear()
        try { clientSocket?.close() } catch (_: Exception) {}
        clientSocket = null

        manager.removeGroup(channel, simpleListener("removeGroup"))
        receiver?.let { unregisterReceiver(it) }
        receiver = null
        log("Stopped.")
    }

    private fun registerReceiverCompat() {
        val r = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                when (intent.action) {
                    WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION -> {
                        manager.requestConnectionInfo(channel) { info -> onConnectionInfo(info) }
                    }
                    WifiP2pManager.WIFI_P2P_STATE_CHANGED_ACTION -> {
                        val enabled = intent.getIntExtra(WifiP2pManager.EXTRA_WIFI_STATE, -1) ==
                            WifiP2pManager.WIFI_P2P_STATE_ENABLED
                        log("WiFi P2P radio ${if (enabled) "ENABLED" else "DISABLED"}")
                    }
                }
            }
        }
        receiver = r
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(r, intentFilter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(r, intentFilter)
        }
    }

    // ── DRIVER (Group Owner) ────────────────────────────────────────────────

    private fun startDriver() {
        val config = WifiP2pConfig.Builder()
            .setNetworkName(NETWORK_NAME)
            .setPassphrase(PASSPHRASE)
            .build()

        log("Creating fixed-identity group \"$NETWORK_NAME\"...")
        statusText.text = "Driver: creating group..."
        manager.createGroup(channel, config, simpleListener("createGroup"))
    }

    private fun onConnectionInfo(info: WifiP2pInfo) {
        if (!info.groupFormed) {
            statusText.text = if (isDriver()) "Driver: waiting for group..." else "NextStop: not connected"
            return
        }
        if (info.isGroupOwner) {
            statusText.text = "Driver: group owner, starting TCP server on port $SERVER_PORT"
            log("Group formed — this device is Group Owner. Starting server.")
            startServer()
        } else {
            val goAddress = info.groupOwnerAddress
            statusText.text = "NextStop: joined group, GO at ${goAddress?.hostAddress}"
            log("Group formed as client. Group Owner address: ${goAddress?.hostAddress}")
            goAddress?.hostAddress?.let { connectToServer(it) }
        }
    }

    private fun startServer() {
        if (serverSocket != null) return // already running
        Thread {
            try {
                val server = ServerSocket(SERVER_PORT)
                serverSocket = server
                while (running.get()) {
                    val socket = server.accept()
                    log("Client connected: ${socket.inetAddress.hostAddress}")
                    handleClient(socket)
                }
            } catch (e: Exception) {
                if (running.get()) log("Server error: ${e.message}")
            }
        }.start()
    }

    private fun handleClient(socket: Socket) {
        Thread {
            val writer = PrintWriter(socket.getOutputStream(), true)
            clientWriters.add(writer)
            try {
                Thread {
                    var seq = 0
                    while (running.get() && !socket.isClosed) {
                        try {
                            writer.println("PING $seq ${System.currentTimeMillis()}")
                            seq++
                            Thread.sleep(3000)
                        } catch (e: Exception) {
                            break
                        }
                    }
                }.start()

                val reader = BufferedReader(InputStreamReader(socket.getInputStream()))
                while (running.get()) {
                    val line = reader.readLine() ?: break
                    log("From ${socket.inetAddress.hostAddress}: $line")
                }
            } catch (e: Exception) {
                log("Client ${socket.inetAddress.hostAddress} error: ${e.message}")
            } finally {
                clientWriters.remove(writer)
                log("Client disconnected: ${socket.inetAddress.hostAddress}")
                try { socket.close() } catch (_: Exception) {}
            }
        }.start()
    }

    // ── NEXTSTOP (Client) ───────────────────────────────────────────────────

    private fun startNextStop() {
        statusText.text = "NextStop: discovering peers..."
        log("Discovering peers, looking for a device named like \"$DEVICE_NAME_MATCH\"...")
        manager.discoverPeers(channel, simpleListener("discoverPeers"))
        manager.requestPeers(channel) { peers -> tryConnectToDriver(peers.deviceList) }

        // WiFi Direct peer discovery is known to be slow/flaky on the first call —
        // keep re-checking the peer list for a while rather than giving up after one.
        Thread {
            var attempts = 0
            while (running.get() && clientSocket == null && attempts < 20) {
                Thread.sleep(2000)
                attempts++
                manager.requestPeers(channel) { peers -> tryConnectToDriver(peers.deviceList) }
            }
        }.start()
    }

    private fun tryConnectToDriver(devices: Collection<WifiP2pDevice>) {
        if (clientSocket != null) return
        val target = devices.firstOrNull { it.deviceName.contains(DEVICE_NAME_MATCH, ignoreCase = true) }
            ?: devices.firstOrNull()
            ?: return

        log("Found peer \"${target.deviceName}\" — connecting...")
        val config = WifiP2pConfig().apply { deviceAddress = target.deviceAddress }
        manager.connect(channel, config, simpleListener("connect"))
    }

    private fun connectToServer(host: String) {
        if (clientSocket != null) return
        Thread {
            try {
                val socket = Socket(host, SERVER_PORT)
                clientSocket = socket
                log("Connected to Driver server at $host:$SERVER_PORT")
                val writer = PrintWriter(socket.getOutputStream(), true)
                val reader = BufferedReader(InputStreamReader(socket.getInputStream()))
                while (running.get()) {
                    val line = reader.readLine() ?: break
                    log("Received: $line")
                    writer.println("ACK ${System.currentTimeMillis()}")
                }
            } catch (e: Exception) {
                log("Connection to server failed: ${e.message}")
            } finally {
                clientSocket = null
            }
        }.start()
    }

    // ── shared helpers ───────────────────────────────────────────────────────

    private fun simpleListener(label: String) = object : WifiP2pManager.ActionListener {
        override fun onSuccess() = log("$label: success")
        override fun onFailure(reason: Int) = log("$label: FAILED (reason=$reason)")
    }

    private fun log(msg: String) {
        val line = "[${timeFmt.format(System.currentTimeMillis())}] $msg"
        Log.d(TAG, line)
        runOnUiThread {
            logText.append(line + "\n")
            logScroll.post { logScroll.fullScroll(android.view.View.FOCUS_DOWN) }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        if (running.get()) stopTest()
    }
}
