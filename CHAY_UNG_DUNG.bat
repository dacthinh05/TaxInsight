@echo off
cd /d "%~dp0"
title TaxRecord – Hồ Sơ Thuế Điện Tử

echo ====================================================================
echo   TAXRECORD – HO SO THUE DIEN TU (v2.0)
echo   Cong Dich vu cong Thue Viet Nam: dichvucong.gdt.gov.vn
echo ====================================================================
echo.

if not exist "node_modules" (
    echo [1/2] Cai dat thu vien npm install
    call npm install
    if errorlevel 1 (
        echo [!] Loi khi cai dat thu vien
        pause
        exit /b 1
    )
)

echo [2/2] Bien dich ma nguon va giao dien moi nhat (npm run build)...
call npm run build
if errorlevel 1 (
    echo [!] Loi khi bien dich ma nguon
    pause
    exit /b 1
)

echo.
echo [*] Dang khoi chay ung dung Desktop TaxRecord...
echo.

call npm start

if errorlevel 1 (
    echo.
    echo [!] Ung dung da dung voi ma loi: %errorlevel%
)

echo.
echo ====================================================================
echo   Ung dung da dong. Nhan phim bat ky de thoat.
echo ====================================================================
pause

