@echo off
rem Valdrada with the Unreal Engine 5 renderer: the core and the renderer (launcher\ValdradaUE.ps1; ValdradaUE.bat --help)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher\ValdradaUE.ps1" %*
exit /b %ERRORLEVEL%
