#!/bin/bash
# sync-webhooks.sh - TITANIUM v9.7.0 (UNIFIED)
# Sincroniza TODOS los webhooks: Telegram (frontend + backend) + WhatsApp (Meta)
# Uso: export las variables necesarias y ejecutar

set -euo pipefail

ERRORS=0

# === VALIDACIONES TELEGRAM ===
if [ -z "$BACKEND_BOT_TOKEN" ] || [ -z "$FRONTEND_BOT_TOKEN" ] || [ -z "$BORG_SECRET_KEY" ] || [ -z "$WORKER_URL" ]; then
    echo "❌ Error: Faltan variables de entorno para Telegram."
    echo "Requeridas: BACKEND_BOT_TOKEN, FRONTEND_BOT_TOKEN, BORG_SECRET_KEY, WORKER_URL"
    ERRORS=$((ERRORS + 1))
fi

echo "============================================================"
echo "🔗 BORG UNIFIED WEBHOOK SYNC — v9.7.0-TITANIUM"
echo "============================================================"
echo ""

# ============================================================
# SECCION 1: TELEGRAM WEBHOOKS
# ============================================================
echo "--- TELEGRAM WEBHOOKS ---"
echo ""

if [ -n "$BACKEND_BOT_TOKEN" ] && [ -n "$BORG_SECRET_KEY" ] && [ -n "$WORKER_URL" ]; then
    echo "🔄 Registrando Webhook BACKEND..."
    RESPONSE=$(curl -s -X POST "https://api.telegram.org/bot$BACKEND_BOT_TOKEN/setWebhook" \
         -d "url=$WORKER_URL/webhook/backend" \
         -d "secret_token=$BORG_SECRET_KEY" \
         -d "drop_pending_updates=true")
    if echo "$RESPONSE" | grep -q '"ok":true'; then
        echo "✅ Backend Telegram OK"
    else
        echo "❌ Falló Backend Telegram: $RESPONSE"
        ERRORS=$((ERRORS + 1))
    fi

    echo "🔄 Registrando Webhook FRONTEND..."
    RESPONSE=$(curl -s -X POST "https://api.telegram.org/bot$FRONTEND_BOT_TOKEN/setWebhook" \
         -d "url=$WORKER_URL/webhook/frontend" \
         -d "secret_token=$BORG_SECRET_KEY" \
         -d "drop_pending_updates=true")
    if echo "$RESPONSE" | grep -q '"ok":true'; then
        echo "✅ Frontend Telegram OK"
    else
        echo "❌ Falló Frontend Telegram: $RESPONSE"
        ERRORS=$((ERRORS + 1))
    fi
else
    echo "⚠️  Variables Telegram incompletas. Omitiendo registro."
fi

echo ""
echo "--- WHATSAPP WEBHOOK ---"
echo ""

# ============================================================
# SECCION 2: WHATSAPP WEBHOOK (Meta Graph API)
# ============================================================
if [ -n "$WHATSAPP_ACCESS_TOKEN" ] && [ -n "$META_APP_ID" ] && [ -n "$WHATSAPP_VERIFY_TOKEN" ]; then
    WA_CALLBACK_URL="${WHATSAPP_CALLBACK_URL:-$WORKER_URL/webhook/whatsapp}"
    GRAPH_URL="https://graph.facebook.com/v25.0/${META_APP_ID}/subscriptions"

    echo "🔄 Suscribiendo WhatsApp webhook en Meta..."
    echo "   Callback: $WA_CALLBACK_URL"

    WA_RESPONSE=$(curl -s -w "\n%{http_code}" \
        -X POST "$GRAPH_URL" \
        -H "Authorization: Bearer $WHATSAPP_ACCESS_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{
            \"object\": \"whatsapp_business_account\",
            \"callback_url\": \"$WA_CALLBACK_URL\",
            \"verify_token\": \"$WHATSAPP_VERIFY_TOKEN\",
            \"fields\": [\"messages\"]
        }")

    WA_HTTP_CODE=$(echo "$WA_RESPONSE" | tail -1)
    WA_BODY=$(echo "$WA_RESPONSE" | head -n -1)

    if [ "$WA_HTTP_CODE" -ge 200 ] && [ "$WA_HTTP_CODE" -lt 300 ]; then
        echo "✅ WhatsApp Meta suscrito OK (HTTP $WA_HTTP_CODE)"
    else
        echo "❌ Falló WhatsApp: HTTP $WA_HTTP_CODE"
        echo "   Response: $WA_BODY"
        ERRORS=$((ERRORS + 1))
    fi
