#!/usr/bin/env bash
# ==============================================================================
# BORG-SDK CLI - TITANIUM EASY DEPLOY v2026
# Operador Sistémico - Auto-Despliegue Cloudflare Pages & D1
# ==============================================================================

set -e # Detener script en caso de error

# --- Colores ---
CYAN='\033[1;36m'
GREEN='\033[1;32m'
YELLOW='\033[1;33m'
RED='\033[1;31m'
NC='\033[0m' # No Color

echo -e "${CYAN}====================================================${NC}"
echo -e "${CYAN}   🚀 INICIANDO NODO SEGURO: BORG-SDK (v2026)    ${NC}"
echo -e "${CYAN}====================================================${NC}"
echo ""

# --- Verificación de Dependencias ---
echo -e "${YELLOW}[*] Verificando dependencias (npm, npx, curl)...${NC}"
for cmd in npm npx curl jq; do
    if ! command -v $cmd &> /dev/null; then
        echo -e "${RED}[!] Error: Se requiere '$cmd' para el despliegue.${NC}"
        exit 1
    fi
done
echo -e "${GREEN}[✓] Dependencias confirmadas.${NC}\n"

# --- Paso 1 y 2: Recolección de Inteligencia y Credenciales ---
echo -e "${CYAN}--- INYECCIÓN DE METADATOS CLOUDFLARE & GEMINI ---${NC}"
read -p "Ingresa tu GEMINI_API_KEY: " GEMINI_TOKEN
read -p "Ingresa tu CLOUDFLARE_API_TOKEN: " CF_TOKEN
read -p "Ingresa tu CLOUDFLARE_ACCOUNT_ID: " CF_ACCOUNT
read -p "Nombre del Proyecto en Pages [ej: win365-1]: " PROJECT_NAME
PROJECT_NAME=${PROJECT_NAME:-win365-1}
read -p "Nombre de la base de datos D1 [ej: borg]: " D1_NAME
D1_NAME=${D1_NAME:-borg}

# Exportar variables de entorno para que Wrangler (npx) las detecte automáticamente
export CLOUDFLARE_API_TOKEN=$CF_TOKEN
export CLOUDFLARE_ACCOUNT_ID=$CF_ACCOUNT

echo -e "\n${GREEN}[✓] Credenciales almacenadas temporalmente en memoria segura.${NC}\n"

# --- Paso A: Preparación del Repositorio/Dist ---
echo -e "${YELLOW}[*] Paso A: Preparando entorno de despliegue (Direct Upload)...${NC}"
mkdir -p dist
# Aquí iría el clonado de tu repositorio. Como ejemplo rápido, inyectamos un index base:
if [ ! -f "dist/index.html" ]; then
    echo "<h1>Nodo desplegado mediante Borg-SDK</h1>" > dist/index.html
fi
echo -e "${GREEN}[✓] Directorio './dist' preparado.${NC}\n"

# --- Paso B: Ejecución de Wrangler Pages Deploy ---
echo -e "${YELLOW}[*] Paso B: Ejecutando despliegue hacia ${PROJECT_NAME}.pages.dev...${NC}"
# Forzamos la instalación de wrangler de ser necesario y desplegamos
npx -y wrangler pages deploy ./dist --project-name="$PROJECT_NAME"
echo -e "${GREEN}[✓] Despliegue completado con éxito.${NC}\n"

# --- Paso C: Inyección de Secretos en Cloudflare ---
echo -e "${YELLOW}[*] Paso C: Encriptando e inyectando secretos en Cloudflare Pages...${NC}"
# Usamos echo para pasar los valores al prompt iterativo de wrangler secret put
echo "$GEMINI_TOKEN" | npx -y wrangler pages secret put GEMINI_API_KEY --project-name="$PROJECT_NAME"
echo "$CF_TOKEN" | npx -y wrangler pages secret put CLOUDFLARE_TOKEN --project-name="$PROJECT_NAME"
echo "$D1_NAME" | npx -y wrangler pages secret put D1_DATABASE_NAME --project-name="$PROJECT_NAME"
echo -e "${GREEN}[✓] Variables inyectadas (GEMINI_API_KEY, CLOUDFLARE_TOKEN, D1_DATABASE_NAME).${NC}\n"

# --- Notificación Webhook de Configuración ---
echo -e "${YELLOW}[*] Enviando payload de sincronización al Worker Maestro...${NC}"
curl -s -X POST https://4agentsonline.marketceogjr.workers.dev/setup-config \
    -H "Content-Type: application/json" \
    -d "{\"project\": \"$PROJECT_NAME\", \"d1\": \"$D1_NAME\", \"status\": \"ACTIVE_2026\"}"

echo -e "\n${CYAN}====================================================${NC}"
echo -e "${GREEN} 🌟 CONFIGURACIÓN TITANIUM GUARDADA Y DESPLEGADA 🌟${NC}"
echo -e "${CYAN}====================================================${NC}"
echo -e "Sistema listo para operación. Tu sitio está disponible en:"
echo -e "👉 https://${PROJECT_NAME}.pages.dev"
