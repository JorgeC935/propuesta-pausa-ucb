
import { randomBytes } from "node:crypto";
import {
  verificarContrasena,
  hashToken
} from "../../../lib/autenticacion.js";

export async function onRequestPost({ request, env }) {
  const origen = request.headers.get("Origin");

  if (origen && origen !== new URL(request.url).origin) {
    return Response.json(
      { error: "Origen no autorizado" },
      { status: 403 }
    );
  }

  try {
    const datos = await request.json();

    const usuario = String(datos.usuario ?? "")
      .trim()
      .toLowerCase();

    const contrasena = String(datos.contrasena ?? "");

    if (
      !/^[a-z0-9._-]{3,32}$/.test(usuario) ||
      contrasena.length < 12 ||
      contrasena.length > 128
    ) {
      return Response.json(
        { error: "Credenciales incorrectas" },
        { status: 401 }
      );
    }

    const empleado = await env.DB.prepare(`
      SELECT id, usuario, contrasena_hash, rol, activo
      FROM empleados
      WHERE usuario = ?
    `).bind(usuario).first();

    if (
      !empleado ||
      empleado.activo !== 1 ||
      !(await verificarContrasena(
        contrasena,
        empleado.contrasena_hash
      ))
    ) {
      return Response.json(
        { error: "Credenciales incorrectas" },
        { status: 401 }
      );
    }

    const token = randomBytes(32).toString("hex");
    const expira = Math.floor(Date.now() / 1000) + 30 * 86400;

    await env.DB.prepare(`
      INSERT INTO sesiones (token_hash, empleado_id, expira_en)
      VALUES (?, ?, ?)
    `).bind(hashToken(token), empleado.id, expira).run();

    const seguro =
      new URL(request.url).protocol === "https:"
        ? "; Secure"
        : "";

    const cookie =
      `pausa_sesion=${token}; Path=/; Max-Age=2592000; ` +
      `HttpOnly; SameSite=Strict${seguro}`;

    return Response.json(
      {
        usuario: empleado.usuario,
        rol: empleado.rol
      },
      {
        headers: {
          "Set-Cookie": cookie,
          "Cache-Control": "no-store"
        }
      }
    );

  } catch (error) {
    console.error("Error de autenticacion:", error);

    return Response.json(
      { error: "No se pudo iniciar sesion" },
      { status: 500 }
    );
  }
}
