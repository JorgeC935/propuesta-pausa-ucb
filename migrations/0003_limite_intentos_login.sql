-- PAUSA V2 - Migracion 3
-- Limite de intentos de autenticacion por usuario y origen.
-- clave es un SHA-256; no almacenamos IP en texto claro.
CREATE TABLE IF NOT EXISTS intentos_login (
    clave TEXT PRIMARY KEY,
    intentos INTEGER NOT NULL DEFAULT 0 CHECK (intentos >= 0),
    ventana_hasta INTEGER NOT NULL,
    bloqueado_hasta INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_intentos_login_ventana
ON intentos_login(ventana_hasta);
