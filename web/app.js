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
  { k: 'contacto', t: 'Contacto' },
];
const POR_DEFECTO_OCULTAS = ['vig_inicio'];          // se pueden mostrar desde «Más opciones»
const AUTO_SI_HAY_DATOS = ['email', 'celular', 'mios'];
const GRUPOS_CERRADOS = new Set(['b:90', 'b:mas']);

/* ---------- Estado ---------- */
const S = {
  page: 'polizas',
  polizas: [], companias: [], dbPath: '',
  vista: store.get('vista3', 'todas'),
  q: '', estado: '', comp: '',
  sort: store.get('sort3', { k: 'dias', dir: 1 }),
  vsub: 'alertas', dia: null, mes: null,
  abiertos: new Set(), cerrados: new Set(GRUPOS_CERRADOS),
  cols: store.get('cols3', null),
  editId: null, fichaId: null,
  rowsPol: [], cargado: false,
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
  S.polizas = j.polizas.map((p) => {
    const dias = diasHasta(p.vig_fin);
    return { ...p, dias, est: estado(dias), _q: norm(`${p.patente} ${p.asegurado} ${p.nro_poliza}`) };
  });
  if (S.comp && !S.companias.some((c) => c.toLowerCase() === S.comp.toLowerCase())) S.comp = '';
  S.cargado = true;
  render();
}

