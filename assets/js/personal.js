
"use strict";

const $ = (id) => document.getElementById(id);

const CLAVE_COMPRA = "pausa_operacion_pendiente";
const CLAVE_CANJE = "pausa_canje_pendiente";

// Identifica al usuario que tiene abierta la sesion.
// Los pendientes quedan separados por empleado en este dispositivo.
let usuarioActual = null;
let paginaMovimientos = 1;
let hayMovimientosSiguientes = false;
let secuenciaMovimientos = 0;
let lectorActivo = false;
let flujoCamara = null;
let animacionLector = null;
let versionLector = 0;

const PATRON_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function api(ruta, opciones = {}) {
  const respuesta = await fetch(ruta, {
    ...opciones,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(opciones.body
        ? { "Content-Type": "application/json" }
        : {})
    }
  });

  const datos = await respuesta.json().catch(() => ({}));

  if (!respuesta.ok) {
    const error = new Error(
      datos.error || `Error HTTP ${respuesta.status}`
    );

    error.status = respuesta.status;
    error.datos = datos;
    throw error;
  }

  return datos;
}

function mensaje(id, texto, error = false) {
  const elemento = $(id);
  elemento.textContent = texto;
  elemento.className =
    "mensaje " + (error ? "error" : "exito");
}

// El almacenamiento es LOCAL al navegador: no contiene claves ni tokens,
// solo telefono e identificador de una operacion aun no confirmada.
// Si falla el almacenamiento, NO enviamos una operacion nueva: perder su
// identificador podria hacer que un reintento generase doble registro.
function claveLocal(clave) {
  if (!usuarioActual) return null;
  return `pausa-v2:${usuarioActual}:${clave}`;
}

function leerPendiente(clave) {
  const llave = claveLocal(clave);
  if (!llave) return null;
  try {
    const dato = JSON.parse(localStorage.getItem(llave));
    if (
      dato &&
      /^[0-9]{8}$/.test(dato.telefono) &&
      PATRON_UUID.test(dato.clave_operacion)
    ) {
      return dato;
    }
  } catch {
    // Lectura del almacenamiento temporalmente no disponible.
  }
  return null;
}

function guardarPendiente(clave, operacion) {
  const llave = claveLocal(clave);
  if (!llave) return false;
  try {
    localStorage.setItem(llave, JSON.stringify(operacion));
    // Verificar persistencia antes de enviar una compra o canje.
    return localStorage.getItem(llave) === JSON.stringify(operacion);
  } catch {
    return false;
  }
}

function borrarPendiente(clave) {
  const llave = claveLocal(clave);
  if (!llave) return;
  try {
    localStorage.removeItem(llave);
  } catch {
    // Si falla el borrado, el reintento mantiene la misma clave.
  }
}

function obtenerTelefono() {
  return $("telefono").value.trim();
}

function telefonoValido(telefono) {
  return /^[0-9]{8}$/.test(telefono);
}
function errorTelefono(texto) {
  const nodo = $("error-telefono");
  nodo.textContent = texto;
  nodo.hidden = false;
  $("telefono").setAttribute("aria-invalid", "true");
  $("telefono").focus();
}
function limpiarErrorTelefono() {
  $("error-telefono").textContent = "";
  $("error-telefono").hidden = true;
  $("telefono").removeAttribute("aria-invalid");
}


function mostrarLogin() {
  usuarioActual = null;
  $("cargando").hidden = true;
  $("pantalla-panel").hidden = true;
  $("zona-carga-masiva").hidden = true;
  $("pantalla-login").hidden = false;
}

