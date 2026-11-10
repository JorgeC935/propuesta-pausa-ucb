-- PAUSA V2 - migracion 4
-- Cuotas para consultas anonimas. Las claves son HMAC con secreto del servidor.
CREATE TABLE IF NOT EXISTS limites_consulta_publica (
    clave TEXT PRIMARY KEY,
    intentos INTEGER NOT NULL DEFAULT 0 CHECK (intentos >= 0),
    ventana_hasta INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_limites_consulta_publica_ventana
ON limites_consulta_publica(ventana_hasta);
