@echo off
cd /d "%~dp0"
title TaxRecord - Kiem chung Cong Thue Phase 0 Live Probe

echo ====================================================================
echo   PHASE 0: KIEM CHUNG TRUC TIEP VOI CONG THUE LIVE PORTAL PROBE
echo   dichvucong.gdt.gov.vn
echo ====================================================================
echo.

if not exist "node_modules" (
    echo [*] Dang cai dat thu vien
    call npm install
)

echo [*] Bat dau script Probe dong lenh
echo.
call npm run probe

echo.
echo ====================================================================
echo   Hoan tat phien kiem chung. Nhan phim bat ky de thoat.
echo ====================================================================
pause
