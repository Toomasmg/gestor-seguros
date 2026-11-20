'use strict';
/* Gestor de Seguros — interfaz. JavaScript sin dependencias. */

const TOKEN = document.querySelector('meta[name="token"]').content;
const ALERTA = Number(document.querySelector('meta[name="alerta-dias"]').content) || 12;
const DIAS_AGENDA = 30;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const icon = (id, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const store = {
  get(k, def) { try { const v = localStorage.getItem('gs.' + k); return v == null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { try { localStorage.setItem('gs.' + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};

/* ---------- Columnas ---------- */
const COLS = [
  { k: 'estado', t: 'Estado', sort: 'dias' },
  { k: 'nro_poliza', t: 'N° póliza' },
  { k: 'asegurado', t: 'Asegurado' },
  { k: 'patente', t: 'Patente' },
  { k: 'compania', t: 'Compañía' },
  { k: 'vig_fin', t: 'Fin de vigencia' },
  { k: 'tipo', t: 'Tipo' },
  { k: 'marca', t: 'Marca' },
  { k: 'modelo', t: 'Modelo' },
  { k: 'email', t: 'E-mail' },
  { k: 'celular', t: 'Celular' },
  { k: 'vig_inicio', t: 'Inicio de vigencia' },
  { k: 'mios', t: 'MIOS' },
];
const VENC_COLS = [
  { k: 'estado', t: 'Estado' },
  { k: 'asegurado', t: 'Asegurado' },
  { k: 'patente', t: 'Patente' },
  { k: 'compania', t: 'Compañía' },
  { k: 'vig_fin', t: 'Fin de vigencia' },
];
const ANUL_COLS = [
  { k: 'asegurado', t: 'Asegurado' },
  { k: 'nro_poliza', t: 'N° póliza' },
  { k: 'patente', t: 'Patente' },
  { k: 'tipo', t: 'Tipo' },
  { k: 'marca', t: 'Marca' },
  { k: 'modelo', t: 'Modelo' },
  { k: 'email', t: 'E-mail' },
  { k: 'celular', t: 'Celular' },
  { k: 'compania', t: 'Compañía' },
  { k: 'vig_inicio', t: 'Inicio de vigencia' },
  { k: 'vig_fin', t: 'Fin de vigencia' },
  { k: 'mios', t: 'MIOS' },
  { k: 'anulada_el', t: 'Anulada el' },
  { k: 'motivo_anulacion', t: 'Motivo' },
];
const POR_DEFECTO_OCULTAS = ['vig_inicio'];          // se pueden mostrar desde «Más opciones»
const AUTO_SI_HAY_DATOS = ['email', 'celular', 'mios'];
const GRUPOS_CERRADOS = new Set(['b:90', 'b:mas']);

/* ---------- Panel lateral ---------- */
const RAIL = store.get('rail', { w: 232, mini: false });
function aplicarRail() {
  const app = $('#app');
  app.classList.toggle('mini', RAIL.mini);
  app.style.setProperty('--rail-w', `${RAIL.mini ? 84 : RAIL.w}px`);
  const b = $('#rail-toggle');
  b.setAttribute('aria-expanded', String(!RAIL.mini));
  b.setAttribute('aria-label', RAIL.mini ? 'Mostrar panel' : 'Ocultar panel');
  $('#rail-toggle-t').textContent = RAIL.mini ? 'Mostrar panel' : 'Ocultar panel';
  store.set('rail', RAIL);
}
function eventosRail() {
  $('#rail-toggle').addEventListener('click', () => { RAIL.mini = !RAIL.mini; if (RAIL.w < 150) RAIL.w = 232; aplicarRail(); });
  const grip = $('#grip');
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const x0 = e.clientX, w0 = RAIL.mini ? 84 : RAIL.w;
    $('#app').classList.add('arrastrando-panel'); grip.classList.add('arrastrando');
    const mv = (ev) => {
      const w = Math.max(84, Math.min(380, w0 + ev.clientX - x0));
      if (w < 150) RAIL.mini = true; else { RAIL.mini = false; RAIL.w = Math.round(w); }
      aplicarRail();
    };
    const up = () => { grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); grip.classList.remove('arrastrando'); $('#app').classList.remove('arrastrando-panel'); };
    grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', up);
  });
  $('#brand').addEventListener('click', () => irA('polizas'));
}

/* ---------- Estado ---------- */
const S = {
  page: 'polizas',
  polizas: [], todas: [], anuladas: [], rowsAnul: [], qa: '', version: '', update: null, exportBtn: null, config: null, respaldo: null, renov: {}, adjuntos: [], adjCuenta: {}, archivos: null, papelera: [], cfgSec: 'wa', tplAbiertos: new Set(), companias: [], dbPath: '',
  vista: store.get('vista3', 'todas'),
  q: '', estado: '', comp: '',
  sort: store.get('sort3', { k: 'dias', dir: 1 }),
  vsub: 'alertas', dia: null, mes: null,
  abiertos: new Set(), cerrados: new Set(GRUPOS_CERRADOS),
  cols: store.get('cols3', null),
  editId: null, fichaId: null, fichaTab: 'datos',
  rowsPol: [], cargado: false, auto: new Set(), anchoPol: 0,
};

/* ---------- Fechas y estados ---------- */
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const SEMANA = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const hoy = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
function diasHasta(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y) return null;
  return Math.round((new Date(y, m - 1, d) - hoy()) / 86400000);
}
const fmtFecha = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const sumarDias = (n) => { const d = hoy(); d.setDate(d.getDate() + n); return d; };
const dd = (n) => `${n} día${n === 1 ? '' : 's'}`;
function estado(d) {
  if (d == null) return { k: 'sin', t: 'Sin fecha' };
  if (d < 0) return { k: 'vencida', t: `Vencida hace ${dd(-d)}` };
  if (d === 0) return { k: 'porvencer', t: 'Vence hoy' };
  if (d === 1) return { k: 'porvencer', t: 'Vence mañana' };
  if (d <= ALERTA) return { k: 'porvencer', t: `Vence en ${dd(d)}` };
  return { k: 'vigente', t: 'Vigente' };
}

/* ---------- Comunicación con el programa ---------- */
async function api(path, body, opts = {}) {
  let res;
  try {
    res = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'X-Token': TOKEN, ...(body !== undefined && !opts.raw ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : (opts.raw ? body : JSON.stringify(body)),
    });
  } catch {
    throw new Error('No se pudo conectar con el programa. Cerralo y volvé a abrirlo.');
  }
  if (opts.blob) {
    if (!res.ok) throw new Error('No se pudo generar el archivo.');
    return { blob: await res.blob(), name: res.headers.get('X-Filename') || 'polizas' };
  }
  const j = await res.json().catch(() => ({ ok: false, error: 'Respuesta inválida del programa.' }));
  if (!res.ok || j.ok === false) throw new Error(j.error || 'Ocurrió un error.');
  return j;
}

async function cargar() {
  const j = await api('/api/state');
  S.dbPath = j.db;
  S.companias = j.companias;
  S.todas = j.polizas.map((p) => {
    const dias = diasHasta(p.vig_fin);
    return { ...p, dias, est: p.anulada ? { k: 'anulada', t: 'Anulada' } : estado(dias), _q: norm(`${p.patente} ${p.asegurado} ${p.nro_poliza}`) };
  });
  S.polizas = S.todas.filter((p) => !p.anulada);      // todo el programa trabaja con las activas
  S.anuladas = S.todas.filter((p) => p.anulada);
  S.version = j.version;
  S.update = j.update;
  S.config = j.config;
  S.papelera = j.papelera || [];
  S.todas.forEach((p) => { p._q = armarBlob(p); });      // lo que se puede buscar de cada póliza
  S.respaldo = j.respaldo;
  S.adjuntos = j.adjuntos || [];
  S.archivos = j.archivos;
  S.adjCuenta = {};
  S.adjuntos.forEach((a) => { S.adjCuenta[a.poliza_id] = (S.adjCuenta[a.poliza_id] || 0) + 1; });
  S.renov = {};
  (j.renovaciones || []).forEach((r) => { (S.renov[r.poliza_id] = S.renov[r.poliza_id] || []).push(r); });
  if (S.comp && !S.companias.some((c) => c.toLowerCase() === S.comp.toLowerCase())) S.comp = '';
  S.cargado = true;
  render();
}

/* ---------- Mensajes (pie de pantalla: nunca tapan el contenido) ---------- */
let msgTimer = null;
const mensajeBase = () => { const n = S.polizas.length; return `${n} póliza${n === 1 ? '' : 's'} guardadas en este equipo`; };
function say(tipo, texto, ms = 7000, accion = null) {
  const m = $('#msg');
  clearTimeout(msgTimer);
  m.className = tipo;
  m.textContent = texto;
  if (accion) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'link'; b.textContent = accion.texto;
    b.addEventListener('click', accion.fn);
    m.append(b);
  }
  msgTimer = setTimeout(() => { m.className = ''; m.textContent = mensajeBase(); }, tipo === 'err' ? 20000 : ms);
}
const falla = (e) => say('err', e.message || String(e));

/* ---------- Búsqueda amplia y clientes ---------- */
const normEsp = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/* Todo lo que se puede buscar de una póliza, en minúsculas y sin acentos. Incluye el celular en formato WhatsApp. */
function armarBlob(p) {
  const tel = p.celular ? numeroWA(p.celular).num : '';
  const b = normEsp([p.asegurado, p.trato, p.patente, p.nro_poliza, p.tipo, p.marca, p.modelo, p.compania, p.email, p.celular, tel].join(' '));
  return `${b} ${b.replace(/ /g, '')}`;                 // con y sin espacios: «AB 123 CD» y «AB123CD» encuentran lo mismo
}
/* Cada palabra buscada tiene que aparecer en algún dato, en cualquier orden («Gómez María» = «María Gómez»). */
const coincide = (p, q) => normEsp(q).split(' ').filter(Boolean).every((t) => p._q.includes(t));
const claveCliente = (p) => normEsp(p.asegurado).split(' ').filter(Boolean).sort().join(' ');
const otrasDelCliente = (p) => { const k = claveCliente(p); return k ? S.todas.filter((x) => x.id !== p.id && claveCliente(x) === k) : []; };

/* ---------- Datos derivados ---------- */
const cmp = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'es', { numeric: true, sensitivity: 'base' });
const contar = () => {
  const c = { vigente: 0, porvencer: 0, vencida: 0, sin: 0, prox30: 0 };
  S.polizas.forEach((p) => { c[p.est.k]++; if (p.dias != null && p.dias >= 0 && p.dias <= DIAS_AGENDA) c.prox30++; });
  c.alertas = c.porvencer + c.vencida;
  return c;
};
const hayFiltros = () => !!(S.q || S.estado || S.comp);

function ordenarPol(arr) {
  const { k, dir } = S.vista === 'venc' ? { k: 'dias', dir: 1 } : S.sort;
  return [...arr].sort((a, b) => {
    const r = k === 'dias' ? (a.dias ?? 1e9) - (b.dias ?? 1e9) : cmp(a[k], b[k]);
    return (r || cmp(a.asegurado, b.asegurado)) * dir;
  });
}
function filtrarPol() {
  return S.polizas.filter((p) => {
    if (S.q && !coincide(p, S.q)) return false;
    if (S.estado && p.est.k !== S.estado) return false;
    if (S.comp && (p.compania || '').toLowerCase() !== S.comp.toLowerCase()) return false;
    return true;
  });
}
function filasVenc() {
  let r = S.polizas.filter((p) => p.dias != null);
  if (S.dia !== null) return r.filter((p) => p.vig_fin === S.dia);
  if (S.vsub === 'alertas') r = r.filter((p) => ['vencida', 'porvencer'].includes(p.est.k));
  else if (S.vsub === 'vencida') r = r.filter((p) => p.est.k === 'vencida');
  else if (S.vsub === 'porvencer') r = r.filter((p) => p.est.k === 'porvencer');
  else r = r.filter((p) => p.dias >= 0 && p.dias <= DIAS_AGENDA);
  return r.sort((a, b) => a.dias - b.dias || cmp(a.asegurado, b.asegurado));
}
const PRIORIDAD_POL = ['mios', 'vig_inicio', 'email', 'tipo', 'marca', 'celular', 'modelo', 'nro_poliza', 'vig_fin'];
const PRIORIDAD_VENC = ['compania', 'patente'];
/* Si la tabla no entra a lo ancho, esconde de a una la columna menos importante hasta que entre. Devuelve true si escondió una. */
function ajustarColumnas(wrapSel, cols, prioridad, auto) {
  const w = $(wrapSel);
  if (w.scrollWidth - w.clientWidth <= 2) return false;
  const k = prioridad.find((x) => cols.some((c) => c.k === x) && !auto.has(x));
  if (!k) return false;
  auto.add(k);
  return true;
}
function columnasPol(conAuto = true) {
  const vacia = (k) => !S.polizas.some((p) => p[k]);
  return COLS.filter((c) => !(conAuto && S.auto.has(c.k))).filter((c) => {
    if (S.cols && c.k in S.cols) return S.cols[c.k];
    if (POR_DEFECTO_OCULTAS.includes(c.k)) return false;
    if (AUTO_SI_HAY_DATOS.includes(c.k)) return !vacia(c.k);
    return true;
  });
}

