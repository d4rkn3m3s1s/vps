@echo off
REM Run the API with Windows node (NOT WSL) so it has internet access for
REM catchmail / sms-bus / fonts, and reaches the emulator ADB + WSL Postgres/Redis
REM over localhost. Logs to _api-win-host.log. CWD must be apps\api so dotenv finds .env.
cd /d "c:\Yeni klasör\vps\apps\api"
set NODE_ENV=development
node "c:\Yeni klasör\vps\node_modules\tsx\dist\cli.mjs" watch src/index.ts
