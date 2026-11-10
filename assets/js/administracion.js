
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
  $("zona-reset").scrollIntoView({ behavior: "smooth", block: "start" });
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


let paginaHistorial = 1;
let hayPaginaSiguiente = false;

async function cargarHistorialAdmin() {
  const estado = $("estado-historial");
  const lista = $("historial-admin");

  estado.textContent = "Consultando historial...";

  const parametros = new URLSearchParams({
    pagina: String(paginaHistorial),
    telefono: $("filtro-telefono").value.trim(),
    usuario: $("filtro-usuario").value.trim(),
    estado: $("filtro-estado").value
  });

  try {
    const respuesta = await fetch(
      "/api/movimientos?" + parametros.toString(),
      {
        credentials: "same-origin",
        cache: "no-store"
      }
    );

    const datos = await respuesta.json();

    if (!respuesta.ok) {
      throw new Error(datos.error || "Error consultando historial");
    }

    lista.replaceChildren();

    for (const movimiento of datos.movimientos) {
      const fila = document.createElement("div");
      fila.className = "empleado";

      const informacion = document.createElement("div");

      const titulo = document.createElement("strong");
      titulo.textContent =
        `${movimiento.telefono} · ` +
        `${movimiento.tipo} (${movimiento.sellos} sellos)`;

      const detalle = document.createElement("small");
      detalle.textContent =
        `${movimiento.registrado_por} · ` +
        new Date(
          movimiento.creado_en * 1000
        ).toLocaleString("es-BO");

      informacion.append(titulo, detalle);

      if (movimiento.correccion_tipo) {
        const correccion = document.createElement("small");

        correccion.textContent =
          `Corrección: ${movimiento.correccion_tipo}` +
          (movimiento.telefono_destino
            ? ` hacia ${movimiento.telefono_destino}`
            : "") +
          ` · Por ${movimiento.corregido_por}` +
          ` · Motivo: ${movimiento.motivo}`;

        informacion.append(correccion);
      }

      fila.append(informacion);

      if (movimiento.puede_corregir === 1) {
        const acciones = document.createElement("div");
        acciones.className = "acciones";

        acciones.append(
          boton("Corregir", () =>
            corregirDesdeAdmin(movimiento, "trasladar")
          ),
          boton("Anular", () =>
            corregirDesdeAdmin(movimiento, "anular")
          )
        );

        fila.append(acciones);
      }

      lista.append(fila);
    }

    hayPaginaSiguiente = datos.tiene_mas;
    $("pagina-actual").textContent =
      `Página ${paginaHistorial}`;

    $("pagina-anterior").disabled = paginaHistorial === 1;
    $("pagina-siguiente").disabled = !hayPaginaSiguiente;

    estado.textContent = datos.movimientos.length
      ? ""
      : "No se encontraron movimientos.";

  } catch (error) {
    estado.textContent = error.message;
  }
}

async function corregirDesdeAdmin(movimiento, tipo) {
  try {
    const resultado = await window.PausaCorregir(
      movimiento,
      tipo
    );

    if (!resultado) return;

    await cargarHistorialAdmin();

    $("estado-historial").textContent =
      resultado.repetido
        ? "Corrección ya registrada."
        : "Corrección realizada correctamente.";

  } catch (error) {
    $("estado-historial").textContent =
      error.message +
      " Actualiza el historial para verificar el resultado.";
  }
}

$("buscar-movimientos").addEventListener("click", () => {
  paginaHistorial = 1;
  cargarHistorialAdmin();
});

$("pagina-anterior").addEventListener("click", () => {
  if (paginaHistorial > 1) {
    paginaHistorial--;
    cargarHistorialAdmin();
  }
});

$("pagina-siguiente").addEventListener("click", () => {
  if (hayPaginaSiguiente) {
    paginaHistorial++;
    cargarHistorialAdmin();
  }
});

cargarHistorialAdmin();
