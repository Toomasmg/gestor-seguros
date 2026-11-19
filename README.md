# Gestor de Seguros

Programa de escritorio (Windows) para llevar el libro de pólizas de una productora de seguros:
búsqueda por patente / asegurado / N° de póliza, vencimientos con alerta a 12 días, calendario,
compañías, exportación a Excel y PDF.

- **Funciona sin internet.** Los datos viven en un archivo local `seguros.db` junto al programa.
- Interfaz web en una ventana propia (Edge/Chrome en modo app) + servidor local en Python (SQLite).
- Los datos de clientes **no están en este repositorio** ni deben subirse nunca (ver `.gitignore`).

## Desarrollo
```
pip install openpyxl reportlab pillow pyinstaller
python gestor_seguros.py
```

## Compilar
```
python -m PyInstaller --noconfirm --onefile --windowed --name GestorSeguros --icon web_icon.ico ^
  --add-data "web;web" --exclude-module tkinter --exclude-module tkcalendar --exclude-module babel gestor_seguros.py
```
(No excluir `PIL`: reportlab lo necesita para el PDF.)

Tipografías: IBM Plex (licencia OFL, ver `web/fonts/LICENSE-IBM-Plex-OFL.txt`).

## Actualizaciones
El programa busca solo el último *Release* de este repositorio (si hay internet), descarga el `.exe`,
verifica su firma SHA-256 y se reemplaza al reiniciar. **Los datos del usuario nunca se tocan**: los cambios en la
estructura de la base se aplican como migraciones (`MIGRACIONES` en `gestor_seguros.py`) y, antes de tocar una base
con datos, se hace un respaldo automático (`seguros.db.respaldo-antes-de-vN`).

Publicar una versión nueva:
1. Cambiar `APP_VERSION` en `gestor_seguros.py` (y, si hace falta, agregar una migración).
2. `git commit` + `git push`.
3. `powershell -File tools\publicar.ps1 -Version X.Y.Z -Notas "qué cambió"`.
