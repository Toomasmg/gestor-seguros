# Publica una versión nueva en GitHub para que el programa de Mamá se actualice solo.
#
# Uso (desde la carpeta del proyecto, con todo ya commiteado y subido):
#     powershell -File tools\publicar.ps1 -Version 1.2.0 -Notas "Qué cambió, en una frase"
#
# Qué hace:
#   1. Verifica que APP_VERSION en gestor_seguros.py coincida y que no queden cambios sin commitear.
#   2. Clona el repositorio en una carpeta limpia y compila ahí: así el .exe NUNCA lleva datos de clientes
#      (la base precargada vive en seed/, que no está en git).
#   3. Calcula la firma SHA-256 y crea el Release "vX.Y.Z" con GestorSeguros.exe + GestorSeguros.exe.sha256.
# El programa instalado revisa el último Release, descarga el .exe, verifica la firma y se reemplaza solo.
# Los datos (seguros.db) nunca se tocan; si hay cambios en la estructura se aplican como migración
# (ver MIGRACIONES en gestor_seguros.py) con respaldo automático previo.
param(
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$Notas = ""
)
$ErrorActionPreference = "Stop"
$repo = "Toomasmg/gestor-seguros"
$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz

$enCodigo = [regex]::Match((Get-Content gestor_seguros.py -Raw), 'APP_VERSION = "([^"]+)"').Groups[1].Value
if ($enCodigo -ne $Version) { throw "APP_VERSION en el código es '$enCodigo' y pediste '$Version'. Actualizá gestor_seguros.py primero." }
if (git status --porcelain) { throw "Hay cambios sin commitear. Hacé commit y push antes de publicar." }
if ((git rev-parse HEAD) -ne (git rev-parse '@{u}')) { throw "Hay commits sin subir. Hacé git push antes de publicar." }

$tmp = Join-Path $env:TEMP "gestor_seguros_release"
if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
git clone --quiet . $tmp
Push-Location $tmp
python -m PyInstaller --noconfirm --onefile --windowed --name GestorSeguros --icon web_icon.ico `
    --add-data "web;web" --exclude-module tkinter --exclude-module tkcalendar --exclude-module babel gestor_seguros.py
Pop-Location

$exe = Join-Path $tmp "dist\GestorSeguros.exe"
if (-not (Test-Path $exe)) { throw "No se generó el .exe" }
$sha = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLower()
$shaArchivo = Join-Path $tmp "dist\GestorSeguros.exe.sha256"
"$sha  GestorSeguros.exe" | Set-Content -Encoding ASCII $shaArchivo

if (-not $Notas) { $Notas = "Versión $Version" }
gh release create "v$Version" $exe $shaArchivo --repo $repo --title "Versión $Version" --notes $Notas
Write-Host "Publicado v$Version  (sha256 $sha)"
