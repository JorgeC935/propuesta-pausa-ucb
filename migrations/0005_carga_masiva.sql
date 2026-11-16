-- PAUSA V2 / Migracion 5: ajustes masivos auditables.
-- El personal solo puede ejecutar lotes mientras el permiso temporal esta activo.
INSERT OR IGNORE INTO configuracion (clave, valor)
VALUES ('carga_masiva_empleados_hasta', '0');

CREATE TABLE IF NOT EXISTS lotes_carga (
    id TEXT PRIMARY KEY,
    empleado_id TEXT NOT NULL REFERENCES empleados(id),
    motivo TEXT NOT NULL CHECK(length(trim(motivo)) BETWEEN 8 AND 200),
    huella TEXT NOT NULL CHECK(length(huella) = 64),
    cantidad INTEGER NOT NULL CHECK(cantidad BETWEEN 1 AND 50),
    estado TEXT NOT NULL DEFAULT 'pendiente'
        CHECK(estado IN ('pendiente', 'completado')),
    creado_en INTEGER NOT NULL DEFAULT (unixepoch())
);

ALTER TABLE movimientos ADD COLUMN lote_id TEXT REFERENCES lotes_carga(id);
ALTER TABLE movimientos ADD COLUMN saldo_previo INTEGER
    CHECK (saldo_previo IS NULL OR saldo_previo >= 0);
CREATE INDEX IF NOT EXISTS idx_movimientos_lote ON movimientos(lote_id);
CREATE INDEX IF NOT EXISTS idx_lotes_empleado ON lotes_carga(empleado_id, creado_en);

-- Protege la actualizacion incluso si se cambio el saldo despues de consultarlo.
-- Se verifica en el instante de cada INSERT dentro de la misma transaccion.
CREATE TRIGGER IF NOT EXISTS validar_ajuste_lote
BEFORE INSERT ON movimientos
WHEN NEW.lote_id IS NOT NULL
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM lotes_carga l
        WHERE l.id = NEW.lote_id AND l.estado = 'pendiente'
    ) THEN RAISE(ABORT, 'lote_no_valido') END;

    SELECT CASE WHEN NEW.tipo <> 'ajuste'
        OR NEW.saldo_previo IS NULL
        OR NEW.sellos = 0
        OR NEW.sellos < -50 OR NEW.sellos > 50
        THEN RAISE(ABORT, 'ajuste_no_valido') END;

    SELECT CASE WHEN (
        SELECT COALESCE(SUM(m.sellos), 0)
        FROM movimientos m WHERE m.cliente_id = NEW.cliente_id
    ) <> NEW.saldo_previo
        THEN RAISE(ABORT, 'saldo_desactualizado') END;

    SELECT CASE WHEN NEW.saldo_previo + NEW.sellos < 0
        THEN RAISE(ABORT, 'saldo_insuficiente') END;

    SELECT CASE WHEN EXISTS (
        SELECT 1 FROM movimientos m
        WHERE m.lote_id = NEW.lote_id
          AND m.cliente_id = NEW.cliente_id
    ) THEN RAISE(ABORT, 'cliente_repetido') END;
END;

-- Evita completar un lote al que le falten movimientos.
-- Si se incumple, D1.batch revierte todas las sentencias del lote.
CREATE TRIGGER IF NOT EXISTS validar_cierre_lote
BEFORE UPDATE OF estado ON lotes_carga
WHEN NEW.estado = 'completado'
BEGIN
    SELECT CASE WHEN (
        SELECT COUNT(*) FROM movimientos m WHERE m.lote_id = NEW.id
    ) <> NEW.cantidad
    THEN RAISE(ABORT, 'lote_incompleto') END;
END;
