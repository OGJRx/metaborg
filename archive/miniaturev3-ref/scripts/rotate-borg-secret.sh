#!/bin/bash
# Generates a new BORG_SECRET_KEY and outputs the commands to execute
# Requirement: openssl must be installed

NEW_SECRET=$(openssl rand -hex 32)
echo "----------------------------------------------------------------"
echo "🔱 BORGPTRON - Rotación de Secreto BORG_SECRET_KEY"
echo "----------------------------------------------------------------"
echo "Nuevo Secreto (32-byte hex): $NEW_SECRET"
echo ""
echo "INSTRUCCIONES DE EJECUCIÓN:"
echo "1. Actualizar el Worker runtime:"
echo "   echo \"$NEW_SECRET\" | wrangler secret put BORG_SECRET_KEY"
echo ""
echo "2. Re-registrar Webhook FRONTEND:"
echo "   scripts/sync-webhooks.sh (asegurarse de que el script use el nuevo secreto)"
echo ""
echo "3. Re-registrar Webhook BACKEND:"
echo "   (Manual o vía scripts/sync-webhooks.sh si está unificado)"
echo ""
echo "⚠️  ADVERTENCIA: Los webhooks fallarán con 403 Forbidden"
echo "hasta que se completen los pasos 1, 2 y 3."
echo "----------------------------------------------------------------"
