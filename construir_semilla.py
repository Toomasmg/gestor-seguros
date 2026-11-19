"""Genera seed/seguros_semilla.db (base precargada que viaja dentro del .exe) a partir del Excel original."""
import os
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
EXCEL = os.path.join(AQUI, "Productores1.0 - 2025.xlsm")
SEMILLA = os.path.join(AQUI, "seed", "seguros_semilla.db")

os.makedirs(os.path.dirname(SEMILLA), exist_ok=True)
for ext in ("", "-wal", "-shm", "-journal"):
    try:
        os.remove(SEMILLA + ext)
    except FileNotFoundError:
        pass
os.environ["SEGUROS_DB"] = SEMILLA
sys.path.insert(0, AQUI)
import gestor_seguros as g  # noqa: E402

with open(EXCEL, "rb") as f:
    res = g.importar_xlsx(f.read())
print("Importación:", res)

# Correcciones de fechas mal escritas en el Excel original (revisadas una por una)
CORRECCIONES = {
    "1037452": {"vig_fin": "2027-02-28"},     # decía 29/02/2027 (2027 no es bisiesto)
    "1100587": {"vig_inicio": "2026-09-13"},  # decía 13/09/2065 (error de tipeo)
}
for nro, cambios in CORRECCIONES.items():
    for campo, valor in cambios.items():
        g.db.con.execute(f"UPDATE polizas SET {campo}=? WHERE nro_poliza=?", (valor, nro))
g.db.con.commit()
g.db.con.execute("VACUUM")

ps = g.db.polizas()
print("Pólizas:", len(ps), "| compañías:", g.db.companias())
print("Sin fecha fin:", [p["nro_poliza"] for p in ps if not p["vig_fin"]])
print("Sin fecha inicio:", [p["nro_poliza"] for p in ps if not p["vig_inicio"]])
print("Fin < inicio:", [p["nro_poliza"] for p in ps if p["vig_fin"] and p["vig_inicio"] and p["vig_fin"] < p["vig_inicio"]])
print("Sin n° póliza:", [p["asegurado"] for p in ps if not p["nro_poliza"]])
from collections import Counter  # noqa: E402
print("Tipos:", Counter(p["tipo"] for p in ps))
print("MIOS:", Counter(p["mios"] for p in ps))
