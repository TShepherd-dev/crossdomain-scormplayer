@echo off
echo Starting .NET API on https://localhost:5001...
start "API" cmd /c "cd /d %~dp0src\ScormPlayer.Api && dotnet run"

echo Starting Vue frontend on http://localhost:8080...
start "Frontend" cmd /c "cd /d %~dp0frontend && npm run dev"

timeout /t 5 /nobreak >nul
start http://localhost:8080