
"use strict";

const $ = (id) => document.getElementById(id);

const CLAVE_PENDIENTE = "pausa_operacion_pendiente";

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
    throw new Error(
      datos.error || `Error HTTP ${respuesta.status}`
    );
  }

  return datos;
}

function mensaje(id, texto, error = false) {
  const elemento = $(id);
  elemento.textContent = texto;
  elemento.className =
    "mensaje " + (error ? "error" : "exito");
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

  const pendiente = recuperarPendiente();

  if (pendiente) {
    $("telefono").value = pendiente.telefono;
    mensaje(
      "mensaje-sello",
      "Hay una operación sin confirmar. " +
      "Puedes reintentar el registro.",
      true
    );
  }

  $("telefono").focus();
}

function recuperarPendiente() {
  try {
    const dato = JSON.parse(
      sessionStorage.getItem(CLAVE_PENDIENTE)
    );

    if (
      dato &&
      /^[0-9]{8}$/.test(dato.telefono) &&
      /^[0-9a-f-]{36}$/i.test(dato.clave_operacion)
    ) {
      return dato;
    }
  } catch {
    // No existe una operación pendiente válida.
  }

  return null;
}

// Comprobar sesión cuando se abre la página.
async function iniciar() {
  try {
    const empleado = await api("/api/auth/me");
    mostrarPanel(empleado);
  } catch {
    mostrarLogin();
  }
}

// Iniciar sesión.
$("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();

  const boton = e.currentTarget.querySelector(
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

// Registrar sello.
$("form-sello").addEventListener("submit", async (e) => {
  e.preventDefault();

  const telefono = $("telefono").value.trim();

  if (!/^[0-9]{8}$/.test(telefono)) {
    mensaje(
      "mensaje-sello",
      "Introduce un número de ocho dígitos.",
      true
    );
    return;
  }

  let operacion = recuperarPendiente();

  if (operacion && operacion.telefono !== telefono) {
    mensaje(
      "mensaje-sello",
      "Hay un registro anterior sin confirmar para " +
      operacion.telefono +
      ". Vuelve a ese número para reintentarlo.",
      true
    );
    return;
  }

  if (!operacion) {
    operacion = {
      telefono,
      clave_operacion: crypto.randomUUID()
    };

    sessionStorage.setItem(
      CLAVE_PENDIENTE,
      JSON.stringify(operacion)
    );
  }

  const boton = e.currentTarget.querySelector(
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

    sessionStorage.removeItem(CLAVE_PENDIENTE);

    mensaje(
      "mensaje-sello",
      resultado.repetido
        ? `Esta compra ya estaba registrada. ` +
          `Saldo: ${resultado.saldo_actual} sellos.`
        : `Sello registrado correctamente. ` +
          `Saldo: ${resultado.saldo_actual} sellos.`
    );

    $("telefono").value = "";
    $("telefono").focus();

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

// Cerrar sesión.
$("cerrar-sesion").addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", {
      method: "POST"
    });

    $("contrasena").value = "";
    mostrarLogin();
  } catch (error) {
    mensaje("mensaje-sello", error.message, true);
  }
});

iniciar();
