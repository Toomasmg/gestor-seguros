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
