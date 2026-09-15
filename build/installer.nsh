; 安装与卸载后通知 Shell 刷新图标缓存。
;
; 不做这一步，覆盖安装时资源管理器会继续用 IconCache 里的旧图标画桌面快捷方式：
; exe 里嵌的图标其实已经换掉了，但用户看到的还是旧图标，且重启资源管理器前不会自愈。
; SHCNE_ASSOCCHANGED (0x08000000) 会让 Shell 丢弃图标缓存并重画。
;
; 另外把 $INSTDIR\bin 加进 PATH（卸载时移除），让终端里能直接敲 dsh。
; 增删由 bin\path-setup.ps1 完成——用原生 NSIS 改 PATH 要么引入几百行的
; EnvVarUpdate，要么手写字符串搜索，都不如几十行 PowerShell 好读好测。
; 写哪一级由安装模式决定：全用户安装写 HKLM（此时安装器已提权），
; 仅当前用户安装写 HKCU。$installMode 由 electron-builder 的 multiUser.nsh
; 在安装与卸载两侧的初始化里设好，取值 "all" 或 "CurrentUser"。
;
; customUnInstall 在 RMDir /r $INSTDIR 之前执行，所以卸载时脚本文件还在。

!macro _dshLauncherPathScope OUT
  ${if} $installMode == "all"
    StrCpy ${OUT} "Machine"
  ${else}
    StrCpy ${OUT} "User"
  ${endif}
!macroend

!macro customInstall
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
  !insertmacro _dshLauncherPathScope $1
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\bin\path-setup.ps1" -Action add -Dir "$INSTDIR\bin" -Scope $1'
  Pop $1
!macroend

!macro customUnInstall
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
  !insertmacro _dshLauncherPathScope $1
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\bin\path-setup.ps1" -Action remove -Dir "$INSTDIR\bin" -Scope $1'
  Pop $1
!macroend
