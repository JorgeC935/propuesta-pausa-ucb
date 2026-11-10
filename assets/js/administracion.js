
"use strict";

const $ = (id) => document.getElementById(id);
let empleadoParaReset = null;

function mensaje(texto) {
  $("mensaje").textContent = texto;
}

async function consultar(metodo = "GET", cuerpo = null) {
  const respuesta = await fetch("/api/admin", {
    method: metodo,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(cuerpo ? { "Content-Type": "application/json" } : {})
    },
    ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {})
  });

  const datos = await respuesta.json().catch(() => ({}));

  if (!respuesta.ok) {
    throw new Error(
      datos.error || `Error HTTP ${respuesta.status}`
    );
  }

  return datos;
}

function boton(texto, accion) {
  const elemento = document.createElement("button");

  elemento.type = "button";
  elemento.textContent = texto;
  elemento.addEventListener("click", accion);

  return elemento;
}

function pintarEmpleados(empleados) {
  const lista = $("lista-empleados");
  lista.replaceChildren();

  for (const empleado of empleados) {
    const fila = document.createElement("div");
    fila.className = "empleado";

    const datos = document.createElement("div");

    const nombre = document.createElement("strong");
    nombre.textContent = empleado.usuario;

    const descripcion = document.createElement("small");
    descripcion.textContent =
      `${empleado.rol} · ` +
      (empleado.activo ? "Activo" : "Deshabilitado");

    datos.append(nombre, descripcion);
    fila.append(datos);

    if (empleado.rol === "empleado") {
      const acciones = document.createElement("div");
      acciones.className = "acciones";

      acciones.append(
        boton(
          empleado.activo ? "Deshabilitar" : "Habilitar",
          () => cambiarEstado(empleado)
        ),
        boton(
          "Cambiar contraseña",
          () => prepararReset(empleado)
        )
      );

      fila.append(acciones);
    }

    lista.append(fila);
  }
}

async function cargar() {
  const datos = await consultar();

  $("whatsapp").value = datos.whatsapp_contacto;
  pintarEmpleados(datos.empleados);

  $("cargando").hidden = true;
  $("contenido").hidden = false;
}

async function ejecutar(accion) {
  mensaje("Procesando...");

  try {
    const resultado = await accion();
    mensaje(resultado.mensaje || "Operacion completada");
    await cargar();
    return true;
  } catch (error) {
    mensaje(error.message);
    return false;
  }
}

$("form-whatsapp").addEventListener("submit", async (evento) => {
  evento.preventDefault();

  const formulario = evento.currentTarget;
  const botonGuardar = formulario.querySelector(
    'button[type="submit"]'
  );

  botonGuardar.disabled = true;

  await ejecutar(() => consultar("POST", {
    accion: "guardar_whatsapp",
    numero: $("whatsapp").value
  }));

  botonGuardar.disabled = false;
});

$("form-crear").addEventListener("submit", async (evento) => {
  evento.preventDefault();

  const clave = $("nueva-clave").value;

  if (clave !== $("confirmar-clave").value) {
    mensaje("Las contraseñas no coinciden");
    return;
  }

  const botonGuardar = evento.currentTarget.querySelector(
    'button[type="submit"]'
  );

  botonGuardar.disabled = true;

  const correcto = await ejecutar(() => consultar("POST", {
    accion: "crear_empleado",
    usuario: $("nuevo-usuario").value,
    contrasena: clave
  }));

  if (correcto) {
    evento.currentTarget.reset();
  }

  botonGuardar.disabled = false;
});

async function cambiarEstado(empleado) {
  const habilitar = !empleado.activo;

  const confirmado = confirm(
    `${habilitar ? "Habilitar" : "Deshabilitar"} ` +
    `al empleado ${empleado.usuario}?`
  );

  if (!confirmado) return;

  await ejecutar(() => consultar("POST", {
    accion: "cambiar_estado",
    id: empleado.id,
    activo: habilitar
  }));
}

function prepararReset(empleado) {
  empleadoParaReset = empleado;

  $("destinatario-reset").textContent =
    `Empleado: ${empleado.usuario}`;

  $("form-reset").reset();
  $("zona-reset").hidden = false;
  $("clave-reset").focus();
}

$("cancelar-reset").addEventListener("click", () => {
  empleadoParaReset = null;
  $("zona-reset").hidden = true;
  $("form-reset").reset();
});

$("form-reset").addEventListener("submit", async (evento) => {
  evento.preventDefault();

  if (!empleadoParaReset) return;

  const clave = $("clave-reset").value;

  if (clave !== $("confirmar-reset").value) {
    mensaje("Las contraseñas no coinciden");
    return;
  }

  const botonGuardar = evento.currentTarget.querySelector(
    'button[type="submit"]'
  );

  botonGuardar.disabled = true;

  const correcto = await ejecutar(() => consultar("POST", {
    accion: "restablecer_clave",
    id: empleadoParaReset.id,
    contrasena: clave
  }));

  if (correcto) {
    empleadoParaReset = null;
    $("zona-reset").hidden = true;
    evento.currentTarget.reset();
  }

  botonGuardar.disabled = false;
});

cargar().catch((error) => {
  $("cargando").textContent =
    "Acceso reservado a administradores. " +
    "Inicia sesión desde el panel del personal.";

  mensaje(error.message);
});
