@echo off
REM ===========================================================================
REM up.cmd — bring up the ENTIRE VPS Fleet local stack with ONE command.
REM Double-click, or run `up` from a terminal in the project root.
REM
REM 1. Runs the WSL bring-up (Docker/Postgres/Redis/API/Dashboard, route+loopback
REM    repair) via up.sh.
REM 2. Sets up Windows->WSL portproxy for :3000 and :4000 so the browser on
REM    Windows can reach the dashboard + API running inside WSL (the NAT localhost
REM    bridge is unreliable on this custom-kernel setup, so we forward explicitly).
REM ===========================================================================
echo Starting VPS Fleet stack via WSL...
wsl -d Ubuntu bash -lc "bash '/mnt/c/Yeni klas\xc3\xb6r/vps/deploy/local-test/up.sh'"

echo.
echo Setting up Windows port forwarding to WSL...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ip = (wsl -d Ubuntu hostname -I).Trim().Split(' ')[0];" ^
  "Write-Host ('WSL IP: ' + $ip);" ^
  "foreach ($p in 3000,4000) {" ^
  "  netsh interface portproxy delete v4tov4 listenaddress=127.0.0.1 listenport=$p 2>$null | Out-Null;" ^
  "  netsh interface portproxy add v4tov4 listenaddress=127.0.0.1 listenport=$p connectaddress=$ip connectport=$p | Out-Null;" ^
  "  Write-Host ('  127.0.0.1:' + $p + ' -> ' + $ip + ':' + $p) }"

echo.
echo Done. Open http://localhost:3000  (login: admin@local.dev / Admin2026)
pause
