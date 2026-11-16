
"use strict";

const $ = (id) => document.getElementById(id);
let empleadoParaReset = null;

function mensaje(texto) {
  $("mensaje").textContent = texto;
}

function estadoSeccion(id, texto, error = false) {
  const nodo = $(id);
  nodo.textContent = texto;
  nodo.className = "estado-seccion " + (error ? "error" : "ok");
}
function errorCampo(id, texto) {
  const nodo = $("error-" + id);
  nodo.textContent = texto;
  nodo.hidden = false;
  const input = $(id);
  input.setAttribute("aria-invalid", "true");
  input.focus({ preventScroll: true });
  nodo.scrollIntoView({ block: "nearest" });
  return false;
}
function limpiarErrorCampo(id) {
  const nodo = $("error-" + id);
  nodo.textContent = "";
  nodo.hidden = true;
  $(id).removeAttribute("aria-invalid");
}
for (const id of [
  "whatsapp", "nuevo-usuario", "nueva-clave", "confirmar-clave",
  "clave-reset", "confirmar-reset", "filtro-telefono", "filtro-usuario"
]) {
  $(id).addEventListener("input", () => limpiarErrorCampo(id));
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
  const hasta = Number(datos.carga_masiva_hasta || 0);
  $("estado-permiso-carga").textContent = hasta === -1
    ? "Habilitada sin límite de tiempo (hasta que se desactive manualmente)"
    : hasta > Date.now() / 1000
      ? "Habilitada para empleados hasta " +
        new Date(hasta * 1000).toLocaleString("es-BO")
      : "Deshabilitada para empleados";
  pintarEmpleados(datos.empleados);

  $("cargando").hidden = true;
  $("contenido").hidden = false;
}

async function ejecutar(accion, idEstado = "mensaje", campoConError = null) {
  if (idEstado === "mensaje") mensaje("Procesando...");
  else estadoSeccion(idEstado, "Procesando...");
  try {
    const resultado = await accion();
    await cargar();
    if (idEstado === "mensaje") mensaje(resultado.mensaje || "Operación completada");
    else estadoSeccion(idEstado, resultado.mensaje || "Operación completada");
    return true;
  } catch (error) {
    if (campoConError) errorCampo(campoConError, error.message);
    else if (idEstado === "estado-crear" && /usuario ya existe|usuario invalido/i.test(error.message)) {
      errorCampo("nuevo-usuario", error.message);
    } else if (idEstado === "estado-crear" && /contraseñ|contrasen/i.test(error.message)) {
      errorCampo("nueva-clave", error.message);
    } else if (idEstado === "estado-reset" && /contraseñ|contrasen/i.test(error.message)) {
      errorCampo("clave-reset", error.message);
    } else if (idEstado === "mensaje") mensaje(error.message);
    else estadoSeccion(idEstado, error.message, true);
    return false;
  }
}

$("form-whatsapp").addEventListener("submit", async (evento) => {
  evento.preventDefault();

  const formulario = evento.currentTarget;
  const botonGuardar = formulario.querySelector(
    'button[type="submit"]'
  );

  limpiarErrorCampo("whatsapp");
  const whatsapp = $("whatsapp").value.trim().replace(/[\s()-]/g, "");
  if (whatsapp && !/^(?:[67][0-9]{7}|\+?[1-9][0-9]{8,14})$/.test(whatsapp)) {
    return errorCampo("whatsapp", "Introduce un número de WhatsApp válido.");
  }
  botonGuardar.disabled = true;
  await ejecutar(() => consultar("POST", {
    accion: "guardar_whatsapp", numero: $("whatsapp").value
  }), "estado-whatsapp", "whatsapp");
  botonGuardar.disabled = false;
});

$("form-crear").addEventListener("submit", async (evento) => {
  evento.preventDefault();

  const usuario = $("nuevo-usuario").value.trim().toLowerCase();
  const clave = $("nueva-clave").value;
  if (!/^[a-z0-9._-]{3,32}$/.test(usuario)) {
    return errorCampo("nuevo-usuario", "Usa entre 3 y 32 caracteres: letras, números, punto, guion o guion bajo.");
  }
  if (clave.length < 12 || clave.length > 128) {
    return errorCampo("nueva-clave", "La contraseña debe tener entre 12 y 128 caracteres.");
  }
  if (clave !== $("confirmar-clave").value) {
    return errorCampo("confirmar-clave", "Las contraseñas no coinciden.");
  }

  const botonGuardar = evento.currentTarget.querySelector(
    'button[type="submit"]'
  );

  botonGuardar.disabled = true;

  const correcto = await ejecutar(() => consultar("POST", {
    accion: "crear_empleado", usuario, contrasena: clave
  }), "estado-crear");

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
  limpiarErrorCampo("clave-reset");
  limpiarErrorCampo("confirmar-reset");
  estadoSeccion("estado-reset", "");
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
  if (clave.length < 12 || clave.length > 128) {
    return errorCampo("clave-reset", "La nueva contraseña debe tener entre 12 y 128 caracteres.");
  }
  if (clave !== $("confirmar-reset").value) {
    return errorCampo("confirmar-reset", "Las contraseñas no coinciden.");
  }

  const botonGuardar = evento.currentTarget.querySelector(
    'button[type="submit"]'
  );

  botonGuardar.disabled = true;

  const correcto = await ejecutar(() => consultar("POST", {
    accion: "restablecer_clave", id: empleadoParaReset.id, contrasena: clave
  }), "estado-reset");

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
  const telefonoFiltro = $("filtro-telefono").value.trim();
  const usuarioFiltro = $("filtro-usuario").value.trim().toLowerCase();
  limpiarErrorCampo("filtro-telefono");
  limpiarErrorCampo("filtro-usuario");
  if (telefonoFiltro && !/^[0-9]{8}$/.test(telefonoFiltro)) {
    return errorCampo("filtro-telefono", "Introduce ocho dígitos o deja el campo vacío.");
  }
  if (usuarioFiltro && !/^[a-z0-9._-]{3,32}$/.test(usuarioFiltro)) {
    return errorCampo("filtro-usuario", "Escribe un usuario válido o deja el campo vacío.");
  }
  const estado = $("estado-historial");
  const lista = $("historial-admin");

  estado.textContent = "Consultando historial...";

  const parametros = new URLSearchParams({
    pagina: String(paginaHistorial),
    telefono: telefonoFiltro,
    usuario: usuarioFiltro,
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
        ).toLocaleString("es-BO") +
        (movimiento.lote_id
          ? " · Lote " + movimiento.lote_id.slice(0, 8) +
            " · " + (movimiento.lote_motivo || "Carga masiva")
          : "");

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

// Control de permiso exclusivo del administrador; -1 significa hasta desactivar.
for (const [horas, botonId] of [
  [0, "permiso-carga-0"],
  [2, "permiso-carga-2"],
  [24, "permiso-carga-24"],
  [-1, "permiso-carga-indefinida"]
]) {
  $(botonId).addEventListener("click", async () => {
    const texto = horas === 0
      ? "¿Deshabilitar ahora la carga masiva para empleados?"
      : horas === -1
        ? "¿Habilitar sin límite de tiempo? Permanecerá activa para todos los empleados autorizados hasta que la desactives manualmente."
        : `¿Habilitar la carga masiva para empleados por ${horas} horas?`;
    if (!confirm(texto)) return;
    await ejecutar(() => consultar("POST", {
      accion: "configurar_carga_masiva", horas
    }), "estado-permiso-accion");
  });
}