function mostrarPanel(empleado) {
  usuarioActual = empleado.usuario;
  $("cargando").hidden = true;
  $("pantalla-login").hidden = true;
  $("pantalla-panel").hidden = false;

  $("usuario-actual").textContent = empleado.rol === "administrador"
    ? `${empleado.usuario} · Administrador`
    : empleado.usuario;

  $("zona-admin").hidden =
    empleado.rol !== "administrador";
  $("titulo-personal").textContent = empleado.rol === "administrador"
    ? "Panel de administración y personal"
    : "Panel del personal";
  paginaMovimientos = 1;

  const compra = leerPendiente(CLAVE_COMPRA);
  const canje = leerPendiente(CLAVE_CANJE);
  const pendiente = compra || canje;

  if (pendiente) {
    $("telefono").value = pendiente.telefono;

    mensaje(
      "mensaje-sello",
      `Hay un ${compra ? "registro" : "canje"} ` +
      "sin confirmar. Reintenta la misma operación.",
      true
    );

    consultarSaldo(pendiente.telefono).catch(() => {});
  }

  // El administrador ve y puede abrir la administración antes de registrar compras.
  if (empleado.rol === "administrador" && !pendiente) {
    $("abrir-admin").focus();
  } else {
    $("telefono").focus();
  }

  cargarMovimientosPersonal();

  // El enlace es solamente presentación. El permiso real se comprueba
  // nuevamente desde el servidor al consultar y aplicar cada lote.
  const usuarioAlConsultar = usuarioActual;
  $("zona-carga-masiva").hidden = true;
  api("/api/carga-masiva")
    .then(datos => {
      if (usuarioActual === usuarioAlConsultar) {
        $("zona-carga-masiva").hidden = !datos.puede_usar;
      }
    })
    .catch(() => { $("zona-carga-masiva").hidden = true; });
}

async function consultarSaldo(telefono) {
  const datos = await api(
    "/api/sellos/consulta?telefono=" +
    encodeURIComponent(telefono)
  );

  // Evita mostrar el saldo de un número que ya cambió.
  if (obtenerTelefono() !== telefono) {
    return datos;
  }

  mostrarResumen(
    telefono,
    Number(datos.saldo),
    Number(datos.meta_sellos)
  );

  return datos;
}

function mostrarResumen(telefono, saldo, meta) {
  $("resumen-cliente").hidden = false;

  $("resumen-telefono").textContent = telefono;
  $("resumen-sellos").textContent = String(saldo);
  $("resumen-meta").textContent =
    `Recompensa disponible cada ${meta} sellos.`;

  $("resumen-telefono").dataset.telefono = telefono;
  $("resumen-sellos").dataset.saldo = String(saldo);
  $("resumen-meta").dataset.meta = String(meta);

  const canjePendiente = leerPendiente(CLAVE_CANJE);
  const reintento =
    canjePendiente?.telefono === telefono;

  $("boton-canjear").disabled =
    saldo < meta && !reintento;

  $("boton-canjear").textContent = reintento
    ? "Reintentar canje pendiente"
    : `Canjear ${meta} sellos`;
}

function hayOperacionContraria(claveActual) {
  const otraClave =
    claveActual === CLAVE_COMPRA
      ? CLAVE_CANJE
      : CLAVE_COMPRA;

  return leerPendiente(otraClave) !== null;
}

// Comprobar la sesión al abrir la página.
async function iniciar() {
  try {
    const empleado = await api("/api/auth/me");
    mostrarPanel(empleado);
  } catch {
    mostrarLogin();
  }
}

// Iniciar sesión.
$("form-login").addEventListener("submit", async (evento) => {
  evento.preventDefault();

  const boton = evento.currentTarget.querySelector(
    'button[type="submit"]'
  );

  boton.disabled = true;
  mensaje("mensaje-login", "Comprobando credenciales...");

  try {
    const empleado = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        usuario: $("usuario").value.trim(),
        contrasena: $("contrasena").value
      })
    });

    $("contrasena").value = "";
    mensaje("mensaje-login", "");
    mostrarPanel(empleado);

  } catch (error) {
    mensaje("mensaje-login", error.message, true);
  } finally {
    boton.disabled = false;
  }
});

// Ocultar saldos anteriores al cambiar el teléfono.
$("telefono").addEventListener("input", () => {
  limpiarErrorTelefono();
  $("resumen-cliente").hidden = true;
  mensaje("mensaje-canje", "");
});

