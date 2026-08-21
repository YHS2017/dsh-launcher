; 安装与卸载后通知 Shell 刷新图标缓存。
;
; 不做这一步，覆盖安装时资源管理器会继续用 IconCache 里的旧图标画桌面快捷方式：
; exe 里嵌的图标其实已经换掉了，但用户看到的还是旧图标，且重启资源管理器前不会自愈。
; SHCNE_ASSOCCHANGED (0x08000000) 会让 Shell 丢弃图标缓存并重画。

!macro customInstall
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro customUnInstall
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend
