"""Gestor de Seguros: servidor local (SQLite) + interfaz web en una ventana propia (Edge/Chrome en modo app)."""
import hmac
import io
import json
import mimetypes
import os
import re
import secrets
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
import unicodedata
import urllib.parse
import urllib.request
import hashlib
import tempfile
import webbrowser
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ALERTA_DIAS = 12
APP_TITLE = "Gestor de Seguros"
APP_DIR = (os.path.dirname(sys.executable) if getattr(sys, "frozen", False)
           else os.path.dirname(os.path.abspath(__file__)))
RES_DIR = getattr(sys, "_MEIPASS", APP_DIR)
WEB_DIR = os.path.join(RES_DIR, "web")
STATIC = {"/app.css": "text/css; charset=utf-8", "/app.js": "text/javascript; charset=utf-8",
          "/favicon.svg": "image/svg+xml"}

CAMPOS = ["nro_poliza", "asegurado", "patente", "tipo", "marca", "modelo", "email", "celular",
          "compania", "vig_inicio", "vig_fin", "mios", "trato"]


def resolver_db():
    """Base junto al .exe (o en LocalAppData si esa carpeta no es escribible).
    La primera vez se copia la base precargada que viene dentro del programa."""
    if os.environ.get("SEGUROS_DB"):
        return os.environ["SEGUROS_DB"]
    junto = os.path.join(APP_DIR, "seguros.db")
    local_dir = os.path.join(os.environ.get("LOCALAPPDATA", APP_DIR), "GestorSeguros")
    local = os.path.join(local_dir, "seguros.db")
    if os.path.exists(junto):
        return junto
    destino = junto if os.access(APP_DIR, os.W_OK) else local
    if destino == local:
        os.makedirs(local_dir, exist_ok=True)
        if os.path.exists(local):
            return local
    semilla = os.path.join(RES_DIR, "seed", "seguros_semilla.db")
    if os.path.exists(semilla):
        shutil.copyfile(semilla, destino)
    return destino


DB_PATH = resolver_db()
APP_VERSION = "1.4.0"
REPO = "Toomasmg/gestor-seguros"
UPDATE = {"comprobado": False, "disponible": False, "version": "", "url": "", "sha": "", "tam": 0, "notas": "", "error": ""}
VENTANA = None
TOKEN = secrets.token_urlsafe(24)
PORT = 0
LAST_PING = 0.0
BYE = 0.0


# ------------------------------------------------------------------ utilidades
def norm(txt):
    txt = unicodedata.normalize("NFD", str(txt or ""))
    txt = "".join(c for c in txt if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]", "", txt.lower())


def fmt(iso):
    try:
        return datetime.strptime(iso, "%Y-%m-%d").strftime("%d/%m/%Y")
    except (TypeError, ValueError):
        return ""


def dias_restantes(iso):
    try:
        fin = datetime.strptime(iso, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None
    return (fin - date.today()).days


def estado_txt(d):
    """Texto plano (sin símbolos) para Excel/PDF/toast."""
    if d is None:
        return "Sin fecha"
    if d < 0:
        return f"Vencida hace {-d} d"
    if d == 0:
        return "Vence hoy"
    if d <= ALERTA_DIAS:
        return f"Vence en {d} d"
    return "Vigente"


def toast(titulo, mensaje):
    """Notificación nativa de Windows (best effort)."""
    if os.name != "nt":
        return
    esc = lambda s: str(s).replace("'", "''").replace("\n", " ")
    ps = (
        "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, "
        "ContentType = WindowsRuntime] | Out-Null;"
        "$t=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent("
        "[Windows.UI.Notifications.ToastTemplateType]::ToastText02);"
        "$n=$t.GetElementsByTagName('text');"
        f"$n.Item(0).AppendChild($t.CreateTextNode('{esc(titulo)}')) | Out-Null;"
        f"$n.Item(1).AppendChild($t.CreateTextNode('{esc(mensaje)}')) | Out-Null;"
        "$id='{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe';"
        "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($id)"
        ".Show([Windows.UI.Notifications.ToastNotification]::new($t))"
    )
    try:
        subprocess.Popen(["powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", ps],
                         creationflags=0x08000000)
    except Exception:
        pass


# ------------------------------------------------------------------ base de datos
def _cols(con, tabla):
    return [r[1] for r in con.execute(f"PRAGMA table_info({tabla})")]


def _m1(con):
    """Estructura original (idempotente)."""
    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS companias(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL UNIQUE COLLATE NOCASE);
        CREATE TABLE IF NOT EXISTS polizas(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nro_poliza TEXT, asegurado TEXT, patente TEXT, tipo TEXT,
            marca TEXT, modelo TEXT, email TEXT, celular TEXT,
            compania TEXT, vig_inicio TEXT, vig_fin TEXT, mios TEXT DEFAULT '');
        """)
    if "mios" not in _cols(con, "polizas"):
        con.execute("ALTER TABLE polizas ADD COLUMN mios TEXT DEFAULT ''")


def _m2(con):
    """Pólizas anuladas: se conservan todos los datos y se pueden reactivar."""
    for nombre, ddl in (("anulada", "INTEGER NOT NULL DEFAULT 0"), ("anulada_el", "TEXT DEFAULT ''"),
                        ("motivo_anulacion", "TEXT DEFAULT ''")):
        if nombre not in _cols(con, "polizas"):
            con.execute(f"ALTER TABLE polizas ADD COLUMN {nombre} {ddl}")


def _m3(con):
    """Nombre para saludar, configuración (mensajes, respaldo) e historial de renovaciones."""
    if "trato" not in _cols(con, "polizas"):
        con.execute("ALTER TABLE polizas ADD COLUMN trato TEXT DEFAULT ''")
    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS config(clave TEXT PRIMARY KEY, valor TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS renovaciones(
            id INTEGER PRIMARY KEY AUTOINCREMENT, poliza_id INTEGER NOT NULL, hecha_el TEXT,
            inicio_ant TEXT, fin_ant TEXT, nro_ant TEXT, inicio_nuevo TEXT, fin_nuevo TEXT, nro_nuevo TEXT);
        """)