/* ---------- Mensajes (pie de pantalla: nunca tapan el contenido) ---------- */
let msgTimer = null;
const mensajeBase = () => { const n = S.polizas.length; return `${n} póliza${n === 1 ? '' : 's'} guardadas en este equipo`; };
function say(tipo, texto, ms = 7000) {
  const m = $('#msg');
  clearTimeout(msgTimer);
  m.className = tipo;
  m.textContent = texto;
  msgTimer = setTimeout(() => { m.className = ''; m.textContent = mensajeBase(); }, tipo === 'err' ? 20000 : ms);
}
const falla = (e) => say('err', e.message || String(e));

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
  const q = norm(S.q);
  return S.polizas.filter((p) => {
    if (q && !p._q.includes(q)) return false;
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
function columnasPol() {
  const vacia = (k) => !S.polizas.some((p) => p[k]);
  return COLS.filter((c) => {
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
  $$('.alerta-dias').forEach((e) => { e.textContent = ALERTA; });
  $('#dl-comp').innerHTML = S.companias.map((n) => `<option value="${esc(n)}">`).join('');
  if (S.page === 'polizas') renderPolizas(c);
  else if (S.page === 'venc') renderVenc(c);
  else renderComp();
  const m = $('#msg');
  if (!m.className && !m.textContent) m.textContent = mensajeBase();
  else if (!m.className) m.textContent = mensajeBase();
}

function irA(page) {
  S.page = page;
  ['polizas', 'venc', 'comp'].forEach((p) => { $('#page-' + p).hidden = p !== page; });
  $$('.nav button').forEach((b) => (b.dataset.page === page ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  if (page === 'venc' && !S.vsubElegido) S.vsub = contar().alertas ? 'alertas' : 'prox30';
  render();
}

/* ---------- Celdas ---------- */
function celda(p, k) {
  const vacio = '<span class="muted">—</span>';
  switch (k) {
    case 'estado': return `<span class="st ${p.est.k}">${esc(p.est.t)}</span>`;
    case 'asegurado': return `<span class="name">${esc(p.asegurado)}</span>`;
    case 'patente': return p.patente ? `<span class="plate">${esc(p.patente)}</span>` : vacio;
    case 'vig_inicio': case 'vig_fin': return p[k] ? `<span class="num">${fmtFecha(p[k])}</span>` : vacio;
    case 'mios': return p.mios ? `<span class="tag">${esc(p.mios)}</span>` : vacio;
    case 'nro_poliza': return p.nro_poliza ? `<span class="num">${esc(p.nro_poliza)}</span>` : vacio;
    case 'celular': return p.celular ? `<span class="num">${esc(p.celular)}</span>` : vacio;
    case 'contacto': { const v = p.celular || p.email; return v ? esc(v) : vacio; }
    default: return p[k] ? esc(p[k]) : vacio;
  }
}
function filaHTML(p, cols) {
  const tds = cols.map((c) => `<td data-label="${esc(c.t)}">${celda(p, c.k)}</td>`).join('');
  return `<tr class="row" data-id="${p.id}">${tds}
    <td class="c-act"><span class="acts">
      <button type="button" class="icon-btn" data-edit="${p.id}" aria-label="Editar la póliza de ${esc(p.asegurado)}">${icon('pencil')}</button>
      <button type="button" class="icon-btn danger" data-del="${p.id}" aria-label="Eliminar la póliza de ${esc(p.asegurado)}">${icon('trash')}</button>
    </span></td></tr>`;
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

function renderPolizas(c) {
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

  const n = $('#notice');
  n.hidden = !c.alertas;
  if (c.alertas) $('#notice-t').textContent = `${c.alertas} requieren atención`;

  const cols = columnasPol();
  const agrupada = S.vista !== 'todas';
  $('#thead-pol').innerHTML = encabezado(cols, S.vista !== 'venc');
  let html;
  if (!agrupada) {
    html = S.rowsPol.map((p) => filaHTML(p, cols)).join('');
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
  } else {
    e.innerHTML = '<h3>Nada para mostrar</h3><p>No hay pólizas en esta categoría.</p>';
  }
}

/* ---------- Sección: Vencimientos ---------- */
function renderVenc(c) {
  $('#vn-alertas').textContent = c.alertas;
  $('#vn-vencida').textContent = c.vencida;
  $('#vn-porvencer').textContent = c.porvencer;
  $('#vn-prox30').textContent = c.prox30;
  $$('#v-views button').forEach((b) => b.setAttribute('aria-pressed', String(S.dia === null && b.dataset.vsub === S.vsub)));
  const x = $('#v-dia-x');
  x.hidden = S.dia === null;
  if (S.dia !== null) { const [yy, mm, d2] = S.dia.split('-').map(Number); x.textContent = `Mostrando solo el ${d2} de ${MESES_L[mm - 1]} · Quitar`; }

  const rows = filasVenc();
  const cols = VENC_COLS.filter((cc) => cc.k !== 'contacto' || rows.some((p) => p.celular || p.email));
  $('#thead-venc').innerHTML = encabezado(cols, false);
  $('#tbody-venc').innerHTML = rows.map((p) => filaHTML(p, cols)).join('');
  vacio('venc', rows.length);
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

/* ---------- Sección: Compañías ---------- */
function renderComp() {
  const cuenta = {};
  S.polizas.forEach((p) => { const k = (p.compania || '').toLowerCase(); cuenta[k] = (cuenta[k] || 0) + 1; });
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

/* ---------- Ficha (solo lectura) ---------- */
function abrirFicha(id) {
  const p = S.polizas.find((x) => x.id === id);
  if (!p) return;
  S.fichaId = id;
  $('#fi-estado').innerHTML = `<span class="st ${p.est.k}">${esc(p.est.t)}${p.vig_fin ? ` · ${p.est.k === 'vencida' ? 'venció' : 'vence'} el ${fmtFecha(p.vig_fin)}` : ''}</span>`;
  $('#fi-nombre').textContent = p.asegurado;
  $('#fi-sub').textContent = [p.nro_poliza && `Póliza ${p.nro_poliza}`, p.compania].filter(Boolean).join(' · ');
  const f = (t, v, cls = '') => `<div><dt>${t}</dt><dd class="${v ? cls : 'vacio'}">${v ? v : 'Sin cargar'}</dd></div>`;
  const mail = p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : '';
  $('#fi-body').innerHTML = `
    <section class="fi-sec"><h3>Vehículo</h3><dl class="fi-grid">
      ${f('Patente', p.patente && esc(p.patente), 'mono')}${f('Tipo', esc(p.tipo))}${f('Marca', esc(p.marca))}${f('Modelo', esc(p.modelo))}</dl></section>
    <section class="fi-sec"><h3>Contacto</h3><dl class="fi-grid">
      ${f('Celular', esc(p.celular), 'mono')}${f('E-mail', mail)}</dl></section>
    <section class="fi-sec"><h3>Cobertura</h3><dl class="fi-grid">
      ${f('Compañía', esc(p.compania))}${f('N° de póliza', esc(p.nro_poliza), 'mono')}
      ${f('Inicio de vigencia', fmtFecha(p.vig_inicio), 'mono')}${f('Fin de vigencia', fmtFecha(p.vig_fin), 'mono')}
      ${p.mios ? f('MIOS', esc(p.mios)) : ''}</dl></section>`;
  $('#dlg-ficha').showModal();
}

/* ---------- Formulario ---------- */
const CAMPOS_FORM = ['nro_poliza', 'asegurado', 'patente', 'tipo', 'marca', 'modelo', 'email', 'celular', 'compania', 'vig_inicio', 'vig_fin', 'mios'];
const REQ = { nro_poliza: 'Falta el N° de póliza.', asegurado: 'Falta el nombre del asegurado.', compania: 'Elegí o escribí la compañía.', vig_inicio: 'Elegí la fecha de inicio.', vig_fin: 'Elegí la fecha de fin.' };
const FM = () => $('#form').elements;
let formInicial = '';
const formValores = () => JSON.stringify(CAMPOS_FORM.map((k) => FM()[k].value));

function setErr(k, msg) {
  const el = FM()[k];
  const out = document.getElementById('e-' + k);
  if (out) out.textContent = msg;
  if (msg) { el.setAttribute('aria-invalid', 'true'); if (out) el.setAttribute('aria-describedby', out.id); }
  else { el.removeAttribute('aria-invalid'); el.removeAttribute('aria-describedby'); }
}
function validarCampo(k) {
  const el = FM()[k];
  const v = el.value.trim();
  if (REQ[k] && !v) { setErr(k, REQ[k]); return false; }
  if (k === 'email' && v && !el.checkValidity()) { setErr(k, 'Revisá el e-mail: parece incompleto.'); return false; }
  if (k === 'vig_fin' && v && FM().vig_inicio.value && v < FM().vig_inicio.value) { setErr(k, 'No puede ser anterior al inicio.'); return false; }
  setErr(k, '');
  return true;
}
function pistaVigencia() {
  const h = $('#vig-hint');
  const v = FM().vig_fin.value;
  if (!v) { h.textContent = ''; h.className = 'vig-hint'; return; }
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
  if (!p) {
    const t = hoy();
    FM().vig_inicio.value = toISO(t);
    const fin = new Date(t.getFullYear() + 1, t.getMonth(), t.getDate());
    if (fin.getMonth() !== t.getMonth()) fin.setDate(0);
    FM().vig_fin.value = toISO(fin);
  }
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
  const okAll = CAMPOS_FORM.map(validarCampo).every(Boolean);
  if (!okAll) {
    $('#form-err').textContent = 'Revisá los campos marcados.';
    const primero = CAMPOS_FORM.find((k) => FM()[k].getAttribute('aria-invalid') === 'true');
    if (primero) FM()[primero].focus();
    return;
  }
  $('#form-err').textContent = '';
  const datos = Object.fromEntries(CAMPOS_FORM.map((k) => [k, FM()[k].value.trim()]));
  const btn = $('#form-save');
  btn.disabled = true;
  try {
    const nueva = !S.editId;
    await api('/api/poliza', { id: S.editId, datos });
    formInicial = formValores();
    $('#dlg-form').close();
    await cargar();
    say('ok', `${nueva ? 'Póliza creada' : 'Póliza actualizada'}: ${datos.asegurado} · ${datos.compania}`);
  } catch (e) {
    $('#form-err').textContent = e.message;
  } finally {
    btn.disabled = false;
  }
}

/* ---------- Eliminar ---------- */
async function eliminar(id) {
  const p = S.polizas.find((x) => x.id === id);
  if (!p) return;
  const ok = await confirmar({
    titulo: 'Eliminar póliza',
    msg: `Vas a eliminar la póliza ${p.nro_poliza || '(sin número)'} de ${p.asegurado}. Esta acción no se puede deshacer.`,
    ok: 'Eliminar', peligro: true,
  });
  if (!ok) return;
  try {
    await api('/api/polizas/delete', { ids: [id] });
    if ($('#dlg-ficha').open) $('#dlg-ficha').close();
    await cargar();
    say('ok', 'Póliza eliminada.');
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
  $('#al-list').innerHTML = lista.slice(0, 40).map((p) => `<li class="al-item">
      <span class="st ${p.est.k}">${esc(p.est.t)}</span>
      <div><div class="name">${esc(p.asegurado)}</div><div class="meta">${[p.patente, p.compania, p.nro_poliza && 'póliza ' + p.nro_poliza].filter(Boolean).map(esc).join(' · ')}</div></div>
      <span class="num muted">${fmtFecha(p.vig_fin)}</span></li>`).join('')
    + (n > 40 ? `<li class="al-item"><span></span><span class="muted">… y ${n - 40} más en Vencimientos.</span><span></span></li>` : '');
  $('#dlg-alertas').showModal();
}

/* ---------- Exportar / importar ---------- */
async function exportar(formato) {
  if (!S.rowsPol.length) { say('warn', 'No hay pólizas para exportar con los filtros actuales.'); return; }
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
    const { blob, name } = await api('/api/export', { formato, ids: S.rowsPol.map((p) => p.id), vista: S.vista }, { blob: true });
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
  const vis = new Set(columnasPol().map((c) => c.k));
  $('#menu-mas').innerHTML = `<button type="button" data-mas="importar"><b>Importar desde Excel</b><span>Suma pólizas nuevas sin duplicar</span></button><hr>
    <p class="menu-title">Columnas de la tabla</p>`
    + COLS.filter((c) => c.k !== 'estado').map((c) => `<label><input type="checkbox" data-col="${c.k}" ${vis.has(c.k) ? 'checked' : ''}><span>${esc(c.t)}</span></label>`).join('')
    + '<p class="menu-note">E-mail, Celular y MIOS aparecen solos cuando tienen datos.</p>';
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
  for (const t of ['pol', 'venc']) {
    $('#tbody-' + t).addEventListener('click', (e) => {
      const g = e.target.closest('[data-grp]');
      if (g) {
        const k = g.dataset.grp;
        if (g.getAttribute('aria-expanded') === 'false') { S.cerrados.delete(k); S.abiertos.add(k); } else { S.cerrados.add(k); S.abiertos.delete(k); }
        renderPolizas(contar());
        return;
      }
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
  $('#fi-edit').addEventListener('click', () => { const id = S.fichaId; $('#dlg-ficha').close(); abrirForm(id); });
  $('#fi-del').addEventListener('click', () => eliminar(S.fichaId));

  // formulario
  $('#form').addEventListener('submit', guardarForm);
  $('#form-x').addEventListener('click', cerrarForm);
  $('#form-cancel').addEventListener('click', cerrarForm);
  $('#dlg-form').addEventListener('cancel', (e) => { if (formValores() !== formInicial) { e.preventDefault(); cerrarForm(); } });
  $('#form').addEventListener('focusout', (e) => { const k = e.target.name; if (k && CAMPOS_FORM.includes(k) && (e.target.value || e.target.getAttribute('aria-invalid'))) validarCampo(k); });
  $('#form').addEventListener('input', (e) => {
    const k = e.target.name;
    if (k === 'patente') e.target.value = e.target.value.toUpperCase();
    if (e.target.getAttribute('aria-invalid') === 'true') validarCampo(k);
    if (k === 'vig_fin' || k === 'vig_inicio') pistaVigencia();
  });

  // aviso inicial
  $('#al-close').addEventListener('click', () => $('#dlg-alertas').close());
  $('#al-ver').addEventListener('click', () => { S.vsub = 'alertas'; S.vsubElegido = true; S.dia = null; $('#dlg-alertas').close(); irA('venc'); });

  // menús
  [['#btn-export', '#menu-export'], ['#btn-mas', '#menu-mas']].forEach(([b, m]) => {
    const btn = $(b), menu = $(m);
    menu.addEventListener('toggle', (e) => {
      btn.setAttribute('aria-expanded', String(e.newState === 'open'));
      if (e.newState === 'open') ubicarMenu(menu, btn);
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
  });
  $('#menu-mas').addEventListener('change', (e) => {
    const c = e.target.closest('[data-col]'); if (!c) return;
    const actual = Object.fromEntries(COLS.filter((x) => x.k !== 'estado').map((x) => [x.k, columnasPol().some((v) => v.k === x.k)]));
    actual[c.dataset.col] = c.checked;
    S.cols = actual;
    store.set('cols3', S.cols);
    render();
  });
  $('#file-import').addEventListener('change', (e) => importar(e.target.files[0]));

  // ancho útil de la tabla (para que los encabezados de grupo no se corran al desplazar)
  const wrap = $('#wrap-pol');
  const medir = () => wrap.style.setProperty('--wrap-w', `${wrap.clientWidth}px`);
  new ResizeObserver(medir).observe(wrap);
  medir();

  // conexión con el programa: permite cerrarlo solo al cerrar la ventana
  let fallos = 0;
  const ping = () => fetch('/api/ping', { method: 'POST', headers: { 'X-Token': TOKEN } })
    .then(() => { fallos = 0; })
    .catch(() => { if (++fallos === 3) say('err', 'Se perdió la conexión con el programa. Cerralo y volvé a abrirlo.'); });
  ping();
  setInterval(ping, 10000);
  addEventListener('pagehide', () => { try { fetch('/api/bye', { method: 'POST', keepalive: true, headers: { 'X-Token': TOKEN } }); } catch { /* cierre */ } });
}

/* ---------- Inicio ---------- */
(async function init() {
  eventos();
  irA('polizas');
  try {
    await cargar();
    let yaAvisado = false;
    try { yaAvisado = sessionStorage.getItem('gs.aviso') === '1'; sessionStorage.setItem('gs.aviso', '1'); } catch { /* sin storage */ }
    if (!yaAvisado) abrirAlertas();
  } catch (e) {
    say('err', 'No se pudieron cargar los datos: ' + e.message);
  }
})();
