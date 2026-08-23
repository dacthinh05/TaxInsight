@echo off
chcp 65001 >nul
cd /d "%~dp0"
title TaxRecord - Test ket noi Giay Nop Tien (GNT)

echo ====================================================================
echo   TAXRECORD - E2E BACKTEST: GIAY NOP TIEN (GNT)
echo   Kiem tra chuoi: Dang nhap DVC -^> SSO eTax -^> Tra cuu GNT
echo   (File nay KHONG mo ung dung TaxInsight - chi chay test trong cua so nay)
echo ====================================================================
echo.

if not exist "node_modules" (
    echo [1/3] Cai dat thu vien npm install...
    call npm install
    if errorlevel 1 (
        echo [!] Loi khi cai dat thu vien
        pause
        exit /b 1
    )
)

echo [2/3] Dong goi script test (esbuild)...
call npx esbuild scripts/gnt-e2e-backtest.mts --bundle --platform=node --format=cjs --external:electron --outfile="%TEMP%\gnt-e2e.cjs" --log-level=warning
if errorlevel 1 (
    echo [!] Loi khi dong goi script
    pause
    exit /b 1
)

echo [3/3] Khoi chay test...
echo.
echo     [1] Nhap ten dang nhap DVC, mat khau
echo     [2] Anh CAPTCHA se TU DONG mo - nhap ma vao day roi Enter
echo.
set GNT_DEBUG_DUMP=1
node "%TEMP%\gnt-e2e.cjs"

echo.
echo ====================================================================
echo   Test xong. Copy toan bo phan "CHECKPOINT REPORT" o tren gui lai
echo   de phan tich (neu co FAIL).
echo ====================================================================
pause
