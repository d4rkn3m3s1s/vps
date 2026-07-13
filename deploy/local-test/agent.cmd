@echo off
REM Self-contained agent launcher: sets env, runs agent.mjs, redirects its own
REM stdout/stderr to a log. Survives independently of the launching shell.
set FLEET_API_URL=http://localhost:4000
set FLEET_API_KEY=%FLEET_API_KEY%
set FLEET_HOST_KEY=%FLEET_HOST_KEY%
set FLEET_ADB=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe
set FLEET_FFMPEG=C:\scrcpy\ffmpeg.exe
set FLEET_STREAM_W=540
set FLEET_POLL_MS=2000
node "C:\Yeni klasör\vps\deploy\kvm-host\agent\agent.mjs" > "C:\Yeni klasör\vps\deploy\local-test\_agent-win.log" 2>&1
