@echo off
cd /d "%~dp0"
echo Starting Cheongyak Radar... open http://localhost:4320
node server.js
pause
