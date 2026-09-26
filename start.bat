@echo off
setlocal
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
    echo Creating the local Python environment...
    py -3 -m venv .venv
    if errorlevel 1 goto failed
)
echo Starting Meetflow...
.venv\Scripts\python.exe app.py
goto end
:failed
echo.
echo Setup did not finish. Check that Python 3.10 or newer is installed and try again.
pause
:end
endlocal