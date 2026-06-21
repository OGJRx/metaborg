#!/bin/bash
# Script de provisionamiento de secretos para BORGPTRON

echo "🔱 Provisionando secretos del Titanium Core..."

wrangler secret put FRONTEND_BOT_INFO <<EOF
{"id":7806101848,"is_bot":true,"first_name":"Borg Telegate","username":"borg_frontend_bot"}
EOF

wrangler secret put BACKEND_BOT_INFO <<EOF
{"id":6617778072,"is_bot":true,"first_name":"Borg Backend","username":"borg_backend_bot"}
EOF

wrangler secret put TALLER_LATITUD <<EOF
10.48855974863415
EOF

wrangler secret put TALLER_LONGITUD <<EOF
-66.88157077878705
EOF

wrangler secret put TALLER_MAPS_URL <<EOF
https://www.google.com/maps/search/?api=1&query=10.48855974863415,-66.88157077878705&query_place_id=Autodiagnostico+JR
EOF

wrangler secret put WHATSAPP_PHONE_NUMBER_ID <<EOF
1092822373921606
EOF

echo "✅ Proceso completado. Ejecute 'wrangler deploy' para aplicar cambios."