// Consultar saldo sin registrar ninguna compra.
$("consultar-saldo").addEventListener("click", async () => {
  const telefono = obtenerTelefono();

  if (!telefonoValido(telefono)) {
    return errorTelefono("Introduce un número de ocho dígitos.");
  }

  const boton = $("consultar-saldo");
  boton.disabled = true;

  try {
    await consultarSaldo(telefono);
    mensaje("mensaje-sello", "");
  } catch (error) {
    mensaje("mensaje-sello", error.message, true);
  } finally {
    boton.disabled = false;
  }
});

// Registrar una compra.
$("form-sello").addEventListener("submit", async (evento) => {
  evento.preventDefault();

  const telefono = obtenerTelefono();

  if (!telefonoValido(telefono)) {
    return errorTelefono("Introduce un número de ocho dígitos.");
  }

  if (hayOperacionContraria(CLAVE_COMPRA)) {
    mensaje(
      "mensaje-sello",
      "Primero resuelve el canje pendiente.",
      true
    );
    return;
  }

  let operacion = leerPendiente(CLAVE_COMPRA);

  if (operacion && operacion.telefono !== telefono) {
    mensaje(
      "mensaje-sello",
      `Primero resuelve la compra pendiente de ` +
      operacion.telefono,
      true
    );
    return;
  }

  const confirmado = confirm(
    operacion
      ? `¿Reintentar la compra pendiente de ${telefono}?`
      : `¿Confirmas que el cliente ${telefono} ` +
        "realizó una compra pagada y corresponde " +
        "registrar un sello?"
  );

  if (!confirmado) return;

  if (!operacion) {
    operacion = {
      telefono,
      clave_operacion: crypto.randomUUID()
    };

    if (!guardarPendiente(CLAVE_COMPRA, operacion)) {
      mensaje(
        "mensaje-sello",
        "No se pudo guardar el identificador de la compra en " +
        "este dispositivo. No se envio la operacion.",
        true
      );
      return;
    }
  }

  const boton = evento.currentTarget.querySelector(
    'button[type="submit"]'
  );

  boton.disabled = true;
  $("telefono").readOnly = true;

  mensaje("mensaje-sello", "Registrando compra...");

  try {
    const resultado = await api(
      "/api/sellos/registrar",
      {
        method: "POST",
        body: JSON.stringify(operacion)
      }
    );

    borrarPendiente(CLAVE_COMPRA);

    mensaje(
      "mensaje-sello",
      resultado.repetido
        ? `La compra ya estaba registrada. ` +
          `Saldo: ${resultado.saldo_actual}.`
        : `Compra registrada. ` +
          `Saldo: ${resultado.saldo_actual} sellos.`
    );

    try {
      await consultarSaldo(telefono);
    } catch {
      // El registro ya quedó confirmado por el servidor.
    }

    // Actualizar el historial despues de registrar la compra.
    paginaMovimientos = 1;
    void cargarMovimientosPersonal();
    $("telefono").focus();
    $("telefono").select();

  } catch (error) {
    mensaje(
      "mensaje-sello",
      error.message +
      ". Se conservará la operación para reintentar.",
      true
    );
  } finally {
    boton.disabled = false;
    $("telefono").readOnly = false;
  }
});

