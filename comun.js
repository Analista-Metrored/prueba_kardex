/* ============================================================
   Kardex Demo — base común de la entrega a Compras.
   Todo lo que comparten las cinco pantallas: cálculos del kardex,
   ayudas contextuales, navegación y hoja de validación.
   Funciona sin internet: no usa ninguna librería externa.
   ============================================================ */
(function (w) {

  const D = w.KARDEX_DATOS || { centros: [], catalogo: {}, movimientos: {}, meses: [] };

  const CLAVE_MOVS = "kx_entrega_movs_v1";   // lo que se escriba probando el prototipo
  const CLAVE_VAL  = "kx_entrega_valida_v1"; // las respuestas de la validación
  const CLAVE_AY   = "kx_entrega_ayudas";    // si el modo ayuda está encendido

  const CENTRO_DEMO = "CM PARAISO";
  const MES_DEMO = { anio: 2026, mes: 8, nombre: "AGOSTO" };
  const RESP_DEMO = "Gabriel Mora";

  const CATS = ["SUMINISTROS", "MEDICINA", "ENDOSCOPIA", "LIMPIEZA", "OFICINA", "TONER"];
  const ICONO = {
    SUMINISTROS: "🩹", MEDICINA: "💊", ENDOSCOPIA: "🔬",
    LIMPIEZA: "🧼", OFICINA: "📎", TONER: "🖨️"
  };
  const HOJA_EXCEL = {
    SUMINISTROS: "SUMINISTROS", MEDICINA: "MEDICINA", ENDOSCOPIA: "ENDOSCOPIA",
    LIMPIEZA: "LIMPIEZA", OFICINA: "KARDEX OFICINA", TONER: "TONER"
  };

  /* ---------- utilidades ---------- */
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const n0 = x => (x == null || x === "" || isNaN(x)) ? 0 : Number(x);
  const fmt = x => n0(x).toLocaleString("es-EC", { maximumFractionDigits: 2 });
  const pad = n => String(n).padStart(2, "0");
  const fecha = (a, m, d) => `${a}-${pad(m)}-${pad(d)}`;
  const diasDelMes = (a, m) => new Date(a, m, 0).getDate();
  const uid = () => "m" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  const norm = s => String(s || "").toUpperCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "");
  const hoyTexto = () => new Date().toLocaleDateString("es-EC", { day: "2-digit", month: "long", year: "numeric" });

  function toast(msg) {
    let t = document.getElementById("kxToast");
    if (!t) { t = document.createElement("div"); t.id = "kxToast"; t.className = "toast"; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("show");
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove("show"), 2600);
  }

  /* ---------- catálogo oficial ---------- */
  function catalogo(cat) { return (D.catalogo && D.catalogo[cat]) || []; }
  function totalProductos() { return CATS.reduce((s, c) => s + catalogo(c).length, 0); }
  /* Busca el producto en el catálogo oficial. Primero por nombre exacto y, si no
     aparece, ignorando mayúsculas y tildes: en los archivos el mismo producto se
     escribe a veces "Fentanilo" y a veces "FENTANILO". */
  function delCatalogo(cat, prod) {
    const lista = catalogo(cat);
    let f = lista.find(x => x.p === prod);
    if (!f) { const n = norm(prod); f = lista.find(x => norm(x.p) === n); }
    return f || null;
  }
  function unidadDe(cat, prod) {
    const f = delCatalogo(cat, prod);
    return f ? (f.u || "") : "";
  }

  /* ---------- movimientos reales de ejemplo (kardex de agosto) ---------- */
  let _base = null;
  function movimientosBase() {
    if (_base) return _base;
    const out = [];
    const src = D.movimientos || {};
    Object.keys(src).forEach(cat => {
      src[cat].forEach(it => {
        // La unidad que manda es la del catálogo oficial actualizado, porque es la
        // que se está validando. Si ahí no hay unidad, se muestra vacía a propósito:
        // esconder el hueco con un "UNIDAD" inventado sería ocultar el problema.
        const cp = delCatalogo(cat, it.p);
        const com = {
          centro: CENTRO_DEMO, categoria: cat, producto: cp ? cp.p : it.p,
          unidad: cp ? (cp.u || "") : "", responsable: RESP_DEMO, origen: "excel"
        };
        if (it.ini) out.push(Object.assign({
          id: uid(), tipo: "INICIAL", fecha: fecha(MES_DEMO.anio, MES_DEMO.mes, 1),
          cantidad: it.ini, obs: "Saldo inicial del mes"
        }, com));
        if (it.ing) out.push(Object.assign({
          id: uid(), tipo: "INGRESO", fecha: fecha(MES_DEMO.anio, MES_DEMO.mes, 1),
          cantidad: it.ing, obs: "Ingreso de bodega central"
        }, com));
        Object.keys(it.d || {}).forEach(d => out.push(Object.assign({
          id: uid(), tipo: "EGRESO", fecha: fecha(MES_DEMO.anio, MES_DEMO.mes, +d),
          cantidad: it.d[d], obs: ""
        }, com)));
      });
    });
    _base = out;
    return out;
  }

  /* ---------- lo que se captura mientras se prueba ---------- */
  function leerLocal() {
    try { return JSON.parse(localStorage.getItem(CLAVE_MOVS)) || []; } catch (e) { return []; }
  }
  function guardarLocal(arr) { try { localStorage.setItem(CLAVE_MOVS, JSON.stringify(arr)); } catch (e) { } }
  function agregar(movs) {
    const arr = leerLocal();
    (Array.isArray(movs) ? movs : [movs]).forEach(m => {
      arr.push(Object.assign({ id: uid(), origen: "captura", registrado: new Date().toISOString() }, m));
    });
    guardarLocal(arr);
    return arr.length;
  }
  function borrarLocal() { localStorage.removeItem(CLAVE_MOVS); }
  function todos() { return movimientosBase().concat(leerLocal()); }

  /* ---------- el cálculo del kardex ----------
     Una fila por producto con exactamente las columnas del Excel:
     saldo inicial, ingreso, consumo de cada día, egreso y saldo final. */
  function kardex({ centro, categoria, anio, mes, movs } = {}) {
    anio = anio || MES_DEMO.anio; mes = mes || MES_DEMO.mes;
    const pre = `${anio}-${pad(mes)}-`;
    const filas = {};
    (movs || todos()).forEach(m => {
      if (centro && m.centro !== centro) return;
      if (categoria && m.categoria !== categoria) return;
      if (String(m.fecha || "").slice(0, 8) !== pre) return;
      const k = m.categoria + "||" + m.producto;
      const f = filas[k] || (filas[k] = {
        categoria: m.categoria, producto: m.producto, unidad: m.unidad || "",
        ini: 0, ing: 0, ajuste: 0, dias: {}, egreso: 0, movs: 0
      });
      f.movs++;
      const d = +String(m.fecha).slice(8, 10);
      const c = n0(m.cantidad);
      if (m.tipo === "INICIAL") f.ini += c;
      else if (m.tipo === "INGRESO") f.ing += c;
      else if (m.tipo === "AJUSTE") f.ajuste += c;
      else { f.dias[d] = (f.dias[d] || 0) + c; f.egreso += c; }
    });
    return Object.values(filas).map(f => {
      f.saldo = f.ini + f.ing + f.ajuste - f.egreso;
      const diasConMov = Object.keys(f.dias).length;
      f.promedio = diasConMov ? f.egreso / diasConMov : 0;
      f.cobertura = f.promedio > 0 ? f.saldo / f.promedio : (f.saldo > 0 ? 999 : 0);
      f.estado = estadoDe(f);
      return f;
    }).sort((a, b) => a.producto.localeCompare(b.producto, "es"));
  }

  function estadoDe(f) {
    if (f.saldo <= 0 && (f.egreso > 0 || f.ini > 0 || f.ing > 0)) return "agotado";
    if (f.egreso === 0 && f.saldo === 0) return "sinmov";
    if (f.cobertura < 5) return "critico";
    if (f.cobertura < 12) return "bajo";
    return "ok";
  }

  /* ---------- exportar a Excel (archivo .csv, se abre con doble clic) ---------- */
  function csvCampo(x) {
    x = String(x == null ? "" : x);
    return /[",\r\n;]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x;
  }
  function descargarCSV(nombre, filas) {
    const txt = filas.map(f => f.map(csvCampo).join(";")).join("\r\n");
    const blob = new Blob(["﻿" + txt], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 800);
    toast("Archivo descargado: " + nombre);
  }

  /* ============================================================
     AYUDAS CONTEXTUALES
     Cada cosa de la pantalla puede llevar un signo ? al lado.
     Con el interruptor "Ayudas a la vista" encendido, todos los
     textos se muestran abiertos y ya no hay que hacer clic.
     ============================================================ */
  function ay(titulo, texto, opts) {
    opts = opts || {};
    const cls = "ay-wrap" + (opts.bloque === false ? "" : " bloque") + (opts.der ? " der" : "");
    return `<span class="${cls}"><button class="ay" type="button" aria-label="Ayuda">?</button>` +
      `<span class="ay-txt"><b class="tt">${esc(titulo)}</b>${texto}</span></span>`;
  }
  function ayLinea(titulo, texto) { return ay(titulo, texto, { bloque: false }); }

  /* En las páginas escritas a mano las ayudas se marcan así:
       <i class="ayu" data-t="Título de la ayuda">Texto explicativo…</i>
     y aquí se convierten en el signo ? con su globo. */
  function expandirAyudas(raiz) {
    (raiz || document).querySelectorAll("i.ayu[data-t]").forEach(el => {
      const span = document.createElement("span");
      span.className = "ay-wrap" + (el.hasAttribute("data-linea") ? "" : " bloque") +
        (el.hasAttribute("data-der") ? " der" : "");
      span.innerHTML = `<button class="ay" type="button" aria-label="Ayuda">?</button>` +
        `<span class="ay-txt"><b class="tt">${esc(el.dataset.t)}</b>${el.innerHTML}</span>`;
      el.replaceWith(span);
    });
  }

  function modoAyuda(on) {
    document.body.classList.toggle("modo-ayuda", !!on);
    try { localStorage.setItem(CLAVE_AY, on ? "1" : "0"); } catch (e) { }
    const c = document.getElementById("swAyuda");
    if (c) c.checked = !!on;
  }
  function modoAyudaGuardado() {
    try { return localStorage.getItem(CLAVE_AY) !== "0"; } catch (e) { return true; }
  }

  document.addEventListener("click", e => {
    const b = e.target.closest("button.ay");
    document.querySelectorAll(".ay-wrap.abierta").forEach(x => {
      if (!b || x !== b.parentNode) x.classList.remove("abierta");
    });
    if (b) { b.parentNode.classList.toggle("abierta"); e.preventDefault(); }
  });

  /* ============================================================
     NAVEGACIÓN Y CABECERA
     ============================================================ */
  const PASOS = [
    { n: 0, href: "index.html",            t: "Inicio" },
    { n: 1, href: "1-ingreso.html",        t: "Registro diario" },
    { n: 2, href: "2-kardex-mensual.html", t: "Documento del mes" },
    { n: 3, href: "3-catalogo.html",       t: "Productos y unidades" },
    { n: 4, href: "4-matriz-pedido.html",  t: "Matriz de pedido" },
    { n: 5, href: "5-validacion.html",     t: "Respuestas" }
  ];

  function barra({ titulo, sub, etiqueta }) {
    return `<header class="top"><div class="top-in">
      <div class="marca">
        <div class="glifo">KX</div>
        <div>
          <h1>${esc(titulo)}</h1>
          <div class="sub">${esc(sub || "Kardex digital de insumos · Red Médica Demo")}</div>
        </div>
      </div>
      <div class="der">
        ${etiqueta ? `<span class="tag-prop">${esc(etiqueta)}</span>` : ""}
        <label class="sw" title="Muestra o esconde las explicaciones de cada parte de la pantalla">
          <input type="checkbox" id="swAyuda" onchange="KX.modoAyuda(this.checked)"> Ayudas a la vista
        </label>
      </div>
    </div></header>`;
  }

  function nav(activo) {
    const items = PASOS.map(p => {
      const act = p.n === activo ? " act" : "";
      return `<a class="paso${act}" href="${p.href}"><span class="nro">${p.n === 0 ? "★" : p.n}</span>${esc(p.t)}</a>`;
    }).join("");
    const r = valResumen();
    return `<nav class="pasos no-print"><div class="pasos-in">${items}
      <span class="sep"></span>
      <span class="avance" id="avanceVal">Validación: ${r.resp} de ${r.total} puntos respondidos</span>
    </div></nav>`;
  }

  /* Monta cabecera + navegación + interruptor de ayudas de una sola vez. */
  function montar(cfg) {
    const c = document.getElementById("cab");
    if (c) c.innerHTML = barra(cfg) + nav(cfg.paso);
    modoAyuda(modoAyudaGuardado());
    const listo = () => { expandirAyudas(); pintarValidacion(); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", listo);
    else listo();
  }

  /* ============================================================
     PANEL "¿QUÉ ES ESTA PANTALLA?"
     ============================================================ */
  function panelPantalla(cfg) {
    const id = "guia_" + (cfg.id || "x");
    let abierta = true;
    try { const v = localStorage.getItem(id); if (v === "0") abierta = false; } catch (e) { }

    const items = (cfg.enPantalla || []).map((it, i) =>
      `<div class="guia-item"><span class="pt">${i + 1}</span>
        <div class="tx"><b>${esc(it.q)}</b><span>${it.d}</span></div></div>`).join("");
    const pasos = (cfg.probar || []).map(p => `<li>${p}</li>`).join("");
    const sirve = (cfg.sirve || []).map(t => `<li>${t}</li>`).join("");

    return `<div class="guia${abierta ? " abierta" : ""}" id="${id}">
      <div class="guia-h" onclick="KX.toggleGuia('${id}')">
        <span class="ic">💡</span>
        <div class="tt"><b>¿Qué es esta pantalla y para qué sirve?</b><small>${esc(cfg.resumen)}</small></div>
        <span class="chev">▼</span>
      </div>
      <div class="guia-b">
        <div class="guia-cols">
          <div class="guia-bloque">
            <h5>De qué se trata</h5>
            <p>${cfg.queEs}</p>
            <p><b>¿Quién la usa?</b> ${esc(cfg.quien)}</p>
            <p><b>¿Cada cuánto?</b> ${esc(cfg.cuando)}</p>
          </div>
          <div class="guia-bloque">
            <h5>Qué está viendo en pantalla</h5>
            <div class="guia-items">${items}</div>
          </div>
          <div class="guia-bloque">
            <h5>Pruébelo usted mismo</h5>
            <ol class="guia-pasos">${pasos}</ol>
            ${sirve ? `<h5 style="margin-top:14px">Para qué sirve esta parte</h5><ul class="lista-v">${sirve}</ul>` : ""}
          </div>
        </div>
        <div class="guia-pie">
          <span>📌 Los números que ve son reales: kardex de CM Paraíso, agosto 2026. Escribir aquí no afecta a ningún sistema.</span>
          <span style="flex:1"></span>
          <a href="glosario.html">📖 Glosario de términos</a>
          <a href="5-validacion.html">✅ Hoja de validación</a>
        </div>
      </div>
    </div>`;
  }
  function toggleGuia(id) {
    const e = document.getElementById(id); if (!e) return;
    e.classList.toggle("abierta");
    try { localStorage.setItem(id, e.classList.contains("abierta") ? "1" : "0"); } catch (err) { }
  }

  /* ============================================================
     HOJA DE VALIDACIÓN
     Los puntos que Compras tiene que aprobar, corregir o dejar
     pendientes. Se responden desde cualquier pantalla y todo se
     junta en la hoja de validación.
     ============================================================ */
  const GRUPOS = [
    { g: "A", titulo: "Registro diario", donde: "1-ingreso.html", dondeT: "Paso 1" },
    { g: "B", titulo: "Documento del mes", donde: "2-kardex-mensual.html", dondeT: "Paso 2" },
    { g: "C", titulo: "Productos y unidades", donde: "3-catalogo.html", dondeT: "Paso 3" },
    { g: "D", titulo: "Para poder arrancar", donde: "5-validacion.html", dondeT: "Paso 5" }
  ];

  /* Ocho preguntas, no más. Si hay que leer mucho para responder, nadie responde. */
  const VALID = [
    { id: "a1", g: "A", q: "¿Están todas las hojas y columnas que Compras necesita?",
      como: "Seis hojas (Suministros, Medicina, Endoscopía, Limpieza, Oficina, Tóner) y las columnas de siempre. Si falta algo, dígalo." },
    { id: "a2", g: "A", q: "¿Falta algún dato al momento de registrar?",
      como: "Por ejemplo: lote, fecha de caducidad, a qué servicio se entregó. Todavía se puede agregar." },

    { id: "b1", g: "B", q: "¿El documento impreso reemplaza al que hoy se archiva?",
      como: "Pulse «Imprimir / PDF» y mírelo. Si el formato oficial exige algo distinto, anótelo." },
    { id: "b2", g: "B", q: "¿Este documento necesita ir firmado?",
      como: "Lo sacamos a propósito: el documento sale sin líneas de firma. Si el archivo o auditoría las exige, díganos aquí <b>quiénes</b> firman y se las ponemos." },

    { id: "c1", g: "C", q: "¿La unidad de medida de cada producto es la correcta?",
      como: "Es lo más importante de todo. Si un centro cuenta en CAJA y otro en UNIDAD, el pedido sale mal. Revise sobre todo los 69 marcados en ámbar." },
    { id: "c2", g: "C", q: "¿Qué unidad va para Oficina y Tóner?",
      como: "Son 106 productos sin unidad: el Excel no la trae. Hay que definirla antes de arrancar." },
    { id: "c3", g: "C", q: "¿Los 12 centros y los productos que entraron o salieron están bien?",
      como: "Entraron 46 productos, salieron 22, y aparecieron CM Ciudad Jardín y CM Mirador." },

    { id: "d1", g: "D", q: "¿Desde qué mes arranca y quién registra en cada centro?",
      como: "El primer mes hay que contar la percha para el saldo inicial. Y cada centro necesita un responsable con su clave." }
  ];


  function valLeer() {
    try { return JSON.parse(localStorage.getItem(CLAVE_VAL)) || { items: {}, meta: {} }; }
    catch (e) { return { items: {}, meta: {} }; }
  }
  function valGuardar(v) { try { localStorage.setItem(CLAVE_VAL, JSON.stringify(v)); } catch (e) { } }
  function valSet(id, estado) {
    const v = valLeer();
    const it = v.items[id] || (v.items[id] = { e: "", obs: "" });
    it.e = (it.e === estado) ? "" : estado;
    valGuardar(v);
    pintarValItem(id);
    refrescarAvance();
    if (typeof w.alCambiarValidacion === "function") w.alCambiarValidacion();
  }
  function valObs(id, texto) {
    const v = valLeer();
    const it = v.items[id] || (v.items[id] = { e: "", obs: "" });
    it.obs = texto;
    valGuardar(v);
    if (typeof w.alCambiarValidacion === "function") w.alCambiarValidacion();
  }
  function valMeta(campo, texto) {
    const v = valLeer(); v.meta[campo] = texto; valGuardar(v);
  }
  function valResumen() {
    const v = valLeer();
    let ok = 0, no = 0, dd = 0;
    VALID.forEach(x => {
      const e = (v.items[x.id] || {}).e;
      if (e === "ok") ok++; else if (e === "no") no++; else if (e === "dd") dd++;
    });
    return { ok, no, dd, resp: ok + no + dd, total: VALID.length };
  }
  function valBorrar() {
    if (!confirm("Esto borra todas las respuestas de la validación. ¿Continuar?")) return;
    localStorage.removeItem(CLAVE_VAL);
    location.reload();
  }

  const ETIQ = {
    ok: { t: "Está bien", c: "p-ok" },
    no: { t: "Hay que corregir", c: "p-crit" },
    dd: { t: "Tengo dudas", c: "p-warn" },
    "": { t: "Sin responder", c: "p-neutro" }
  };

  function pintarValItem(id) {
    const cont = document.querySelector(`[data-val="${id}"]`);
    if (!cont) return;
    const it = valLeer().items[id] || { e: "", obs: "" };
    cont.querySelectorAll("button[data-e]").forEach(b => {
      const sel = b.dataset.e === it.e;
      b.className = sel ? ("sel-" + b.dataset.e) : "";
    });
    const i = cont.querySelector("input.obs");
    if (i && i.value !== it.obs) i.value = it.obs || "";
  }

  /* Caja naranja "qué tiene que validar aquí", al pie de cada pantalla. */
  function cajaValidar(g) {
    const grupo = GRUPOS.find(x => x.g === g) || {};
    const items = VALID.filter(x => x.g === g);
    const cuerpo = items.map(x => `
      <div class="v-item" data-val="${x.id}">
        <div class="q">${esc(x.g + x.id.slice(1) + ". ")}${esc(x.q)}</div>
        <p class="como">${x.como}</p>
        <div class="v-opts">
          <button type="button" data-e="ok" onclick="KX.valSet('${x.id}','ok')">✓ Está bien</button>
          <button type="button" data-e="no" onclick="KX.valSet('${x.id}','no')">✕ Hay que corregir</button>
          <button type="button" data-e="dd" onclick="KX.valSet('${x.id}','dd')">? Tengo dudas</button>
          <input class="obs" placeholder="Observación (opcional): qué cambiar, qué falta…"
                 oninput="KX.valObs('${x.id}', this.value)">
        </div>
      </div>`).join("");

    return `<section class="validar" id="validar">
      <h3>✅ Sobre esta pantalla <small>${items.length} pregunta${items.length === 1 ? "" : "s"}</small></h3>
      <div class="cuerpo">
        <p class="intro-v">Marque y, si algo está mal, escríbalo. Se guarda solo y se junta en
          <a href="5-validacion.html">Respuestas</a>.</p>
        ${cuerpo}
      </div>
    </section>`;
  }

  function refrescarAvance() {
    const e = document.getElementById("avanceVal");
    if (!e) return;
    const r = valResumen();
    e.textContent = `Validación: ${r.resp} de ${r.total} puntos respondidos`;
  }

  /* Repinta el estado guardado en todas las cajas de validación de la página. */
  function pintarValidacion() {
    document.querySelectorAll("[data-val]").forEach(c => pintarValItem(c.dataset.val));
    refrescarAvance();
  }

  w.KX = {
    D, CATS, ICONO, HOJA_EXCEL, CENTRO_DEMO, MES_DEMO, RESP_DEMO, GRUPOS, VALID, ETIQ,
    esc, n0, fmt, pad, fecha, diasDelMes, uid, norm, toast, hoyTexto,
    catalogo, totalProductos, unidadDe, delCatalogo,
    movimientosBase, leerLocal, guardarLocal, agregar, borrarLocal, todos,
    kardex, estadoDe, descargarCSV,
    ay, ayLinea, expandirAyudas, modoAyuda, barra, nav, montar, panelPantalla, toggleGuia,
    valLeer, valSet, valObs, valMeta, valResumen, valBorrar, cajaValidar, pintarValidacion, refrescarAvance
  };
})(window);
