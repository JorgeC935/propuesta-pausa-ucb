
import {
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

  const cookies = request.headers.get("Cookie") || "";
  const coincidencia =
    /(?:^|;\s*)pausa_sesion=([a-f0-9]{64})(?:;|$)/.exec(cookies);

  if (coincidencia) {
    await env.DB.prepare(
      "DELETE FROM sesiones WHERE token_hash = ?"
    ).bind(hashToken(coincidencia[1])).run();
  }

  const seguro =
    new URL(request.url).protocol === "https:"
      ? "; Secure"
      : "";

  return Response.json(
    { mensaje: "Sesion cerrada" },
    {
      headers: {
        "Set-Cookie":
          `pausa_sesion=; Path=/; Max-Age=0; ` +
          `HttpOnly; SameSite=Strict${seguro}`,
        "Cache-Control": "no-store"
      }
    }
  );
}