// Canjear una recompensa.
$("boton-canjear").addEventListener("click", async () => {
  const telefono = obtenerTelefono();

  if (
    !telefonoValido(telefono) ||
    $("resumen-telefono").dataset.telefono !== telefono
  ) {
    mensaje(
      "mensaje-canje",
      "Consulta nuevamente el saldo del cliente.",
      true
    );
    return;
  }

  if (hayOperacionContraria(CLAVE_CANJE)) {
    mensaje(
      "mensaje-canje",
      "Primero resuelve la compra pendiente.",
      true
    );
    return;
  }

  let operacion = leerPendiente(CLAVE_CANJE);

  if (operacion && operacion.telefono !== telefono) {
    mensaje(
      "mensaje-canje",
      "Existe un canje pendiente de otro cliente.",
      true
    );
    return;
  }

  const meta = Number(
    $("resumen-meta").dataset.meta
  );

  const confirmado = confirm(
    operacion
      ? `¿Reintentar el canje pendiente de ${telefono}?`
      : `¿Confirmas que entregarás la recompensa ` +
        `al cliente ${telefono} y descontarás ` +
        `${meta} sellos?`
  );

  if (!confirmado) return;

  if (!operacion) {
    operacion = {
      telefono,
      clave_operacion: crypto.randomUUID()
    };

    if (!guardarPendiente(CLAVE_CANJE, operacion)) {
      mensaje(
        "mensaje-canje",
        "No se pudo guardar el identificador del canje en " +
        "este dispositivo. No se envio la operacion.",
        true
      );
      return;
    }
  }

  const boton = $("boton-canjear");
  boton.disabled = true;
  $("telefono").readOnly = true;

  mensaje("mensaje-canje", "Procesando canje...");

  try {
    const resultado = await api(
      "/api/sellos/canjear",
      {
        method: "POST",
        body: JSON.stringify(operacion)
      }
    );

    borrarPendiente(CLAVE_CANJE);

    mensaje(
      "mensaje-canje",
      resultado.repetido
        ? "Este canje ya estaba registrado. " +
          `Saldo: ${resultado.saldo_actual}.`
        : "Canje registrado. Entrega confirmada. " +
          `Saldo restante: ${resultado.saldo_actual}.`
    );

    mostrarResumen(
      telefono,
      Number(resultado.saldo_actual),
      meta
    );
    // Refrescar el historial tras un canje confirmado.
    paginaMovimientos = 1;
    void cargarMovimientosPersonal();

  } catch (error) {
    // Un saldo insuficiente es una respuesta definitiva.
    if (
      error.status === 409 &&
      error.datos?.error ===
        "Sellos insuficientes para realizar el canje"
    ) {
      borrarPendiente(CLAVE_CANJE);

      try {
        await consultarSaldo(telefono);
      } catch {
        // Se conservará el mensaje original.
      }

      mensaje("mensaje-canje", error.message, true);
    } else {
      mensaje(
        "mensaje-canje",
        error.message +
        ". Conservamos el identificador para reintentar.",
        true
      );
    }

  } finally {
    $("telefono").readOnly = false;

    // Volver a habilitar si hay sellos suficientes
    // o existe un canje pendiente.
    const saldo = Number(
      $("resumen-sellos").dataset.saldo || 0
    );

    const pendiente = leerPendiente(CLAVE_CANJE);

    boton.disabled =
      saldo < meta &&
      pendiente?.telefono !== telefono;

    boton.textContent = pendiente
      ? "Reintentar canje pendiente"
      : `Canjear ${meta} sellos`;
  }
});

// Cerrar sesión.
$("cerrar-sesion").addEventListener("click", async () => {
  const pendiente =
    leerPendiente(CLAVE_COMPRA) ||
    leerPendiente(CLAVE_CANJE);

  if (pendiente) {
    const salir = confirm(
      "Hay una operacion sin confirmar. Puedes cerrar sesion, " +
      "pero NO vuelvas a registrar o canjear esa misma operacion " +
      "desde otra cuenta o dispositivo. Se conservara en este " +
      "navegador para que este usuario la reintente con la misma clave. " +
      "¿Cerrar sesion de todos modos?"
    );
    if (!salir) return;
  }

  try {
    await api("/api/auth/logout", {
      method: "POST"
    });

    $("contrasena").value = "";
    $("telefono").value = "";
    $("resumen-cliente").hidden = true;
    secuenciaMovimientos++;
    paginaMovimientos = 1;
    detenerLector();
    $("lista-movimientos").replaceChildren();
    mensaje("mensaje-sello", "");
    mensaje("mensaje-canje", "");
    mostrarLogin();

  } catch (error) {
    mensaje("mensaje-sello", error.message, true);
  }
});

