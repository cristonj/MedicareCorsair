$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
New-Item -ItemType Directory -Force build/runtime | Out-Null
Copy-Item package.json,package-lock.json build/runtime/
& npm ci --omit=dev --prefix build/runtime
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& .venv/Scripts/python.exe -m PyInstaller --noconfirm --clean --onefile --windowed --manifest windows.manifest --name MedicareCorsair --collect-all pypdfium2 --add-data 'extension;extension' --add-data 'setup-guides.json;.' --add-data 'assets;assets' --add-data 'backend/ocr.cjs;backend' --add-data 'build/runtime/node_modules;node_modules' --add-binary "$nodePath;runtime" desktop.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
