"use strict";

const $ = id => document.getElementById(id);
const LIMITE = 50;
const TELEFONO = /^[0-9]{8}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let filas = new Map();
let empleado = null;
let ocupado = false;
let lotePreparado = null;
let llavePendiente = null;

function aviso(texto, error = false) {
  $("aviso").textContent = texto;
  $("aviso").className = error ? "error" : "ok";
}

async function peticion(url, cuerpo = null) {
  const res = await fetch(url, {
    method: cuerpo ? "POST" : "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(cuerpo ? { "Content-Type": "application/json" } : {})
    },
    ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {})
  });
  const datos = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(datos.error || `Error HTTP ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return datos;
}

function bloquear(valor) {
  ocupado = valor;
  for (const id of ["agregar", "agregar-lista", "refrescar", "revisar",
      "aplicar", "verificar-pendiente"]) {
    $(id).disabled = valor;
  }
}

function panel(nombre) {
  for (const id of ["panel-editor", "panel-confirmacion", "panel-pendiente", "panel-resultado"]) {
    $(id).hidden = id !== nombre;
  }
}

function firmado(delta) {
  return delta > 0 ? `+${delta}` : String(delta);
}

function dibujar() {
  const lista = $("lista");
  lista.replaceChildren();
  const elementos = [...filas.values()].sort((a, b) => a.telefono.localeCompare(b.telefono));

  if (!elementos.length) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.textContent = "Todavía no agregaste clientes.";
    lista.append(vacio);
  }

  for (const item of elementos) {
    const fila = document.createElement("div");
    fila.className = "fila";

    const telefono = document.createElement("strong");
    telefono.className = "numero";
    telefono.textContent = item.telefono;

    const saldo = document.createElement("div");
    saldo.className = "saldo";
    saldo.textContent = "Actual: " + item.saldo;

    const ajustar = document.createElement("div");
    const controles = document.createElement("div");
    controles.className = "modificar";

    const menos = document.createElement("button");
    menos.type = "button";
    menos.className = "btn-simple";
    menos.textContent = "−";
    menos.title = "Quitar un sello";
    menos.disabled = item.delta <= -50 || item.saldo + item.delta <= 0;

    const cantidad = document.createElement("input");
    cantidad.type = "number";
    cantidad.min = "-50";
    cantidad.max = "50";
    cantidad.step = "1";
    cantidad.value = item.delta;
    cantidad.setAttribute("aria-label", "Variación de sellos para " + item.telefono);

    const mas = document.createElement("button");
    mas.type = "button";
    mas.className = "btn-simple";
    mas.textContent = "+";
    mas.title = "Agregar un sello";
    mas.disabled = item.delta >= 50;

    const nuevo = document.createElement("div");
    nuevo.className = "nuevo";
    nuevo.textContent = "Resultado: " + (item.saldo + item.delta);

    function actualizar(v) {
      if (!Number.isInteger(v) || v < -50 || v > 50 || item.saldo + v < 0) {
        cantidad.value = item.delta;
        aviso("Esa variación no es válida o dejaría un saldo negativo.", true);
        return;
      }
      item.delta = v;
      dibujar();
    }

    menos.addEventListener("click", () => actualizar(item.delta - 1));
    mas.addEventListener("click", () => actualizar(item.delta + 1));
    cantidad.addEventListener("change", () => actualizar(Number(cantidad.value)));

    controles.append(menos, cantidad, mas);
    ajustar.append(controles, nuevo);

    const quitar = document.createElement("button");
    quitar.type = "button";
    quitar.className = "btn-simple quitar";
    quitar.textContent = "Quitar";
    quitar.addEventListener("click", () => {
      filas.delete(item.telefono);
      dibujar();
    });

    fila.append(telefono, saldo, ajustar, quitar);
    lista.append(fila);
  }

  const afectados = elementos.filter(f => f.delta !== 0);
  $("total-clientes").textContent =
    `${filas.size} clientes · ${afectados.length} con cambios`;
  const total = afectados.reduce((s, f) => s + f.delta, 0);
  $("total-variacion").textContent =
    `Variación total: ${firmado(total)} sellos`;
}

async function agregarTelefonos(telefonos) {
  if (ocupado) return;
  if (!telefonos.length || telefonos.some(t => !TELEFONO.test(t))) {
    aviso("Introduce números de ocho dígitos, sin otros caracteres.", true);
    return;
  }
  const nuevos = [...new Set(telefonos)].filter(t => !filas.has(t));
  if (filas.size + nuevos.length > LIMITE) {
    aviso("El límite es de 50 números distintos por lote.", true);
    return;
  }
  if (!nuevos.length) {
    aviso("Esos números ya están incluidos.");
    return;
  }

  bloquear(true);
  try {
    const datos = await peticion("/api/carga-masiva", {
      accion: "consultar", telefonos: nuevos
    });
    for (const r of datos.clientes) {
      filas.set(r.telefono, { telefono: r.telefono, saldo: r.saldo, delta: 0 });
    }
    dibujar();
    aviso(`${nuevos.length} número(s) agregado(s), sin cambiar sellos.`);
  } catch (error) {
    aviso(error.message, true);
  } finally {
    bloquear(false);
  }
}

$("agregar").addEventListener("click", async () => {
  const telefono = $("nuevo-telefono").value.trim();
  await agregarTelefonos([telefono]);
  if (filas.has(telefono)) $("nuevo-telefono").value = "";
  $("nuevo-telefono").focus();
});
$("nuevo-telefono").addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); $("agregar").click(); }
});
$("mostrar-pegar").addEventListener("click", () => {
  $("zona-pegar").hidden = !$("zona-pegar").hidden;
});
$("agregar-lista").addEventListener("click", async () => {
  const texto = $("paste").value.trim();
  const telefonos = texto.split(/[\s,;]+/).filter(Boolean);
  if (telefonos.length !== new Set(telefonos).size) {
    aviso("La lista contiene números repetidos. Revísala antes de agregar.", true);
    return;
  }
  await agregarTelefonos(telefonos);
  if (telefonos.every(t => filas.has(t))) $("paste").value = "";
});

$("refrescar").addEventListener("click", async () => {
  if (!filas.size || ocupado) return;
  bloquear(true);
  try {
    const datos = await peticion("/api/carga-masiva", {
      accion: "consultar", telefonos: [...filas.keys()]
    });
    const viejos = new Map([...filas.values()].map(f => [f.telefono, f.delta]));
    for (const r of datos.clientes) {
      filas.set(r.telefono, {
        telefono: r.telefono,
        saldo: r.saldo,
        delta: viejos.get(r.telefono) || 0
      });
    }
    // Si ahora el saldo impide una resta previa, exigir revisión manual.
    for (const f of filas.values()) {
      if (f.saldo + f.delta < 0) f.delta = 0;
    }
    dibujar();
    aviso("Saldos actualizados. Revisa los cambios antes de confirmar.");
  } catch (error) { aviso(error.message, true); }
  finally { bloquear(false); }
});

$("tipo-motivo").addEventListener("change", () => {
  $("grupo-tarjetas").hidden = $("tipo-motivo").value !== "Migración de tarjetas físicas";
});

$("revisar").addEventListener("click", () => {
  const cambios = [...filas.values()]
    .filter(f => f.delta !== 0)
    .sort((a, b) => a.telefono.localeCompare(b.telefono));
  if (!cambios.length) {
    aviso("Selecciona al menos un número y una variación distinta de cero.", true);
    return;
  }
  const referencia = $("referencia").value.trim();
  if (referencia.length < 8 || referencia.length > 145) {
    aviso("Escribe una referencia de 8 a 145 caracteres.", true);
    return;
  }
  if ($("tipo-motivo").value === "Migración de tarjetas físicas" &&
      !$("tarjetas-verificadas").checked) {
    aviso("Confirma que las tarjetas físicas fueron verificadas y marcadas.", true);
    return;
  }
  const motivo = $("tipo-motivo").value + ": " + referencia;
  lotePreparado = {
    accion: "aplicar",
    clave_operacion: crypto.randomUUID(),
    motivo,
    cambios: cambios.map(f => ({
      telefono: f.telefono, delta: f.delta, saldo_esperado: f.saldo
    }))
  };
  $("resumen-confirmacion").textContent =
    `${cambios.length} clientes · ${motivo} · ` +
    `Variación neta ${firmado(cambios.reduce((s, f) => s + f.delta, 0))} sellos.`;
  const lista = $("detalle-confirmacion");
  lista.replaceChildren();
  for (const f of cambios) {
    const li = document.createElement("li");
    li.textContent = `${f.telefono}: ${f.saldo} ${firmado(f.delta)} = ${f.saldo + f.delta}`;
    lista.append(li);
  }
  panel("panel-confirmacion");
  aviso("Revisa cada línea antes de confirmar.");
});
$("volver-editar").addEventListener("click", () => {
  lotePreparado = null;
  panel("panel-editor");
});

function recuperarPendiente() {
  try {
    const objeto = JSON.parse(sessionStorage.getItem(llavePendiente));
    return objeto && UUID.test(objeto.clave_operacion) &&
      objeto.accion === "aplicar" && Array.isArray(objeto.cambios)
      ? objeto : null;
  } catch { return null; }
}
function guardarPendiente(objeto) {
  try {
    const texto = JSON.stringify(objeto);
    sessionStorage.setItem(llavePendiente, texto);
    return sessionStorage.getItem(llavePendiente) === texto;
  } catch { return false; }
}
function borrarPendiente() {
  try { sessionStorage.removeItem(llavePendiente); }
  catch { /* Un reintento con la misma clave sigue siendo seguro. */ }
}
function mostrarPendiente() {
  const pendiente = recuperarPendiente();
  if (!pendiente) return false;
  $("pendiente-id").textContent = "Lote " + pendiente.clave_operacion;
  panel("panel-pendiente");
  return true;
}
function mostrarResultado(datos) {
  borrarPendiente();
  panel("panel-resultado");
  $("resultado-mensaje").textContent = datos.repetido
    ? "El lote ya estaba aplicado. No se repitieron movimientos."
    : "Lote aplicado correctamente. Todos los movimientos quedaron registrados.";
  const destino = $("resultado-detalles");
  destino.replaceChildren();
  const tabla = document.createElement("ul");
  for (const d of datos.detalles || []) {
    const li = document.createElement("li");
    li.textContent = `${d.telefono}: ${d.saldo_previo} ${firmado(d.variacion)} = ${d.saldo_resultante}`;
    tabla.append(li);
  }
  destino.append(tabla);
  aviso(`Lote ${datos.lote.id.slice(0, 8)} registrado por ${datos.lote.usuario}.`);
  filas = new Map();
  lotePreparado = null;
}

async function enviarPendiente() {
  const pendiente = recuperarPendiente();
  if (!pendiente || ocupado) return;
  bloquear(true);
  try {
    // Antes de reintentar, consultar D1 para recuperar una respuesta perdida.
    const resultado = await peticion(
      "/api/carga-masiva?id=" + encodeURIComponent(pendiente.clave_operacion)
    ).catch(e => {
      if (e.status === 404) return null;
      throw e;
    });
    if (resultado) {
      mostrarResultado({ ...resultado, repetido: true });
      return;
    }
    const aplicado = await peticion("/api/carga-masiva", pendiente);
    mostrarResultado(aplicado);
  } catch (error) {
    if (error.status === 409 || error.status === 400) {
      // Una respuesta HTTP definitiva indica que el lote fue rechazado.
      // La transaccion no se aplico. Permitir refrescar saldos y preparar otro.
      borrarPendiente();
      panel("panel-editor");
      lotePreparado = null;
      aviso(error.message + " Actualiza saldos y prepara otro lote.", true);
    } else {
      mostrarPendiente();
      aviso("No se pudo confirmar. Conservamos el identificador; reintenta al recuperar la conexión.", true);
    }
  } finally { bloquear(false); }
}

$("aplicar").addEventListener("click", async () => {
  if (!lotePreparado || ocupado) return;
  if (!confirm(
    `¿Aplicar ${lotePreparado.cambios.length} ajustes? ` +
    "Esta acción modifica saldos reales y quedará en el historial."
  )) return;
  if (!guardarPendiente(lotePreparado)) {
    aviso("No se pudo guardar el identificador de seguridad. No se envió ningún ajuste.", true);
    return;
  }
  mostrarPendiente();
  await enviarPendiente();
});
$("verificar-pendiente").addEventListener("click", enviarPendiente);
$("nuevo-lote").addEventListener("click", () => {
  $("referencia").value = "";
  $("tarjetas-verificadas").checked = false;
  $("nuevo-telefono").value = "";
  $("paste").value = "";
  $("zona-pegar").hidden = true;
  dibujar();
  panel("panel-editor");
  aviso("Prepara un nuevo lote. Los cambios anteriores ya están registrados.");
});

async function iniciar() {
  try {
    empleado = await peticion("/api/auth/me");
    const permisos = await peticion("/api/carga-masiva");
    if (!permisos.puede_usar) {
      aviso("El administrador no habilitó la carga masiva para empleados.", true);
      return;
    }
    llavePendiente = "pausa-carga-masiva:" + empleado.id;
    if (!mostrarPendiente()) {
      panel("panel-editor");
      dibujar();
      aviso(empleado.rol === "administrador"
        ? "Acceso de administrador. El permiso de empleados puede estar desactivado."
        : "Carga masiva temporal habilitada para tu usuario.");
    } else {
      aviso("Tienes un lote sin confirmar. Verifica su estado antes de hacer más cambios.", true);
    }
  } catch (error) {
    aviso("Acceso no autorizado. Entra primero desde el panel del personal. " + error.message, true);
  }
}

iniciar();
