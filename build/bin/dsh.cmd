@echo off
rem Command-line entry for DSH Launcher.
rem Runs the launcher's bundled Node against whichever dsh copy the launcher
rem itself would run (updated copy if one is activated in Settings, otherwise
rem the bundled one), so the CLI and the window never disagree on the version.
rem ASCII only: cmd reads batch files in the OEM code page.
"%~dp0..\resources\runtime\node\node.exe" "%~dp0dsh-cli.mjs" %*
exit /b %ERRORLEVEL%
