import { empleadoAutenticado } from "../../lib/autenticacion.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TELEFONO = /^[0-9]{8}$/;
const MAX_CLIENTES = 50;

function respuesta(datos, status = 200) {
  return Response.json(datos, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

async function permiso(db, empleado) {
  const fila = await db.prepare(`
    SELECT CAST(valor AS INTEGER) AS hasta
    FROM configuracion WHERE clave = 'carga_masiva_empleados_hasta'
  `).first();
  const hasta = Number(fila?.hasta || 0);
  return {
    rol: empleado.rol,
    hasta,
    habilitado_empleados: hasta === -1 || hasta > Math.floor(Date.now() / 1000),
    puede_usar: empleado.rol === "administrador" ||
      hasta === -1 || hasta > Math.floor(Date.now() / 1000)
  };
}

async function resultadoLote(db, id, empleado) {
  const lote = await db.prepare(`
    SELECT l.id, l.empleado_id, e.usuario, l.motivo, l.huella,
           l.cantidad, l.estado, l.creado_en
    FROM lotes_carga l
    JOIN empleados e ON e.id = l.empleado_id
    WHERE l.id = ? AND (l.empleado_id = ? OR ? = 'administrador')
  `).bind(id, empleado.id, empleado.rol).first();
  if (!lote) return null;
  const detalle = await db.prepare(`
    SELECT c.telefono, m.saldo_previo, m.sellos AS variacion,
           m.saldo_previo + m.sellos AS saldo_resultante
    FROM movimientos m JOIN clientes c ON c.id = m.cliente_id
    WHERE m.lote_id = ? ORDER BY c.telefono
  `).bind(id).all();
  return { lote, detalles: detalle.results || [] };
}

async function digestHex(texto) {
  const bytes = new TextEncoder().encode(texto);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)]
    .map(x => x.toString(16).padStart(2, "0")).join("");
}

function validarTelefonos(datos) {
  const entrada = datos?.telefonos;
  if (!Array.isArray(entrada) || !entrada.length ||
      entrada.length > MAX_CLIENTES ||
      entrada.some(t => typeof t !== "string" || !TELEFONO.test(t)) ||
      new Set(entrada).size !== entrada.length) {
    return null;
  }
  return entrada;
}

export async function onRequestGet({ request, env }) {
  try {
    const empleado = await empleadoAutenticado(env, request);
    if (!empleado) return respuesta({ error: "Sesion no autorizada" }, 401);

    const id = new URL(request.url).searchParams.get("id");
    if (id !== null) {
      if (!UUID.test(id)) return respuesta({ error: "Lote invalido" }, 400);
      // Consultar el estado de un lote propio debe ser posible aunque
      // el administrador haya deshabilitado el permiso mientras se procesaba.
      const encontrado = await resultadoLote(env.DB, id, empleado);
      if (!encontrado) return respuesta({ error: "Lote no encontrado" }, 404);
      return respuesta(encontrado);
    }

    return respuesta(await permiso(env.DB, empleado));
  } catch (error) {
    console.error("Carga masiva GET:", error);
    return respuesta({ error: "No se pudo consultar la carga masiva" }, 503);
  }
}

