# Adds or removes a directory on the persistent PATH (user or machine scope).
# Invoked by the NSIS installer/uninstaller; see build/installer.nsh.
#
# ASCII only on purpose: without a BOM, Windows PowerShell 5.1 reads .ps1
# files in the ANSI code page and any non-ASCII byte can break parsing.
param(
  [Parameter(Mandatory = $true)][ValidateSet('add', 'remove')][string]$Action,
  [Parameter(Mandatory = $true)][string]$Dir,
  [Parameter(Mandatory = $true)][ValidateSet('User', 'Machine')][string]$Scope
)
$ErrorActionPreference = 'Stop'

$key = if ($Scope -eq 'Machine') {
  'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment'
} else {
  'HKCU:\Environment'
}

# Read the RAW registry value. Get-ItemProperty and [Environment]:: both expand
# %SystemRoot% etc.; writing that expanded text back would silently destroy the
# indirection in every other PATH entry. The same reason we write ExpandString.
$item = Get-Item -LiteralPath $key
$raw = [string]$item.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
# Keep every existing entry byte-for-byte, including empty ones and a trailing
# separator. This script owns exactly one entry; normalising other people's is
# not its business and could break a tool that depends on the odd formatting.
# Assign directly, never via the output of an if-statement: PowerShell unrolls a
# one-element array coming out of a statement into a scalar string, after which
# += silently becomes string concatenation and corrupts the value.
$parts = @()
if ($raw -ne '') { $parts = @($raw -split ';') }

$norm = $Dir.TrimEnd('\')
$present = @($parts | Where-Object { $_.TrimEnd('\') -ieq $norm })

if ($Action -eq 'add') {
  if ($present.Count -gt 0) { Write-Output "already on PATH ($Scope): $Dir"; exit 0 }
  # If the value ends with a separator (a trailing empty entry), insert before it
  # so the value keeps ending the way it did.
  if ($parts.Count -gt 0 -and $parts[-1] -eq '') {
    $parts = @($parts[0..($parts.Count - 2)]) + @($Dir) + @('')
  } else {
    $parts += $Dir
  }
} else {
  if ($present.Count -eq 0) { Write-Output "not on PATH ($Scope): $Dir"; exit 0 }
  $parts = @($parts | Where-Object { $_.TrimEnd('\') -ine $norm })
}

Set-ItemProperty -LiteralPath $key -Name 'Path' -Value ($parts -join ';') -Type ExpandString

# Broadcast WM_SETTINGCHANGE so Explorer and newly opened shells pick the change
# up immediately, exactly like the Environment Variables dialog does. Shells that
# are already open keep their old copy of PATH regardless.
Add-Type -Namespace DshLauncher -Name Native -MemberDefinition @'
[DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
'@
$result = [UIntPtr]::Zero
[void][DshLauncher.Native]::SendMessageTimeout([IntPtr]0xffff, 0x001A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$result)

Write-Output "$Action ok ($Scope): $Dir"
