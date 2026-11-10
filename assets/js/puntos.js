/* Pausa V2 · Consulta publica de sellos desde Cloudflare D1.
   El numero se guarda solamente en este navegador.
   No se descarga ni se almacena un CSV con los clientes.
   El servidor limita las consultas anonimas y devuelve unicamente saldo y meta. */
(function () {
  var C = window.PAUSA, UI = window.PAUSA_UI;
  var panel = document.getElementById("panel");
  var KEY = "pausa_numero";
  var QR_KEY = "pausa_qr_local";
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function guardarQr(numero, id) {
    if (!UUID.test(String(id || ""))) return;
    try { localStorage.setItem(QR_KEY, JSON.stringify({ telefono: numero, id: id })); } catch (e) {}
  }
  function recuperarQr(numero) {
    try {
      var valor = JSON.parse(localStorage.getItem(QR_KEY));
      return valor && valor.telefono === numero && UUID.test(valor.id) ? valor.id : null;
    } catch (e) { return null; }
  }
  function mostrarQr(numero, id, offline) {
    if (!UUID.test(String(id || "")) || typeof qrcode !== "function") return;
    var seccion = el("section", "pausa-qr");
    var titulo = el("h2", null, "Mi QR de Pausa");
    var ayuda = el("p", "muted small", offline
      ? "Tu QR guardado funciona sin internet. El saldo necesita conexion."
      : "Muestra este QR al personal. No hace falta internet para mostrarlo despues de guardarlo.");
    var imagen = el("div", "pausa-qr__imagen");
    try {
      var codigo = qrcode(0, "M");
      codigo.addData("PAUSA-V2:" + id);
      codigo.make();
      imagen.innerHTML = codigo.createSvgTag({ cellSize: 7, margin: 4, scalable: true });
    } catch (e) { return; }
    var nota = el("p", "hint", "Este QR identifica tu cuenta de sellos, pero no autoriza compras ni canjes. Puedes guardar una captura.");
    seccion.append(titulo, ayuda, imagen, nota);
    panel.appendChild(seccion);
  }
  var consultaActual = 0;
  var controlador = null;

  /* Deja solo 8 dígitos: acepta «7123 4567», «+591 71234567», «59171234567» */
  function normalize(v) {
    var d = String(v || "").replace(/\D/g, "");
    if (d.length === 11 && d.indexOf("591") === 0) d = d.slice(3);
    return d;
  }
  function masked(n) { return "•••• " + n.slice(-4); }
  function load() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function save(n) { try { localStorage.setItem(KEY, n); } catch (e) {} }
  function forget() { try { localStorage.removeItem(KEY); localStorage.removeItem(QR_KEY); } catch (e) {} }

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function check() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'; }
  function clear() {
    while (panel.firstChild) panel.removeChild(panel.firstChild);
  }
  function whoLine(numero) {
    var w = el("div", "who");
    w.appendChild(el("span", null, "Número: " + masked(numero)));
    var b = el("button", null, "Cambiar número"); b.type = "button";
    b.addEventListener("click", function () { forget(); showForm(""); });
    w.appendChild(b);
    return w;
  }

  /* ---------- Buscador ---------- */
  function showForm(prefill, errorMsg) {
    consultaActual++;
    if (controlador) controlador.abort();
    clear();
    panel.appendChild(el("h1", null, "Mis puntos"));
    panel.appendChild(el("p", "muted", "Escribe el número de WhatsApp con el que pides. Lo guardamos en este celular para que la próxima vez veas tus sellos directo."));
    var f = el("form", "lookup"); f.noValidate = true;
    var lab = el("label", null, "Tu número de WhatsApp"); lab.htmlFor = "numero";
    var field = el("div", "field");
    field.appendChild(el("span", null, "+591"));
    var inp = document.createElement("input");
    inp.id = "numero"; inp.name = "numero"; inp.type = "tel"; inp.inputMode = "numeric";
    inp.autocomplete = "tel-national"; inp.placeholder = "7XXXXXXX"; inp.maxLength = 16; inp.value = prefill || "";
    field.appendChild(inp);
    var err = el("p", "error", errorMsg || ""); err.setAttribute("role", "alert"); if (!errorMsg) err.hidden = true;
    var btn = el("button", "btn btn--primary btn--block", "Ver mis sellos"); btn.type = "submit";
    f.appendChild(lab); f.appendChild(field); f.appendChild(err); f.appendChild(btn);
    f.appendChild(el("p", "hint", "Solo mostramos la cantidad de sellos, nunca tu nombre."));
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var n = normalize(inp.value);
      if (n.length !== 8) { err.textContent = "Escribe los 8 dígitos de tu número (por ejemplo, 71234567)."; err.hidden = false; inp.focus(); return; }
      save(n); lookup(n);
    });
    panel.appendChild(f);
    if (!prefill) inp.focus({ preventScroll: true });
  }

  /* ---------- Resultado ---------- */
  function showResult(numero, data) {
    clear();
    panel.appendChild(el("h1", null, "Mis puntos"));
    panel.appendChild(whoLine(numero));
    var meta = Number(data.meta_sellos) || 10;
    var n = Math.max(0, Number(data.saldo) || 0);

    var count = el("p", "count");
    count.appendChild(el("span", "count__n", String(n)));
    count.appendChild(el("span", "count__of", "de " + meta + " sellos digitales"));
    panel.appendChild(count);

    var ul = el("ul", "stamps"); ul.setAttribute("aria-hidden", "true");
    for (var i = 0; i < meta; i++) { var li = el("li", i < n ? "on" : ""); if (i < n) li.innerHTML = check(); ul.appendChild(li); }
    panel.appendChild(ul);

    if (n >= meta) panel.appendChild(el("p", null, "Ya tienes sellos suficientes para una recompensa. Solicita el canje al personal de Pausa."));
    else if (n === 0) panel.appendChild(el("p", "muted", "Todavía no tienes sellos digitales. El personal registra tus sellos al confirmar la compra."));
    else panel.appendChild(el("p", "muted", "Te faltan " + (meta - n) + " sellos para la próxima recompensa."));

    if (UUID.test(String(data.qr_id || ""))) {
      guardarQr(numero, data.qr_id);
      mostrarQr(numero, data.qr_id, false);
    } else {
      panel.appendChild(el("p", "muted small", "Tu QR aparecera aqui despues de que se registre tu primera compra."));
    }
  }

  function showNotFound(numero) {
    clear();
    panel.appendChild(el("h1", null, "Mis puntos"));
    panel.appendChild(whoLine(numero));
    panel.appendChild(el("p", null, "Todavía no hay sellos para este número."));
    panel.appendChild(el("p", "muted", "Tu primer sello aparece cuando el personal registra tu compra. Si ya compraste y no aparece, consúltanos."));
    var a = el("a", "btn btn--secondary", "Escribir por WhatsApp");
    a.setAttribute("data-wa", "puntos"); a.target = "_blank"; panel.appendChild(a);
    UI.wire(panel);
  }

  function showError(numero, detalle) {
    clear();
    panel.appendChild(el("h1", null, "Mis puntos"));
    panel.appendChild(whoLine(numero));
    panel.appendChild(el("p", "muted", detalle || "No pudimos cargar tus sellos ahora. Revisa tu conexión e inténtalo nuevamente."));
    // Solo mostrar el QR guardado, nunca un saldo viejo como saldo actual.
    mostrarQr(numero, recuperarQr(numero), true);
    var volver = el("button", "btn btn--secondary", "Volver a consultar");
    volver.type = "button";
    volver.addEventListener("click", function () { lookup(numero); });
    panel.appendChild(volver);
  }

  function lookup(numero) {
    var numeroConsulta = ++consultaActual;
    if (controlador) controlador.abort();
    controlador = new AbortController();

    clear();
    panel.appendChild(el("h1", null, "Mis puntos"));
    panel.appendChild(el("p", "muted", "Buscando tus sellos…"));

    fetch("/api/sellos/consulta", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ telefono: numero }),
      credentials: "omit",
      cache: "no-store",
      signal: controlador.signal
    })
      .then(function (respuesta) {
        if (!respuesta.ok) {
          var codigo = respuesta.status;
          return respuesta.json().catch(function () { return {}; })
            .then(function (datos) {
              throw new Error(datos.error || (codigo === 429
                ? "Demasiadas consultas. Intenta nuevamente en un minuto."
                : "No pudimos cargar tus sellos."));
            });
        }
        return respuesta.json();
      })
      .then(function (datos) {
        if (numeroConsulta !== consultaActual) return;
        showResult(numero, datos);
      })
      .catch(function (error) {
        if (numeroConsulta !== consultaActual || error.name === "AbortError") return;
        showError(numero, error.message);
      });
  }

  var saved = load();
  if (saved && normalize(saved).length === 8) lookup(normalize(saved));
  else showForm("");
})();
