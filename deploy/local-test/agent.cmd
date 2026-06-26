@echo off
REM Self-contained agent launcher: sets env, runs agent.mjs, redirects its own
REM stdout/stderr to a log. Survives independently of the launching shell.
set FLEET_API_URL=http://localhost:4000
set FLEET_API_KEY=f185cb2df56900c9b2a2cdc350ee5cc0db2ceff9
set FLEET_HOST_KEY=host_6bbbbfe1fd292aa80f2aa1b7ab1a0326
set FLEET_ADB=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe
set FLEET_FFMPEG=C:\scrcpy\ffmpeg.exe
set FLEET_STREAM_W=540
set FLEET_POLL_MS=2000
node "C:\Yeni klasör\vps\deploy\kvm-host\agent\agent.mjs" > "C:\Yeni klasör\vps\deploy\local-test\_agent-win.log" 2>&1
