#!/bin/bash
# populate-obd-db.sh - TITANIUM v9.7.0
# Aplica la migration baseline y los 45 batch files al D1 OBD_DB
# Requiere: wrangler CLI autenticado (npx wrangler whoami)

set -euo pipefail

DB_NAME="borg-obd-db"
MIGRATION_FILE="sqlODB/migrations/0001_baseline_create.sql"
BATCHES_DIR="sqlODB/batches"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "============================================================"
echo "🔧 OBD DATABASE POPULATION — v9.7.0-TITANIUM"
echo "============================================================"
echo ""

# Verify we're in the right directory
if [ ! -f "$SCRIPT_DIR/$MIGRATION_FILE" ]; then
    echo "❌ ERROR: No se encontro $MIGRATION_FILE"
    echo "   Ejecutar desde la raiz del repo: scripts/populate-obd-db.sh"
    exit 1
fi

BATCH_COUNT=$(ls "$SCRIPT_DIR/$BATCHES_DIR"/batch_*.sql 2>/dev/null | wc -l)
if [ "$BATCH_COUNT" -eq 0 ]; then
    echo "❌ ERROR: No se encontraron batch files en $BATCHES_DIR/"
    exit 1
fi

echo "  Base de datos: $DB_NAME"
echo "  Migration:     $MIGRATION_FILE"
echo "  Batch files:   $BATCH_COUNT"
echo ""

# ============================================================
# STEP 1: Verify wrangler is authenticated
# ============================================================
echo "--- Paso 1/4: Verificando wrangler CLI... ---"
if ! npx wrangler whoami > /dev/null 2>&1; then
    echo "❌ ERROR: wrangler no esta autenticado."
    echo "   Ejecuta: npx wrangler login"
    exit 1
fi
echo "✅ Wrangler autenticado."
echo ""

# ============================================================
# STEP 2: Verify D1 database exists
# ============================================================
echo "--- Paso 2/4: Verificando D1 database '$DB_NAME'... ---"
if ! npx wrangler d1 list 2>/dev/null | grep -q "$DB_NAME"; then
    echo "⚠️  La base de datos '$DB_NAME' no existe. Creandola..."
    npx wrangler d1 create "$DB_NAME" --preview false
    echo ""
    echo "⚠️  IMPORTANTE: Copia el database_id del output arriba y"
    echo "   actualiza wrangler.toml si es necesario."
else
    echo "✅ Base de datos '$DB_NAME' encontrada."
fi
echo ""

# ============================================================
# STEP 3: Apply baseline migration
# ============================================================
echo "--- Paso 3/4: Aplicando migration baseline... ---"
echo "   File: $MIGRATION_FILE"

MIGRATION_SQL=$(cat "$SCRIPT_DIR/$MIGRATION_FILE")

# Split migration into individual statements for D1 API compatibility
# D1 execute accepts multiple statements separated by ;
echo "$MIGRATION_SQL" | npx wrangler d1 execute "$DB_NAME" --remote --command="$(cat "$SCRIPT_DIR/$MIGRATION_FILE")"

echo "✅ Migration baseline aplicada."
echo ""

# ============================================================
# STEP 4: Execute all batch files
# ============================================================
echo "--- Paso 4/4: Ejecutando $BATCH_COUNT batch files... ---"

SUCCESS=0
FAILED=0
TOTAL_CODES=0
CURRENT=0

for BATCH_FILE in "$SCRIPT_DIR/$BATCHES_DIR"/batch_*.sql; do
    CURRENT=$((CURRENT + 1))
    BATCH_NAME=$(basename "$BATCH_FILE")
    LINES=$(wc -l < "$BATCH_FILE")
    
    printf "\r  [%2d/%2d] %-20s (%d lineas) " "$CURRENT" "$BATCH_COUNT" "$BATCH_NAME" "$LINES"
    
    # Execute batch - D1 execute can handle multiple INSERT statements
    if npx wrangler d1 execute "$DB_NAME" --remote --file="$BATCH_FILE" > /dev/null 2>&1; then
        echo "✅"
        SUCCESS=$((SUCCESS + 1))
        # Count approximate INSERT statements
        CODES=$(grep -c "INSERT" "$BATCH_FILE" 2>/dev/null || echo "0")
        TOTAL_CODES=$((TOTAL_CODES + CODES))
    else
        echo "❌ (reintentando con comando individual...)"
        # Fallback: try command mode
        if npx wrangler d1 execute "$DB_NAME" --remote --command="$(cat "$BATCH_FILE")" > /dev/null 2>&1; then
            echo "           ✅ Recuperado en segundo intento"
            SUCCESS=$((SUCCESS + 1))
            CODES=$(grep -c "INSERT" "$BATCH_FILE" 2>/dev/null || echo "0")
            TOTAL_CODES=$((TOTAL_CODES + CODES))
        else
            FAILED=$((FAILED + 1))
            echo "           ❌ FALLÓ: $BATCH_NAME"
        fi
    fi
done

echo ""
echo "============================================================"
echo "📊 RESUMEN:"
echo "   Batches exitosos:  $SUCCESS / $BATCH_COUNT"
echo "   Batches fallidos:  $FAILED"
echo "   Codigos OBD:       ~$TOTAL_CODES"
echo ""

if [ "$FAILED" -gt 0 ]; then
    echo "❌ Hubo $FAILED error(es). Revisa los batches fallidos arriba."
    echo ""
    echo "Para re-ejecutar un batch especifico:"
    echo "   npx wrangler d1 execute borg-obd-db --remote --file=sqlODB/batches/batch_X.sql"
    exit 1
else
    echo "✅ Todos los batches ejecutados correctamente."
fi

# ============================================================
# VERIFICATION: Count records in DB
# ============================================================
echo ""
echo "--- Verificacion final ---"
ROW_COUNT=$(npx wrangler d1 execute "$DB_NAME" --remote --command="SELECT COUNT(*) as total FROM obd_codes" \
    --json 2>/dev/null | grep -o '"total":[0-9]*' | head -1 | grep -o '[0-9]*' || echo "?")

echo "   Registros en obd_codes: $ROW_COUNT"
echo ""

# Test FTS5 search
echo "   Probando busqueda FTS5..."
FTS_TEST=$(npx wrangler d1 execute "$DB_NAME" --remote \
    --command="SELECT code, description FROM obd_codes_fts WHERE obd_codes_fts MATCH 'P0300' LIMIT 1" \
    --json 2>/dev/null || echo "error")

if echo "$FTS_TEST" | grep -q "P0300"; then
    echo "   ✅ FTS5 busqueda funcional (P0300 encontrado)."
else
    echo "   ⚠️  FTS5 no devolvio resultados para P0300."
fi

echo ""
echo "============================================================"
echo "🏁 OBD Database poblado exitosamente."
echo "============================================================"
