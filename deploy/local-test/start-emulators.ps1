# Start the 3 WhatsApp AVDs on fixed ports. Idempotent-ish: skips an AVD whose
# console port is already listening. Booting is checked by the caller.
param([int[]]$Ports = @(5584, 5586, 5588))
$sdk = "$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_HOME = $sdk; $env:ANDROID_SDK_ROOT = $sdk
$env:ANDROID_AVD_HOME = "$env:USERPROFILE\.android\avd"
$emu = "$sdk\emulator\emulator.exe"
$dl = "$env:USERPROFILE\Downloads\android-setup"
$map = @{ 5584 = 'wa01'; 5586 = 'wa02'; 5588 = 'wa03' }
foreach ($p in $Ports) {
  $avd = $map[$p]
  $listening = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue
  if ($listening) { Write-Output "$avd (port $p) already running"; continue }
  Start-Process -FilePath $emu -ArgumentList '-avd',$avd,'-no-snapshot-save','-gpu','swiftshader_indirect','-no-boot-anim','-accel','on','-port',"$p" `
    -RedirectStandardOutput "$dl\emu_$avd.log" -RedirectStandardError "$dl\emu_$avd.err" -WindowStyle Minimized
  Write-Output "$avd launched on port $p (adb $($p+1))"
}
