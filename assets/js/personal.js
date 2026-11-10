
"use strict";

const $ = (id) => document.getElementById(id);

const CLAVE_COMPRA = "pausa_operacion_pendiente";
const CLAVE_CANJE = "pausa_canje_pendiente";

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

function leerPendiente(clave) {
  try {
    const dato = JSON.parse(
      sessionStorage.getItem(clave)
    );

    if (
      dato &&
      /^[0-9]{8}$/.test(dato.telefono) &&
      PATRON_UUID.test(dato.clave_operacion)
    ) {
      return dato;
    }
  } catch {
    // No hay una operación pendiente válida.
  }

  return null;
}

function obtenerTelefono() {
  return $("telefono").value.trim();
}

function telefonoValido(telefono) {
  return /^[0-9]{8}$/.test(telefono);
}

function mostrarLogin() {
  $("cargando").hidden = true;
  $("pantalla-panel").hidden = true;
  $("pantalla-login").hidden = false;
}

function mostrarPanel(empleado) {
  $("cargando").hidden = true;
  $("pantalla-login").hidden = true;
  $("pantalla-panel").hidden = false;

  $("usuario-actual").textContent =
    `${empleado.usuario} · ${empleado.rol}`;

  $("zona-admin").hidden =
    empleado.rol !== "administrador";

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

  $("telefono").focus();
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
  $("resumen-cliente").hidden = true;
  mensaje("mensaje-canje", "");
});

// Consultar saldo sin registrar ninguna compra.
$("consultar-saldo").addEventListener("click", async () => {
  const telefono = obtenerTelefono();

  if (!telefonoValido(telefono)) {
    mensaje(
      "mensaje-sello",
      "Introduce un número de ocho dígitos.",
      true
    );
    return;
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
    mensaje(
      "mensaje-sello",
      "Introduce un número de ocho dígitos.",
      true
    );
    return;
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

    sessionStorage.setItem(
      CLAVE_COMPRA,
      JSON.stringify(operacion)
    );
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

    sessionStorage.removeItem(CLAVE_COMPRA);

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

    sessionStorage.setItem(
      CLAVE_CANJE,
      JSON.stringify(operacion)
    );
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

    sessionStorage.removeItem(CLAVE_CANJE);

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

  } catch (error) {
    // Un saldo insuficiente es una respuesta definitiva.
    if (
      error.status === 409 &&
      error.datos?.error ===
        "Sellos insuficientes para realizar el canje"
    ) {
      sessionStorage.removeItem(CLAVE_CANJE);

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
    mensaje(
      "mensaje-sello",
      "Existe una operación sin confirmar. " +
      "Reinténtala antes de cerrar sesión.",
      true
    );
    return;
  }

  try {
    await api("/api/auth/logout", {
      method: "POST"
    });

    $("contrasena").value = "";
    $("resumen-cliente").hidden = true;
    mostrarLogin();

  } catch (error) {
    mensaje("mensaje-sello", error.message, true);
  }
});

iniciar();
