#!/bin/bash
# cleanup-github-secrets.sh - TITANIUM v9.7.0
# Limpia secrets innecesarios del repositorio GitHub.
# Evidencia: solo las variables listadas aqui son referenciadas en el codigo fuente.
# Cualquier otra variable es HUELLA MUERTA y debe eliminarse.
#
# REQUISITOS:
#   - gh CLI autenticado (gh auth status)
#   - Permisos de admin en el repositorio
#
# USO:
#   export GITHUB_REPO="owner/repo"
#   ./scripts/cleanup-github-secrets.sh

set -euo pipefail

REPO="${GITHUB_REPO:-}"

if [ -z "$REPO" ]; then
    echo "❌ ERROR: GITHUB_REPO no definida."
    echo "   export GITHUB_REPO=MarketCeoJR/miniaturev3"
    echo "   (o tu organizacion/repo correspondiente)"
    exit 1
fi

# Verify gh CLI
if ! command -v gh &> /dev/null; then
    echo "❌ ERROR: 'gh' CLI no encontrado."
    echo "   Instalar: https://cli.github.com/"
    exit 1
fi

if ! gh auth status &> /dev/null; then
    echo "❌ ERROR: gh CLI no autenticado."
    echo "   Ejecutar: gh auth login"
    exit 1
fi

echo "============================================================"
echo "🧹 GITHUB SECRETS CLEANUP — v9.7.0-TITANIUM"
echo "============================================================"
echo ""
echo "  Repositorio: $REPO"
echo "  Evidencia:   Variables extraidas del codigo fuente"
echo ""

# ============================================================
# LISTA BLANCA: Secrets que el CODIGO realmente necesita
# Referencia: shared/types/index.ts CoreEnv interface
#             + wrangler.toml [vars]
#             + provision-secrets.sh
# ============================================================
REQUIRED_SECRETS=(
    # --- TELEGRAM ---
    "FRONTEND_BOT_TOKEN"
    "BACKEND_BOT_TOKEN"
    "TELEGRAM_ADMIN_IDS"
    "FRONTEND_BOT_INFO"
    "BACKEND_BOT_INFO"

    # --- SEGURIDAD ---
    "BORG_SECRET_KEY"

    # --- IA ---
    "GEMINI_API_KEY"

    # --- WHATSAPP (solo 4, WHATSAPP_API_VERSION esta en wrangler.toml, META_APP_ID en INFRA_SECRETS) ---
    "WHATSAPP_ACCESS_TOKEN"
    "WHATSAPP_APP_SECRET"
    "WHATSAPP_VERIFY_TOKEN"
    "WHATSAPP_PHONE_NUMBER_ID"

    # --- TALLER (geolocalización) ---
    "TALLER_LATITUD"
    "TALLER_LONGITUD"
    "TALLER_MAPS_URL"

    # --- RETENCIÓN (maintenance-service.ts) ---
    "RETENTION_LOGS_DAYS"
    "RETENTION_UPDATES_HOURS"
    "RETENTION_WHATSAPP_DAYS"
)

# --- Variables que NO son secrets de Wrangler sino de infraestructura ---
# CLOUDFLARE_API_TOKEN  → usado por gh actions / wrangler deploy, no por el Worker
# CLOUDFLARE_ACCOUNT_ID → idem

INFRA_SECRETS=(
    "CLOUDFLARE_API_TOKEN"
    "CLOUDFLARE_ACCOUNT_ID"
    # --- META (CI-only, no Wrangler) ---
    "META_APP_ID"
)

# --- Variables que son INNECESARIAS (huella muerta) ---
# Evidencia: grep -rn "VARIABLE" en todo el codebase = 0 resultados
KNOWN_DEAD_SECRETS=(
    "INTERNAL_SERVICE_TOKEN"
)

# ============================================================
# OBTENER TODOS LOS SECRETS ACTUALES DEL REPO
# ============================================================
echo "--- Obteniendo secrets actuales del repositorio... ---"
ALL_SECRETS=()
while IFS= read -r line; do
    NAME=$(echo "$line" | awk '{print $1}')
    if [ -n "$NAME" ]; then
        ALL_SECRETS+=("$NAME")
    fi
done < <(gh secret list -R "$REPO" 2>/dev/null || echo "ERROR_LISTING")