iniciar();

function crearBotonMovimiento(texto, accion) {
  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "btn btn--secondary";
  boton.textContent = texto;
  boton.style.margin = "6px 8px 0 0";
  boton.addEventListener("click", accion);
  return boton;
}

async function cargarMovimientosPersonal() {
  const lista = $("lista-movimientos");
  const estado = $("estado-movimientos");

  const peticion = ++secuenciaMovimientos;
  estado.textContent = "Actualizando movimientos...";

  try {
    const datos = await api("/api/movimientos?pagina=" + paginaMovimientos);
    if (peticion !== secuenciaMovimientos || !usuarioActual) return;
    lista.replaceChildren();

    for (const movimiento of datos.movimientos) {
      const fila = document.createElement("div");
      fila.style.padding = "16px 0";
      fila.style.borderBottom = "1px solid #ddd";

      const titulo = document.createElement("strong");
      titulo.textContent =
        `${movimiento.telefono} · ` +
        (movimiento.tipo === "compra"
          ? "+1 sello"
          : movimiento.tipo === "ajuste"
            ? `${movimiento.sellos > 0 ? "+" : ""}${movimiento.sellos} sellos (carga masiva)`
            : `${movimiento.sellos} sellos (canje)`);

      const detalle = document.createElement("p");
      detalle.className = "small muted";
      detalle.style.marginTop = "6px";

      detalle.textContent = new Date(
        movimiento.creado_en * 1000
      ).toLocaleString("es-BO");

      fila.append(titulo, detalle);

      if (movimiento.lote_id) {
        const lote = document.createElement("p");
        lote.className = "small muted";
        lote.textContent = "Lote: " + movimiento.lote_id.slice(0, 8) +
          " · " + (movimiento.lote_motivo || "Ajuste masivo");
        fila.append(lote);
      }

      if (movimiento.correccion_tipo) {
        const corregido = document.createElement("p");
        corregido.className = "small";
        corregido.style.marginTop = "8px";
        corregido.textContent =
          movimiento.correccion_tipo === "trasladar"
            ? `Corregido: trasladado a ` +
              movimiento.telefono_destino
            : "Registro anulado";

        fila.append(corregido);
      } else if (movimiento.puede_corregir === 1) {
        fila.append(
          crearBotonMovimiento(
            "Corregir número",
            () => corregirMovimientoPersonal(
              movimiento, "trasladar"
            )
          ),
          crearBotonMovimiento(
            "Anular sello",
            () => corregirMovimientoPersonal(
              movimiento, "anular"
            )
          )
        );
      }

      lista.append(fila);
    }

    hayMovimientosSiguientes = Boolean(datos.tiene_mas);
    $("movimientos-anterior").disabled = paginaMovimientos === 1;
    $("movimientos-siguiente").disabled = !hayMovimientosSiguientes;
    $("movimientos-pagina").textContent = `Página ${paginaMovimientos}`;

    estado.textContent = datos.movimientos.length
      ? ""
      : "No hay movimientos en esta página.";

  } catch (error) {
    if (peticion === secuenciaMovimientos) estado.textContent = error.message;
  }
}

async function corregirMovimientoPersonal(movimiento, tipo) {
  try {
    const resultado = await window.PausaCorregir(
      movimiento,
      tipo
    );

    if (!resultado) return;

    paginaMovimientos = 1;
    await cargarMovimientosPersonal();

    // Mostrar el resultado DESPUES de recargar la lista,
    // para que el mensaje no desaparezca inmediatamente.
    mensaje(
      "estado-movimientos",
      resultado.repetido
        ? "Esta corrección ya estaba registrada."
        : "Corrección realizada correctamente."
    );

    const telefono = obtenerTelefono();

    if (
      telefono === movimiento.telefono ||
      telefono === resultado.telefono_destino
    ) {
      await consultarSaldo(telefono);
    }

  } catch (error) {
    mensaje(
      "estado-movimientos",
      error.message +
      " Actualiza el historial para comprobar el estado.",
      true
    );
  }
}

