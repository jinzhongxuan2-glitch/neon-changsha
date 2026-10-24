@echo off
rem ASCII only on purpose: cmd decodes this file in the system codepage, so any
rem non-ASCII path here gets mangled. All logic lives in _build\build.py.
setlocal
cd /d "%~dp0"
python "%~dp0_build\build.py" %*
if errorlevel 9009 (
  echo [error] "python" not found, retry with "py -3"
  py -3 "%~dp0_build\build.py" %*
)
exit /b %errorlevel%
