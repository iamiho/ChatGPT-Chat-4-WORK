@echo off
chcp 65001 >nul
title 正在修复并启动 ChatGPT 桌面端...
echo ========================================================
echo   正在清理后台卡死的 ChatGPT 僵尸进程与锁文件...
echo ========================================================
echo.

:: 1. 强杀残留的后台无响应进程
taskkill /F /IM ChatGPT.exe >nul 2>&1

:: 2. 删除残留的单例锁文件
del /F /Q "C:\Users\25655\AppData\Local\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Roaming\Codex\web\Codex\lockfile" >nul 2>&1

echo ✓ 清理完毕，正在拉起全新干净的窗口...
start "" "explorer.exe" "shell:AppsFolder\OpenAI.Codex_2p2nqsd0c76g0!App"

timeout /t 3 >nul
exit