else
    echo "⚠️  Variables WhatsApp incompletas. Omitiendo suscripcion Meta."
    echo "   Requeridas: WHATSAPP_ACCESS_TOKEN, META_APP_ID, WHATSAPP_VERIFY_TOKEN"
    echo "   WORKER_URL se usa como base del callback (defecto: .../webhook/whatsapp)"
fi

echo ""
echo "--- POST-DEPLOY VERIFICATION ---"
echo ""

# ============================================================
# SECCION 3: VERIFICACION POST-DEPLOY
# ============================================================
if [ -n "$WORKER_URL" ]; then
    echo "🔍 Verificando endpoints del Worker..."

    # Check frontend webhook reachable
    HTTP_FRONTEND=$(curl -s -o /dev/null -w "%{http_code}" "$WORKER_URL/webhook/frontend" 2>/dev/null || echo "000")
    if [ "$HTTP_FRONTEND" = "401" ]; then
        echo "✅ /webhook/frontend → HTTP 401 (esperado: sin secret_token)"
    elif [ "$HTTP_FRONTEND" = "000" ]; then
        echo "⚠️  /webhook/frontend → No alcanzable (HTTP $HTTP_FRONTEND)"
        ERRORS=$((ERRORS + 1))
    else
        echo "✅ /webhook/frontend → HTTP $HTTP_FRONTEND"
    fi

    # Check backend webhook reachable
    HTTP_BACKEND=$(curl -s -o /dev/null -w "%{http_code}" "$WORKER_URL/webhook/backend" 2>/dev/null || echo "000")
    if [ "$HTTP_BACKEND" = "401" ]; then
        echo "✅ /webhook/backend → HTTP 401 (esperado: sin secret_token)"
    elif [ "$HTTP_BACKEND" = "000" ]; then
        echo "⚠️  /webhook/backend → No alcanzable (HTTP $HTTP_BACKEND)"
        ERRORS=$((ERRORS + 1))
    else
        echo "✅ /webhook/backend → HTTP $HTTP_BACKEND"
    fi

    # Check WhatsApp webhook reachable (GET challenge without token = 403)
    HTTP_WA=$(curl -s -o /dev/null -w "%{http_code}" "$WORKER_URL/webhook/whatsapp" 2>/dev/null || echo "000")
    if [ "$HTTP_WA" = "403" ] || [ "$HTTP_WA" = "405" ]; then
        echo "✅ /webhook/whatsapp → HTTP $HTTP_WA (esperado: sin verify_token)"
    elif [ "$HTTP_WA" = "000" ]; then
        echo "⚠️  /webhook/whatsapp → No alcanzable (HTTP $HTTP_WA)"
        ERRORS=$((ERRORS + 1))
    else
        echo "✅ /webhook/whatsapp → HTTP $HTTP_WA"
    fi

    # Check calendar (should 401 without auth)
    HTTP_CAL=$(curl -s -o /dev/null -w "%{http_code}" "$WORKER_URL/calendar" 2>/dev/null || echo "000")
    if [ "$HTTP_CAL" = "401" ]; then
        echo "✅ /calendar → HTTP 401 (esperado: sin token)"
    else
        echo "ℹ️  /calendar → HTTP $HTTP_CAL"
    fi
fi

echo ""
echo "============================================================"
if [ "$ERRORS" -gt 0 ]; then
    echo "❌ Completado con $ERRORS error(es). Revisar salida arriba."
    exit 1
else
    echo "✅ Todos los webhooks sincronizados y verificados."
fi
echo "============================================================"
