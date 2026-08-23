@echo off
title TaxInsight - Keygen and Customer Manager

set "DIR=%~dp0"
if exist "%~dp0QUAN_LY_BAN_QUYEN.html" (
    start "" "%~dp0QUAN_LY_BAN_QUYEN.html"
) else if exist "d:\Desktop\QUAN_LY_BAN_QUYEN.html" (
    start "" "d:\Desktop\QUAN_LY_BAN_QUYEN.html"
) else if exist "d:\Desktop\TaxRecord\QUAN_LY_BAN_QUYEN.html" (
    start "" "d:\Desktop\TaxRecord\QUAN_LY_BAN_QUYEN.html"
)

if exist "%~dp0TaxRecord\scripts\admin_keygen_server.js" (
    cd /d "%~dp0TaxRecord"
    node scripts\admin_keygen_server.js
) else if exist "%~dp0scripts\admin_keygen_server.js" (
    cd /d "%~dp0"
    node scripts\admin_keygen_server.js
)