export async function onRequestPost({ request, env }) {
  if (request.headers.get("Origin") !== new URL(request.url).origin) {
    return respuesta({ error: "Origen no autorizado" }, 403);
  }
  if (!request.headers.get("Content-Type")?.toLowerCase()
      .startsWith("application/json")) {
    return respuesta({ error: "Formato no admitido" }, 415);
  }

  const empleado = await empleadoAutenticado(env, request);
  if (!empleado) return respuesta({ error: "Sesion no autorizada" }, 401);

  let datos;
  try {
    const texto = await request.text();
    if (texto.length > 20000) return respuesta({ error: "Solicitud excesiva" }, 413);
    datos = JSON.parse(texto);
    if (!datos || typeof datos !== "object" || Array.isArray(datos)) {
      return respuesta({ error: "Datos invalidos" }, 400);
    }
  } catch {
    return respuesta({ error: "JSON invalido" }, 400);
  }

  try {
    const acceso = await permiso(env.DB, empleado);
    if (!acceso.puede_usar) {
      return respuesta({ error: "La carga masiva esta deshabilitada para empleados" }, 403);
    }

    if (datos.accion === "consultar") {
      const telefonos = validarTelefonos(datos);
      if (!telefonos) return respuesta({ error: "Introduce entre 1 y 50 numeros distintos de ocho digitos" }, 400);

      const filas = await env.DB.prepare(`
        SELECT j.value AS telefono, COALESCE(SUM(m.sellos), 0) AS saldo
        FROM json_each(?) j
        LEFT JOIN clientes c ON c.telefono = j.value
        LEFT JOIN movimientos m ON m.cliente_id = c.id
        GROUP BY j.value ORDER BY j.value
      `).bind(JSON.stringify(telefonos)).all();

      return respuesta({ clientes: (filas.results || []).map(f => ({
        telefono: f.telefono,
        saldo: Number(f.saldo)
      })) });
    }

    if (datos.accion !== "aplicar") {
      return respuesta({ error: "Operacion desconocida" }, 400);
    }

    const id = datos.clave_operacion;
    const motivo = datos.motivo;
    const cambios = datos.cambios;

    if (typeof id !== "string" || !UUID.test(id) ||
        typeof motivo !== "string" || motivo.trim().length < 8 ||
        motivo.trim().length > 200 ||
        !Array.isArray(cambios) || cambios.length < 1 ||
        cambios.length > MAX_CLIENTES) {
      return respuesta({ error: "Lote o motivo invalido (8 a 200 caracteres)" }, 400);
    }

    const vistos = new Set();
    const normalizados = [];
    for (const item of cambios) {
      if (!item || typeof item !== "object" ||
          typeof item.telefono !== "string" || !TELEFONO.test(item.telefono) ||
          !Number.isInteger(item.delta) || item.delta === 0 ||
          Math.abs(item.delta) > 50 ||
          !Number.isInteger(item.saldo_esperado) ||
          item.saldo_esperado < 0 || item.saldo_esperado > 1000000 ||
          item.saldo_esperado + item.delta < 0 ||
          vistos.has(item.telefono)) {
        return respuesta({ error: "Cambios invalidos, repetidos o con saldo negativo" }, 400);
      }
      vistos.add(item.telefono);
      normalizados.push({
        telefono: item.telefono,
        delta: item.delta,
        saldo_esperado: item.saldo_esperado
      });
    }
    normalizados.sort((a, b) => a.telefono.localeCompare(b.telefono));
    const textoMotivo = motivo.trim();
    const huella = await digestHex(JSON.stringify([textoMotivo, normalizados]));

    // Un reintento del mismo lote devuelve el resultado original.
    const existente = await resultadoLote(env.DB, id, empleado);
    if (existente) {
      if (existente.lote.empleado_id !== empleado.id ||
          existente.lote.huella !== huella) {
        return respuesta({ error: "Identificador usado con otros cambios" }, 409);
      }
      return respuesta({ aplicado: false, repetido: true, ...existente });
    }

    const filas = normalizados.map(c => ({
      ...c,
      id_cliente: crypto.randomUUID(),
      id_qr: crypto.randomUUID(),
      id_movimiento: crypto.randomUUID()
    }));
    const json = JSON.stringify(filas);

    try {
      // Unicamente cuatro sentencias, dentro de UN batch transaccional.
      // Los triggers de la migracion abortan la transaccion si un saldo
      // cambio, falta algun movimiento o el lote no esta autorizado.
      await env.DB.batch([
        env.DB.prepare(`
          INSERT INTO lotes_carga (id, empleado_id, motivo, huella, cantidad)
          SELECT ?, e.id, ?, ?, ? FROM empleados e
          WHERE e.id = ? AND e.activo = 1 AND (
            e.rol = 'administrador' OR
            CAST(COALESCE((SELECT valor FROM configuracion
               WHERE clave = 'carga_masiva_empleados_hasta'), '0') AS INTEGER) IN (-1)
            OR CAST(COALESCE((SELECT valor FROM configuracion
               WHERE clave = 'carga_masiva_empleados_hasta'), '0') AS INTEGER) > unixepoch()
          )
        `).bind(id, textoMotivo, huella, filas.length, empleado.id),
        env.DB.prepare(`
          INSERT INTO clientes (id, telefono, qr_id)
          SELECT
            json_extract(j.value, '$.id_cliente'),
            json_extract(j.value, '$.telefono'),
            json_extract(j.value, '$.id_qr')
          FROM json_each(?) j WHERE 1
          ON CONFLICT(telefono) DO NOTHING
        `).bind(json),
        env.DB.prepare(`
          INSERT INTO movimientos (
            id, cliente_id, empleado_id, tipo, sellos,
            clave_operacion, observacion, lote_id, saldo_previo
          )
          SELECT
            json_extract(j.value, '$.id_movimiento'),
            c.id, ?, 'ajuste',
            CAST(json_extract(j.value, '$.delta') AS INTEGER),
            ? || ':' || c.telefono,
            'Carga masiva: ' || ?, ?,
            CAST(json_extract(j.value, '$.saldo_esperado') AS INTEGER)
          FROM json_each(?) j
          JOIN clientes c ON c.telefono = json_extract(j.value, '$.telefono')
        `).bind(empleado.id, id, textoMotivo, id, json),
        env.DB.prepare(`
          UPDATE lotes_carga SET estado = 'completado' WHERE id = ?
        `).bind(id)
      ]);
    } catch (error) {
      // Podria tratarse de un reintento concurrente ya confirmado.
      const despues = await resultadoLote(env.DB, id, empleado);
      if (despues && despues.lote.empleado_id === empleado.id &&
          despues.lote.huella === huella) {
        return respuesta({ aplicado: false, repetido: true, ...despues });
      }
      console.error("Lote rechazado:", error);
      return respuesta({
        error: "Lote no aplicado. Revisa saldos, permisos y duplicados; actualiza la lista antes de volver a empezar."
      }, 409);
    }

    const confirmado = await resultadoLote(env.DB, id, empleado);
    if (!confirmado || confirmado.lote.estado !== "completado" ||
        confirmado.detalles.length !== filas.length) {
      return respuesta({ error: "Estado del lote pendiente de confirmar. Reintenta con la misma clave." }, 503);
    }
    return respuesta({ aplicado: true, repetido: false, ...confirmado });
  } catch (error) {
    console.error("Carga masiva:", error);
    return respuesta({ error: "No se pudo procesar la carga masiva" }, 503);
  }
}
