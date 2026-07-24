; PromptPad — custom NSIS installer hooks.
; Auto-included by electron-builder because directories.buildResources is "build".
;
; Silently close a running PromptPad before installing/updating so the user
; never has to quit the app by hand. Overrides electron-builder's default
; "app is running, click OK to close it" prompt (this app has no auto-updater,
; so a manually-run installer would otherwise always show that prompt).
!macro customCheckAppRunning
  DetailPrint "Closing PromptPad if it is running..."
  ; Polite close first (lets the app finish its debounced autosave), then a
  ; forced kill for anything that survived (e.g. minimized-to-tray instances).
  nsExec::Exec 'taskkill /im "${APP_EXECUTABLE_FILENAME}"'
  Sleep 600
  nsExec::Exec 'taskkill /f /im "${APP_EXECUTABLE_FILENAME}"'
  Sleep 300
!macroend