$("actualizar-movimientos").addEventListener("click", () => {
  paginaMovimientos = 1;
  cargarMovimientosPersonal();
});
$("movimientos-anterior").addEventListener("click", () => {
  if (paginaMovimientos <= 1) return;
  paginaMovimientos--;
  cargarMovimientosPersonal();
});
$("movimientos-siguiente").addEventListener("click", () => {
  if (!hayMovimientosSiguientes) return;
  paginaMovimientos++;
  cargarMovimientosPersonal();
});


// Lector QR: identifica al cliente, pero NO agrega sellos ni canjea premios.
function detenerLector() {
  versionLector++;
  lectorActivo = false;
  if (animacionLector !== null) cancelAnimationFrame(animacionLector);
  animacionLector = null;
  if (flujoCamara) {
    flujoCamara.getTracks().forEach(track => track.stop());
    flujoCamara = null;
  }
  $("video-qr").srcObject = null;
  $("panel-escaner").hidden = true;
}

$("escanear-qr").addEventListener("click", async () => {
  if (lectorActivo) return;
  const intentoLector = ++versionLector;
  const panel = $("panel-escaner");
  const estado = $("estado-escaner");
  panel.hidden = false;
  estado.textContent = "Preparando cámara...";

  if (!("BarcodeDetector" in window) || !navigator.mediaDevices?.getUserMedia) {
    estado.textContent = "Este navegador no admite el lector QR. Introduce el celular manualmente.";
    return;
  }

  try {
    const soportados = await BarcodeDetector.getSupportedFormats();
    if (!soportados.includes("qr_code")) {
      estado.textContent = "El lector de QR no está disponible en este navegador. Usa el celular manualmente.";
      return;
    }
    const lector = new BarcodeDetector({ formats: ["qr_code"] });
    const nuevaCamara = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" } }
    });
    if (intentoLector !== versionLector) {
      nuevaCamara.getTracks().forEach(track => track.stop());
      return;
    }
    flujoCamara = nuevaCamara;
    const video = $("video-qr");
    video.srcObject = flujoCamara;
    await video.play();
    if (intentoLector !== versionLector) {
      detenerLector();
      return;
    }
    lectorActivo = true;
    estado.textContent = "Enfoca el QR de Pausa con la cámara.";
    let ultimaLectura = 0;
    const escanear = async tiempo => {
      if (!lectorActivo) return;
      if (tiempo - ultimaLectura < 250) {
        animacionLector = requestAnimationFrame(escanear);
        return;
      }
      ultimaLectura = tiempo;
      try {
        const resultados = await lector.detect(video);
        if (!lectorActivo) return;
        for (const resultado of resultados) {
          const match = /^PAUSA-V2:([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.exec(resultado.rawValue || "");
          if (!match) continue;
          // detener ANTES de resolver la API para evitar lecturas repetidas
          detenerLector();
          mensaje("mensaje-sello", "Identificando QR...");
          try {
            const datos = await api("/api/clientes/qr?codigo=" + encodeURIComponent(match[1]));
            $("telefono").value = datos.telefono;
            $("resumen-cliente").hidden = true;
            await consultarSaldo(datos.telefono);
            mensaje("mensaje-sello", "QR reconocido. Verifica el cliente antes de registrar o canjear.");
          } catch (error) {
            mensaje("mensaje-sello", error.message, true);
          }
          return;
        }
      } catch (error) {
        if (lectorActivo) estado.textContent = "No se pudo leer el QR. Intenta con mejor iluminación.";
      }
      if (lectorActivo) animacionLector = requestAnimationFrame(escanear);
    };
    animacionLector = requestAnimationFrame(escanear);
  } catch (error) {
    if (intentoLector !== versionLector) return;
    detenerLector();
    panel.hidden = false;
    estado.textContent = "No se pudo abrir la cámara. Comprueba los permisos o usa el celular manualmente.";
  }
});
$("cerrar-escaner").addEventListener("click", detenerLector);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) detenerLector();
});
