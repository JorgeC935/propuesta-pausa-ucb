
import { randomBytes, scrypt } from "node:crypto";
import { empleadoAutenticado } from "../../lib/autenticacion.js";

function responder(datos, estado = 200) {
  return Response.json(datos, {
    status: estado,
    headers: { "Cache-Control": "no-store" }
  });
}

async function comprobarAcceso(request, env) {
  const empleado = await empleadoAutenticado(env, request);

  if (!empleado) {
    return { error: responder({ error: "Sesion no autorizada" }, 401) };
  }

  if (empleado.rol !== "administrador") {
    return { error: responder({ error: "Permiso denegado" }, 403) };
  }

  return { empleado };
}

async function generarHash(clave) {
  const sal = randomBytes(16);

  const resultado = await new Promise((resolve, reject) => {
    scrypt(clave, sal, 64, {
      N: 32768,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024
    }, (error, derivado) => {
      if (error) reject(error);
      else resolve(derivado);
    });
  });

  return `scrypt$32768$8$1$${sal.toString("hex")}$${resultado.toString("hex")}`;
}

function contrasenaValida(clave) {
  return typeof clave === "string" &&
    clave.length >= 12 &&
    clave.length <= 128;
}

function normalizarWhatsApp(valor) {
  if (typeof valor !== "string") return null;

  const limpio = valor.trim().replace(/[\s()-]/g, "");

  if (limpio === "") return "";

  // Celular boliviano de ocho digitos.
  if (/^[67][0-9]{7}$/.test(limpio)) {
    return "591" + limpio;
  }

  // Numero internacional, con o sin +.
  if (/^\+?[1-9][0-9]{8,14}$/.test(limpio)) {
    return limpio.replace(/^\+/, "");
  }

  return null;
}

export async function onRequestGet({ request, env }) {
  try {
    const acceso = await comprobarAcceso(request, env);
    if (acceso.error) return acceso.error;

    const [configuracion, listado] = await Promise.all([
      env.DB.prepare(`
        SELECT valor
        FROM configuracion
        WHERE clave = 'whatsapp_contacto'
      `).first(),

      env.DB.prepare(`
        SELECT id, usuario, rol, activo, creado_en
        FROM empleados
        ORDER BY rol ASC, usuario ASC
      `).all()
    ]);

    return responder({
      whatsapp_contacto: configuracion?.valor ?? "",
      empleados: listado.results
    });
  } catch (error) {
    console.error("Error en administracion:", error);
    return responder({ error: "Error del servidor" }, 503);
  }
}

export async function onRequestPost({ request, env }) {
  if (request.headers.get("Origin") !== new URL(request.url).origin) {
    return responder({ error: "Origen no autorizado" }, 403);
  }

  const acceso = await comprobarAcceso(request, env);
  if (acceso.error) return acceso.error;

  if (!request.headers.get("Content-Type")?.toLowerCase()
      .startsWith("application/json")) {
    return responder({ error: "Formato no admitido" }, 415);
  }

  let datos;

  try {
    const texto = await request.text();

    if (texto.length > 4096) {
      return responder({ error: "Solicitud demasiado grande" }, 413);
    }

    datos = JSON.parse(texto);

    if (!datos || typeof datos !== "object" ||
        Array.isArray(datos)) {
      return responder({ error: "Datos invalidos" }, 400);
    }
  } catch {
    return responder({ error: "JSON invalido" }, 400);
  }

  try {
    if (datos.accion === "guardar_whatsapp") {
      const numero = normalizarWhatsApp(datos.numero);

      if (numero === null) {
        return responder({
          error: "Introduce un numero de WhatsApp valido"
        }, 400);
      }

      await env.DB.prepare(`
        INSERT INTO configuracion (clave, valor)
        VALUES ('whatsapp_contacto', ?)
        ON CONFLICT(clave) DO UPDATE SET
          valor = excluded.valor,
          actualizado_en = unixepoch()
      `).bind(numero).run();

      return responder({
        mensaje: "WhatsApp actualizado",
        whatsapp_contacto: numero
      });
    }

    if (datos.accion === "crear_empleado") {
      const usuario = String(datos.usuario ?? "")
        .trim()
        .toLowerCase();

      if (!/^[a-z0-9._-]{3,32}$/.test(usuario)) {
        return responder({
          error: "Usuario invalido: utiliza entre 3 y 32 caracteres"
        }, 400);
      }

      if (!contrasenaValida(datos.contrasena)) {
        return responder({
          error: "La contrasena debe tener entre 12 y 128 caracteres"
        }, 400);
      }

      const existente = await env.DB.prepare(`
        SELECT id FROM empleados WHERE usuario = ?
      `).bind(usuario).first();

      if (existente) {
        return responder({ error: "El usuario ya existe" }, 409);
      }

      const hash = await generarHash(datos.contrasena);

      try {
        await env.DB.prepare(`
          INSERT INTO empleados
            (id, usuario, contrasena_hash, rol, activo)
          VALUES (?, ?, ?, 'empleado', 1)
        `).bind(crypto.randomUUID(), usuario, hash).run();
      } catch {
        return responder({
          error: "No se pudo crear el usuario; verifica que no exista"
        }, 409);
      }

      return responder({
        mensaje: "Empleado creado correctamente",
        usuario
      }, 201);
    }

    if (
      datos.accion === "cambiar_estado" ||
      datos.accion === "restablecer_clave"
    ) {
      const id = String(datos.id ?? "");

      if (!/^[a-f0-9-]{36}$/i.test(id)) {
        return responder({ error: "Empleado invalido" }, 400);
      }

      const destino = await env.DB.prepare(`
        SELECT id, usuario, rol
        FROM empleados
        WHERE id = ?
      `).bind(id).first();

      if (!destino) {
        return responder({ error: "Empleado inexistente" }, 404);
      }

      // No permitir modificar administradores desde este panel.
      if (destino.rol !== "empleado") {
        return responder({
          error: "No se permite modificar administradores"
        }, 403);
      }

      if (datos.accion === "cambiar_estado") {
        if (typeof datos.activo !== "boolean") {
          return responder({ error: "Estado invalido" }, 400);
        }

        await env.DB.batch([
          env.DB.prepare(`
            UPDATE empleados SET activo = ?
            WHERE id = ? AND rol = 'empleado'
          `).bind(datos.activo ? 1 : 0, id),

          env.DB.prepare(`
            DELETE FROM sesiones WHERE empleado_id = ?
          `).bind(id)
        ]);

        return responder({
          mensaje: datos.activo
            ? "Empleado habilitado"
            : "Empleado deshabilitado"
        });
      }

      if (!contrasenaValida(datos.contrasena)) {
        return responder({
          error: "La nueva contrasena debe tener entre 12 y 128 caracteres"
        }, 400);
      }

      const nuevoHash = await generarHash(datos.contrasena);

      await env.DB.batch([
        env.DB.prepare(`
          UPDATE empleados SET contrasena_hash = ?
          WHERE id = ? AND rol = 'empleado'
        `).bind(nuevoHash, id),

        env.DB.prepare(`
          DELETE FROM sesiones WHERE empleado_id = ?
        `).bind(id)
      ]);

      return responder({
        mensaje: "Contrasena restablecida; sesiones anteriores cerradas"
      });
    }

    return responder({ error: "Operacion desconocida" }, 400);

  } catch (error) {
    console.error("Error administrativo:", error);
    return responder({ error: "No se pudo completar la operacion" }, 503);
  }
}