/* ---------- Render general ---------- */
function render() {
  const c = contar();
  const nn = $('#nav-n');
  nn.textContent = c.alertas;
  nn.hidden = !c.alertas;
  const na = $('#nav-a');
  na.textContent = S.anuladas.length;
  na.hidden = !S.anuladas.length;
  const nRev = revisar().length, nr = $('#nav-r');
  nr.textContent = nRev; nr.hidden = !nRev;
  const rs = S.respaldo || {};
  $('#top-estado').textContent = 'Todo guardado en este equipo' + (rs.ultimo && !rs.error ? ` · última copia ${new Date(rs.ultimo).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}` : '');
  $$('.alerta-dias').forEach((e) => { e.textContent = ALERTA; });
  $('#dl-comp').innerHTML = S.companias.map((n) => `<option value="${esc(n)}">`).join('');
  if (S.page === 'polizas') renderPolizas(c);
  else if (S.page === 'venc') renderVenc(c);
  else if (S.page === 'anul') renderAnul();
  else if (S.page === 'rev') renderRev();
  else renderComp();
  renderUpdate();
  const m = $('#msg');
  if (!m.className && !m.textContent) m.textContent = mensajeBase();
  else if (!m.className) m.textContent = mensajeBase();
}

function irA(page) {
  S.page = page;
  ['polizas', 'venc', 'anul', 'rev', 'comp'].forEach((p) => { $('#page-' + p).hidden = p !== page; });
  $$('.nav button').forEach((b) => (b.dataset.page === page ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  if (page === 'venc' && !S.vsubElegido) S.vsub = contar().alertas ? 'alertas' : 'prox30';
  render();
}

/* ---------- Celdas ---------- */
function celda(p, k) {
  const vacio = '<span class="muted">—</span>';
  switch (k) {
    case 'estado': return `<span class="st ${p.est.k}">${esc(p.est.t)}</span>`;
    case 'asegurado': return (p.asegurado ? `<span class="name">${esc(p.asegurado)}</span>` : '<span class="muted">(sin nombre)</span>')
      + (S.adjCuenta[p.id] ? `<span class="clip" title="${S.adjCuenta[p.id]} archivo${S.adjCuenta[p.id] === 1 ? '' : 's'} adjunto${S.adjCuenta[p.id] === 1 ? '' : 's'}">${icon('clip')}${S.adjCuenta[p.id]}</span>` : '');
    case 'patente': return p.patente ? `<span class="plate">${esc(p.patente)}</span>` : vacio;
    case 'vig_inicio': case 'vig_fin': return p[k] ? `<span class="num">${fmtFecha(p[k])}</span>` : vacio;
    case 'mios': return p.mios ? `<span class="tag">${esc(p.mios)}</span>` : vacio;
    case 'nro_poliza': return p.nro_poliza ? `<span class="num">${esc(p.nro_poliza)}</span>` : vacio;
    case 'celular': return p.celular ? `<span class="num">${esc(p.celular)}</span>` : vacio;
    case 'anulada_el': return p.anulada_el ? `<span class="num">${fmtFecha(p.anulada_el)}</span>` : vacio;
    case 'motivo_anulacion': return p.motivo_anulacion ? esc(p.motivo_anulacion) : vacio;
    case 'contacto': { const v = p.celular || p.email; return v ? esc(v) : vacio; }
    default: return p[k] ? esc(p[k]) : vacio;
  }
}
function filaHTML(p, cols) {
  const tds = cols.map((c) => `<td data-label="${esc(c.t)}">${celda(p, c.k)}</td>`).join('');
  const acciones = p.anulada
    ? `<button type="button" class="icon-btn" data-react="${p.id}" aria-label="Reactivar la póliza de ${esc(nombre(p))}" title="Reactivar">${icon('undo')}</button>`
    : `${p.celular ? `<button type="button" class="icon-btn" data-wa="${p.id}" aria-label="Enviar WhatsApp a ${esc(nombre(p))}" title="WhatsApp">${icon('chat')}</button>` : ''}
      <button type="button" class="icon-btn" data-renew="${p.id}" aria-label="Renovar la póliza de ${esc(nombre(p))}" title="Renovar">${icon('refresh')}</button>
      <button type="button" class="icon-btn" data-edit="${p.id}" aria-label="Editar la póliza de ${esc(nombre(p))}">${icon('pencil')}</button>
      <button type="button" class="icon-btn danger" data-del="${p.id}" aria-label="Eliminar la póliza de ${esc(nombre(p))}">${icon('trash')}</button>`;
  return `<tr class="row" data-id="${p.id}">${tds}<td class="c-act"><span class="acts">${acciones}</span></td></tr>`;
}
function encabezado(cols, ordenable) {
  return `<tr>${cols.map((c) => {
    const key = c.sort || c.k;
    const on = ordenable && S.sort.k === key;
    const aria = on ? (S.sort.dir === 1 ? 'ascending' : 'descending') : null;
    const inner = ordenable ? `<button type="button" class="th-btn" data-sort="${key}">${esc(c.t)}${on ? icon('up') : ''}</button>` : esc(c.t);
    return `<th scope="col"${aria ? ` aria-sort="${aria}"` : ''}>${inner}</th>`;
  }).join('')}<th class="c-act" scope="col"><span class="sr-only">Acciones</span></th></tr>`;
}

/* ---------- Resumen de cartera y paginación ---------- */
function renderKpis(c) {
  $('#kpi-v').textContent = c.vencida; $('#kpi-p').textContent = c.porvencer; $('#kpi-g').textContent = c.vigente;
  $$('#kpis .kpi').forEach((b) => b.setAttribute('aria-pressed', String(S.estado === b.dataset.kpi)));
  const col = { v: 'var(--bad)', p: 'var(--warn)', g: '#3e9f61' };
  $('#kpi-bar').innerHTML = [['v', c.vencida], ['p', c.porvencer], ['g', c.vigente]].filter((x) => x[1] > 0).map(([k, n]) => `<i style="flex:${n} 1 0;background:${col[k]}"></i>`).join('');
}
const PAG = { p: 0, pf: '', v: 0, vf: '' };
function paginar(total, tam, k, firma) {
  const tot = Math.max(1, Math.ceil(total / tam));
  if (PAG[k + 'f'] !== firma) { PAG[k] = 0; PAG[k + 'f'] = firma; }       // al cambiar filtros se vuelve a la primera página
  PAG[k] = Math.max(0, Math.min(PAG[k], tot - 1));
  return { ini: PAG[k] * tam, fin: Math.min(total, PAG[k] * tam + tam), p: PAG[k], tot };
}
function pintarPager(id, g, total, mostrar = true) {
  const el = $('#pager-' + id);
  el.hidden = !mostrar || g.tot <= 1;
  if (el.hidden) return;
  $('#pager-' + id + '-t').textContent = `Mostrando ${g.ini + 1} a ${g.fin} de ${total}`;
  $('#pager-' + id + '-pos').textContent = `Página ${g.p + 1} de ${g.tot}`;
  $('#pager-' + id + '-ant').disabled = g.p === 0;
  $('#pager-' + id + '-sig').disabled = g.p >= g.tot - 1;
}
const TAM_POL = 15, TAM_VENC = 4;

/* ---------- Sección: Pólizas ---------- */
function gruposPol(rows) {
  if (S.vista === 'compania') {
    const m = new Map(S.companias.map((c) => [c.toLowerCase(), { key: 'c:' + c, titulo: c, rows: [] }]));
    rows.forEach((p) => {
      const k = (p.compania || '').toLowerCase();
      if (!m.has(k)) m.set(k, { key: 'c:' + (p.compania || ''), titulo: p.compania || '(sin compañía)', rows: [] });
      m.get(k).rows.push(p);
    });
    return [...m.values()].filter((g) => !hayFiltros() || g.rows.length).sort((a, b) => cmp(a.titulo, b.titulo));
  }
  return [
    { key: 'b:venc', titulo: 'Vencidas', test: (d) => d != null && d < 0 },
    { key: 'b:alerta', titulo: `Vencen en ${ALERTA} días o menos`, test: (d) => d != null && d >= 0 && d <= ALERTA },
    { key: 'b:30', titulo: `En ${ALERTA + 1} a 30 días`, test: (d) => d != null && d > ALERTA && d <= 30 },
    { key: 'b:90', titulo: 'En 31 a 90 días', test: (d) => d != null && d > 30 && d <= 90 },
    { key: 'b:mas', titulo: 'Con más de 90 días', test: (d) => d != null && d > 90 },
    { key: 'b:sin', titulo: 'Sin fecha de vigencia', test: (d) => d == null },
  ].map((b) => ({ ...b, rows: rows.filter((p) => b.test(p.dias)) })).filter((b) => b.rows.length);
}

function renderPolizas(c, reintento = false) {
  if (!reintento) S.auto = new Set();
  S.rowsPol = ordenarPol(filtrarPol());
  $$('#page-polizas .views button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.vista === S.vista)));
  const sc = $('#f-comp');
  sc.innerHTML = '<option value="">Todas las compañías</option>' + S.companias.map((n) => `<option value="${esc(n)}"${S.comp.toLowerCase() === n.toLowerCase() ? ' selected' : ''}>${esc(n)}</option>`).join('');
  sc.classList.toggle('on', !!S.comp);
  $('#f-estado').value = S.estado;
  $('#f-estado').classList.toggle('on', !!S.estado);
  $('#f-limpiar').hidden = !hayFiltros();
  $('#q-clear').hidden = !S.q;
  $('#pol-sub').textContent = hayFiltros() ? `Mostrando ${S.rowsPol.length} de ${S.polizas.length}` : `${S.polizas.length} en total`;

  renderKpis(c);

  const cols = columnasPol();
  const agrupada = S.vista !== 'todas';
  $('#thead-pol').innerHTML = encabezado(cols, S.vista !== 'venc');
  let html;
  const gp = paginar(S.rowsPol.length, TAM_POL, 'p', [S.q, S.estado, S.comp, S.vista, JSON.stringify(S.sort)].join('|'));
  pintarPager('pol', gp, S.rowsPol.length, !agrupada);
  if (!agrupada) {
    html = S.rowsPol.slice(gp.ini, gp.fin).map((p) => filaHTML(p, cols)).join('');
  } else {
    html = gruposPol(S.rowsPol).map((g) => {
      const cerrado = !hayFiltros() && S.cerrados.has(g.key) && !S.abiertos.has(g.key);
      const cc = { porvencer: 0, vencida: 0 };
      g.rows.forEach((p) => { if (cc[p.est.k] !== undefined) cc[p.est.k]++; });
      const meta = (cc.vencida ? `<span class="t-bad">${cc.vencida} vencida${cc.vencida > 1 ? 's' : ''}</span>` : '')
        + (cc.porvencer ? `<span class="t-warn">${cc.porvencer} por vencer</span>` : '');
      return `<tr class="grp"><td colspan="${cols.length + 1}"><button type="button" class="grp-btn" data-grp="${esc(g.key)}" aria-expanded="${!cerrado}">
          ${icon('chev-down')}<span class="grp-title">${esc(g.titulo)}</span><span class="grp-count">${g.rows.length}</span><span class="grp-meta">${meta}</span></button></td></tr>`
        + (cerrado ? '' : g.rows.map((p) => filaHTML(p, cols)).join(''));
    }).join('');
  }
  $('#tbody-pol').innerHTML = html;
  vacio('pol', S.rowsPol.length);
  if (S.rowsPol.length && ajustarColumnas('#wrap-pol', cols, PRIORIDAD_POL, S.auto)) renderPolizas(c, true);
}

function vacio(que, hay) {
  const e = $('#empty-' + que);
  e.hidden = !!hay || !S.cargado;
  $('#tabla-' + que).hidden = !hay;
  if (hay) return;
  if (que === 'pol') {
    e.innerHTML = !S.polizas.length
      ? `<h3>Todavía no hay pólizas</h3><p>Creá la primera, o traé todas juntas desde un Excel (menú ⋯).</p>
         <div class="row-btns"><button type="button" class="btn solid" data-act="nueva">${icon('plus')}Nueva póliza</button></div>`
      : `<h3>Sin resultados</h3><p>Ninguna póliza coincide con lo que buscaste.</p>
         <div class="row-btns"><button type="button" class="btn solid" data-act="limpiar">Quitar búsqueda y filtros</button></div>`;
  } else if (que === 'anul') {
    e.innerHTML = !S.anuladas.length
      ? '<h3>No hay pólizas anuladas</h3><p>Cuando anules una póliza desde su ficha, va a aparecer acá con todos sus datos y la vas a poder reactivar.</p>'
      : '<h3>Sin resultados</h3><p>Ninguna póliza anulada coincide con lo que buscaste.</p>';
  } else {
    e.innerHTML = '<h3>Nada para mostrar</h3><p>No hay pólizas en esta categoría.</p>';
  }
}

/* ---------- Sección: Vencimientos ---------- */
function renderVenc(c, reintento = false) {
  if (!reintento) S.autoV = new Set();
  $('#vn-alertas').textContent = c.alertas;
  $('#vn-vencida').textContent = c.vencida;
  $('#vn-porvencer').textContent = c.porvencer;
  $('#vn-prox30').textContent = c.prox30;
  $$('#v-views button').forEach((b) => b.setAttribute('aria-pressed', String(S.dia === null && b.dataset.vsub === S.vsub)));
  const x = $('#v-dia-x');
  x.hidden = S.dia === null;
  if (S.dia !== null) { const [yy, mm, d2] = S.dia.split('-').map(Number); x.textContent = `Mostrando solo el ${d2} de ${MESES_L[mm - 1]} · Quitar`; }

  const rows = filasVenc();
  const cols = VENC_COLS.filter((cc) => !(S.autoV && S.autoV.has(cc.k)));
  $('#thead-venc').innerHTML = encabezado(cols, false);
  const gv = paginar(rows.length, TAM_VENC, 'v', [S.vsub, S.dia].join('|'));
  $('#tbody-venc').innerHTML = rows.slice(gv.ini, gv.fin).map((p) => filaHTML(p, cols)).join('');
  pintarPager('venc', gv, rows.length);
  vacio('venc', rows.length);
  if (rows.length && ajustarColumnas('#wrap-venc', cols, PRIORIDAD_VENC, S.autoV)) { renderVenc(c, true); return; }
  renderGrafico();
}

function renderGrafico() {
  const t = hoy();
  if (!S.mes) S.mes = { y: t.getFullYear(), m: t.getMonth() };
  const { y, m } = S.mes;
  $('#cal-titulo').textContent = `${MESES_L[m][0].toUpperCase()}${MESES_L[m].slice(1)} de ${y}`;
  const porFecha = new Map();
  S.polizas.forEach((p) => { if (p.vig_fin) { if (!porFecha.has(p.vig_fin)) porFecha.set(p.vig_fin, []); porFecha.get(p.vig_fin).push(p); } });
  const primero = new Date(y, m, 1);
  const desfase = (primero.getDay() + 6) % 7;                 // semana de lunes a domingo
  const inicio = new Date(y, m, 1 - desfase);
  const hoyISO = toISO(t);
  let html = '';
  const semanas = Math.ceil((desfase + new Date(y, m + 1, 0).getDate()) / 7);   // 4, 5 o 6 filas según el mes
  for (let i = 0; i < semanas * 7; i++) {
    const f = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + i);
    const iso = toISO(f);
    const lista = porFecha.get(iso) || [];
    const n = lista.length;
    const d = Math.round((f - t) / 86400000);
    const k = d < 0 ? 'vencida' : d <= ALERTA ? 'porvencer' : 'vigente';
    const fuera = f.getMonth() !== m;
    const cls = `cal-dia${fuera ? ' fuera' : ''}${iso === hoyISO ? ' hoy' : ''}${n ? ' con ' + k : ''}${S.dia === iso ? ' sel' : ''}`;
    const nombre = lista.slice(0, 6).map((p) => p.asegurado).join(', ') + (n > 6 ? ` y ${n - 6} más` : '');
    const etiqueta = `${f.getDate()} de ${MESES_L[f.getMonth()]}${iso === hoyISO ? ' (hoy)' : ''}: ${n ? `${n} póliza${n === 1 ? '' : 's'} ${d < 0 ? 'vencieron' : 'vencen'}` : 'sin vencimientos'}`;
    html += n
      ? `<button type="button" class="${cls}" data-fecha="${iso}" aria-pressed="${S.dia === iso}" aria-label="${esc(etiqueta)}" title="${esc(nombre)}"><span class="cal-num">${f.getDate()}</span><span class="cal-cant">${n}</span></button>`
      : `<div class="${cls}" aria-label="${esc(etiqueta)}"><span class="cal-num">${f.getDate()}</span></div>`;
  }
  $('#cal-grid').innerHTML = html;
}

/* ---------- Sección: Anuladas ---------- */
function renderAnul() {
  const q = S.qa;
  S.rowsAnul = S.anuladas.filter((p) => !q || coincide(p, q))
    .sort((a, b) => (b.anulada_el || '').localeCompare(a.anulada_el || '') || cmp(a.asegurado, b.asegurado));
  $('#anul-sub').textContent = !S.anuladas.length ? 'Todavía no hay pólizas anuladas'
    : (q ? `Mostrando ${S.rowsAnul.length} de ${S.anuladas.length}` : `${S.anuladas.length} en total`);
  $('#thead-anul').innerHTML = encabezado(ANUL_COLS, false);
  $('#tbody-anul').innerHTML = S.rowsAnul.map((p) => filaHTML(p, ANUL_COLS)).join('');
  vacio('anul', S.rowsAnul.length);
}

/* ---------- Sección: Compañías ---------- */
function renderComp() {
  const cuenta = {};
  S.todas.forEach((p) => { const k = (p.compania || '').toLowerCase(); cuenta[k] = (cuenta[k] || 0) + 1; });
  $('#comp-total').textContent = S.companias.length;
  $('#comp-list').innerHTML = S.companias.map((n) => `<tr>
      <td><span class="name">${esc(n)}</span></td>
      <td class="n">${cuenta[n.toLowerCase()] || 0}</td>
      <td class="a"><span class="comp-acts">
        <button type="button" class="btn" data-comp-ver="${esc(n)}">Ver pólizas</button>
        <button type="button" class="btn" data-comp-rename="${esc(n)}">Renombrar</button>
        <button type="button" class="btn quiet-danger" data-comp-del="${esc(n)}">Quitar</button></span></td></tr>`).join('')
    || '<tr><td colspan="3" class="muted" style="height:80px">Todavía no hay compañías. Agregá la primera arriba.</td></tr>';
}

/* ---------- Confirmaciones ---------- */
function confirmar({ titulo, msg, ok = 'Aceptar', peligro = false }) {
  return new Promise((res) => {
    const d = $('#dlg-confirm');
    $('#cf-title').textContent = titulo;
    $('#cf-msg').textContent = msg;
    const b = $('#cf-ok');
    b.textContent = ok;
    b.className = 'btn ' + (peligro ? 'danger' : 'solid');
    d.returnValue = '';
    d.addEventListener('close', () => { res(d.returnValue === 'ok'); d.returnValue = ''; }, { once: true });
    d.showModal();
  });
}

/* ---------- Ficha: tarjeta flotante con pestañas ---------- */
function pintarTabs() {
  $$('#fi-tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === S.fichaTab)));
  $$('#fi-body .fi-panel').forEach((d) => { d.hidden = d.dataset.panel !== S.fichaTab; });
}
function abrirFicha(id) {
  const p = S.todas.find((x) => x.id === id);
  if (!p) return;
  if (S.fichaId !== id || !$('#dlg-ficha').open) S.fichaTab = 'datos';
  S.fichaId = id;
  const an = !!p.anulada;
  $('#fi-estado').innerHTML = an
    ? `<span class="st anulada">Anulada el ${fmtFecha(p.anulada_el)}</span>`
    : `<span class="st ${p.est.k}">${esc(p.est.t)}</span>`;
  const nom = nombre(p);
  $('#fi-nombre').textContent = nom;
  $('#fi-mono').textContent = (nom.replace(/[^A-Za-zÀ-ÿ ]/g, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('') || '?').toUpperCase();
  $('#fi-sub').innerHTML = [p.nro_poliza && `<span class="mono">N° ${esc(p.nro_poliza)}</span>`, p.compania && esc(p.compania)].filter(Boolean).join('<br>');
  const vg = $('#fi-vig');
  vg.className = 'fi-vig ' + (an ? '' : p.est.k);
  if (p.vig_inicio && p.vig_fin) {
    const a = new Date(p.vig_inicio), b = new Date(p.vig_fin), tot = Math.max(1, (b - a) / 86400000);
    const pc = Math.round(Math.min(1, Math.max(0, (hoy() - a) / 86400000 / tot)) * 100);
    vg.innerHTML = `<div class="fi-vig-t"><span>${fmtFecha(p.vig_inicio)}</span><span>${fmtFecha(p.vig_fin)}</span></div><div class="fi-vig-bar"><i style="width:${pc}%"></i></div>`;
  } else {
    vg.innerHTML = p.vig_fin ? `<div class="fi-vig-t"><span>${p.est.k === 'vencida' ? 'Venció' : 'Vence'} el ${fmtFecha(p.vig_fin)}</span></div>` : '<div class="fi-vig-t"><span>Sin fecha de vigencia</span></div>';
  }
  const f = (t2, v, cls = '') => `<div><dt>${t2}</dt><dd class="${v ? cls : 'vacio'}">${v ? v : 'Sin cargar'}</dd></div>`;
  const mail = p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : '';
  const otras = otrasDelCliente(p);
  const hist = S.renov[p.id] || [];
  $('#fi-body').innerHTML = `
    <div class="fi-panel" data-panel="datos">
      ${an ? `<section class="fi-sec"><h3>Anulación</h3><dl class="fi-grid">${f('Anulada el', fmtFecha(p.anulada_el), 'mono')}${f('Motivo', esc(p.motivo_anulacion))}</dl></section>` : ''}
      <section class="fi-sec"><h3>Vehículo</h3><dl class="fi-grid cuatro">
        ${f('Patente', p.patente && `<span class="plate">${esc(p.patente)}</span>`)}${f('Tipo', esc(p.tipo))}${f('Marca', esc(p.marca))}${f('Modelo', esc(p.modelo))}</dl></section>
      <section class="fi-sec"><h3>Contacto</h3><dl class="fi-grid">
        ${celularFicha(p)}${f('E-mail', mail)}${p.trato ? f('Nombre para saludar', esc(p.trato)) : ''}</dl></section>
      <section class="fi-sec"><h3>Cobertura</h3><dl class="fi-grid">
        ${f('Compañía', esc(p.compania))}${f('N° de póliza', esc(p.nro_poliza), 'mono')}
        ${f('Inicio de vigencia', fmtFecha(p.vig_inicio), 'mono')}${f('Fin de vigencia', fmtFecha(p.vig_fin), 'mono')}
        ${p.mios ? f('MIOS', esc(p.mios)) : ''}</dl></section>
      ${otras.length ? `<section class="fi-sec"><h3>Otras pólizas de este cliente <span class="n">· ${otras.length}</span></h3><ul class="otras">${otras.map((o) => `<li><button type="button" data-ficha="${o.id}">
        <span class="st ${o.est.k}">${esc(o.est.t)}</span><span class="ot">${esc([o.marca, o.modelo].filter(Boolean).join(' ') || o.tipo || 'Póliza')}${o.patente ? ' · ' + esc(o.patente) : ''}</span><small>${esc(o.compania || '')}</small></button></li>`).join('')}</ul></section>` : ''}
    </div>
    <div class="fi-panel" data-panel="arch" hidden>
      <div class="drop" id="fi-drop" tabindex="0" role="button" aria-label="Agregar archivos: arrastralos acá o presioná Enter para elegirlos">
        ${icon('upload')}<span><b>Arrastrá los archivos acá</b></span><span>o <u>elegilos desde la computadora</u> · sin límite de cantidad ni de tamaño</span></div>
      <input type="file" id="fi-arch-input" multiple hidden>
      <ul class="arch-prog" id="fi-arch-prog" aria-live="polite"></ul>
      <ul class="arch-list" id="fi-arch-list"></ul>
      <p class="muted" id="fi-arch-vacio" style="margin-top:14px" hidden>Todavía no hay archivos en esta póliza.</p>
    </div>
    <div class="fi-panel" data-panel="hist" hidden>
      <section class="fi-sec"><h3>Renovaciones</h3>${hist.length ? `<dl class="fi-grid">${hist.slice(0, 12).map((r) =>
        f(`Renovada el ${fmtFecha(r.hecha_el)}`, `${r.inicio_nuevo ? fmtFecha(r.inicio_nuevo) + ' → ' : 'hasta '}${fmtFecha(r.fin_nuevo)}`, 'mono')).join('')}</dl>` : '<p class="muted">Todavía no se renovó desde el programa.</p>'}</section>
    </div>`;
  renderAdjuntos();
  pintarTabs();
  $('#fi-anular').hidden = an;
  $('#fi-der').hidden = an;
  $('#fi-react').hidden = !an;
  const dlgF = $('#dlg-ficha');
  if (!dlgF.open) dlgF.showModal();
  $('#fi-body').scrollTop = 0;
  (an ? $('#fi-react') : $('#fi-renovar')).focus({ focusVisible: false });
}

/* ---------- Formulario ---------- */
const CAMPOS_FORM = ['nro_poliza', 'asegurado', 'patente', 'tipo', 'marca', 'modelo', 'email', 'celular', 'compania', 'vig_inicio', 'vig_fin', 'mios', 'trato'];
const nombre = (p) => (p && p.asegurado) || '(sin nombre)';
const FM = () => $('#form').elements;
let formInicial = '';
const formValores = () => JSON.stringify(CAMPOS_FORM.map((k) => FM()[k].value));

function setErr(k, msg) {
  const out = document.getElementById('e-' + k);
  if (out) { out.textContent = msg; out.classList.remove('aviso'); }
  const el = FM()[k];
  el.removeAttribute('aria-invalid');
}
/* Avisos que orientan pero NO impiden guardar: ella decide. */
function setAviso(k, msg) {
  const out = document.getElementById('e-' + k);
  if (!out) return;
  out.textContent = msg;
  out.classList.toggle('aviso', !!msg);
}
function validarCampo(k) {
  const el = FM()[k];
  const v = el.value.trim();
  if (k === 'email') setAviso(k, v && !el.checkValidity() ? 'Parece incompleto, pero se guarda igual.' : '');
  if (k === 'vig_fin' || k === 'vig_inicio') {
    const a = FM().vig_inicio.value, b = FM().vig_fin.value;
    setAviso('vig_fin', a && b && b < a ? 'Ojo: el fin es anterior al inicio. Se guarda igual.' : '');
  }
  return true;
}
function pistaVigencia() {
  const h = $('#vig-hint');
  const v = FM().vig_fin.value;
  if (!v) { h.textContent = 'Sin fecha de fin: esta póliza no va a generar alertas de vencimiento.'; h.className = 'vig-hint'; return; }
  const d = diasHasta(v);
  const e = estado(d);
  h.className = 'vig-hint ' + (e.k === 'vigente' ? 'ok' : e.k);
  h.textContent = d < 0 ? `Esta póliza ya está vencida (hace ${dd(-d)}).`
    : d <= ALERTA ? `Entra en alerta: ${e.t.toLowerCase()}.`
    : `Vigente: vence en ${dd(d)}. La alerta salta ${ALERTA} días antes.`;
}

function abrirForm(id = null) {
  S.editId = id;
  const p = id ? S.polizas.find((x) => x.id === id) : null;
  $('#form-title').textContent = p ? 'Editar póliza' : 'Nueva póliza';
  $('#form-err').textContent = '';
  CAMPOS_FORM.forEach((k) => { FM()[k].value = p ? (p[k] || '') : ''; setErr(k, ''); });
  pistaVigencia();
  formInicial = formValores();
  $('#dlg-form').showModal();
}
async function cerrarForm() {
  if (formValores() !== formInicial) {
    const ok = await confirmar({ titulo: '¿Descartar los cambios?', msg: 'Hay datos sin guardar en esta póliza.', ok: 'Descartar', peligro: true });
    if (!ok) return;
  }
  $('#dlg-form').close();
}
async function guardarForm(ev) {
  ev.preventDefault();
  const datos = Object.fromEntries(CAMPOS_FORM.map((k) => [k, FM()[k].value.trim()]));
  if (!CAMPOS_FORM.some((k) => datos[k])) {
    $('#form-err').textContent = 'Completá al menos un dato para guardar la póliza.';
    FM().asegurado.focus();
    return;
  }
  $('#form-err').textContent = '';
  const btn = $('#form-save');
  btn.disabled = true;
  try {
    const nueva = !S.editId;
    await api('/api/poliza', { id: S.editId, datos });
    formInicial = formValores();
    $('#dlg-form').close();
    await cargar();
    say('ok', `${nueva ? 'Póliza creada' : 'Póliza actualizada'}: ${[datos.asegurado, datos.compania].filter(Boolean).join(' · ') || 'sin datos de identificación'}`);
  } catch (e) {
    $('#form-err').textContent = e.message;
  } finally {
    btn.disabled = false;
  }
}

/* ---------- Eliminar ---------- */
async function eliminar(id) {
  const p = S.todas.find((x) => x.id === id);
  if (!p) return;
  const ok = await confirmar({
    titulo: 'Eliminar póliza',
    msg: `Vas a eliminar la póliza ${p.nro_poliza || '(sin número)'} de ${nombre(p)}. Va a la Papelera y la podés recuperar durante 30 días (Configuración > Papelera).${S.adjCuenta[id] ? ` Sus ${S.adjCuenta[id]} archivo${S.adjCuenta[id] === 1 ? '' : 's'} adjunto${S.adjCuenta[id] === 1 ? '' : 's'} se conservan.` : ''}`,
    ok: 'Eliminar', peligro: true,
  });
  if (!ok) return;
  try {
    await api('/api/polizas/delete', { ids: [id] });
    if ($('#dlg-ficha').open) $('#dlg-ficha').close();
    await cargar();
    say('ok', 'Póliza eliminada. Quedó 30 días en la Papelera.', 14000, { texto: 'Deshacer', fn: () => restaurar(id) });
  } catch (e) { falla(e); }
}

async function restaurar(id) {
  try {
    await api('/api/papelera/restaurar', { id });
    await cargar();
    say('ok', 'Póliza recuperada: volvió a la lista de Pólizas.');
  } catch (e) { falla(e); }
}

/* ---------- Anular y reactivar (no es lo mismo que eliminar) ---------- */
let anulandoId = null;
function abrirAnular(id) {
  const p = S.todas.find((x) => x.id === id);
  if (!p) return;
  anulandoId = id;
  $('#an-nombre').textContent = nombre(p);
  $('#an-motivo').value = '';
  $('#an-err').textContent = '';
  $('#dlg-anular').showModal();
}
async function confirmarAnular(ev) {
  ev.preventDefault();
  try {
    await api('/api/poliza/anular', { id: anulandoId, motivo: $('#an-motivo').value.trim() });
    $('#dlg-anular').close();
    if ($('#dlg-ficha').open) $('#dlg-ficha').close();
    await cargar();
    say('ok', 'Póliza anulada. La encontrás en la sección Anuladas y se puede reactivar.');
  } catch (e) { $('#an-err').textContent = e.message; }
}
async function reactivar(id) {
  const p = S.todas.find((x) => x.id === id);
  try {
    await api('/api/poliza/reactivar', { id });
    if ($('#dlg-ficha').open) $('#dlg-ficha').close();
    await cargar();
    say('ok', `Póliza reactivada: ${nombre(p)}. Volvió a la lista de Pólizas.`);
  } catch (e) { falla(e); }
}

/* ---------- WhatsApp ---------- */
const celularFicha = (p) => `<div><dt>Celular</dt><dd class="${p.celular ? 'mono' : 'vacio'}">${p.celular
  ? `${esc(p.celular)}${p.anulada ? '' : `<button type="button" class="btn wa-btn" data-wa-ficha>${icon('chat')}WhatsApp</button>`}` : 'Sin cargar'}</dd></div>`;

/* Convierte lo que ella escribió ("381 4123456", "0381 15 4123456", "+54 9 381…") al formato que pide WhatsApp. */
function numeroWA(raw) {
  const pais = String((S.config && S.config.codigo_pais) || '54').replace(/\D/g, '').replace(/^549$/, '54');
  let d = String(raw || '').replace(/\D/g, '');
  let num = d;
  if (pais === '54') {
    if (d.startsWith('549') && d.length >= 12) num = d;
    else if (d.startsWith('54') && d.length === 12) num = '549' + d.slice(2);
    else {
      d = d.replace(/^0+/, '');
      if (d.length === 12) { const i = [2, 3, 4].find((k) => d.slice(k, k + 2) === '15'); if (i !== undefined) d = d.slice(0, i) + d.slice(i + 2); }
      num = d.length === 11 && d.startsWith('9') ? '54' + d : '549' + d;
    }
  } else num = d.startsWith(pais) ? d : pais + d.replace(/^0+/, '');
  const ok = pais === '54' ? /^549\d{10}$/.test(num) : num.length >= 9 && num.length <= 15;
  return { num, ok, mostrar: '+' + num };
}
function nombreSaludo(p) {
  if (p.trato) return p.trato;
  const t = String(p.asegurado || '').replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean);
  if (!t.length) return '';
  const w = t.length === 1 ? t[0] : (t.length <= 3 ? t[1] : t[2]);     // en el libro figura «APELLIDO NOMBRE»
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}
function fechaLarga(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} de ${MESES_L[m - 1]}${y !== hoy().getFullYear() ? ' de ' + y : ''}`;
}
function armarMensaje(texto, p, saludo) {
  const d = p.dias;
  const cuando = d == null ? '' : d < -1 ? `hace ${dd(-d)}` : d === -1 ? 'ayer' : d === 0 ? 'hoy' : d === 1 ? 'mañana' : `en ${dd(d)}`;
  const vence = d == null ? 'está por vencer' : d < 0 ? `venció ${cuando}` : `vence ${cuando}`;
  const vars = { nombre: saludo, fecha: fechaLarga(p.vig_fin), cuando, vence, vehiculo: [p.marca, p.modelo].filter(Boolean).join(' ') || p.tipo || '', compania: p.compania || '', patente: p.patente || '', mi_nombre: (S.config && S.config.wa_mi_nombre) || '', mi_numero: (S.config && S.config.wa_mi_numero) || '' };
  return String(texto || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m))
    .replace(/ +\(\)/g, '').replace(/[ \t]{2,}/g, ' ').replace(/ +([,.;!?])/g, '$1').trim();
}
let waPol = null, waTpl = null;
function waRender() {
  const tpls = (S.config && S.config.plantillas) || [];
  $('#wa-tpl').innerHTML = tpls.length
    ? tpls.map((t) => `<button type="button" data-tpl="${esc(t.id)}" aria-pressed="${t.id === waTpl}">${esc(t.nombre)}</button>`).join('')
    : '<span class="muted">Todavía no tenés mensajes guardados: escribí uno acá abajo o creá los tuyos en Configuración (la tuerca).</span>';
}
function waAplicar() {
  const t = ((S.config && S.config.plantillas) || []).find((x) => x.id === waTpl);
  if (t) $('#wa-texto').value = armarMensaje(t.texto, waPol, $('#wa-nombre').value.trim());
}
function abrirWA(id) {
  const p = S.polizas.find((x) => x.id === id);
  if (!p || !p.celular) return;
  waPol = p;
  const r = numeroWA(p.celular);
  $('#wa-para').innerHTML = `Para <b>${esc(nombre(p))}</b> · ${esc(r.mostrar)}${r.ok ? '' : ' <span class="err aviso" style="display:inline">· el número parece incompleto, revisalo</span>'}`;
  const mi = S.config.wa_mi_numero;
  $('#wa-emisor').innerHTML = mi
    ? `Sale desde tu WhatsApp <b>${esc(mi)}</b>. Fijate que sea esa la cuenta abierta en la computadora.`
    : 'Sale desde el WhatsApp que tengas abierto en la computadora. Podés guardar tu número en Configuración.';
  $('#wa-nombre').value = nombreSaludo(p);
  $('#wa-recordar').checked = false;
  $('#wa-err').textContent = '';
  waTpl = S.config.plantilla_pred || ((S.config.plantillas[0] || {}).id);
  $('#wa-texto').value = '';
  waRender();
  waAplicar();
  $('#dlg-wa').showModal();
  $('#wa-texto').focus();
}
async function enviarWA(ev) {
  ev.preventDefault();
  const texto = $('#wa-texto').value.trim();
  const r = numeroWA(waPol.celular);
  try {
    const modo = S.config.wa_abrir || 'auto';
    const t = texto ? '&text=' + encodeURIComponent(texto) : '';
    const url = modo === 'escritorio' ? `whatsapp://send?phone=${r.num}${t}` : modo === 'web' ? `https://web.whatsapp.com/send?phone=${r.num}${t}` : `https://wa.me/${r.num}${texto ? '?text=' + encodeURIComponent(texto) : ''}`;
    await api('/api/abrir-url', { url });
    const saludo = $('#wa-nombre').value.trim();
    if ($('#wa-recordar').checked && saludo && saludo !== waPol.trato) {
      const datos = Object.fromEntries(CAMPOS_FORM.map((k) => [k, waPol[k] || '']));
      datos.trato = saludo;
      await api('/api/poliza', { id: waPol.id, datos });
      await cargar();
    }
    $('#dlg-wa').close();
    say('ok', `Se abrió WhatsApp con el mensaje para ${nombre(waPol)}. Falta que lo envíes.`);
  } catch (e) { $('#wa-err').textContent = e.message; }
}

/* ---------- Renovar con un clic ---------- */
let renovandoId = null;
const sumarMeses = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  const f = new Date(y, m - 1 + n, d);
  if (f.getDate() !== d) f.setDate(0);                      // 30/11 + 3 meses = 28/02, no 02/03
  return toISO(f);
};
function rvPista() {
  const fin = $('#rv-fin').value;
  const h = $('#rv-hint');
  if (!fin) { h.textContent = ''; h.className = 'vig-hint'; return; }
  const d = diasHasta(fin);
  h.className = 'vig-hint ' + (d < 0 ? 'vencida' : d <= ALERTA ? 'porvencer' : 'ok');
  h.textContent = d < 0 ? 'Ojo: esa fecha ya pasó.' : `Va a quedar vigente hasta el ${fmtFecha(fin)} (${d === 0 ? 'hoy' : 'dentro de ' + dd(d)}).`;
}
function rvDuracion(meses) {
  $('#form-renovar').dataset.meses = meses || '';
  $$('#rv-dur button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.meses) === meses)));
  if (meses && $('#rv-inicio').value) $('#rv-fin').value = sumarMeses($('#rv-inicio').value, meses);
  rvPista();
}
function abrirRenovar(id) {
  const p = S.polizas.find((x) => x.id === id);
  if (!p) return;
  renovandoId = id;
  $('#rv-sub').textContent = `${nombre(p)}${p.vig_fin ? ` · ${p.dias < 0 ? 'venció' : 'vence'} el ${fmtFecha(p.vig_fin)}` : ' · sin fecha de vencimiento cargada'}`;
  $('#rv-inicio').value = p.vig_fin || toISO(hoy());       // la nueva vigencia arranca donde terminó la anterior
  $('#rv-nro').value = p.nro_poliza || '';
  $('#rv-err').textContent = '';
  rvDuracion(3);                                           // por defecto 3 meses; ella puede elegir otra duración o fecha
  $('#dlg-renovar').showModal();
  $('#rv-ok').focus();
}
async function confirmarRenovar(ev) {
  ev.preventDefault();
  const fin = $('#rv-fin').value;
  if (!fin) { $('#rv-err').textContent = 'Elegí hasta qué fecha se renueva.'; return; }
  const p = S.polizas.find((x) => x.id === renovandoId);
  try {
    await api('/api/poliza/renovar', { id: renovandoId, inicio: $('#rv-inicio').value, fin, nro_poliza: $('#rv-nro').value.trim() });
    $('#dlg-renovar').close();
    if ($('#dlg-ficha').open) $('#dlg-ficha').close();
    await cargar();
    say('ok', `Renovada: ${nombre(p)} hasta el ${fmtFecha(fin)}.`);
  } catch (e) { $('#rv-err').textContent = e.message; }
}

/* ---------- Archivos adjuntos ---------- */
const tamTxt = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : b < 1073741824 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1073741824).toFixed(2)} GB`);
const urlAdj = (a) => `/adjunto/${a.id}?t=${encodeURIComponent(TOKEN)}`;
const tipoAdj = (a) => (/\.(png|jpe?g|gif|webp|bmp)$/i.test(a.nombre) ? 'img' : /\.pdf$/i.test(a.nombre) ? 'pdf' : 'otro');
const extAdj = (a) => ((/\.(\w{1,5})$/.exec(a.nombre) || [])[1] || 'ARCH').toUpperCase();
function renderAdjuntos() {
  const lista = S.adjuntos.filter((a) => a.poliza_id === S.fichaId);
  const n = $('#fi-arch-list');
  if (!n) return;
  const tn = $('#fi-tab-arch-n');
  tn.textContent = lista.length; tn.hidden = !lista.length;
  $('#fi-arch-vacio').hidden = !!lista.length;
  n.innerHTML = lista.map((a) => `<li class="arch" data-id="${a.id}">
    <button type="button" class="arch-th" data-arch-ver aria-label="Ver ${esc(a.nombre)}">${tipoAdj(a) === 'img' ? `<img src="${urlAdj(a)}" alt="" loading="lazy">` : esc(extAdj(a))}</button>
    <div class="arch-t"><button type="button" class="arch-ver" data-arch-ver><b title="${esc(a.nombre)}">${esc(a.nombre)}</b><small>${tamTxt(a.tam)} · ${fmtFecha((a.agregado_el || '').slice(0, 10))} · tocá para ver</small></button></div>
    <button type="button" class="btn" data-arch-abrir>Abrir</button>
    <button type="button" class="icon-btn" data-arch-carpeta aria-label="Mostrar ${esc(a.nombre)} en la carpeta" title="Mostrar en la carpeta">${icon('folder')}</button>
    <button type="button" class="icon-btn danger" data-arch-borrar aria-label="Eliminar el archivo ${esc(a.nombre)}" title="Eliminar">${icon('trash')}</button></li>`).join('');
}

/* ---------- Vista previa de un archivo ---------- */
let prevLista = [], prevI = 0;
function pintarPrev() {
  const a = prevLista[prevI];
  if (!a) return;
  $('#pv-nombre').textContent = a.nombre;
  $('#pv-sub').textContent = `${tamTxt(a.tam)} · ${prevI + 1} de ${prevLista.length}`;
  const t2 = tipoAdj(a);
  $('#pv-body').innerHTML = t2 === 'img' ? `<img src="${urlAdj(a)}" alt="${esc(a.nombre)}">`
    : t2 === 'pdf' ? `<iframe title="Vista previa de ${esc(a.nombre)}" src="${urlAdj(a)}"></iframe>`
    : `<div class="pv-otro"><div class="fi-mono" aria-hidden="true">${esc(extAdj(a))}</div><b>Este tipo de archivo no se puede ver acá</b><p>Abrilo con el programa de tu computadora (Word, Excel, etc.).</p></div>`;
  $('#pv-ant').disabled = $('#pv-sig').disabled = prevLista.length < 2;
}
function abrirPrev(id) {
  prevLista = S.adjuntos.filter((a) => a.poliza_id === S.fichaId);
  prevI = Math.max(0, prevLista.findIndex((a) => a.id === id));
  pintarPrev();
  const d = $('#dlg-prev');
  if (!d.open) d.showModal();
}
function subirUno(pid, file, barra) {
  return new Promise((res, rej) => {
    const x = new XMLHttpRequest();
    x.open('POST', `/api/adjuntos/subir?poliza=${pid}&nombre=${encodeURIComponent(file.name)}`);
    x.setRequestHeader('X-Token', TOKEN);
    x.upload.onprogress = (e) => { if (e.lengthComputable) barra(Math.round((e.loaded / e.total) * 100)); };
    x.onload = () => {
      let j = {};
      try { j = JSON.parse(x.responseText); } catch { /* respuesta inválida */ }
      if (x.status === 200 && j.ok) res(j); else rej(new Error(j.error || 'No se pudo guardar el archivo.'));
    };
    x.onerror = () => rej(new Error('Se cortó la conexión con el programa.'));
    x.send(file);
  });
}
async function subirArchivos(files) {
  const pid = S.fichaId;
  const lista = [...files];
  if (!pid || !lista.length) return;
  let ok = 0;
  for (const f of lista) {
    const li = document.createElement('li');
    li.className = 'arch-p';
    li.innerHTML = `<span>${esc(f.name)} · ${tamTxt(f.size)}</span><div class="barra"><i></i></div>`;
    $('#fi-arch-prog').append(li);
    try {
      await subirUno(pid, f, (pc) => { li.querySelector('i').style.width = pc + '%'; });
      ok++;
      li.remove();
    } catch (e) {
      li.classList.add('err');
      li.innerHTML = `<span>No se pudo guardar «${esc(f.name)}»: ${esc(e.message)}</span>`;
      setTimeout(() => li.remove(), 12000);
    }
    await cargar();
    renderAdjuntos();
  }
  if (ok) say('ok', `${ok} archivo${ok === 1 ? '' : 's'} guardado${ok === 1 ? '' : 's'} en la póliza.`);
}
function eventosAdjuntos() {
  const fi = $('#fi-body');
  fi.addEventListener('click', async (e) => {
    if (e.target.closest('#fi-drop')) { $('#fi-arch-input').click(); return; }
    const li = e.target.closest('.arch');
    if (!li) return;
    const id = Number(li.dataset.id);
    try {
      if (e.target.closest('[data-arch-ver]')) abrirPrev(id);
      else if (e.target.closest('[data-arch-abrir]')) await api('/api/adjuntos/abrir', { id });
      else if (e.target.closest('[data-arch-carpeta]')) await api('/api/adjuntos/carpeta', { id });
      else if (e.target.closest('[data-arch-borrar]')) {
        const a = S.adjuntos.find((x) => x.id === id);
        if (await confirmar({ titulo: 'Eliminar archivo', msg: `¿Eliminar «${a ? a.nombre : 'el archivo'}»? No se puede deshacer (si ya hiciste una copia de seguridad, ahí queda guardado).`, ok: 'Eliminar', peligro: true })) {
          await api('/api/adjuntos/borrar', { id });
          await cargar();
          renderAdjuntos();
          say('ok', 'Archivo eliminado.');
        }
      }
    } catch (er) { falla(er); }
  });
  fi.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.id === 'fi-drop') { e.preventDefault(); $('#fi-arch-input').click(); } });
  fi.addEventListener('change', (e) => { if (e.target.id === 'fi-arch-input') { subirArchivos(e.target.files); e.target.value = ''; } });
  const dlg = $('#dlg-ficha');
  ['dragenter', 'dragover'].forEach((ev) => dlg.addEventListener(ev, (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); dlg.classList.add('arrastrando'); } }));
  dlg.addEventListener('dragleave', (e) => { if (!dlg.contains(e.relatedTarget)) dlg.classList.remove('arrastrando'); });
  dlg.addEventListener('drop', (e) => { e.preventDefault(); dlg.classList.remove('arrastrando'); if (e.dataTransfer.files.length) subirArchivos(e.dataTransfer.files); });
  // soltar un archivo fuera de la zona no debe abrirlo en la ventana del programa
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());
}

/* ---------- Configuración (tuerca): pantalla dividida en secciones ---------- */
const SECCIONES = { wa: 'WhatsApp', resp: 'Copia de seguridad', arch: 'Archivos adjuntos', pap: 'Papelera', prog: 'Programa' };
const VARIABLES = [['nombre', 'Nombre'], ['fecha', 'Fecha de vencimiento'], ['vence', 'Vence en… / Venció hace…'], ['vehiculo', 'Vehículo'], ['compania', 'Compañía'], ['mi_nombre', 'Mi nombre'], ['mi_numero', 'Mi número']];
let cfgTimer = null;
function cfgGuardar() {
  clearTimeout(cfgTimer);
  $('#cfg-estado').textContent = 'Guardando…';
  cfgTimer = setTimeout(async () => {
    try { const r = await api('/api/config', { config: S.config }); S.config = r.config; $('#cfg-estado').textContent = 'Guardado ✓'; }
    catch (e) { $('#cfg-estado').textContent = 'No se pudo guardar'; falla(e); }
  }, 450);
}
function ejemploWA() {
  return S.polizas.find((p) => p.celular && p.vig_fin) || S.polizas.find((p) => p.vig_fin)
    || { asegurado: 'PEREZ JUAN', dias: 11, vig_fin: toISO(sumarDias(11)), marca: 'Ford', modelo: 'Fiesta', compania: 'ATM', patente: 'AB123CD' };
}
const vistaPrevia = (t) => { const p = ejemploWA(); return armarMensaje(t.texto, p, nombreSaludo(p)); };
function tplHTML(t, i) {
  const pred = t.id === S.config.plantilla_pred;
  return `<details class="tpl" data-i="${i}" data-id="${esc(t.id)}"${S.tplAbiertos.has(t.id) ? ' open' : ''}>
    <summary><span class="tpl-t">${esc(t.nombre)}</span><span class="tpl-badge"${pred ? '' : ' hidden'}>Predeterminado</span>${icon('chev-down', 'chev')}</summary>
    <div class="tpl-cuerpo">
      <div class="tpl-head"><input class="tpl-nombre" type="text" value="${esc(t.nombre)}" maxlength="60" aria-label="Nombre del mensaje">
        <button type="button" class="icon-btn danger" data-tpl-del aria-label="Eliminar este mensaje">${icon('trash')}</button></div>
      <textarea class="tpl-texto" rows="4" maxlength="1000" aria-label="Texto del mensaje">${esc(t.texto)}</textarea>
      <div class="tpl-vars"><span>Agregar:</span>${VARIABLES.map(([k, n]) => `<button type="button" data-var="${k}">${n}</button>`).join('')}</div>
      <label class="chk"><input type="radio" name="pred" ${pred ? 'checked' : ''}> Usar como mensaje predeterminado</label>
      <div class="tpl-prev"><b>Así le llegaría:</b>\n<span class="tpl-prev-t">${esc(vistaPrevia(t))}</span></div>
    </div></details>`;
}
function respaldoInfo() {
  const r = S.respaldo || {};
  if (r.error) return { t: r.error, err: true };
  if (!r.ultimo) return { t: 'Todavía no se hizo ninguna copia.' };
  const f = new Date(r.ultimo);
  return { t: `Última copia: ${f.toLocaleDateString('es-AR')} a las ${f.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })} · ${r.cantidad} copia${r.cantidad === 1 ? '' : 's'} guardada${r.cantidad === 1 ? '' : 's'}.` };
}
function secWA() {
  const c = S.config;
  const modos = [['auto', 'Lo que elija la computadora', 'Recomendado: abre la app de WhatsApp si la tenés, o WhatsApp Web.'],
    ['escritorio', 'La aplicación de WhatsApp para Windows', 'Si la tenés instalada y con tu sesión abierta.'],
    ['web', 'WhatsApp Web en el navegador', 'Abre web.whatsapp.com con tu sesión.']];
  return `
    <div class="cfg-card"><h4>Tu WhatsApp</h4>
      <div class="grid2">
        <div class="field"><label for="cfg-wa-num">Tu número</label><input id="cfg-wa-num" type="tel" inputmode="tel" value="${esc(c.wa_mi_numero)}" placeholder="Ej.: 381 412 3456" maxlength="30"></div>
        <div class="field"><label for="cfg-wa-nom">Tu nombre <span class="opt">(para firmar)</span></label><input id="cfg-wa-nom" value="${esc(c.wa_mi_nombre)}" placeholder="Ej.: Marta" maxlength="60"></div>
      </div>
      <p class="cfg-nota"><b>Ojo:</b> los mensajes salen desde la cuenta de WhatsApp que tengas abierta en esta computadora. El programa no puede elegir el número por vos: lo guarda para recordártelo cada vez que enviás y para usarlo en tus mensajes con los botones «Mi número» y «Mi nombre».</p>
      <fieldset class="cfg-radios"><legend>¿Cómo se abre WhatsApp?</legend>
        ${modos.map(([v, t, d]) => `<label class="radio"><input type="radio" name="waabrir" value="${v}" ${(c.wa_abrir || 'auto') === v ? 'checked' : ''}><span><b>${t}</b><small>${d}</small></span></label>`).join('')}
      </fieldset></div>
    <div class="cfg-card"><h4>Tus mensajes</h4>
      <p class="sub">Escribilos como los dirías vos. Los botones «Agregar» ponen datos del cliente (nombre, fecha…) donde tengas el cursor. El botón de WhatsApp aparece solo en los clientes que tienen celular cargado.</p>
      <div id="cfg-tpls">${c.plantillas.map(tplHTML).join('') || '<p class="muted">No hay mensajes. Agregá el primero.</p>'}</div>
      <div class="chip-fila"><button type="button" class="btn" id="cfg-add-tpl">${icon('plus')}Agregar mensaje</button><button type="button" class="link" id="cfg-reset-tpl">Volver a los mensajes originales</button></div>
    </div>`;
}
function secResp() {
  const c = S.config, r = S.respaldo || {}, info = respaldoInfo();
  return `
    <div class="cfg-card"><h4>Copia diaria</h4>
      <p class="sub">Protege tus pólizas si le pasa algo a la computadora. Se guarda una copia por día y las más viejas se borran solas.</p>
      <label class="chk"><input type="checkbox" id="cfg-resp-on" ${c.respaldo_activo ? 'checked' : ''}> Hacer una copia todos los días (al abrir el programa)</label>
      <div class="cfg-row"><label for="cfg-resp-n">Guardar las últimas</label><input id="cfg-resp-n" class="cfg-num" type="number" min="1" max="365" value="${c.respaldo_cantidad}"><span>copias</span></div>
      <div class="cfg-row"><label class="chk"><input type="checkbox" id="cfg-resp-arch" ${c.respaldo_archivos ? 'checked' : ''}> Incluir los archivos adjuntos</label></div>
    </div>
    <div class="cfg-card"><h4>Dónde se guardan</h4>
      <p class="cfg-ruta" id="cfg-resp-ruta">${esc(r.carpeta || '')}</p>
      <div class="cfg-row"><button type="button" class="btn" id="cfg-resp-cambiar">Cambiar carpeta…</button><button type="button" class="btn" id="cfg-resp-abrir">Abrir carpeta</button></div>
      <p class="sub" style="margin-top:12px">Sirve elegir un pendrive o una carpeta de Drive: así la copia queda fuera de esta computadora.</p>
    </div>
    <div class="cfg-card"><h4>Estado</h4>
      <p class="cfg-info ${info.err ? 'err' : ''}" id="cfg-resp-info" style="margin-top:0">${esc(info.t)}</p>
      <div class="cfg-row"><button type="button" class="btn solid" id="cfg-resp-ahora">Hacer una copia ahora</button></div>
      <p class="sub" style="margin-top:14px">Para volver a una copia: cerrá el programa y reemplazá <b>seguros.db</b> por la copia que elijas (con ese mismo nombre). Los archivos adjuntos están en la carpeta <b>Archivos</b> de la copia.</p>
    </div>`;
}
function secArch() {
  const a = S.archivos || { carpeta: '', cantidad: 0, bytes: 0 };
  return `
    <div class="cfg-card"><h4>Archivos de tus clientes</h4>
      <p class="sub">Los archivos que arrastrás a la ficha de una póliza (DNI, cédula, fotos, la póliza escaneada…) se guardan en esta computadora, junto a tus datos. No hay límite de cantidad ni de tamaño: solo el espacio del disco.</p>
      <div class="cfg-stats"><div class="cfg-stat"><b>${a.cantidad}</b><span>archivo${a.cantidad === 1 ? '' : 's'} guardado${a.cantidad === 1 ? '' : 's'}</span></div><div class="cfg-stat"><b>${tamTxt(a.bytes)}</b><span>ocupan en total</span></div></div>
      <p class="cfg-ruta">${esc(a.carpeta)}</p>
      <div class="cfg-row"><button type="button" class="btn" id="cfg-arch-abrir">${icon('folder')}Abrir la carpeta</button></div>
    </div>
    <div class="cfg-card"><h4>Cómo se usan</h4>
      <p class="sub" style="margin:0">Abrí la ficha de una póliza y arrastrá los archivos a la zona punteada, o tocala para elegirlos. En la lista de pólizas, el clip junto al nombre indica que tiene archivos. Si anulás o reactivás una póliza, sus archivos se conservan; si la <b>eliminás</b>, se eliminan también (la copia de seguridad los guarda).</p>
    </div>`;
}
function secProg() {
  const c = S.config;
  return `
    <div class="cfg-card"><h4>Actualizaciones</h4>
      <p class="sub">Con internet, el programa avisa solo cuando hay una versión nueva. Tus datos nunca se tocan al actualizar.</p>
      <div class="cfg-row" style="margin-top:0"><span>Versión instalada: <b>${esc(S.version)}</b></span><button type="button" class="btn" id="cfg-upd">Buscar actualizaciones</button></div>
    </div>
    <div class="cfg-card"><h4>WhatsApp</h4>
      <div class="cfg-row" style="margin-top:0"><label for="cfg-pais">Código de país</label><input id="cfg-pais" class="cfg-num" type="text" inputmode="numeric" value="${esc(c.codigo_pais)}" maxlength="4"><span class="sub">(Argentina: 54)</span></div>
    </div>
    <div class="cfg-card"><h4>Tus datos</h4>
      <p class="sub" style="margin:0">Todo vive en esta computadora, en el archivo <b>seguros.db</b> y la carpeta <b>Archivos</b>. El programa funciona sin internet; solo se conecta para buscar actualizaciones y para abrir WhatsApp.</p>
    </div>`;
}
function secPap() {
  const l = S.papelera;
  const faltan = (iso) => Math.max(0, 30 - Math.round((hoy() - new Date(iso + 'T00:00:00')) / 86400000));
  return `<div class="cfg-card"><h4>Pólizas eliminadas</h4>
    <p class="sub">Cuando eliminás una póliza no se pierde de inmediato: queda acá 30 días y la podés recuperar con todos sus datos y archivos. Pasado ese tiempo se borra para siempre.</p>
    ${l.length ? `<ul class="pap-lista">${l.map((x) => `<li class="pap-item"><div class="pap-t"><b>${esc(x.asegurado || '(sin nombre)')}</b>
      <small>${[x.patente, x.compania, x.nro_poliza && 'póliza ' + x.nro_poliza].filter(Boolean).map(esc).join(' · ')}</small>
      <small>Eliminada el ${fmtFecha(x.eliminada_el)} · se borra para siempre en ${dd(faltan(x.eliminada_el))}</small></div>
      <button type="button" class="btn" data-pap-rest="${x.id}">Recuperar</button>
      <button type="button" class="icon-btn danger" data-pap-borrar="${x.id}" aria-label="Eliminar para siempre" title="Eliminar para siempre">${icon('trash')}</button></li>`).join('')}</ul>
      <div class="cfg-row"><button type="button" class="btn quiet-danger" id="cfg-pap-vaciar">Vaciar la papelera</button></div>`
    : '<p class="muted" style="margin:12px 0 0">La papelera está vacía.</p>'}</div>`;
}

/* Detector de datos raros: cosas que conviene mirar (no se corrige nada solo). */
function revisar() {
  const act = S.polizas, anio = hoy().getFullYear(), g = [];
  /* Cada hallazgo dice POR QUÉ aparece (motivo) y, si corresponde, con qué otra póliza se parece (otros). */
  const add = (k, titulo, desc, items) => {
    const m = new Map();
    items.forEach((it) => { if (!m.has(it.id)) m.set(it.id, it); });
    if (m.size) g.push({ k, titulo, desc, items: [...m.values()], ids: [...m.keys()] });
  };
  const de = (lista, f) => lista.map((p) => ({ id: p.id, motivo: f(p) }));
  const repetidas = (clave, motivo) => {
    const m = {};
    act.forEach((p) => { const k = clave(p); if (k) (m[k] = m[k] || []).push(p); });
    return Object.values(m).filter((a) => a.length > 1).flatMap((a) => a.map((p) => ({ id: p.id, motivo: motivo(p, a.length), otros: a.filter((x) => x.id !== p.id) })));
  };
  const anios = (p) => [p.vig_inicio, p.vig_fin].filter((f) => f && (Number(f.slice(0, 4)) < 2000 || Number(f.slice(0, 4)) > anio + 5));
  add('dupnro', 'Mismo N° de póliza repetido', 'Dos o más pólizas tienen el mismo número. Puede ser una póliza cargada dos veces.',
    repetidas((p) => norm(p.nro_poliza), (p, n) => `El N° de póliza ${p.nro_poliza} figura en ${n} pólizas.`));
  add('duppat', 'Misma patente y misma compañía', 'Parece la misma póliza cargada dos veces.',
    repetidas((p) => (norm(p.patente) ? norm(p.patente) + '|' + norm(p.compania) : ''), (p) => `La patente ${p.patente} está cargada más de una vez en ${p.compania || 'la misma compañía'}.`));
  add('sinfin', 'Sin fecha de fin de vigencia', 'No generan alertas de vencimiento.',
    de(act.filter((p) => !p.vig_fin), () => 'No tiene fecha de fin de vigencia, así que el programa nunca te avisa cuando venza.'));
  add('finantes', 'Fin de vigencia anterior al inicio', 'Las fechas están al revés.',
    de(act.filter((p) => p.vig_inicio && p.vig_fin && p.vig_fin < p.vig_inicio), (p) => `Termina el ${fmtFecha(p.vig_fin)} pero empieza el ${fmtFecha(p.vig_inicio)}: parecen estar al revés.`));
  add('anio', 'Fechas con un año raro', 'Por ejemplo 2065: casi seguro es un error al tipear.',
    de(act.filter((p) => anios(p).length), (p) => `Tiene una fecha con un año fuera de lo normal: ${anios(p).map(fmtFecha).join(' y ')}.`));
  add('larga', 'Vigencia de más de 2 años', 'Revisá que las fechas estén bien cargadas.',
    de(act.filter((p) => p.vig_inicio && p.vig_fin && p.vig_fin >= p.vig_inicio && (new Date(p.vig_fin) - new Date(p.vig_inicio)) / 86400000 > 730),
      (p) => `Va del ${fmtFecha(p.vig_inicio)} al ${fmtFecha(p.vig_fin)}: son ${Math.round((new Date(p.vig_fin) - new Date(p.vig_inicio)) / 31557600000 * 10) / 10} años.`));
  add('vencidas', 'Vencidas hace más de 60 días', '¿Se renovaron? Si no siguen, conviene anularlas.',
    de(act.filter((p) => p.dias != null && p.dias < -60), (p) => `Venció el ${fmtFecha(p.vig_fin)} (hace ${dd(-p.dias)}) y sigue cargada como activa.`));
  add('sinnombre', 'Sin nombre del asegurado', '', de(act.filter((p) => !p.asegurado), () => 'No tiene cargado el nombre del asegurado.'));
  add('sincia', 'Sin compañía', '', de(act.filter((p) => !p.compania), () => 'No tiene compañía: no se puede ver en «Por compañía».'));
  add('sinnro', 'Sin N° de póliza', '', de(act.filter((p) => !p.nro_poliza), () => 'No tiene número de póliza cargado.'));
  add('cel', 'Celular que parece incompleto', 'Tiene menos de 8 dígitos, WhatsApp no lo va a poder abrir.',
    de(act.filter((p) => p.celular && p.celular.replace(/\D/g, '').length < 8), (p) => `El celular «${p.celular}» tiene solo ${p.celular.replace(/\D/g, '').length} dígitos.`));
  add('mail', 'E-mail que parece incompleto', 'Le falta la arroba o el dominio.',
    de(act.filter((p) => p.email && !/^\S+@\S+\.\S+$/.test(p.email)), (p) => `El e-mail «${p.email}» no parece completo.`));
  return g;
}
function renderRev() {
  const g = revisar();
  const cont = $('#rev-body');
  if (!g.length) { cont.innerHTML = '<div class="rev-ok">Todo en orden: no encontré nada raro en tus pólizas.</div>'; return; }
  const total = new Set(g.flatMap((x) => x.ids)).size;
  const info = (p) => [p.patente, p.compania, p.nro_poliza && 'póliza ' + p.nro_poliza].filter(Boolean).map(esc).join(' · ');
  cont.innerHTML = `<p class="sub" style="margin:0 0 14px">Encontré <b>${g.length} tema${g.length === 1 ? '' : 's'}</b> para revisar (${total} póliza${total === 1 ? '' : 's'}). Cada una dice por qué está acá. Tocá «Abrir» para corregirla.</p>`
    + g.map((x) => `<details class="rev-g" open><summary><span class="t">${esc(x.titulo)}</span><span class="c">${x.items.length}</span>${icon('chev-down', 'chev')}</summary>
      <div class="rev-cuerpo">${x.desc ? `<p>${esc(x.desc)}</p>` : ''}${x.items.slice(0, 40).map((it) => {
        const p = S.polizas.find((z) => z.id === it.id);
        return `<div class="rev-item"><div class="rev-t"><span><b>${esc(nombre(p))}</b> <small>${info(p)}</small></span>
          <p class="rev-m">${esc(it.motivo)}</p>
          ${(it.otros || []).slice(0, 4).map((o) => `<p class="rev-o">Se parece a <button type="button" class="link" data-rev-abrir="${o.id}">${esc(nombre(o))}</button> <small>${info(o)}</small></p>`).join('')}</div>
          <button type="button" class="btn" data-rev-abrir="${it.id}">Abrir</button></div>`;
      }).join('')}${x.items.length > 40 ? `<p style="margin-top:8px">… y ${x.items.length - 40} más.</p>` : ''}</div></details>`).join('');
}

function renderConfig() {
  const sec = SECCIONES[S.cfgSec] ? S.cfgSec : 'wa';
  S.cfgSec = sec;
  $$('.cfg-nav [data-sec]').forEach((b) => b.setAttribute('aria-current', String(b.dataset.sec === sec)));
  $('#cfg-sec-titulo').textContent = SECCIONES[sec];
  $('#cfg-body').innerHTML = { wa: secWA, resp: secResp, arch: secArch, pap: secPap, prog: secProg }[sec]();
  const nP = S.papelera.length;
  $('.cfg-nav [data-sec="pap"] small').textContent = nP ? `${nP} eliminada${nP === 1 ? '' : 's'}` : 'Vacía';
  $('#cfg-body').scrollTop = 0;
}
function abrirConfig(sec) {
  if (sec) S.cfgSec = sec;
  renderConfig();
  $('#cfg-estado').textContent = 'Los cambios se guardan solos.';
  $('#dlg-config').showModal();
  ($('.cfg-nav [aria-current="true"]') || $('#cfg-x')).focus({ focusVisible: false });   // sin recuadro: la sección activa ya se ve marcada
}

function eventosConfig() {
  $('#btn-config').addEventListener('click', () => abrirConfig());
  $('#cfg-x').addEventListener('click', () => $('#dlg-config').close());
  $('.cfg-nav').addEventListener('click', (e) => { const b = e.target.closest('[data-sec]'); if (b) { S.cfgSec = b.dataset.sec; renderConfig(); } });
  const body = $('#cfg-body');
  body.addEventListener('toggle', (e) => {
    const d = e.target.closest && e.target.closest('.tpl');
    if (d) { d.open ? S.tplAbiertos.add(d.dataset.id) : S.tplAbiertos.delete(d.dataset.id); }
  }, true);
  body.addEventListener('input', (e) => {
    const tpl = e.target.closest('.tpl');
    if (tpl) {
      const t = S.config.plantillas[Number(tpl.dataset.i)];
      if (e.target.classList.contains('tpl-nombre')) { t.nombre = e.target.value; $('.tpl-t', tpl).textContent = e.target.value || 'Mensaje'; }
      if (e.target.classList.contains('tpl-texto')) { t.texto = e.target.value; $('.tpl-prev-t', tpl).textContent = vistaPrevia(t); }
      cfgGuardar();
    }
    if (e.target.id === 'cfg-resp-n') { S.config.respaldo_cantidad = Math.max(1, Math.min(365, Number(e.target.value) || 30)); cfgGuardar(); }
    if (e.target.id === 'cfg-pais') { S.config.codigo_pais = e.target.value.replace(/\D/g, '') || '54'; cfgGuardar(); }
    if (e.target.id === 'cfg-wa-num') { S.config.wa_mi_numero = e.target.value; cfgGuardar(); }
    if (e.target.id === 'cfg-wa-nom') { S.config.wa_mi_nombre = e.target.value; cfgGuardar(); }
  });
  body.addEventListener('change', (e) => {
    const tpl = e.target.closest('.tpl');
    if (tpl && e.target.matches('input[type="radio"]')) {
      S.config.plantilla_pred = S.config.plantillas[Number(tpl.dataset.i)].id;
      $$('.tpl', body).forEach((d) => { $('.tpl-badge', d).hidden = d.dataset.id !== S.config.plantilla_pred; });
      cfgGuardar();
    }
    if (e.target.name === 'waabrir') { S.config.wa_abrir = e.target.value; cfgGuardar(); }
    if (e.target.id === 'cfg-resp-on') { S.config.respaldo_activo = e.target.checked; cfgGuardar(); }
    if (e.target.id === 'cfg-resp-arch') { S.config.respaldo_archivos = e.target.checked; cfgGuardar(); }
  });
  body.addEventListener('click', async (e) => {
    const pr = e.target.closest('[data-pap-rest]');
    if (pr) { await restaurar(Number(pr.dataset.papRest)); renderConfig(); return; }
    const pb = e.target.closest('[data-pap-borrar]');
    if (pb) {
      const x = S.papelera.find((z) => z.id === Number(pb.dataset.papBorrar));
      if (await confirmar({ titulo: 'Eliminar para siempre', msg: `Se borra definitivamente la póliza de ${(x && x.asegurado) || '(sin nombre)'}, con sus archivos. No se puede deshacer.`, ok: 'Eliminar para siempre', peligro: true })) {
        try { await api('/api/papelera/borrar', { ids: [Number(pb.dataset.papBorrar)] }); await cargar(); renderConfig(); say('ok', 'Póliza eliminada para siempre.'); } catch (er) { falla(er); }
      }
      return;
    }
    if (e.target.closest('#cfg-pap-vaciar')) {
      if (await confirmar({ titulo: 'Vaciar la papelera', msg: `Se borran para siempre las ${S.papelera.length} pólizas de la papelera, con sus archivos. No se puede deshacer.`, ok: 'Vaciar', peligro: true })) {
        try { await api('/api/papelera/borrar', { todo: true }); await cargar(); renderConfig(); say('ok', 'Papelera vaciada.'); } catch (er) { falla(er); }
      }
      return;
    }
    const ra = e.target.closest('[data-rev-abrir]');
    if (ra) { $('#dlg-config').close(); abrirFicha(Number(ra.dataset.revAbrir)); return; }
    const v = e.target.closest('[data-var]');
    if (v) {
      const ta = $('.tpl-texto', v.closest('.tpl'));
      const a = ta.selectionStart ?? ta.value.length, b = ta.selectionEnd ?? a;
      ta.setRangeText(`{${v.dataset.var}}`, a, b, 'end');
      ta.focus();
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const del = e.target.closest('[data-tpl-del]');
    if (del) {
      const i = Number(del.closest('.tpl').dataset.i);
      if (await confirmar({ titulo: 'Eliminar mensaje', msg: `¿Eliminar el mensaje «${S.config.plantillas[i].nombre}»?`, ok: 'Eliminar', peligro: true })) {
        S.config.plantillas.splice(i, 1);
        if (!S.config.plantillas.some((t) => t.id === S.config.plantilla_pred)) S.config.plantilla_pred = (S.config.plantillas[0] || {}).id || '';
        renderConfig(); cfgGuardar();
      }
      return;
    }
    if (e.target.closest('#cfg-add-tpl')) {
      const id = 'p-' + Math.random().toString(36).slice(2, 8);
      S.config.plantillas.push({ id, nombre: 'Mensaje nuevo', texto: 'Hola {nombre}, ' });
      if (!S.config.plantilla_pred) S.config.plantilla_pred = id;
      S.tplAbiertos.add(id);
      renderConfig(); cfgGuardar();
      const tp = $$('.tpl', body).pop(); if (tp) { tp.scrollIntoView({ block: 'nearest' }); $('.tpl-nombre', tp).focus(); $('.tpl-nombre', tp).select(); }
      return;
    }
    if (e.target.closest('#cfg-reset-tpl')) {
      if (await confirmar({ titulo: 'Volver a los mensajes originales', msg: 'Se reemplazan tus mensajes por los 3 que trae el programa. Los que escribiste se pierden.', ok: 'Reemplazar', peligro: true })) {
        try { const r = await api('/api/config', { config: { restaurar_plantillas: true } }); S.config = r.config; S.tplAbiertos.clear(); renderConfig(); $('#cfg-estado').textContent = 'Guardado ✓'; } catch (er) { falla(er); }
      }
      return;
    }
    if (e.target.closest('#cfg-resp-cambiar')) {
      try {
        const r = await api('/api/respaldo/carpeta', {});
        if (r.carpeta) {
          S.config.respaldo_carpeta = r.carpeta;
          await api('/api/config', { config: { respaldo_carpeta: r.carpeta } });
          S.respaldo = (await api('/api/state')).respaldo;
          renderConfig(); $('#cfg-estado').textContent = 'Guardado ✓';
        }
      } catch (er) { falla(er); }
      return;
    }
    if (e.target.closest('#cfg-resp-abrir')) { try { await api('/api/respaldo/abrir', {}); } catch (er) { falla(er); } return; }
    if (e.target.closest('#cfg-arch-abrir')) { try { await api('/api/adjuntos/carpeta', {}); } catch (er) { falla(er); } return; }
    if (e.target.closest('#cfg-resp-ahora')) {
      const b = e.target.closest('#cfg-resp-ahora'); b.disabled = true; b.textContent = 'Copiando…';
      try { const r = await api('/api/respaldo/ahora', {}); S.respaldo = r.respaldo; say('ok', 'Copia de seguridad hecha.'); }
      catch (er) { falla(er); S.respaldo = (await api('/api/state')).respaldo; }
      renderConfig();
      return;
    }
    if (e.target.closest('#cfg-upd')) { buscarActualizacion(); }
  });
  // renovar y WhatsApp
  $('#fi-renovar').addEventListener('click', () => abrirRenovar(S.fichaId));
  $('#fi-body').addEventListener('click', (e) => {
    if (e.target.closest('[data-wa-ficha]')) abrirWA(S.fichaId);
    const o = e.target.closest('[data-ficha]'); if (o) abrirFicha(Number(o.dataset.ficha));
  });
  $('#form-renovar').addEventListener('submit', confirmarRenovar);
  $('#rv-cancel').addEventListener('click', () => $('#dlg-renovar').close());
  $('#rv-dur').addEventListener('click', (e) => { const b = e.target.closest('[data-meses]'); if (b) rvDuracion(Number(b.dataset.meses)); });
  $('#rv-inicio').addEventListener('input', () => rvDuracion(Number($('#form-renovar').dataset.meses) || 0));
  $('#rv-fin').addEventListener('input', () => rvDuracion(0));
  $('#form-wa').addEventListener('submit', enviarWA);
  $('#wa-cancel').addEventListener('click', () => $('#dlg-wa').close());
  $('#wa-config').addEventListener('click', () => { $('#dlg-wa').close(); abrirConfig('wa'); });
  $('#wa-tpl').addEventListener('click', (e) => { const b = e.target.closest('[data-tpl]'); if (b) { waTpl = b.dataset.tpl; waRender(); waAplicar(); } });
  $('#wa-nombre').addEventListener('input', waAplicar);
  eventosAdjuntos();
}

/* ---------- Actualizaciones ---------- */
function renderUpdate() {
  const u = S.update;
  const b = $('#btn-update');
  b.hidden = !(u && u.disponible);
  if (u && u.disponible) b.textContent = `Hay una versión nueva (${u.version}): actualizar`;
  $('#ver').textContent = S.version ? `Versión ${S.version}` : '';
}
async function actualizar() {
  const u = S.update;
  if (!u || !u.disponible) return;
  const ok = await confirmar({
    titulo: `Actualizar a la versión ${u.version}`,
    msg: `Se descarga la versión nueva (${Math.max(1, Math.round((u.tam || 0) / 1048576))} MB) y el programa se reinicia solo. Tus pólizas y compañías no se tocan.${u.notas ? '\n\nNovedades:\n' + u.notas : ''}`,
    ok: 'Actualizar ahora',
  });
  if (!ok) return;
  say('ok', 'Descargando la actualización… no cierres el programa.', 180000);
  try { const r = await api('/api/update/apply', {}); say('ok', r.mensaje, 60000); } catch (e) { falla(e); }
}
async function buscarActualizacion() {
  say('ok', 'Buscando actualizaciones…', 20000);
  try {
    const r = await api('/api/update/check', {});
    S.update = r.update;
    renderUpdate();
    if (r.update.disponible) say('ok', `Hay una versión nueva: ${r.update.version}. Usá el botón de arriba para instalarla.`);
    else if (r.update.error) say('warn', 'No se pudo comprobar (¿sin internet?). El programa sigue funcionando igual.');
    else say('ok', 'Ya tenés la última versión.');
  } catch (e) { falla(e); }
}

/* ---------- Compañías ---------- */
async function compAgregar(ev) {
  ev.preventDefault();
  const inp = $('#comp-nueva');
  const nombre = inp.value.trim();
  if (!nombre) { inp.focus(); return; }
  try {
    await api('/api/compania', { nombre });
    inp.value = '';
    await cargar();
    say('ok', `Compañía agregada: ${nombre}`);
  } catch (e) { falla(e); }
}
async function compQuitar(nombre) {
  const ok = await confirmar({ titulo: 'Quitar compañía', msg: `¿Quitar «${nombre}» de la lista? Solo se puede si no tiene pólizas cargadas.`, ok: 'Quitar', peligro: true });
  if (!ok) return;
  try { await api('/api/compania/delete', { nombre }); await cargar(); say('ok', `Compañía quitada: ${nombre}`); } catch (e) { falla(e); }
}
let renombrando = null;
function compRenombrar(nombre) {
  renombrando = nombre;
  $('#rn-input').value = nombre;
  $('#rn-err').textContent = '';
  $('#dlg-rename').showModal();
  $('#rn-input').select();
}
async function guardarRenombre(ev) {
  ev.preventDefault();
  const nuevo = $('#rn-input').value.trim();
  if (!nuevo) { $('#rn-err').textContent = 'Escribí un nombre.'; return; }
  try {
    await api('/api/compania/rename', { viejo: renombrando, nuevo });
    if (S.comp && S.comp.toLowerCase() === renombrando.toLowerCase()) S.comp = nuevo;
    $('#dlg-rename').close();
    await cargar();
    say('ok', `Compañía renombrada: ${renombrando} → ${nuevo}`);
  } catch (e) { $('#rn-err').textContent = e.message; }
}

/* ---------- Aviso al abrir ---------- */
function abrirAlertas() {
  const lista = S.polizas.filter((p) => ['porvencer', 'vencida'].includes(p.est.k)).sort((a, b) => a.dias - b.dias);
  if (!lista.length) return;
  const n = lista.length;
  $('#al-sub').textContent = `${n} póliza${n === 1 ? ' vencida o que vence' : 's vencidas o que vencen'} en ${ALERTA} días o menos.`;
  $('#al-list').innerHTML = lista.slice(0, 4).map((p) => `<li class="al-item">
      <span class="st ${p.est.k}">${esc(p.est.t)}</span>
      <div><div class="name">${esc(nombre(p))}</div><div class="meta">${[p.patente, p.compania, p.nro_poliza && 'póliza ' + p.nro_poliza].filter(Boolean).map(esc).join(' · ')}</div></div>
      <span class="num muted">${fmtFecha(p.vig_fin)}</span></li>`).join('');
  const mas = $('#al-mas');
  mas.hidden = n <= 4;
  mas.textContent = `Ver ${n - 4} más`;
  $('#dlg-alertas').showModal();
}

/* ---------- Exportar / importar ---------- */
async function exportar(formato) {
  const filas = S.page === 'anul' ? S.rowsAnul : S.rowsPol;
  if (!filas.length) { say('warn', 'No hay pólizas para exportar con los filtros actuales.'); return; }
  const ext = formato === 'pdf' ? 'pdf' : 'xlsx';
  const sugerido = `polizas_${toISO(hoy()).replaceAll('-', '')}.${ext}`;
  let handle = null;
  if (window.showSaveFilePicker) {
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: sugerido,
        types: [{ description: formato === 'pdf' ? 'PDF' : 'Excel', accept: { [formato === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']: ['.' + ext] } }],
      });
    } catch (e) { if (e.name === 'AbortError') return; handle = null; }
  }
  try {
    say('ok', 'Preparando archivo…', 30000);
    const { blob, name } = await api('/api/export', { formato, ids: filas.map((p) => p.id), vista: S.page === 'anul' ? 'anuladas' : S.vista }, { blob: true });
    if (handle) {
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      say('ok', `${formato === 'pdf' ? 'PDF' : 'Excel'} guardado: ${handle.name}`);
    } else {
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      say('ok', `${formato === 'pdf' ? 'PDF' : 'Excel'} descargado: ${name}`);
    }
  } catch (e) { falla(e); }
}
async function importar(file) {
  if (!file) return;
  try {
    say('ok', 'Importando…', 60000);
    const r = await api('/api/import', await file.arrayBuffer(), { raw: true });
    await cargar();
    say(r.nuevos ? 'ok' : 'warn', `Importación terminada: ${r.nuevos} nueva${r.nuevos === 1 ? '' : 's'}, ${r.duplicados} ya existente${r.duplicados === 1 ? '' : 's'}${r.sin_fecha ? `, ${r.sin_fecha} sin fecha de fin` : ''}.`, 12000);
  } catch (e) { falla(e); }
  $('#file-import').value = '';
}

/* ---------- Menús ---------- */
function ubicarMenu(menu, btn) {
  const r = btn.getBoundingClientRect();
  const top = Math.round(r.bottom + 6);
  menu.style.top = `${top}px`;
  menu.style.maxHeight = `${Math.max(160, innerHeight - top - 12)}px`;
  menu.style.left = `${Math.max(12, Math.round(Math.min(r.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 12)))}px`;
}
function menuMas() {
  const vis = new Set(columnasPol(false).map((c) => c.k));
  $('#menu-mas').innerHTML = `<button type="button" data-mas="importar"><b>Importar desde Excel</b><span>Suma pólizas nuevas sin duplicar</span></button>
    <button type="button" data-mas="actualizar"><b>Buscar actualizaciones</b><span>Necesita internet; el resto del programa no</span></button><hr>
    <p class="menu-title">Columnas de la tabla</p>`
    + COLS.filter((c) => c.k !== 'estado').map((c) => `<label><input type="checkbox" data-col="${c.k}" ${vis.has(c.k) ? 'checked' : ''}><span>${esc(c.t)}</span></label>`).join('')
    + '<p class="menu-note">E-mail, Celular y MIOS aparecen solos cuando tienen datos. Si una columna no entra en la pantalla, se esconde sola.</p>';
}

/* ---------- Eventos ---------- */
function eventos() {
  // navegación
  $$('.nav button').forEach((b) => b.addEventListener('click', () => irA(b.dataset.page)));
  document.addEventListener('click', (e) => { const l = e.target.closest('[data-ir]'); if (l) irA(l.dataset.ir); });
  $('#btn-nueva').addEventListener('click', () => abrirForm());

  // pólizas: vistas, filtros y búsqueda
  $$('#page-polizas .views button').forEach((b) => b.addEventListener('click', () => { S.vista = b.dataset.vista; store.set('vista3', S.vista); render(); }));
  $('#f-comp').addEventListener('change', (e) => { S.comp = e.target.value; render(); });
  $('#f-estado').addEventListener('change', (e) => { S.estado = e.target.value; render(); });
  const limpiar = () => { S.q = ''; $('#q').value = ''; S.estado = ''; S.comp = ''; render(); };
  $('#f-limpiar').addEventListener('click', limpiar);
  const q = $('#q');
  q.addEventListener('input', () => { S.q = q.value; render(); });
  q.addEventListener('keydown', (e) => { if (e.key === 'Escape' && q.value) { q.value = ''; S.q = ''; render(); e.stopPropagation(); } });
  $('#q-clear').addEventListener('click', () => { q.value = ''; S.q = ''; render(); q.focus(); });
  document.addEventListener('keydown', (e) => {
    const modal = document.querySelector('dialog[open]');
    const escribiendo = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    if (modal) return;
    if (((e.ctrlKey || e.metaKey) && ['k', 'f'].includes(e.key.toLowerCase())) || (e.key === '/' && !escribiendo)) { e.preventDefault(); irA('polizas'); q.focus(); q.select(); }
    else if (e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); abrirForm(); }
  });
  $('#empty-pol').addEventListener('click', (e) => {
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'nueva') abrirForm(); else if (a === 'limpiar') limpiar();
  });

  // tablas (delegación) — pólizas y vencimientos
  for (const t of ['pol', 'venc', 'anul']) {
    $('#tbody-' + t).addEventListener('click', (e) => {
      const g = e.target.closest('[data-grp]');
      if (g) {
        const k = g.dataset.grp;
        if (g.getAttribute('aria-expanded') === 'false') { S.cerrados.delete(k); S.abiertos.add(k); } else { S.cerrados.add(k); S.abiertos.delete(k); }
        renderPolizas(contar());
        return;
      }
      const wa = e.target.closest('[data-wa]'); if (wa) { abrirWA(Number(wa.dataset.wa)); return; }
      const rn = e.target.closest('[data-renew]'); if (rn) { abrirRenovar(Number(rn.dataset.renew)); return; }
      const re = e.target.closest('[data-react]'); if (re) { reactivar(Number(re.dataset.react)); return; }
      const ed = e.target.closest('[data-edit]'); if (ed) { abrirForm(Number(ed.dataset.edit)); return; }
      const del = e.target.closest('[data-del]'); if (del) { eliminar(Number(del.dataset.del)); return; }
      const tr = e.target.closest('tr.row');
      if (tr) abrirFicha(Number(tr.dataset.id));
    });
  }
  $('#thead-pol').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sort]'); if (!b) return;
    const k = b.dataset.sort;
    S.sort = S.sort.k === k ? { k, dir: -S.sort.dir } : { k, dir: 1 };
    store.set('sort3', S.sort);
    render();
  });

  // resumen de cartera: tocar un estado filtra la lista
  $$('#kpis .kpi').forEach((b) => b.addEventListener('click', () => { S.estado = S.estado === b.dataset.kpi ? '' : b.dataset.kpi; render(); }));
  // paginadores
  $('#pager-pol-ant').addEventListener('click', () => { PAG.p--; renderPolizas(contar()); });
  $('#pager-pol-sig').addEventListener('click', () => { PAG.p++; renderPolizas(contar()); });
  $('#pager-venc-ant').addEventListener('click', () => { PAG.v--; renderVenc(contar()); });
  $('#pager-venc-sig').addEventListener('click', () => { PAG.v++; renderVenc(contar()); });
  // revisar datos
  $('#rev-body').addEventListener('click', (e) => { const ra = e.target.closest('[data-rev-abrir]'); if (ra) abrirFicha(Number(ra.dataset.revAbrir)); });

  // vencimientos
  $$('#v-views button').forEach((b) => b.addEventListener('click', () => { S.vsub = b.dataset.vsub; S.vsubElegido = true; S.dia = null; render(); }));
  $('#cal-grid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-fecha]'); if (!b) return;
    S.dia = S.dia === b.dataset.fecha ? null : b.dataset.fecha;
    render();
  });
  const mover = (n) => { const t = new Date(S.mes.y, S.mes.m + n, 1); S.mes = { y: t.getFullYear(), m: t.getMonth() }; renderGrafico(); };
  $('#cal-prev').addEventListener('click', () => mover(-1));
  $('#cal-next').addEventListener('click', () => mover(1));
  $('#cal-hoy').addEventListener('click', () => { const t = hoy(); S.mes = { y: t.getFullYear(), m: t.getMonth() }; renderGrafico(); });
  $('#v-dia-x').addEventListener('click', () => { S.dia = null; render(); });

  // compañías
  $('#comp-add').addEventListener('submit', compAgregar);
  $('#comp-list').addEventListener('click', (e) => {
    const v = e.target.closest('[data-comp-ver]'); if (v) { S.comp = v.dataset.compVer; S.q = ''; $('#q').value = ''; S.estado = ''; irA('polizas'); return; }
    const r = e.target.closest('[data-comp-rename]'); if (r) { compRenombrar(r.dataset.compRename); return; }
    const d = e.target.closest('[data-comp-del]'); if (d) compQuitar(d.dataset.compDel);
  });
  $('#form-rename').addEventListener('submit', guardarRenombre);
  $('#rn-cancel').addEventListener('click', () => $('#dlg-rename').close());

  // ficha de lectura
  $('#fi-x').addEventListener('click', () => $('#dlg-ficha').close());
  $('#fi-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) { S.fichaTab = b.dataset.tab; pintarTabs(); $('#fi-body').scrollTop = 0; } });
  $('#pv-x').addEventListener('click', () => $('#dlg-prev').close());
  $('#pv-ant').addEventListener('click', () => { prevI = (prevI - 1 + prevLista.length) % prevLista.length; pintarPrev(); });
  $('#pv-sig').addEventListener('click', () => { prevI = (prevI + 1) % prevLista.length; pintarPrev(); });
  $('#pv-abrir').addEventListener('click', async () => { try { await api('/api/adjuntos/abrir', { id: prevLista[prevI].id }); } catch (er) { falla(er); } });
  $('#pv-carpeta').addEventListener('click', async () => { try { await api('/api/adjuntos/carpeta', { id: prevLista[prevI].id }); } catch (er) { falla(er); } });
  $('#fi-edit').addEventListener('click', () => { const id = S.fichaId; $('#dlg-ficha').close(); abrirForm(id); });
  $('#fi-del').addEventListener('click', () => eliminar(S.fichaId));
  $('#fi-anular').addEventListener('click', () => abrirAnular(S.fichaId));
  $('#fi-react').addEventListener('click', () => reactivar(S.fichaId));
  $('#form-anular').addEventListener('submit', confirmarAnular);
  $('#an-cancel').addEventListener('click', () => $('#dlg-anular').close());
  $('#q-anul').addEventListener('input', (e) => { S.qa = e.target.value; renderAnul(); });
  $('#btn-update').addEventListener('click', actualizar);
  eventosConfig();
  // el botón «Exportar» de Anuladas abre el mismo menú que el de Pólizas
  $('#btn-export').addEventListener('click', () => { S.exportBtn = $('#btn-export'); });
  $('#btn-export-anul').addEventListener('click', () => { S.exportBtn = $('#btn-export-anul'); });

  // formulario
  $('#form').addEventListener('submit', guardarForm);
  $('#form-x').addEventListener('click', cerrarForm);
  $('#form-cancel').addEventListener('click', cerrarForm);
  $('#dlg-form').addEventListener('cancel', (e) => { if (formValores() !== formInicial) { e.preventDefault(); cerrarForm(); } });
  $('#form').addEventListener('focusout', (e) => { const k = e.target.name; if (k && CAMPOS_FORM.includes(k)) validarCampo(k); });
  $('#form').addEventListener('input', (e) => {
    const k = e.target.name;
    if (k === 'patente') e.target.value = e.target.value.toUpperCase();
    if (k === 'vig_fin' || k === 'vig_inicio') { validarCampo(k); pistaVigencia(); }
    if (k === 'email') validarCampo(k);
  });

  // aviso inicial
  $('#al-close').addEventListener('click', () => $('#dlg-alertas').close());
  const verAlertas = () => { S.vsub = 'alertas'; S.vsubElegido = true; S.dia = null; PAG.v = 0; $('#dlg-alertas').close(); irA('venc'); };
  $('#al-ver').addEventListener('click', verAlertas);
  $('#al-mas').addEventListener('click', verAlertas);

  // menús
  [['#btn-export', '#menu-export'], ['#btn-mas', '#menu-mas']].forEach(([b, m]) => {
    const btn = $(b), menu = $(m);
    menu.addEventListener('toggle', (e) => {
      btn.setAttribute('aria-expanded', String(e.newState === 'open'));
      if (e.newState === 'open') ubicarMenu(menu, (m === '#menu-export' && S.exportBtn) || btn);
    });
    if (!('commandForElement' in HTMLButtonElement.prototype)) btn.addEventListener('click', (ev) => { ev.preventDefault(); menu.togglePopover(); });
  });
  $('#menu-mas').addEventListener('beforetoggle', (e) => { if (e.newState === 'open') menuMas(); });
  $('#menu-export').addEventListener('click', (e) => {
    const b = e.target.closest('[data-exp]'); if (!b) return;
    $('#menu-export').hidePopover();
    exportar(b.dataset.exp);
  });
  $('#menu-mas').addEventListener('click', (e) => {
    if (e.target.closest('[data-mas="importar"]')) { $('#menu-mas').hidePopover(); $('#file-import').click(); }
    else if (e.target.closest('[data-mas="actualizar"]')) { $('#menu-mas').hidePopover(); buscarActualizacion(); }
  });
  $('#menu-mas').addEventListener('change', (e) => {
    const c = e.target.closest('[data-col]'); if (!c) return;
    const actual = Object.fromEntries(COLS.filter((x) => x.k !== 'estado').map((x) => [x.k, columnasPol(false).some((v) => v.k === x.k)]));
    actual[c.dataset.col] = c.checked;
    S.cols = actual;
    store.set('cols3', S.cols);
    render();
  });
  $('#file-import').addEventListener('change', (e) => importar(e.target.files[0]));

  // ancho útil de la tabla (para que los encabezados de grupo no se corran al desplazar)
  const wrap = $('#wrap-pol');
  let pendiente = null;
  const medir = () => {
    wrap.style.setProperty('--wrap-w', `${wrap.clientWidth}px`);
    if (Math.abs(wrap.clientWidth - S.anchoPol) < 8) return;
    S.anchoPol = wrap.clientWidth;
    clearTimeout(pendiente);
    pendiente = setTimeout(() => { if (S.cargado && S.page === 'polizas') renderPolizas(contar()); }, 120);
  };
  new ResizeObserver(medir).observe(wrap);
  medir();

  // conexión con el programa: permite cerrarlo solo al cerrar la ventana
  let fallos = 0;
  const ping = () => fetch('/api/ping', { method: 'POST', headers: { 'X-Token': TOKEN } })
    .then(() => { fallos = 0; })
    .catch(() => { if (++fallos === 3) say('err', 'Se perdió la conexión con el programa. Cerralo y volvé a abrirlo.'); });
  ping();
  setInterval(ping, 10000);
  // la comprobación de actualizaciones corre en segundo plano en el programa; se consulta un rato después de abrir
  for (const ms of [9000, 45000]) setTimeout(async () => { try { const s = await api('/api/state'); S.update = s.update; renderUpdate(); } catch { /* sin conexión */ } }, ms);
  addEventListener('pagehide', () => { try { fetch('/api/bye', { method: 'POST', keepalive: true, headers: { 'X-Token': TOKEN } }); } catch { /* cierre */ } });
}

/* ---------- Inicio ---------- */
(async function init() {
  eventos();
  eventosRail();
  aplicarRail();
  irA('polizas');
  try {
    await cargar();
    if (S.respaldo && S.respaldo.error) say('warn', S.respaldo.error, 25000);
    let yaAvisado = false;
    try { yaAvisado = sessionStorage.getItem('gs.aviso') === '1'; sessionStorage.setItem('gs.aviso', '1'); } catch { /* sin storage */ }
    if (!yaAvisado) abrirAlertas();
  } catch (e) {
    say('err', 'No se pudieron cargar los datos: ' + e.message);
  }
})();
