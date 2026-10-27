@echo off
cd /d "%~dp0"
where pythonw >nul 2>nul
if errorlevel 1 goto usepython
start "" pythonw "%~dp0app.py"
exit /b 0

:usepython
where python >nul 2>nul
if errorlevel 1 goto nopython
start "" /min python "%~dp0app.py"
exit /b 0

:nopython
echo [ERROR] Python was not found.
pause
