
import {
  empleadoAutenticado
} from "../../lib/autenticacion.js";

function responder(datos, status = 200) {
  return Response.json(datos, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

export async function onRequestGet({ request, env }) {
  try {
    const empleado = await empleadoAutenticado(env, request);

    if (!empleado) {
      return responder({ error: "Sesion no autorizada" }, 401);
    }

    const admin = empleado.rol === "administrador";
    const url = new URL(request.url);

    const telefono = (url.searchParams.get("telefono") || "").trim();
    const usuario = (url.searchParams.get("usuario") || "").trim().toLowerCase();
    const estado = url.searchParams.get("estado") || "todos";

    if (!["todos", "vigentes", "corregidos"].includes(estado)) {
      return responder({ error: "Filtro invalido" }, 400);
    }

    if (telefono && !/^[0-9]{8}$/.test(telefono)) {
      return responder({ error: "Telefono invalido" }, 400);
    }

    if (usuario && !/^[a-z0-9._-]{3,32}$/.test(usuario)) {
      return responder({ error: "Usuario invalido" }, 400);
    }

    const paginaTexto = url.searchParams.get("pagina") || "1";
    const pagina = Number(paginaTexto);

    if (!Number.isInteger(pagina) || pagina < 1 || pagina > 1000) {
      return responder({ error: "Pagina invalida" }, 400);
    }

    const limite = admin ? 30 : 10;
    const desplazamiento = admin ? (pagina - 1) * limite : 0;

    const condiciones = [
      "m.tipo IN ('compra', 'canje')"
    ];

    const parametros = [empleado.id, empleado.rol];

    if (!admin) {
      condiciones.push("m.empleado_id = ?");
      parametros.push(empleado.id);
    } else {
      if (telefono) {
        condiciones.push("c.telefono = ?");
        parametros.push(telefono);
      }

      if (usuario) {
        condiciones.push("e.usuario = ?");
        parametros.push(usuario);
      }

      if (estado === "corregidos") {
        condiciones.push("cor.id IS NOT NULL");
      } else if (estado === "vigentes") {
        condiciones.push("cor.id IS NULL");
      }
    }

    const sql = `
      SELECT
        m.id,
        m.tipo,
        m.sellos,
        m.creado_en,
        c.telefono,
        e.usuario AS registrado_por,
        cor.tipo AS correccion_tipo,
        cor.telefono_destino,
        cor.motivo,
        cor.creado_en AS corregido_en,
        ec.usuario AS corregido_por,

        CASE
          WHEN m.tipo = 'compra'
           AND m.sellos = 1
           AND cor.id IS NULL
           AND (
             ? = 'administrador'
             OR (
               m.empleado_id = ?
               AND m.creado_en >= unixepoch() - 900
             )
           )
           AND COALESCE((
             SELECT SUM(s.sellos)
             FROM movimientos s
             WHERE s.cliente_id = m.cliente_id
           ), 0) >= 1
          THEN 1
          ELSE 0
        END AS puede_corregir

      FROM movimientos m
      JOIN clientes c ON c.id = m.cliente_id
      JOIN empleados e ON e.id = m.empleado_id

      LEFT JOIN correcciones cor
        ON cor.movimiento_original_id = m.id

      LEFT JOIN empleados ec
        ON ec.id = cor.empleado_id

      WHERE ${condiciones.join(" AND ")}

      ORDER BY m.creado_en DESC, m.id DESC
      LIMIT ? OFFSET ?
    `;

    // Los parametros del CASE aparecen antes del WHERE.
    const resultado = await env.DB.prepare(sql).bind(
      empleado.rol,
      empleado.id,
      ...parametros.slice(2),
      limite + 1,
      desplazamiento
    ).all();

    const registros = resultado.results || [];

    return responder({
      movimientos: registros.slice(0, limite),
      pagina: admin ? pagina : 1,
      tiene_mas: admin && registros.length > limite
    });

  } catch (error) {
    console.error("Error consultando movimientos:", error);
    return responder({ error: "No se pudo consultar el historial" }, 503);
  }
}
