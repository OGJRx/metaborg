#!/bin/bash
# subscribe-whatsapp-webhook.sh - TITANIUM v9.7.0
# Suscribe el webhook de WhatsApp en Meta Graph API
# Este paso es OBLIGATORIO despues de desplegar el Worker,
# ya que sin el, Meta no enviara eventos al endpoint.

set -euo pipefail

# === VALIDACIONES ===
if [ -z "$WHATSAPP_ACCESS_TOKEN" ]; then
    echo "❌ ERROR: WHATSAPP_ACCESS_TOKEN no esta definida."
    echo "   export WHATSAPP_ACCESS_TOKEN=<tu_token>"
    echo "   (obtenlo en Meta App Dashboard > WhatsApp > API Setup)"
    exit 1
fi

if [ -z "$META_APP_ID" ]; then
    echo "❌ ERROR: META_APP_ID no esta definida."
    echo "   export META_APP_ID=<tu_app_id>"
    echo "   (obtenlo en Meta App Dashboard > App Settings > App ID)"
    exit 1
fi

VERIFY_TOKEN="${WHATSAPP_VERIFY_TOKEN:-}"
CALLBACK_URL="${WHATSAPP_CALLBACK_URL:-}"

if [ -z "$VERIFY_TOKEN" ]; then
    echo "❌ ERROR: WHATSAPP_VERIFY_TOKEN no esta definida."
    echo "   export WHATSAPP_VERIFY_TOKEN=<tu_verify_token>"
    echo "   Debe coincidir con el valor configurado via: wrangler secret put WHATSAPP_VERIFY_TOKEN"
    exit 1
fi

if [ -z "$CALLBACK_URL" ]; then
    echo "⚠️  WHATSAPP_CALLBACK_URL no definida. Usando default:"
    CALLBACK_URL="https://4agentsonline.marketceogjr.workers.dev/webhook/whatsapp"
    echo "   $CALLBACK_URL"
    echo "   (usa export WHATSAPP_CALLBACK_URL=<url> para personalizar)"
fi

API_VERSION="v25.0"
GRAPH_URL="https://graph.facebook.com/${API_VERSION}/${META_APP_ID}/subscriptions"

echo "============================================================"
echo "📱 SUSCRIPCION WHATSAPP WEBHOOK EN META GRAPH API"
echo "============================================================"
echo ""
echo "  App ID:        $META_APP_ID"
echo "  Callback URL:  $CALLBACK_URL"
echo "  API Version:   $API_VERSION"
echo "  Verify Token:  ${VERIFY_TOKEN:0:4}...${VERIFY_TOKEN: -4}"
echo ""
echo "--- Paso 1/3: Suscribiendo webhook en Meta... ---"

HTTP_CODE=$(curl -s -o /tmp/whatsapp_subscribe_response.json -w "%{http_code}" \
    -X POST "$GRAPH_URL" \
    -H "Authorization: Bearer $WHATSAPP_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
        \"object\": \"whatsapp_business_account\",
        \"callback_url\": \"$CALLBACK_URL\",
        \"verify_token\": \"$VERIFY_TOKEN\",
        \"fields\": [\"messages\"]
    }")

echo "HTTP Response Code: $HTTP_CODE"
echo "Response Body:"
cat /tmp/whatsapp_subscribe_response.json
echo ""

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
    echo "✅ Webhook suscrito correctamente en Meta."
else
    echo "❌ ERROR en la suscripcion. Verifica los parametros."
    echo ""
    echo "Posibles causas:"
    echo "  1. WHATSAPP_ACCESS_TOKEN expirado o invalido"
    echo "  2. META_APP_ID incorrecto"
    echo "  3. VERIFY_TOKEN no coincide con el configurado en Cloudflare"
    echo "  4. Callback URL no es HTTPS publico"
    exit 1
fi

echo ""
echo "--- Paso 2/3: Verificando challenge (GET) al Worker... ---"

CHALLENGE_TEST=$(curl -s -o /dev/null -w "%{http_code}" \
    "${CALLBACK_URL}?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=test_borg_challenge")

if [ "$CHALLENGE_TEST" -eq 200 ]; then
    echo "✅ Challenge verification exitosa (HTTP 200). El Worker respondio correctamente."
else
    echo "⚠️  Challenge devolvio HTTP $CHALLENGE_TEST."
    echo "   Esto puede indicar que el Worker no tiene WHATSAPP_VERIFY_TOKEN configurado."
    echo "   Ejecuta: cd borg-core-worker && wrangler secret put WHATSAPP_VERIFY_TOKEN"
fi

echo ""
echo "--- Paso 3/3: Listando suscripciones activas... ---"

curl -s "$GRAPH_URL" \
    -H "Authorization: Bearer $WHATSAPP_ACCESS_TOKEN" | \
    python3 -m json.tool 2>/dev/null || \
    curl -s "$GRAPH_URL" -H "Authorization: Bearer $WHATSAPP_ACCESS_TOKEN"

echo ""
echo "============================================================"
echo "🏁 Proceso completado."
echo ""
echo "NOTA: Si cambiaste WHATSAPP_VERIFY_TOKEN, tambien ejecuta:"
echo "   cd borg-core-worker && wrangler secret put WHATSAPP_VERIFY_TOKEN"
echo "============================================================"

rm -f /tmp/whatsapp_subscribe_response.json
