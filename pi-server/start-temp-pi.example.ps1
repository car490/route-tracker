# Temporary "Pi controller" - runs the exact same pi-server code the real
# Raspberry Pi will run, directly on this laptop, while the Pi hardware
# order is delayed. See TEMP-LAPTOP.md for the full setup/teardown steps.
#
# One-time: copy this file to start-temp-pi.local.ps1 (gitignored - never
# commit a real token) and set $Token below to a long random string.
# Every day: run start-temp-pi.local.ps1. It syncs the schedule, prints
# the two URLs you need (driver commissioning + today's kiosk URL), then
# starts the server and blocks until you Ctrl+C it.

$Token = "REPLACE-WITH-A-LONG-RANDOM-STRING"
$Port = 8080

if ($Token -eq "REPLACE-WITH-A-LONG-RANDOM-STRING") {
    Write-Host "Set `$Token in start-temp-pi.local.ps1 before running it (copy this .example.ps1 file first if you haven't)." -ForegroundColor Red
    exit 1
}

$env:DRIVER_PUSH_TOKEN = $Token
$env:PORT = "$Port"

$scriptDir = $PSScriptRoot

Write-Host "Syncing today's schedule from Supabase..." -ForegroundColor Cyan
node (Join-Path $scriptDir "sync-schedule.mjs")

$hotspotIp = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -like "192.168.137.*" } |
    Select-Object -First 1).IPAddress

if (-not $hotspotIp) {
    Write-Host ""
    Write-Host "Mobile Hotspot doesn't look like it's on yet (no 192.168.137.x address found)." -ForegroundColor Yellow
    Write-Host "Turn it on first: Settings > Network & internet > Mobile hotspot" -ForegroundColor Yellow
    $hotspotIp = "192.168.137.1"
}

Write-Host ""
Write-Host "=== Driver phone commissioning - do this ONCE per phone, not every day ===" -ForegroundColor Green
Write-Host "Open on the driver's phone (Chrome), once, connected to this laptop's hotspot:"
Write-Host "http://<driver-pwa-url>/?announce-setup=ws://$($hotspotIp):$Port/driver-push&announce-token=$Token"
Write-Host ""
Write-Host "=== Today's kiosk URL - open this in the browser on the Monitor ===" -ForegroundColor Green
Write-Host "(fill in <journey-id> from the dashboard's Daily Journeys page)"
Write-Host "http://localhost:$Port/onboard.html?journey=<journey-id>&announce-token=$Token"
Write-Host ""
Write-Host "Starting server on port $Port... (Ctrl+C to stop)" -ForegroundColor Cyan
node (Join-Path $scriptDir "server.mjs")
