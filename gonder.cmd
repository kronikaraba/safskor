@echo off
rem Safskor: bu klasordeki degisiklikleri GitHub main'e gonderir, Render otomatik yayina alir.
rem Kullanim: dosyaya cift tikla. Claude commit mesajini .gonder-mesaj.txt dosyasina yazar.
cd /d "%~dp0"
title Safskor gonderiliyor
echo Safskor gonderiliyor...
echo.
git add -A
git diff --cached --quiet
if %errorlevel%==0 (
  echo Yeni degisiklik yok, sadece GitHub ile esitleniyor.
  goto push
)
set "MSG=Safskor guncellemesi"
if exist ".gonder-mesaj.txt" set /p MSG=<".gonder-mesaj.txt"
git commit -q -m "%MSG%"
if errorlevel 1 goto fail
:push
git pull --rebase -q origin main
if errorlevel 1 goto fail
git push -q origin main
if errorlevel 1 goto fail
echo.
git log -1 --format="TAMAM: %%h %%s"
echo Render birkac dakika icinde yayina alir.
if exist ".gonder-mesaj.txt" del ".gonder-mesaj.txt"
echo.
pause
exit /b 0
:fail
echo.
echo HATA: gonderilemedi. Bu pencerenin ekran goruntusunu Claude'a gonder.
pause
exit /b 1