if [ ${#ALL_SECRETS[@]} -eq 0 ] || [ "${ALL_SECRETS[0]}" = "ERROR_LISTING" ]; then
    echo "❌ ERROR: No se pudieron listar los secrets. Verifica permisos."
    exit 1
fi

echo "   Encontrados: ${#ALL_SECRETS[@]} secrets"
echo ""

# ============================================================
# CLASIFICAR CADA SECRET
# ============================================================
echo "--- Clasificacion ---"
echo ""

TO_KEEP=()
TO_DELETE=()
TO_INVESTIGATE=()

for SECRET in "${ALL_SECRETS[@]}"; do
    # Check if required
    IS_REQUIRED=false
    for REQ in "${REQUIRED_SECRETS[@]}"; do
        if [ "$SECRET" = "$REQ" ]; then
            IS_REQUIRED=true
            break
        fi
    done

    # Check if infra
    IS_INFRA=false
    for INF in "${INFRA_SECRETS[@]}"; do
        if [ "$SECRET" = "$INF" ]; then
            IS_INFRA=true
            break
        fi
    done

    # Check if known dead
    IS_DEAD=false
    for DEAD in "${KNOWN_DEAD_SECRETS[@]}"; do
        if [ "$SECRET" = "$DEAD" ]; then
            IS_DEAD=true
            break
        fi
    done

    if [ "$IS_REQUIRED" = true ]; then
        echo "  ✅ MANTENER (codigo lo usa):  $SECRET"
        TO_KEEP+=("$SECRET")
    elif [ "$IS_INFRA" = true ]; then
        echo "  🔧 MANTENER (infraestructura): $SECRET"
        TO_KEEP+=("$SECRET")
    elif [ "$IS_DEAD" = true ]; then
        echo "  ❌ ELIMINAR (huella muerta):   $SECRET"
        TO_DELETE+=("$SECRET")
    else
        # Check if it looks like a WhatsApp token that's not in our required list
        if [[ "$SECRET" == WHATSAPP_* ]]; then
            echo "  ⚠️  SOSPECHOSO (WhatsApp no referenciado): $SECRET"
            TO_DELETE+=("$SECRET")
        elif [[ "$SECRET" == META_* ]]; then
            echo "  ⚠️  SOSPECHOSO (Meta no referenciado):     $SECRET"
            TO_DELETE+=("$SECRET")
        elif [[ "$SECRET" == TELEGRAM_* ]] && [[ "$SECRET" != "TELEGRAM_ADMIN_IDS" ]]; then
            echo "  ⚠️  SOSPECHOSO (Telegram extra):            $SECRET"
            TO_DELETE+=("$SECRET")
        else
            echo "  ❓ INVESTIGAR (no clasificado):    $SECRET"
            TO_INVESTIGATE+=("$SECRET")
        fi
    fi
done

echo ""
echo "============================================================"
echo "📊 RESUMEN:"
echo "   Mantener:      ${#TO_KEEP[@]}"
echo "   Eliminar:      ${#TO_DELETE[@]}"
echo "   Investigar:    ${#TO_INVESTIGATE[@]}"
echo ""

if [ ${#TO_DELETE[@]} -eq 0 ] && [ ${#TO_INVESTIGATE[@]} -eq 0 ]; then
    echo "✅ Todos los secrets estan clasificados correctamente. Nada que eliminar."
    echo "============================================================"
    exit 0
fi

# ============================================================
# CONFIRMAR ELIMINACION
# ============================================================
echo "--- Secrets a eliminar ---"
for SECRET in "${TO_DELETE[@]}"; do
    echo "   ❌ $SECRET"
done

if [ ${#TO_INVESTIGATE[@]} -gt 0 ]; then
    echo ""
    echo "--- Secrets a investigar manualmente ---"
    for SECRET in "${TO_INVESTIGATE[@]}"; do
        echo "   ❓ $SECRET"
    done
fi

echo ""
read -p "⚠️  ¿Eliminar los ${#TO_DELETE[@]} secrets identificados? (escribir ELIMINAR para confirmar): " CONFIRM

if [ "$CONFIRM" != "ELIMINAR" ]; then
    echo "❌ Operacion cancelada por el usuario."
    exit 0
fi

# ============================================================
# EJECUTAR ELIMINACION
# ============================================================
echo ""
echo "--- Ejecutando eliminacion... ---"
DELETED=0
FAILED=0

for SECRET in "${TO_DELETE[@]}"; do
    if gh secret delete "$SECRET" -R "$REPO" > /dev/null 2>&1; then
        echo "  ✅ Eliminado: $SECRET"
        DELETED=$((DELETED + 1))
    else
        echo "  ❌ Fallo al eliminar: $SECRET"
        FAILED=$((FAILED + 1))
    fi
done

echo ""
echo "============================================================"
echo "🏁 LIMPIEZA COMPLETADA"
echo "   Eliminados: $DELETED"
echo "   Fallidos:   $FAILED"
echo ""
echo "Secrets finales requeridos por el Worker:"
for S in "${REQUIRED_SECRETS[@]}"; do
    echo "   - $S"
done
echo "============================================================"
