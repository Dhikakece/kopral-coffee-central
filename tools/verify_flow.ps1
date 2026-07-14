# Verify flow helper for Kopral Kasir server
# Usage: Start the server (node server.js), then run this script in PowerShell:
#   pwsh .\tools\verify_flow.ps1

$base = "http://localhost:3000"
Write-Host "=== Check GET /?action=getMenu ===" -ForegroundColor Cyan
try {
    $menu = Invoke-RestMethod -Uri "$base/?action=getMenu" -Method GET -ErrorAction Stop
    $menu | ConvertTo-Json -Depth 5 | Write-Output
} catch {
    Write-Host "GET failed:" $_ -ForegroundColor Red
}

Write-Host "`n=== POST /api/pesanan-masuk (simulate order) ===" -ForegroundColor Cyan
$payload = @{
    id_pesanan = "KPRL-TEST-" + (Get-Date -UFormat %s)
    nama = "Test User"
    meja = "T1"
    metode = "Takeaway"
    pembayaran = "Cash"
    items = @(@{ id = "c01"; name = "Espresso Roman"; price = 15000; quantity = 1 })
    total = 15000
    waktu_pesan = (Get-Date).ToString("o")
}
$payloadJson = $payload | ConvertTo-Json -Depth 5
Write-Host "Payload:`n$payloadJson`n"
try {
    $resp = Invoke-RestMethod -Uri "$base/api/pesanan-masuk" -Method POST -Body $payloadJson -ContentType "application/json" -ErrorAction Stop
    Write-Host "Response:`n" -ForegroundColor Green
    $resp | ConvertTo-Json -Depth 5 | Write-Output
} catch {
    Write-Host "POST failed:" $_ -ForegroundColor Red
}

Write-Host "`n=== Re-fetch menu after POST ===" -ForegroundColor Cyan
try {
    $menu2 = Invoke-RestMethod -Uri "$base/?action=getMenu" -Method GET -ErrorAction Stop
    $menu2 | ConvertTo-Json -Depth 5 | Write-Output
} catch {
    Write-Host "Re-fetch GET failed:" $_ -ForegroundColor Red
}

Write-Host "`n=== Done ===" -ForegroundColor Cyan
