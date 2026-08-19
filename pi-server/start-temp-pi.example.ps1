# Temporary "Controller" - runs the exact same pi-server code the real
# Controller box will run, directly on this laptop, while dedicated hardware
# isn't set up yet. See TEMP-LAPTOP.md for the full setup/teardown steps.
#
# One-time: copy this file to start-temp-pi.local.ps1 (gitignored - never
# commit a real token) and set $Token below to a long random string.
# Every day: run start-temp-pi.local.ps1. It prints the two URLs you need
# (driver commissioning + today's kiosk URL), then starts the server and
# blocks until you Ctrl+C it. No separate schedule sync step - the schedule
# now arrives pushed from the Driver device once it starts a journey.

$Token = "REPLACE-WITH-A-LONG-RANDOM-STRING"
$Port = 8080

if ($Token -eq "REPLACE-WITH-A-LONG-RANDOM-STRING") {
    Write-Host "Set `$Token in start-temp-pi.local.ps1 before running it (copy this .example.ps1 file first if you haven't)." -ForegroundColor Red
    exit 1
}

$env:DRIVER_PUSH_TOKEN = $Token
$env:PORT = "$Port"

$scriptDir = $PSScriptRoot

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
Write-Host "(same URL every day - no journey-id to fill in; the sign wakes on its own"
Write-Host "once the driver starts a journey)"
Write-Host "http://localhost:$Port/onboard.html?announce-token=$Token"
Write-Host ""
Write-Host "Starting server on port $Port... (Ctrl+C to stop)" -ForegroundColor Cyan
node (Join-Path $scriptDir "server.mjs")
