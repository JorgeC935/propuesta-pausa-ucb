
"use strict";

window.PausaCorregir = async function (movimiento, tipo) {
  let destino = null;

  if (tipo === "trasladar") {
    destino = prompt(
      `¿A qué número corresponde el sello registrado ` +
      `en ${movimiento.telefono}?`
    );

    if (destino === null) return null;

    destino = destino.trim();

    if (
      !/^[0-9]{8}$/.test(destino) ||
      destino === movimiento.telefono
    ) {
      alert("Introduce otro número válido de ocho dígitos.");
      return null;
    }
  }

  const motivo = prompt(
    tipo === "trasladar"
      ? "Motivo de la corrección:"
      : "Motivo de la anulación:",
    tipo === "trasladar"
      ? "Número de celular equivocado"
      : "Sello registrado por error"
  );

  if (motivo === null) return null;

  if (motivo.trim().length < 3 ||
      motivo.trim().length > 200) {
    alert("El motivo debe tener entre 3 y 200 caracteres.");
    return null;
  }

  const detalle = tipo === "trasladar"
    ? `Se quitará un sello de ${movimiento.telefono} ` +
      `y se acreditará a ${destino}.`
    : `Se quitará un sello de ${movimiento.telefono}.`;

  if (!confirm(
    detalle + "\n\n" +
    "La operación quedará registrada en el historial. " +
    "¿Confirmas la corrección?"
  )) {
    return null;
  }

  const respuesta = await fetch("/api/correcciones", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify({
      movimiento_id: movimiento.id,
      clave_operacion: crypto.randomUUID(),
      tipo,
      telefono_destino: destino,
      motivo: motivo.trim()
    })
  });

  const datos = await respuesta.json().catch(() => ({}));

  if (!respuesta.ok) {
    throw new Error(
      datos.error ||
      "No se pudo confirmar la corrección. " +
      "Actualiza el historial antes de reintentar."
    );
  }

  return datos;
};
