
import {
  createHash,
  scrypt,
  timingSafeEqual
} from "node:crypto";
import { Buffer } from "node:buffer";

const PARAMETROS = {
  N: 32768,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024
};

export async function verificarContrasena(clave, hashGuardado) {
  const formato =
    /^scrypt\$32768\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{128})$/;

  const partes = formato.exec(hashGuardado || "");

  if (!partes) return false;

  const sal = Buffer.from(partes[1], "hex");
  const esperado = Buffer.from(partes[2], "hex");

  const calculado = await new Promise((resolve, reject) => {
    scrypt(clave, sal, 64, PARAMETROS, (error, resultado) => {
      if (error) reject(error);
      else resolve(resultado);
    });
  });

  return timingSafeEqual(calculado, esperado);
}

export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export async function empleadoAutenticado(env, request) {
  const cookies = request.headers.get("Cookie") || "";
  const coincidencia =
    /(?:^|;\s*)pausa_sesion=([a-f0-9]{64})(?:;|$)/.exec(cookies);

  if (!coincidencia) return null;

  const hash = hashToken(coincidencia[1]);

  return env.DB.prepare(`
    SELECT e.id, e.usuario, e.rol
    FROM sesiones s
    JOIN empleados e ON e.id = s.empleado_id
    WHERE s.token_hash = ?
      AND s.expira_en > unixepoch()
      AND e.activo = 1
  `).bind(hash).first();
}
