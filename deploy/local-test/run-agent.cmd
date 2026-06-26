@echo off
REM Detached launcher for the Windows host agent. Sets env and runs agent.mjs
REM against the AVD emulator. Keep this window open; closing it stops the agent.
set FLEET_API_URL=http://localhost:4000
set FLEET_API_KEY=f185cb2df56900c9b2a2cdc350ee5cc0db2ceff9
set FLEET_HOST_KEY=host_6bbbbfe1fd292aa80f2aa1b7ab1a0326
set FLEET_ADB=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe
set FLEET_POLL_MS=2000
title Fleet Host Agent (Windows AVD)
node "C:\Yeni klasör\vps\deploy\kvm-host\agent\agent.mjs"
