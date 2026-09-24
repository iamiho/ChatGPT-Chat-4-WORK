@echo off
title Codex Local Bridge (127.0.0.1:9090)
cd /d "%~dp0"
cls
python codex_bridge.py
pause
