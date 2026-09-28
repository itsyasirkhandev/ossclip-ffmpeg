@echo off
cd /d "C:\Users\Admin\Desktop\ossclip"
echo ===================================================
echo   ossclip Combine ^& Produce Wizard
echo ===================================================
pnpm ossclip combine %*
if %ERRORLEVEL% NEQ 0 (
  echo.
  pause
)
