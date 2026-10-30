$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
& .venv/Scripts/python.exe -m PyInstaller --noconfirm --clean --onefile --windowed --name MedicareCorsair --collect-all pypdfium2 --add-data 'extension;extension' --add-data 'setup-guides.json;.' --add-data 'backend/ocr.cjs;backend' --add-data 'node_modules;node_modules' --add-binary "$nodePath;runtime" desktop.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
