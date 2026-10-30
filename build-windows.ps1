$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
& .venv/Scripts/python.exe -m PyInstaller --noconfirm --clean --onefile --windowed --name MedicareCorsair --add-data 'extension;extension' desktop.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
