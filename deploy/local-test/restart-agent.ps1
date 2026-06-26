# Restart the Windows host agent with ffmpeg H.264 streaming + logging.
$ErrorActionPreference = 'SilentlyContinue'
$pidFile = "C:\Yeni klasör\vps\deploy\local-test\_agent.pid"
$log = "C:\Yeni klasör\vps\deploy\local-test\_agent-win.log"
$old = (Get-Content $pidFile -Raw).Trim()
if ($old) { Stop-Process -Id ([int]$old) -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
try { if (Test-Path $log) { Clear-Content $log -ErrorAction Stop } } catch {}
$envs = @{
  FLEET_API_URL  = "http://localhost:4000"
  FLEET_API_KEY  = "f185cb2df56900c9b2a2cdc350ee5cc0db2ceff9"
  FLEET_HOST_KEY = "host_6bbbbfe1fd292aa80f2aa1b7ab1a0326"
  FLEET_ADB      = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
  FLEET_FFMPEG   = "C:\scrcpy\ffmpeg.exe"
  FLEET_STREAM_W = "540"
  FLEET_POLL_MS  = "2000"
}
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "node.exe"
$psi.Arguments = "`"C:\Yeni klasör\vps\deploy\kvm-host\agent\agent.mjs`""
$psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
$psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
foreach ($k in $envs.Keys) { $psi.EnvironmentVariables[$k] = $envs[$k] }
$proc = [System.Diagnostics.Process]::Start($psi)
$sw = [System.IO.StreamWriter]::new($log, $false)
Register-ObjectEvent -InputObject $proc -EventName OutputDataReceived -Action { if ($EventArgs.Data) { $Event.MessageData.WriteLine($EventArgs.Data); $Event.MessageData.Flush() } } -MessageData $sw | Out-Null
Register-ObjectEvent -InputObject $proc -EventName ErrorDataReceived -Action { if ($EventArgs.Data) { $Event.MessageData.WriteLine("ERR: "+$EventArgs.Data); $Event.MessageData.Flush() } } -MessageData $sw | Out-Null
$proc.BeginOutputReadLine(); $proc.BeginErrorReadLine()
$proc.Id | Out-File $pidFile -Encoding ascii
Write-Output "agent restarted PID $($proc.Id)"