def _m4(con):
    """Archivos adjuntos por póliza (los archivos viven en la carpeta «Archivos», junto a la base)."""
    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS adjuntos(
            id INTEGER PRIMARY KEY AUTOINCREMENT, poliza_id INTEGER NOT NULL, nombre TEXT NOT NULL,
            archivo TEXT NOT NULL, tam INTEGER NOT NULL DEFAULT 0, agregado_el TEXT);
        CREATE INDEX IF NOT EXISTS ix_adjuntos_poliza ON adjuntos(poliza_id);
        """)


def _m5(con):
    """Papelera: eliminar una póliza la manda 30 días a la papelera antes de borrarla de verdad."""
    if "eliminada_el" not in _cols(con, "polizas"):
        con.execute("ALTER TABLE polizas ADD COLUMN eliminada_el TEXT DEFAULT ''")


# Para agregar campos o tablas en una versión futura: sumar acá (N, función). Se aplican en orden, una sola vez,
# con respaldo automático de la base antes de tocarla.
MIGRACIONES = [(1, _m1), (2, _m2), (3, _m3), (4, _m4), (5, _m5)]


def migrar(con, path):
    actual = con.execute("PRAGMA user_version").fetchone()[0]
    pendientes = [(v, f) for v, f in MIGRACIONES if v > actual]
    if not pendientes:
        return
    try:
        con_datos = con.execute("SELECT COUNT(*) FROM polizas").fetchone()[0] > 0
    except sqlite3.Error:
        con_datos = False
    if con_datos and path != ":memory:":
        copia = f"{path}.respaldo-antes-de-v{pendientes[-1][0]}"
        if not os.path.exists(copia):
            destino = sqlite3.connect(copia)
            con.backup(destino)
            destino.close()
    for v, f in pendientes:
        f(con)
        con.execute(f"PRAGMA user_version = {v}")
        con.commit()


class DB:
    def __init__(self, path):
        self.lock = threading.RLock()
        self.con = sqlite3.connect(path, check_same_thread=False)
        self.con.row_factory = sqlite3.Row
        with self.lock:
            migrar(self.con, path)

    def companias(self):
        with self.lock:
            return [r["nombre"] for r in self.con.execute(
                "SELECT nombre FROM companias ORDER BY nombre COLLATE NOCASE")]

    def add_compania(self, nombre):
        nombre = (nombre or "").strip()[:80]
        if not nombre:
            return False
        with self.lock:
            try:
                self.con.execute("INSERT INTO companias(nombre) VALUES(?)", (nombre,))
                self.con.commit()
                return True
            except sqlite3.IntegrityError:
                return False

    def uso_compania(self, nombre):
        with self.lock:
            return self.con.execute("SELECT COUNT(*) FROM polizas WHERE compania=? COLLATE NOCASE AND COALESCE(eliminada_el, '') = ''",
                                    (nombre,)).fetchone()[0]

    def del_compania(self, nombre):
        with self.lock:
            self.con.execute("DELETE FROM companias WHERE nombre=?", (nombre,))
            self.con.commit()

    def rename_compania(self, viejo, nuevo):
        nuevo = (nuevo or "").strip()[:80]
        if not nuevo:
            return False
        with self.lock:
            try:
                self.con.execute("UPDATE companias SET nombre=? WHERE nombre=?", (nuevo, viejo))
                self.con.execute("UPDATE polizas SET compania=? WHERE compania=? COLLATE NOCASE", (nuevo, viejo))
                self.con.commit()
                return True
            except sqlite3.IntegrityError:
                return False

    def polizas(self):
        with self.lock:
            return [dict(r) for r in self.con.execute("SELECT * FROM polizas WHERE COALESCE(eliminada_el, '') = ''")]

    def save(self, d, pid=None):
        vals = [d.get(c, "") for c in CAMPOS]
        with self.lock:
            if pid is None:
                cur = self.con.execute(
                    f"INSERT INTO polizas({','.join(CAMPOS)}) VALUES({','.join('?' * len(CAMPOS))})", vals)
                pid = cur.lastrowid
            else:
                self.con.execute(f"UPDATE polizas SET {','.join(c + '=?' for c in CAMPOS)} WHERE id=?",
                                 vals + [pid])
            self.con.commit()
        return pid

    def anular(self, pid, motivo):
        with self.lock:
            self.con.execute("UPDATE polizas SET anulada=1, anulada_el=?, motivo_anulacion=? WHERE id=?",
                             (date.today().isoformat(), (motivo or "").strip()[:300], int(pid)))
            self.con.commit()

    def reactivar(self, pid):
        with self.lock:
            self.con.execute("UPDATE polizas SET anulada=0, anulada_el='', motivo_anulacion='' WHERE id=?", (int(pid),))
            self.con.commit()

    def config_get(self):
        with self.lock:
            out = {}
            for r in self.con.execute("SELECT clave, valor FROM config"):
                try:
                    out[r["clave"]] = json.loads(r["valor"])
                except ValueError:
                    pass
            return out

    def config_set(self, cfg):
        with self.lock:
            for k, v in cfg.items():
                self.con.execute("INSERT INTO config(clave, valor) VALUES(?, ?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor",
                                 (k, json.dumps(v, ensure_ascii=False)))
            self.con.commit()

    def renovar(self, pid, inicio, fin, nro):
        """La misma póliza pasa a un nuevo período; el anterior queda en el historial."""
        with self.lock:
            r = self.con.execute("SELECT nro_poliza, vig_inicio, vig_fin FROM polizas WHERE id=?", (int(pid),)).fetchone()
            if not r:
                return False
            nro_nuevo = nro if nro else r["nro_poliza"]
            self.con.execute("INSERT INTO renovaciones(poliza_id, hecha_el, inicio_ant, fin_ant, nro_ant, inicio_nuevo, fin_nuevo, nro_nuevo) "
                             "VALUES(?,?,?,?,?,?,?,?)",
                             (int(pid), date.today().isoformat(), r["vig_inicio"], r["vig_fin"], r["nro_poliza"], inicio, fin, nro_nuevo))
            self.con.execute("UPDATE polizas SET vig_inicio=?, vig_fin=?, nro_poliza=? WHERE id=?", (inicio, fin, nro_nuevo, int(pid)))
            self.con.commit()
            return True

    def adjuntos_listar(self):
        with self.lock:
            return [dict(r) for r in self.con.execute("SELECT a.id, a.poliza_id, a.nombre, a.tam, a.agregado_el FROM adjuntos a JOIN polizas p ON p.id = a.poliza_id "
                "WHERE COALESCE(p.eliminada_el, '') = '' ORDER BY a.id DESC")]

    def adjunto_get(self, aid):
        with self.lock:
            r = self.con.execute("SELECT * FROM adjuntos WHERE id=?", (int(aid),)).fetchone()
            return dict(r) if r else None

    def adjunto_nuevo(self, pid, nombre, archivo, tam):
        with self.lock:
            cur = self.con.execute("INSERT INTO adjuntos(poliza_id, nombre, archivo, tam, agregado_el) VALUES(?,?,?,?,?)",
                                   (int(pid), nombre, archivo, int(tam), datetime.now().isoformat(timespec="seconds")))
            self.con.commit()
            return cur.lastrowid

    def adjunto_borrar(self, aid):
        with self.lock:
            a = self.adjunto_get(aid)
            if not a:
                return False
            self.con.execute("DELETE FROM adjuntos WHERE id=?", (int(aid),))
            self.con.commit()
        _borrar_archivo(a["archivo"])
        return True

    def existe_poliza(self, pid):
        with self.lock:
            return self.con.execute("SELECT 1 FROM polizas WHERE id=? AND COALESCE(eliminada_el, '') = ''", (int(pid),)).fetchone() is not None

    def renovaciones(self):
        with self.lock:
            return [dict(r) for r in self.con.execute("SELECT * FROM renovaciones ORDER BY id DESC")]

    def delete(self, ids):
        """Eliminar: la póliza va a la papelera (se puede recuperar durante 30 días)."""
        with self.lock:
            self.con.executemany("UPDATE polizas SET eliminada_el=? WHERE id=?", [(date.today().isoformat(), int(i)) for i in ids])
            self.con.commit()

    def papelera(self):
        with self.lock:
            return [dict(r) for r in self.con.execute(
                "SELECT id, nro_poliza, asegurado, patente, compania, eliminada_el FROM polizas "
                "WHERE COALESCE(eliminada_el, '') != '' ORDER BY eliminada_el DESC, id DESC")]

    def restaurar(self, pid):
        with self.lock:
            self.con.execute("UPDATE polizas SET eliminada_el='' WHERE id=?", (int(pid),))
            self.con.commit()

    def borrar_definitivo(self, ids):
        with self.lock:
            archivos = []
            for i in ids:
                archivos += [r["archivo"] for r in self.con.execute("SELECT archivo FROM adjuntos WHERE poliza_id=?", (int(i),))]
            self.con.executemany("DELETE FROM adjuntos WHERE poliza_id=?", [(int(i),) for i in ids])
            for rel in archivos:
                _borrar_archivo(rel)
            self.con.executemany("DELETE FROM renovaciones WHERE poliza_id=?", [(int(i),) for i in ids])
            self.con.executemany("DELETE FROM polizas WHERE id=?", [(int(i),) for i in ids])
            self.con.commit()

    def existe(self, nro, patente):
        with self.lock:
            return self.con.execute("SELECT 1 FROM polizas WHERE nro_poliza=? AND patente=? AND COALESCE(eliminada_el, '') = ''",
                                    (nro, patente)).fetchone() is not None


db = DB(DB_PATH)


def limpiar(d):
    """Normaliza una póliza recibida. NINGÚN dato es obligatorio (solo se evita guardar una ficha totalmente vacía)."""
    out = {}
    for c in CAMPOS:
        v = d.get(c, "")
        out[c] = ("" if v is None else str(v)).strip()[:200]
    out["patente"] = re.sub(r"\s+", "", out["patente"]).upper()
    for k in ("vig_inicio", "vig_fin"):          # una fecha vacía o ilegible simplemente queda sin fecha
        try:
            datetime.strptime(out[k], "%Y-%m-%d")
        except ValueError:
            out[k] = ""
    if not any(out[c] for c in CAMPOS):
        return None, "Completá al menos un dato para guardar la póliza."
    return out, None


# ------------------------------------------------------------------ importar
ALIAS = {
    "nro_poliza": ["npoliza", "nropoliza", "poliza", "numeropoliza"],
    "asegurado": ["asegurado", "cliente", "nombre", "titular"],
    "patente": ["patente", "dominio"],
    "tipo": ["tipo", "tipovehiculo"],
    "marca": ["marca"],
    "modelo": ["modelo"],
    "email": ["email", "correo", "mail", "correoelectronico"],
    "celular": ["celular", "telefono", "tel", "cel"],
    "compania": ["compania", "aseguradora", "cia"],
    "vig_inicio": ["iniciovigencia", "inicio", "vigenciadesde", "desde", "viginicio", "iniciodevigencia",
                   "fechainicio", "fechadeinicio"],
    "vig_fin": ["finvigencia", "fin", "vigenciahasta", "hasta", "vigfin", "findevigencia",
                "fechafin", "fechadefin", "vencimiento"],
    "mios": ["mios", "mio"],
    "vehiculo": ["tipomarcamodelo", "vehiculo", "marcamodelo"],
}

# --- separación de «TIPO / MARCA / MODELO» (en el Excel original viene todo en una celda)
_MARCAS = ["MERCEDES BENZ", "IKA RENAULT", "VOLKSWAGEN", "VOLKWAGEN", "CHEVROLET", "MERCEDES", "CHRYSLER",
           "MITSUBISHI", "MOTOMEL", "ZANELLA", "PEUGEOT", "CITROEN", "KAWASAKI", "BAJAJ", "BENELLI", "KEEWAY",
           "MAVERICK", "MONDIAL", "SUZUKI", "TOYOTA", "YAMAHA", "RENAULT", "HYUNDAI", "DAIHATSU", "DAEWOO",
           "DUCATI", "TRIUMPH", "SLALOM", "CORVEN", "KELLER", "GILERA", "FAMSA", "APPIA", "BRAVA", "DODGE",
           "HONDA", "NISSAN", "MAZDA", "KYMCO", "IVECO", "SCANIA", "JEEP", "AUDI", "VOLVO", "SEAT", "LADA",
           "SIAM", "SUMO", "FORD", "FIAT", "IKA", "BMW", "KIA", "TVS", "KTM", "BETA", "CHERY"]
_MARCAS.sort(key=len, reverse=True)
_ALIAS_MARCA = {"VOLKWAGEN": "VOLKSWAGEN", "MERCEDES": "MERCEDES BENZ", "IKA": "IKA RENAULT"}
_MOTO = {"ZANELLA", "MOTOMEL", "HONDA", "CORVEN", "YAMAHA", "GILERA", "BAJAJ", "KELLER", "SUZUKI", "SIAM",
         "MONDIAL", "APPIA", "BENELLI", "BRAVA", "MAVERICK", "SLALOM", "KEEWAY", "KYMCO", "SUMO", "TVS",
         "FAMSA", "KAWASAKI", "DUCATI", "TRIUMPH", "KTM", "BETA"}
_RE_AUTO_DE_MOTERA = re.compile(r"\b(CIVIC|FIT|CITY|CR-?V|HR-?V|ACCORD|FUN|VITARA|SWIFT|SX4|JIMNY|GYPSY)\b")
_RE_PICKUP = re.compile(r"\b(F-?100|F-?150|F-?250|F-?350|PICK ?-?UP|HILUX|RANGER|AMAROK|S-?10|SAVEIRO|STRADA|"
                        r"OROCH|TORO|MONTANA|D-?20|D-?100|1500|DAKOTA|FRONTIER|L200|COURIER|LUV|CAMIONETA)\b")
_RE_UTIL = re.compile(r"\b(SPRINTER|DUCATO|KANGOO|PARTNER|BERLINGO|TRAFIC|MASTER|BOXER|FIORINO|CADDY|"
                      r"TRANSIT|DAILY|PANEL|FURGON|COMBI|E ?-?1600)\b")


def _inferir_tipo(marca, resto):
    if marca in _MOTO and not _RE_AUTO_DE_MOTERA.search(resto):
        return "Moto"
    if _RE_PICKUP.search(resto):
        return "Pick-up"
    if marca == "IVECO" or _RE_UTIL.search(resto):
        return "Utilitario"
    return "Auto"


def parse_vehiculo(texto, patente=""):
    """Devuelve dict con tipo, marca, modelo y patente depurada (mejor esfuerzo, editable luego)."""
    pat = re.sub(r"\s+", "", str(patente or "")).upper()
    t = re.sub(r"\s+", " ", str(texto or "")).strip()
    if pat == "AP":
        return {"tipo": "Accidentes personales", "marca": "", "modelo": t, "patente": ""}
    if pat == "BICI":
        return {"tipo": "Bicicleta", "marca": "", "modelo": t, "patente": ""}
    u = t.upper()
    if u == "TRAILER":
        return {"tipo": "Trailer", "marca": "", "modelo": "", "patente": pat}
    if u == "MOTOCICLETA":
        return {"tipo": "Moto", "marca": "", "modelo": "", "patente": pat}
    m = re.match(r"^(SEDAN|PICK ?-?UP|CAMIONETA|FURGON|UTILITARIO)\s*-\s*(.+)$", u)
    if m:
        u = m.group(2)
    marca, resto = "", u
    for b in _MARCAS:
        if re.match(rf"^{re.escape(b)}(?=[\s\-]|$)", u):
            marca, resto = b, u[len(b):].lstrip(" -")
            break
    marca = _ALIAS_MARCA.get(marca, marca)
    if marca == "ZANELLA":
        resto = re.sub(r"^MOTOS\s+", "", resto)
    base = marca if marca != "IKA RENAULT" else "IKA RENAULT"
    if m and m.group(1).startswith("PICK"):
        tipo = "Pick-up"
    elif m and m.group(1) in ("FURGON", "UTILITARIO"):
        tipo = "Utilitario"
    else:
        tipo = _inferir_tipo(base, resto)
    return {"tipo": tipo, "marca": marca, "modelo": resto.strip(), "patente": pat}


def limpiar_nombre(nombre):
    """Colapsa espacios y separa la etiqueta «(L.F)» -> (nombre, mios)."""
    n = re.sub(r"\s+", " ", str(nombre or "")).strip()
    mios = ""
    if re.search(r"\(\s*L\.?F\.?\s*\)", n, re.I):
        n = re.sub(r"\s*\(\s*L\.?F\.?\s*\)", "", n, flags=re.I).strip()
        mios = "L.F"
    return n, mios


def a_fecha(v):
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    s = re.sub(r"/+", "/", str(v or "").strip())
    for f in ("%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d", "%d/%m/%y", "%d.%m.%Y"):
        try:
            return datetime.strptime(s[:10] if f.startswith("%Y") else s, f).date().isoformat()
        except ValueError:
            continue
    return ""


def importar_xlsx(data):
    from openpyxl import load_workbook
    try:
        ws = load_workbook(io.BytesIO(data), data_only=True, read_only=True).worksheets[0]
        filas = list(ws.iter_rows(values_only=True))
    except Exception:
        return {"ok": False, "error": "No se pudo leer el archivo. ¿Es un Excel (.xlsx)?"}
    if not filas:
        return {"ok": False, "error": "La primera hoja está vacía."}
    mapa, h = {}, 0
    for h in range(min(10, len(filas))):
        tmp = {}
        for idx, celda in enumerate(filas[h]):
            n = norm(celda)
            for campo, al in ALIAS.items():
                if n in al and campo not in tmp:
                    tmp[campo] = idx
        if len(tmp) >= 3:
            mapa = tmp
            break
    if not mapa:
        return {"ok": False, "error": "No encontré encabezados como N° póliza, asegurado o patente "
                                       "en las primeras 10 filas."}
    nuevos = dup = sin_fecha = 0
    for fila in filas[h + 1:]:
        def val(c):
            i = mapa.get(c)
            return fila[i] if i is not None and i < len(fila) else None
        d = {c: ("" if val(c) is None else re.sub(r"\s+", " ", str(val(c))).strip()) for c in CAMPOS}
        d["nro_poliza"] = d["nro_poliza"].removesuffix(".0")
        d["celular"] = d["celular"].removesuffix(".0")
        d["patente"] = re.sub(r"\s+", "", d["patente"]).upper()
        d["vig_inicio"] = a_fecha(val("vig_inicio"))
        d["vig_fin"] = a_fecha(val("vig_fin"))
        d["asegurado"], marca_mios = limpiar_nombre(d["asegurado"])
        d["mios"] = d["mios"] or marca_mios
        if "vehiculo" in mapa:
            v = parse_vehiculo(val("vehiculo"), d["patente"])
            d.update({k: v[k] for k in ("tipo", "marca", "modelo", "patente")})
        if not d["nro_poliza"] and not d["asegurado"]:
            continue
        if db.existe(d["nro_poliza"], d["patente"]):
            dup += 1
            continue
        if not d["vig_fin"]:
            sin_fecha += 1
        if d["compania"]:
            db.add_compania(d["compania"])
        db.save(d)
        nuevos += 1
    return {"ok": True, "nuevos": nuevos, "duplicados": dup, "sin_fecha": sin_fecha}


# ------------------------------------------------------------------ exportar
ORDEN_EXP = [("nro_poliza", "N° PÓLIZA", 100), ("asegurado", "ASEGURADO", 170), ("patente", "PATENTE", 80),
             ("tipo", "TIPO", 70), ("marca", "MARCA", 85), ("modelo", "MODELO", 95), ("email", "E-MAIL", 165),
             ("celular", "CELULAR", 95), ("compania", "COMPAÑÍA", 115), ("vig_inicio", "INICIO VIGENCIA", 90),
             ("vig_fin", "FIN VIGENCIA", 90), ("mios", "MIOS", 45)]


def tabla_export(ids, anuladas=False):
    por_id = {p["id"]: p for p in db.polizas()}
    if anuladas:
        enc = [c[1] for c in ORDEN_EXP] + ["ANULADA EL", "MOTIVO"]
        anchos = [c[2] for c in ORDEN_EXP] + [80, 150]
    else:
        enc = [c[1] for c in ORDEN_EXP] + ["DÍAS REST.", "ESTADO"]
        anchos = [c[2] for c in ORDEN_EXP] + [60, 95]
    data = []
    for i in ids:
        p = por_id.get(int(i))
        if not p:
            continue
        d = dias_restantes(p["vig_fin"])
        fila = [fmt(p[k]) if k in ("vig_inicio", "vig_fin") else (p.get(k) or "") for k, _, _ in ORDEN_EXP]
        if anuladas:
            data.append(fila + [fmt(p.get("anulada_el")), p.get("motivo_anulacion") or ""])
        else:
            data.append(fila + ["" if d is None else d, estado_txt(d)])
    return enc, anchos, data


def exportar_excel(ids, anuladas=False):
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter
    enc, anchos, data = tabla_export(ids, anuladas)
    wb = Workbook()
    ws = wb.active
    ws.title = "Pólizas"
    ws.append(enc)
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="1F3A5F")
        c.alignment = Alignment(horizontal="center")
    rojo, ambar = PatternFill("solid", fgColor="F8C7C7"), PatternFill("solid", fgColor="FFE8A3")
    for fila in data:
        ws.append(fila)
        d = fila[-2]
        if isinstance(d, int) and d <= ALERTA_DIAS:
            for c in ws[ws.max_row]:
                c.fill = rojo if d < 0 else ambar
    for i, a in enumerate(anchos, 1):
        ws.column_dimensions[get_column_letter(i)].width = max(12, a // 6 + 4)
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def exportar_pdf(ids, vista, anuladas=False):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    enc, anchos, data = tabla_export(ids, anuladas)
    est = getSampleStyleSheet()
    nombre = {"todas": "Listado general", "compania": "Listado por compañía",
              "venc": "Listado por vencimientos", "anuladas": "Pólizas anuladas"}.get(vista, "Listado")
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4), leftMargin=18, rightMargin=18, topMargin=22,
                            bottomMargin=22, title="Pólizas")
    cel = est["BodyText"].clone("c", fontSize=6.5, leading=8)
    filas = [[Paragraph(f"<b>{h}</b>", cel.clone("h", textColor=colors.white)) for h in enc]]
    for f in data:
        filas.append([Paragraph(str(v).replace("&", "&amp;").replace("<", "&lt;"), cel) for v in f])
    k = (landscape(A4)[0] - 36) / sum(anchos)
    t = Table(filas, colWidths=[a * k for a in anchos], repeatRows=1)
    estilo = [("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1F3A5F")),
              ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#9AA9C0")),
              ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
              ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F3F6FA")])]
    for i, f in enumerate(data, 1):
        d = f[-2]
        if isinstance(d, int) and d <= ALERTA_DIAS:
            estilo.append(("BACKGROUND", (0, i), (-1, i), colors.HexColor("#F8C7C7" if d < 0 else "#FFE8A3")))
    t.setStyle(TableStyle(estilo))
    titulo = Paragraph(f"<b>{APP_TITLE} — {nombre}</b> &nbsp; ({date.today():%d/%m/%Y}) &nbsp; "
                       f"{len(data)} póliza(s)", est["Title"].clone("t", fontSize=13))
    doc.build([titulo, Spacer(1, 6), t])
    return buf.getvalue()


# ------------------------------------------------------------------ configuración y respaldo
PLANTILLAS_BASE = [
    {"id": "aviso", "nombre": "Aviso de vencimiento",
     "texto": "Hola {nombre}, ¿cómo estás? Te escribo porque tu seguro {vence} ({fecha}). ¿Querés que te lo renueve? Cualquier cosa me avisás 🙂"},
    {"id": "vencida", "nombre": "Ya venció",
     "texto": "Hola {nombre}, ¿cómo andás? Tu seguro venció el {fecha}. Si querés lo regularizamos hoy mismo para que no quedes sin cobertura. Avisame y lo vemos."},
    {"id": "renovada", "nombre": "Renovación lista",
     "texto": "Hola {nombre}, ya renové tu seguro hasta el {fecha}. Cualquier consulta, estoy a disposición."},
]
CONFIG_DEF = {"plantillas": PLANTILLAS_BASE, "plantilla_pred": "aviso", "codigo_pais": "54",
              "wa_mi_numero": "", "wa_mi_nombre": "", "wa_abrir": "auto",
              "respaldo_activo": True, "respaldo_carpeta": "", "respaldo_cantidad": 30, "respaldo_archivos": True}
RESPALDO = {"ultimo": "", "archivo": "", "error": "", "archivos": 0}
_PATRON_RESPALDO = re.compile(r"^seguros_\d{4}-\d{2}-\d{2}(_\d{6})?\.db$")


def cargar_config():
    cfg = json.loads(json.dumps(CONFIG_DEF))
    cfg.update({k: v for k, v in db.config_get().items() if k in cfg})
    return cfg


def guardar_config(nuevo):
    cfg = cargar_config()
    if nuevo.get("restaurar_plantillas"):
        cfg["plantillas"] = json.loads(json.dumps(PLANTILLAS_BASE))
        cfg["plantilla_pred"] = "aviso"
    if "plantillas" in nuevo:
        cfg["plantillas"] = [
            {"id": str(x.get("id") or f"p-{secrets.token_hex(3)}")[:40],
             "nombre": (str(x.get("nombre") or "").strip()[:60] or "Mensaje"),
             "texto": str(x.get("texto") or "")[:1000]}
            for x in (nuevo.get("plantillas") or [])[:50] if isinstance(x, dict)]
    if "plantilla_pred" in nuevo:
        cfg["plantilla_pred"] = str(nuevo["plantilla_pred"])
    ids = [x["id"] for x in cfg["plantillas"]]
    if cfg["plantilla_pred"] not in ids:
        cfg["plantilla_pred"] = ids[0] if ids else ""
    if "codigo_pais" in nuevo:
        cfg["codigo_pais"] = re.sub(r"\D", "", str(nuevo["codigo_pais"]))[:4] or "54"
    if "respaldo_activo" in nuevo:
        cfg["respaldo_activo"] = bool(nuevo["respaldo_activo"])
    if "respaldo_carpeta" in nuevo:
        cfg["respaldo_carpeta"] = str(nuevo["respaldo_carpeta"] or "").strip()[:300]
    if "respaldo_cantidad" in nuevo:
        cfg["respaldo_cantidad"] = max(1, min(365, int(nuevo["respaldo_cantidad"])))
    if "respaldo_archivos" in nuevo:
        cfg["respaldo_archivos"] = bool(nuevo["respaldo_archivos"])
    if "wa_mi_numero" in nuevo:
        cfg["wa_mi_numero"] = re.sub(r"[^\d+\s()-]", "", str(nuevo["wa_mi_numero"] or "")).strip()[:30]
    if "wa_mi_nombre" in nuevo:
        cfg["wa_mi_nombre"] = str(nuevo["wa_mi_nombre"] or "").strip()[:60]
    if "wa_abrir" in nuevo:
        cfg["wa_abrir"] = nuevo["wa_abrir"] if nuevo["wa_abrir"] in ("auto", "escritorio", "web") else "auto"
    db.config_set(cfg)
    return cfg


def carpeta_respaldo(cfg=None):
    cfg = cfg or cargar_config()
    if cfg["respaldo_carpeta"]:
        return cfg["respaldo_carpeta"]
    if os.environ.get("SEGUROS_DB"):                       # pruebas: nunca ensuciar Documentos
        return DB_PATH + "_respaldos"
    docs = os.path.join(os.path.expanduser("~"), "Documents")
    return os.path.join(docs if os.path.isdir(docs) else APP_DIR, "Respaldos Gestor de Seguros")


def _rotar_respaldos(carpeta, cantidad):
    archivos = sorted((f for f in os.listdir(carpeta) if _PATRON_RESPALDO.match(f)), reverse=True)
    for viejo in archivos[cantidad:]:
        try:
            os.remove(os.path.join(carpeta, viejo))
        except OSError:
            pass


def hacer_respaldo(manual=False):
    """Copia consistente de la base (aunque esté en uso) a la carpeta de respaldos. Nunca rompe el programa."""
    cfg = cargar_config()
    carpeta = carpeta_respaldo(cfg)
    try:
        os.makedirs(carpeta, exist_ok=True)
        hoy = date.today().isoformat()
        nombre = f"seguros_{hoy}_{datetime.now():%H%M%S}.db" if manual else f"seguros_{hoy}.db"
        destino, tmp = os.path.join(carpeta, nombre), os.path.join(carpeta, nombre + ".tmp")
        with db.lock:
            dst = sqlite3.connect(tmp)
            db.con.backup(dst)
            dst.close()
        os.replace(tmp, destino)
        _rotar_respaldos(carpeta, int(cfg["respaldo_cantidad"]))
        aviso = ""
        if cfg.get("respaldo_archivos", True):
            copiados, fallidos = espejo_archivos(os.path.join(carpeta, "Archivos"))
            RESPALDO["archivos"] = copiados
            if fallidos:
                aviso = f"La base se copió, pero {fallidos} archivo(s) adjunto(s) no se pudieron copiar."
        RESPALDO.update(ultimo=datetime.now().isoformat(timespec="seconds"), archivo=destino, error=aviso)
        return True, destino
    except Exception as e:
        RESPALDO.update(error=f"No se pudo guardar la copia en «{carpeta}»: {e}"[:300])
        return False, RESPALDO["error"]


def estado_respaldo():
    cfg = cargar_config()
    carpeta = carpeta_respaldo(cfg)
    cantidad, ultimo = 0, RESPALDO["ultimo"]
    try:
        archivos = sorted(f for f in os.listdir(carpeta) if _PATRON_RESPALDO.match(f))
        cantidad = len(archivos)
        if archivos:
            ultimo = datetime.fromtimestamp(os.path.getmtime(os.path.join(carpeta, archivos[-1]))).isoformat(timespec="seconds")
    except OSError:
        pass
    return {"carpeta": carpeta, "ultimo": ultimo, "cantidad": cantidad, "error": RESPALDO["error"], "archivos": RESPALDO["archivos"]}


def _hilo_respaldo():
    """Una copia por día: al abrir el programa y, si queda abierto, cada vez que cambia el día."""
    time.sleep(3)
    while True:
        try:
            purgar_papelera()
        except Exception:
            pass
        try:
            cfg = cargar_config()
            if cfg["respaldo_activo"]:
                carpeta, hoy = carpeta_respaldo(cfg), date.today().isoformat()
                ya = os.path.isdir(carpeta) and any(f.startswith(f"seguros_{hoy}") and _PATRON_RESPALDO.match(f) for f in os.listdir(carpeta))
                if not ya:
                    hacer_respaldo()
        except Exception:
            pass
        time.sleep(1800)


def elegir_carpeta():
    """Selector de carpetas de Windows (sin depender de tkinter). Devuelve '' si se cancela."""
    ps = ("[Console]::OutputEncoding=[Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; "
          "$f=New-Object System.Windows.Forms.Form; $f.TopMost=$true; "
          "$d=New-Object System.Windows.Forms.FolderBrowserDialog; "
          "$d.Description='Elegí la carpeta donde guardar las copias de seguridad'; $d.ShowNewFolderButton=$true; "
          "if ($d.ShowDialog($f) -eq 'OK') { Write-Output $d.SelectedPath }")
    r = subprocess.run(["powershell", "-NoProfile", "-STA", "-Command", ps], capture_output=True, text=True,
                       encoding="utf-8", creationflags=0x08000000, timeout=900)
    return (r.stdout or "").strip()


def renovar_datos(d):
    """Valida y aplica una renovación. Devuelve (ok, error)."""
    try:
        pid = int(d.get("id"))
    except (TypeError, ValueError):
        return False, "Póliza inválida."
    fin = str(d.get("fin") or "").strip()
    inicio = str(d.get("inicio") or "").strip()
    try:
        datetime.strptime(fin, "%Y-%m-%d")
    except ValueError:
        return False, "Elegí hasta qué fecha se renueva."
    if inicio:
        try:
            datetime.strptime(inicio, "%Y-%m-%d")
        except ValueError:
            inicio = ""
    nro = re.sub(r"\s+", " ", str(d.get("nro_poliza") or "")).strip()[:60]
    return (True, "") if db.renovar(pid, inicio, fin, nro) else (False, "No se encontró la póliza.")


# ------------------------------------------------------------------ archivos adjuntos
_URL_WA = re.compile(r"^(https://wa\.me/\d{6,16}(\?[^\s]*)?|https://web\.whatsapp\.com/send\?[^\s]+|whatsapp://send\?[^\s]+)$")
_RESERVADOS = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}


def dir_archivos():
    return os.path.join(os.path.dirname(os.path.abspath(DB_PATH)), "Archivos")


def _nombre_seguro(nombre):
    n = os.path.basename(str(nombre or "").replace("\\", "/"))
    n = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", n).strip(" .")[:150] or "archivo"
    return "_" + n if n.split(".")[0].upper() in _RESERVADOS else n


def _ruta_adjunto(rel):
    """Ruta absoluta de un adjunto, SOLO si queda dentro de la carpeta de archivos."""
    base = os.path.realpath(dir_archivos())
    ruta = os.path.realpath(os.path.join(base, rel))
    return ruta if ruta.startswith(base + os.sep) else None


def _borrar_archivo(rel):
    ruta = _ruta_adjunto(rel)
    if not ruta:
        return
    try:
        os.remove(ruta)
        carpeta = os.path.dirname(ruta)
        if not os.listdir(carpeta):
            os.rmdir(carpeta)
    except OSError:
        pass


def subir_adjunto(pid, nombre, rfile, total):
    """Guarda un archivo (sin límite de tamaño; se escribe de a pedazos). Devuelve el registro creado."""
    if not db.existe_poliza(pid):
        raise ValueError("La póliza no existe.")
    if total <= 0:
        raise ValueError("El archivo está vacío.")
    base = dir_archivos()
    os.makedirs(base, exist_ok=True)
    if shutil.disk_usage(base).free < total + 200 * 1024 * 1024:
        raise ValueError("No hay espacio suficiente en el disco para guardar este archivo.")
    seguro = _nombre_seguro(nombre)
    rel = os.path.join(str(int(pid)), f"{secrets.token_hex(4)}_{seguro}")
    destino = os.path.join(base, rel)
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    restante = total
    try:
        with open(destino, "wb") as f:
            while restante > 0:
                bloque = rfile.read(min(1 << 20, restante))
                if not bloque:
                    raise ValueError("La subida se cortó antes de terminar.")
                f.write(bloque)
                restante -= len(bloque)
    except Exception:
        try:
            os.remove(destino)
        except OSError:
            pass
        raise
    aid = db.adjunto_nuevo(pid, seguro, rel, total)
    return {"id": aid, "poliza_id": int(pid), "nombre": seguro, "tam": total}


DIAS_PAPELERA = 30


def purgar_papelera():
    """Borra de verdad lo que lleva más de 30 días en la papelera (y sus archivos)."""
    limite = (date.today() - timedelta(days=DIAS_PAPELERA)).isoformat()
    ids = [x["id"] for x in db.papelera() if x["eliminada_el"] <= limite]
    if ids:
        db.borrar_definitivo(ids)
    return len(ids)


def info_archivos():
    lista = db.adjuntos_listar()
    return {"carpeta": dir_archivos(), "cantidad": len(lista), "bytes": sum(a["tam"] for a in lista)}


def espejo_archivos(destino_base):
    """Copia a la carpeta de respaldo los adjuntos que todavía no están (nunca borra nada del respaldo)."""
    origen = dir_archivos()
    copiados = fallidos = 0
    if not os.path.isdir(origen):
        return 0, 0
    for raiz, _, nombres in os.walk(origen):
        for n in nombres:
            src = os.path.join(raiz, n)
            dst = os.path.join(destino_base, os.path.relpath(src, origen))
            try:
                if not (os.path.exists(dst) and os.path.getsize(dst) == os.path.getsize(src)):
                    os.makedirs(os.path.dirname(dst), exist_ok=True)
                    shutil.copy2(src, dst)
                copiados += 1
            except OSError:
                fallidos += 1
    return copiados, fallidos


# ------------------------------------------------------------------ servidor HTTP
class Handler(BaseHTTPRequestHandler):
    server_version = "Seguros"

    def log_message(self, *a):
        pass

    # --- helpers
    def _host_ok(self):
        return (self.headers.get("Host") or "") in (f"127.0.0.1:{PORT}", f"localhost:{PORT}")

    def _send(self, code, body, ctype="application/json; charset=utf-8", extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        elif isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _err(self, msg, code=400):
        self._send(code, {"ok": False, "error": msg})

    def _body(self, limite=25_000_000):
        n = int(self.headers.get("Content-Length") or 0)
        if n > limite:
            raise ValueError("Archivo demasiado grande")
        return self.rfile.read(n) if n else b""

    def _json(self):
        raw = self._body(2_000_000)
        return json.loads(raw.decode("utf-8")) if raw else {}

    # --- rutas
    def do_GET(self):
        if not self._host_ok():
            return self._err("Host no permitido", 403)
        ruta = self.path.split("?")[0]
        if ruta in ("/", "/index.html"):
            with open(os.path.join(WEB_DIR, "index.html"), encoding="utf-8") as f:
                html = f.read().replace("__TOKEN__", TOKEN).replace("__ALERTA__", str(ALERTA_DIAS))
            return self._send(200, html, "text/html; charset=utf-8")
        if ruta in STATIC:
            with open(os.path.join(WEB_DIR, ruta.lstrip("/")), "rb") as f:
                return self._send(200, f.read(), STATIC[ruta])
        if re.fullmatch(r"/fonts/[A-Za-z0-9\-]+\.woff2", ruta):
            ruta_f = os.path.join(WEB_DIR, ruta.lstrip("/"))
            if os.path.isfile(ruta_f):
                with open(ruta_f, "rb") as f:
                    return self._send(200, f.read(), "font/woff2", {"Cache-Control": "max-age=86400"})
        if ruta == "/api/state":
            if not self._auth():
                return
            return self._send(200, {"ok": True, "polizas": db.polizas(), "companias": db.companias(),
                                    "alerta_dias": ALERTA_DIAS, "db": DB_PATH,
                                    "version": APP_VERSION, "update": _estado_update(),
                                    "config": cargar_config(), "respaldo": estado_respaldo(),
                                    "adjuntos": db.adjuntos_listar(), "archivos": info_archivos(), "papelera": db.papelera(),
                                    "renovaciones": db.renovaciones()})
        self._err("No encontrado", 404)

    def _auth(self):
        if not hmac.compare_digest(self.headers.get("X-Token") or "", TOKEN):
            self._err("No autorizado", 403)
            return False
        return True

    def do_POST(self):
        global LAST_PING, BYE
        if not self._host_ok():
            return self._err("Host no permitido", 403)
        if not self._auth():
            return
        ruta = self.path.split("?")[0]
        try:
            if ruta == "/api/ping":
                LAST_PING = time.time()
                return self._send(200, {"ok": True})
            if ruta == "/api/bye":
                BYE = time.time()
                return self._send(200, {"ok": True})
            if ruta == "/api/adjuntos/subir":
                q = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
                try:
                    pid = int(q.get("poliza", [""])[0])
                except ValueError:
                    return self._err("Póliza inválida.")
                return self._send(200, {"ok": True, "adjunto": subir_adjunto(
                    pid, q.get("nombre", ["archivo"])[0], self.rfile, int(self.headers.get("Content-Length") or 0))})
            if ruta == "/api/import":
                return self._send(200, importar_xlsx(self._body()))
            d = self._json()
            if ruta == "/api/poliza":
                datos, error = limpiar(d.get("datos") or {})
                if error:
                    return self._err(error)
                db.add_compania(datos["compania"])
                pid = db.save(datos, d.get("id"))
                return self._send(200, {"ok": True, "id": pid})
            if ruta == "/api/poliza/renovar":
                ok, error = renovar_datos(d)
                return self._send(200, {"ok": True}) if ok else self._err(error)
            if ruta == "/api/config":
                return self._send(200, {"ok": True, "config": guardar_config(d.get("config") or {})})
            if ruta == "/api/respaldo/ahora":
                ok, msg = hacer_respaldo(manual=True)
                return self._send(200 if ok else 500, {"ok": ok, "error": None if ok else msg, "respaldo": estado_respaldo()})
            if ruta == "/api/respaldo/carpeta":
                return self._send(200, {"ok": True, "carpeta": elegir_carpeta()})
            if ruta == "/api/respaldo/abrir":
                carpeta = carpeta_respaldo()
                os.makedirs(carpeta, exist_ok=True)
                os.startfile(carpeta)
                return self._send(200, {"ok": True})
            if ruta == "/api/abrir-url":
                url = str(d.get("url") or "")
                if not _URL_WA.match(url) or len(url) > 4000:
                    return self._err("Dirección no permitida.", 403)
                if url.startswith("whatsapp://"):
                    os.startfile(url)              # app de WhatsApp para Windows
                else:
                    webbrowser.open(url)
                return self._send(200, {"ok": True})
            if ruta == "/api/adjuntos/abrir":
                a = db.adjunto_get(d.get("id"))
                ruta_f = _ruta_adjunto(a["archivo"]) if a else None
                if not ruta_f or not os.path.isfile(ruta_f):
                    return self._err("No se encontró el archivo en la carpeta de adjuntos.", 404)
                os.startfile(ruta_f)
                return self._send(200, {"ok": True})
            if ruta == "/api/adjuntos/carpeta":
                a = db.adjunto_get(d.get("id")) if d.get("id") else None
                ruta_f = _ruta_adjunto(a["archivo"]) if a else None
                if ruta_f and os.path.isfile(ruta_f):
                    subprocess.Popen(["explorer", f"/select,{ruta_f}"])
                else:
                    os.makedirs(dir_archivos(), exist_ok=True)
                    os.startfile(dir_archivos())
                return self._send(200, {"ok": True})
            if ruta == "/api/adjuntos/borrar":
                return self._send(200, {"ok": db.adjunto_borrar(d.get("id"))})
            if ruta == "/api/papelera/restaurar":
                db.restaurar(d.get("id"))
                return self._send(200, {"ok": True})
            if ruta == "/api/papelera/borrar":
                ids = [x["id"] for x in db.papelera()] if d.get("todo") else [int(i) for i in (d.get("ids") or [])]
                en_papelera = {x["id"] for x in db.papelera()}
                db.borrar_definitivo([i for i in ids if i in en_papelera])     # solo lo que ya está en la papelera
                return self._send(200, {"ok": True})
            if ruta == "/api/poliza/anular":
                db.anular(d.get("id"), d.get("motivo"))
                return self._send(200, {"ok": True})
            if ruta == "/api/poliza/reactivar":
                db.reactivar(d.get("id"))
                return self._send(200, {"ok": True})
            if ruta == "/api/update/check":
                comprobar_actualizacion()
                return self._send(200, {"ok": True, "update": _estado_update()})
            if ruta == "/api/update/apply":
                ok, msg = aplicar_actualizacion()
                return self._send(200 if ok else 400, {"ok": ok, "error": None if ok else msg, "mensaje": msg})
            if ruta == "/api/polizas/delete":
                db.delete(d.get("ids") or [])
                return self._send(200, {"ok": True})
            if ruta == "/api/compania":
                if not db.add_compania(d.get("nombre")):
                    return self._err("Esa compañía ya existe o el nombre está vacío.")
                return self._send(200, {"ok": True})
            if ruta == "/api/compania/rename":
                if not db.rename_compania(d.get("viejo"), d.get("nuevo")):
                    return self._err("Nombre vacío o ya existente.")
                return self._send(200, {"ok": True})
            if ruta == "/api/compania/delete":
                n = db.uso_compania(d.get("nombre", ""))
                if n:
                    return self._err(f"«{d.get('nombre')}» tiene {n} póliza(s) cargada(s). "
                                     "Cambiá la compañía de esas pólizas primero.", 409)
                db.del_compania(d.get("nombre", ""))
                return self._send(200, {"ok": True})
            if ruta == "/api/export":
                ids = [int(i) for i in (d.get("ids") or [])]
                anul = d.get("vista") == "anuladas"
                if d.get("formato") == "pdf":
                    cuerpo, ct, ext = exportar_pdf(ids, d.get("vista"), anul), "application/pdf", "pdf"
                else:
                    cuerpo = exportar_excel(ids, anul)
                    ct, ext = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"
                return self._send(200, cuerpo, ct, {"X-Filename": f"polizas_{date.today():%Y%m%d}.{ext}"})
            self._err("No encontrado", 404)
        except (ValueError, TypeError, json.JSONDecodeError) as e:
            self._err(f"Solicitud inválida: {e}")
        except Exception as e:  # nunca dejar caer el servidor
            self._err(f"Error interno: {e}", 500)


# ------------------------------------------------------------------ actualizaciones (GitHub Releases)
def _version(s):
    return tuple(int(x) for x in re.findall(r"\d+", str(s))[:3]) or (0,)


def _estado_update():
    return {k: UPDATE[k] for k in ("comprobado", "disponible", "version", "tam", "notas", "error")}


def comprobar_actualizacion():
    """Consulta la última versión publicada. Si no hay internet, falla en silencio: el programa sigue igual."""
    UPDATE.update(comprobado=True, error="")
    try:
        req = urllib.request.Request(f"https://api.github.com/repos/{REPO}/releases/latest",
                                     headers={"User-Agent": "GestorSeguros-actualizador", "Accept": "application/vnd.github+json"})
        with urllib.request.urlopen(req, timeout=6) as r:
            info = json.loads(r.read().decode("utf-8"))
        tag = info.get("tag_name", "")
        if _version(tag) <= _version(APP_VERSION):
            UPDATE.update(disponible=False)
            return
        activos = {a.get("name"): a for a in info.get("assets", [])}
        exe = activos.get("GestorSeguros.exe")
        if not exe:
            return
        url = exe.get("browser_download_url", "")
        if not url.startswith(f"https://github.com/{REPO}/releases/download/"):
            return
        sha = (exe.get("digest") or "").removeprefix("sha256:").strip().lower()
        if not sha and "GestorSeguros.exe.sha256" in activos:
            with urllib.request.urlopen(activos["GestorSeguros.exe.sha256"]["browser_download_url"], timeout=6) as r:
                sha = r.read().decode("utf-8").split()[0].strip().lower()
        UPDATE.update(disponible=bool(sha), version=tag.lstrip("v"), url=url, sha=sha,
                      tam=int(exe.get("size") or 0), notas=(info.get("body") or "")[:600])
    except Exception as e:
        UPDATE.update(error=str(e)[:120])


def _salir():
    if VENTANA is not None and VENTANA.poll() is None:
        try:
            VENTANA.terminate()
        except Exception:
            pass
    os._exit(0)


def aplicar_actualizacion():
    """Descarga la versión nueva, verifica su firma SHA-256 y la reemplaza al cerrar. Los datos no se tocan."""
    if not getattr(sys, "frozen", False):
        return False, "Solo se puede actualizar el programa instalado (.exe)."
    if not (UPDATE.get("disponible") and UPDATE.get("sha")):
        return False, "No hay una actualización verificable disponible."
    destino = os.path.join(APP_DIR, "GestorSeguros.nuevo.exe")
    h = hashlib.sha256()
    try:
        req = urllib.request.Request(UPDATE["url"], headers={"User-Agent": "GestorSeguros-actualizador"})
        with urllib.request.urlopen(req, timeout=40) as r, open(destino, "wb") as f:
            while True:
                bloque = r.read(1 << 20)
                if not bloque:
                    break
                h.update(bloque)
                f.write(bloque)
    except Exception as e:
        shutil.rmtree(destino, ignore_errors=True) if os.path.isdir(destino) else (os.path.exists(destino) and os.remove(destino))
        return False, f"No se pudo descargar la actualización: {e}"
    with open(destino, "rb") as f:
        cabecera = f.read(2)
    if h.hexdigest() != UPDATE["sha"] or cabecera != b"MZ":
        os.remove(destino)
        return False, "La descarga no coincide con la firma de seguridad. No se instaló nada."
    bat = os.path.join(tempfile.gettempdir(), "gestor_seguros_actualizar.bat")
    with open(bat, "w", encoding="utf-8") as f:
        f.write(f'''@echo off
chcp 65001 >nul
set "VIEJO={sys.executable}"
set "NUEVO={destino}"
for /l %%i in (1,1,120) do (
  move /y "%NUEVO%" "%VIEJO%" >nul 2>&1 && goto listo
  ping -n 2 127.0.0.1 >nul
)
exit /b 1
:listo
set "PYINSTALLER_RESET_ENVIRONMENT=1"
start "" "%VIEJO%"
(goto) 2>nul & del "%~f0"
''')
    # El programa nuevo NO debe heredar las variables internas de PyInstaller del actual (apuntan a una carpeta
    # temporal que se borra al cerrar y lo dejarían trabado sin abrir).
    entorno = {k: v for k, v in os.environ.items() if not k.startswith("_PYI") and k != "_MEIPASS2"}
    entorno["PYINSTALLER_RESET_ENVIRONMENT"] = "1"
    subprocess.Popen(["cmd", "/c", bat], creationflags=0x00000208, close_fds=True, env=entorno)
    threading.Timer(1.2, _salir).start()
    return True, "Actualizando… el programa se reinicia solo."


# ------------------------------------------------------------------ ventana y ciclo de vida
def _buscar_navegador():
    pf = os.environ.get("ProgramFiles", r"C:\Program Files")
    pf86 = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
    local = os.environ.get("LOCALAPPDATA", "")
    candidatos = [
        os.path.join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
        os.path.join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
        os.path.join(pf, "Google", "Chrome", "Application", "chrome.exe"),
        os.path.join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
        os.path.join(local, "Google", "Chrome", "Application", "chrome.exe"),
    ]
    for c in candidatos:
        if os.path.exists(c):
            return c
    return shutil.which("msedge") or shutil.which("chrome")


def abrir_ventana(url):
    exe = _buscar_navegador()
    if not exe:
        webbrowser.open(url)
        return None
    perfil = os.path.join(os.environ.get("LOCALAPPDATA", APP_DIR), "GestorSeguros", "perfil")
    os.makedirs(perfil, exist_ok=True)
    args = [exe, f"--app={url}", f"--user-data-dir={perfil}", "--window-size=1480,900",
            "--no-first-run", "--no-default-browser-check", "--disable-background-mode",
            "--disable-features=Translate,msEdgeShopping,msEdgeEnhanceImages"]
    return subprocess.Popen(args)


def alertas_pendientes():
    return sum(1 for p in db.polizas() if not p.get("anulada") and (dias_restantes(p["vig_fin"]) is not None
                                           and dias_restantes(p["vig_fin"]) <= ALERTA_DIAS))


def _vigilante(proc):
    """Cierra el programa cuando la ventana se cerró (o dejó de dar señales)."""
    inicio = time.time()
    ultimo_dia = date.today()
    while True:
        time.sleep(1)
        ahora = time.time()
        if proc is not None and proc.poll() is not None:
            if ahora - inicio < 15:      # el navegador cedió la ventana a otro proceso: seguir por señales
                proc = None
            else:
                break
        if BYE and ahora - BYE > 6 and LAST_PING < BYE:
            break
        if LAST_PING and ahora - LAST_PING > 180:
            break
        if not LAST_PING and ahora - inicio > 120:
            break
        if date.today() != ultimo_dia:          # aviso de Windows una vez por día
            ultimo_dia = date.today()
            n = alertas_pendientes()
            if n:
                toast(APP_TITLE, f"{n} póliza(s) vencidas o por vencer (≤ {ALERTA_DIAS} días)")
    if proc is not None and proc.poll() is None:
        try:
            proc.terminate()
        except Exception:
            pass
    os._exit(0)


def main():
    global PORT
    srv = None
    for puerto in list(range(47931, 47941)) + [0]:     # puerto fijo: así el navegador recuerda las preferencias
        try:
            srv = ThreadingHTTPServer(("127.0.0.1", puerto), Handler)
            break
        except OSError:
            continue
    PORT = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    n = alertas_pendientes()
    if n:
        toast(APP_TITLE, f"{n} póliza(s) vencidas o por vencer (≤ {ALERTA_DIAS} días)")
    global VENTANA
    VENTANA = abrir_ventana(f"http://127.0.0.1:{PORT}/")
    threading.Timer(4.0, comprobar_actualizacion).start()
    threading.Thread(target=_hilo_respaldo, daemon=True).start()
    _vigilante(VENTANA)


if __name__ == "__main__":
    main()
