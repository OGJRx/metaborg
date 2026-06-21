# 🔱 BORGPTRON v9.7.0 — TITANIUM CORE

![Build Status](https://img.shields.io/badge/Build-Passing-brightgreen)
![Budget](https://img.shields.io/badge/Budget-%240-blue)
![Tests](https://img.shields.io/badge/Tests-78%2F78-success)
![Branch](https://img.shields.io/badge/Branch-borg-orange)

**BORGPTRON** es un sistema de orquestación dual (Frontend/Backend) de alto rendimiento para gestión de talleres mecánicos, diseñado para operar 100% dentro del **Free Tier de Cloudflare Workers**. Integra WhatsApp Business API, Telegram Bots, Gemini AI y D1 (SQLite) en una arquitectura de "Díada Reactiva" con resiliencia enterprise y latencia mínima en el edge.

> "La latencia es un error de diseño; el costo es un fallo de arquitectura."

---

## 📋 Tabla de Contenidos

- [Arquitectura del Sistema](#-arquitectura-del-sistema)
- [Requisitos Previos (Cuentas Externas)](#-requisitos-previos-cuentas-externas)
- [Obtención de Credenciales (Guía Paso a Paso)](#-obtención-de-credenciales-guía-paso-a-paso)
  - [1. Cloudflare (Account ID + API Token)](#1-cloudflare-account-id--api-token)
  - [2. Telegram (Bot Tokens + Admin IDs)](#2-telegram-bot-tokens--admin-ids)
  - [3. Meta / WhatsApp Business API](#3-meta--whatsapp-business-api)
  - [4. Google Gemini (API Key)](#4-google-gemini-api-key)
- [Mapa Completo de Variables de Entorno](#-mapa-completo-de-variables-de-entorno)
- [Despliegue Paso a Paso](#-despliegue-paso-a-paso)
  - [Fase 0: Fork y Clon del Repositorio](#fase-0-fork-y-clon-del-repositorio)
  - [Fase 1: Bases de Datos D1](#fase-1-bases-de-datos-d1)
  - [Fase 2: Configurar GitHub Secrets](#fase-2-configurar-github-secrets)
  - [Fase 3: Despliegue Automático (GitHub Actions)](#fase-3-despliegue-automático-github-actions)
  - [Fase 4: Activación de Webhooks](#fase-4-activación-de-webhooks)
  - [Fase 5: Verificación End-to-End](#fase-5-verificación-end-to-end)
- [Despliegue Manual (Alternativa CLI)](#-despliegue-manual-alternativa-cli)
- [Estructura del Repositorio](#-estructura-del-repositorio)
- [Scripts de Operación](#-scripts-de-operación)
- [CI/CD Pipeline](#-cicd-pipeline)
- [Presupuesto Free Tier](#-presupuesto-free-tier)
- [Solución de Problemas](#-solución-de-problemas)
- [Trayectoria del Proyecto (Historial de Auditorías)](#-trayectoria-del-proyecto-historial-de-auditorías)
- [Licencia](#-licencia)

---

## 🏗 Arquitectura del Sistema

```
┌─────────────────────────────────────────────────────────────┐
│                    CLOUDFLARE WORKERS (EDGE)                   │
│                                                                 │
│  ┌───────────────────────────────────────────────────┐      │
│  │              borg-core-worker (index.ts)            │      │
│  │                                                       │      │
│  │  /webhook/frontend  ──►  Frontend Bot (grammY)       │      │
│  │  /webhook/backend   ──►  Backend Bot  (grammY)       │      │
│  │  /webhook/whatsapp  ──►  WhatsApp Handler            │      │
│  │  /calendar          ──►  Calendar Mini-App           │      │
│  │  Cron (*/10 min)    ──►  Maintenance + IA Queue       │      │
│  └───────────────┬───────────────────────────────────┘      │
│                  │                                              │
│         ┌────────┴────────┐                                    │
│         │  D1 (SQLite)     │                                    │
│         │  ┌────────────┐ │                                    │
│         │  │    borg     │ │  ← Base de datos principal        │
│         │  │ borg-obd-db │ │  ← Códigos OBD-II + FTS5         │
│         │  └────────────┘ │                                    │
│         └─────────────────┘                                    │
└─────────────────────────────────────────────────────────────┘
         ▲              ▲              ▲
         │              │              │
    ┌────┴────┐   ┌─────┴────┐  ┌─────┴──────┐
    │ Telegram │   │ Telegram │  │   Meta /   │
    │ Cliente  │   │  Admin   │  │ WhatsApp   │
    │ (Front)  │   │ (Back)   │  │  Cloud API │
    └──────────┘   └──────────┘  └────────────┘
                                       │
                                       ▼
                                 ┌──────────┐
                                 │  Gemini  │
                                 │    AI    │
                                 └──────────┘
```

### Componentes Principales

| Componente | Descripción |
|---|---|
| **Frontend Bot (Telegate)** | Bot de Telegram para clientes. Agenda citas, muestra menús interactivos, flujos de conversación guiados. |
| **Backend Bot (Brain)** | Bot de Telegram para administradores. Panel de gestión de citas, diagnóstico OBD-II con IA, reportes. |
| **WhatsApp Handler** | Recibe y procesa mensajes de WhatsApp vía Meta Cloud API. Comparte la misma lógica de orquestación que el Frontend Bot. |
| **BookingOrchestrator** | Orquestador unificado que maneja el flujo de agendamiento para ambas plataformas (Telegram + WhatsApp). |
| **D1 `borg`** | Base de datos SQLite principal. 9 migraciones aplicadas secuencialmente. Tablas: users, sessions, tickets, vehicles, circuit_breakers, ia_jobs, system_logs, whatsapp_messages, etc. |
| **D1 `borg-obd-db`** | Base de datos especializada en códigos de falla OBD-II con búsqueda full-text (FTS5). ~45 batches de datos. |
| **Gemini AI** | Motor de inteligencia artificial gratuito (gemini-3.1-flash-lite). Diagnóstico vehicular, agente administrativo, modo analógico como fallback. |

### Seguridad y Resiliencia

- **Circuit Breaker**: Apertura automática tras 3 fallos consecutivos de APIs externas (WhatsApp, Gemini, Telegram).
- **HMAC Webhook Validation**: Firmas criptográficas para validar la autenticidad de cada webhook entrante.
- **Rate Limiting**: Control de frecuencia por usuario en D1.
- **Idempotency Middleware**: Cada update de Telegram se procesa exactamente una vez.
- **CSP Hardened**: Nonces, no unsafe-inline, frame-ancestors restrictivos.
- **XSS Protection**: Función `esc()` para sanitizar todo contenido HTML dinámico.

---

## 📌 Requisitos Previos (Cuentas Externas)

Antes de desplegar BORGPTRON necesitas crear cuentas en los siguientes servicios. Todos tienen planes gratuitos suficientes para operar el sistema.

| Servicio | Plan Necesario | URL de Registro | Para Qué Se Usa |
|---|---|---|---|
| **Cloudflare** | Free Tier | https://dash.cloudflare.com/sign-up | Workers, D1, despliegue edge |
| **Telegram** | Gratuito | https://t.me/BotFather | Crear bots de atención y administración |
| **Meta Developer** | Gratuito | https://developers.facebook.com/apps/ | WhatsApp Business API (Cloud API) |
| **Google AI Studio** | Gratuito | https://aistudio.google.com/apikey | Gemini API para diagnóstico IA |
| **GitHub** | Gratuito | https://github.com | Repositorio, Actions, Secrets |

### Costo Total Mensual: $0

Todo el sistema opera dentro de los límites gratuitos de cada plataforma. No se requiere tarjeta de crédito para ninguna de las cuentas anteriores.

---

## 🔑 Obtención de Credenciales (Guía Paso a Paso)

A continuación se detalla exactamente cómo obtener cada credencial, desde dónde se genera y cómo se obtuvo originalmente en el proyecto.

### 1. Cloudflare (Account ID + API Token)

#### Cloudflare Account ID

1. Inicia sesión en [Cloudflare Dashboard](https://dash.cloudflare.com).
2. En la barra lateral derecha o en la URL del dashboard, verás tu **Account ID** (un UUID hexadecimal de 32 caracteres).
3. Cópialo. Lo necesitarás como `CLOUDFLARE_ACCOUNT_ID`.

**Cómo se obtuvo en el proyecto original**: El Account ID está visible en cualquier URL del dashboard de Cloudflare cuando seleccionas cualquier dominio o servicio. Se copió directamente de la barra lateral del dashboard.

#### Cloudflare API Token

1. En el dashboard de Cloudflare, ve a **My Profile > API Tokens**.
2. Haz clic en **Create Token**.
3. Usa la plantilla **Edit Cloudflare Workers** (recomendada) o crea uno personalizado con estos permisos:
   - `Account > Workers Scripts > Edit`
   - `Account > Workers KV Storage > Edit`
   - `Account > D1 > Edit`
   - `Account > Workers Routes > Edit`
   - `Account > Account Settings > Read`
4. Copia el token generado. Solo se muestra una vez.

**Importante**: Este token se usa **solo en GitHub Actions** para autenticar `wrangler deploy`. No se inyecta como secreto del Worker en runtime.

**Cómo se obtuvo en el proyecto original**: Se generó desde la plantilla "Edit Cloudflare Workers" con permisos adicionales para D1 y Account Settings.

---

### 2. Telegram (Bot Tokens + Admin IDs)

#### Crear los Bots (Frontend + Backend)

1. Abre Telegram y busca **@BotFather**.
2. Envía `/newbot` para crear el **Frontend Bot** (bot de clientes):
   - Nombre: `Borg Telegate` (o el que prefieras)
   - Username: `borg_frontend_bot` (debe terminar en `_bot`)
   - BotFather te dará un token: `123456789:ABCdefGHI...` → Este es tu `FRONTEND_BOT_TOKEN`
3. Envía `/newbot` nuevamente para crear el **Backend Bot** (bot de admin):
   - Nombre: `Borg Backend`
   - Username: `borg_backend_bot`
   - Token → Este es tu `BACKEND_BOT_TOKEN`
4. Guarda ambos tokens. **No se regeneran automáticamente**; si los pierdes, debes revocarlos en BotFather con `/revoke`.

#### Obtener Admin IDs

1. Abre Telegram y busca **@userinfobot**.
2. Envíale cualquier mensaje.
3. Te responderá con tu `Id`: un número entero (ej: `123456789`).
4. Este es tu `TELEGRAM_ADMIN_IDS`. Si hay múltiples admins, sepáralos con comas: `123456789,987654321`.

#### Obtener Bot Info (JSON)

El Worker necesita la información de identidad de cada bot. Se obtiene así:

```bash
# Reemplaza FRONTEND_BOT_TOKEN con tu token real
curl "https://api.telegram.org/botFRONTEND_BOT_TOKEN/getMe"
```

La respuesta será un JSON como este (guárdalo completo):
```json
{"id":7806101848,"is_bot":true,"first_name":"Borg Telegate","username":"borg_frontend_bot"}
```

Este JSON se inyecta como `FRONTEND_BOT_INFO` y `BACKEND_BOT_INFO` respectivamente.

**Cómo se obtuvo en el proyecto original**: Se crearon ambos bots vía BotFather. El Frontend Bot para atención al cliente (agendar citas) y el Backend Bot para administración del taller. Los IDs de admin se obtuvieron vía @userinfobot. Los Bot Info JSONs se extrajeron con `getMe`.

---

### 3. Meta / WhatsApp Business API

Esta es la integración más compleja. Requiere múltiples credenciales que se obtienen de diferentes secciones del Meta App Dashboard.

#### Paso A: Crear la App en Meta

1. Ve a [Meta for Developers](https://developers.facebook.com/apps/).
2. Haz clic en **Create App**.
3. Selecciona **Business** como tipo de app.
4. Nombra la app (ej: `BORGPTRON Workshop`) y crea una nueva Business Account si no tienes una.
5. En el dashboard de la app, ve a **Add Product > WhatsApp > Set Up**.
6. Acepta los términos y completa el perfil del número de negocio.

#### Paso B: Obtener las Credenciales

##### META_APP_ID

- Ubicación: **App Dashboard > App Settings > App ID**
- Es un número entero (ej: `964668749748476`)
- Se usa para identificar la app en las llamadas a la Graph API

**Cómo se obtuvo**: Visible directamente en la página principal del App Dashboard.

##### WHATSAPP_APP_SECRET

- Ubicación: **App Dashboard > App Settings > App Secret** > Click "Show"
- Es una cadena alfanumérica de 32 caracteres
- Se usa para calcular firmas HMAC de los webhooks entrantes (validación de integridad)

**Cómo se obtuvo**: Se reveló desde el dashboard haciendo clic en "Show" junto al App Secret.

##### WHATSAPP_ACCESS_TOKEN (Token de Acceso Permanente)

- Ubicación: **WhatsApp > API Setup > Temporary Access Token**
- Este token comienza con `EAAG...` (User Access Token)
- **Paso crítico**: En el momento de creación, Meta ofrece la opción de **"Add this phone number to a new WhatsApp Business Account"**. Al hacerlo, el token temporal se convierte en permanente.
- Este token se usa para enviar mensajes de WhatsApp y se inyecta como secreto del Worker.

**Cómo se obtuvo en el proyecto original**: Se generó desde WhatsApp > API Setup. Al asociar el número de teléfono al Business Account, el token `EAAG...` se hizo permanente. Se guardó inmediatamente porque solo se muestra una vez.

##### META_APP_ACCESS_TOKEN (Token de Acceso a Nivel de App)

Este es un token diferente al WHATSAPP_ACCESS_TOKEN. Se necesita específicamente para el endpoint de suscripción de webhooks.

- Formato: `APP_ID|APP_SECRET` (ej: `964668749748476|abc123def456...`)
- Construcción: Se forma concatenando el `App ID` y el `App Secret` separados por `|`
- Se usa **solo en GitHub Actions** para suscribir el webhook de WhatsApp. No se inyecta en el Worker.
- **Importante**: El User Access Token (`EAAG...`) NO funciona para suscripciones. Solo el App Access Token (`ID|SECRET`) tiene permisos para el endpoint `/subscriptions`.

**Cómo se obtuvo en el proyecto original**: Se descubrió durante la Auditoría #20 que el token `EAAG...` no funcionaba para el endpoint de suscripción de Meta. La solución fue construir el App Access Token concatenando `META_APP_ID|WHATSAPP_APP_SECRET`. Este hallazgo fue crítico para que el pipeline pudiera suscribir automáticamente el webhook.

##### WHATSAPP_VERIFY_TOKEN

- Ubicación: **Lo defines tú mismo**. Es un token arbitrario que tú creas.
- Debe ser una cadena aleatoria segura (ej: `mi_token_verificacion_2026_xyz`)
- Meta enviará este token como `hub.verify_token` cuando verifique tu webhook (GET request).
- Tu Worker debe responder con el `hub.challenge` recibido solo si el token coincide.
- **Nota de seguridad**: Este token es visible en los logs de Cloudflare Workers durante la verificación del webhook. Es de bajo riesgo porque solo valida la propiedad del webhook ante Meta.

**Cómo se obtuvo en el proyecto original**: Se generó como una cadena alfanumérica aleatoria y se configuró tanto en el Worker (via `wrangler secret put WHATSAPP_VERIFY_TOKEN`) como en el Meta App Dashboard (campo "Verify Token" en WhatsApp > Configuration).

##### WHATSAPP_PHONE_NUMBER_ID

- Ubicación: **WhatsApp > API Setup > Phone Number ID**
- Es un número entero grande (ej: `1092822373921606`)
- Identifica tu número de teléfono de negocio registrado en WhatsApp Cloud API.
- Se usa como parámetro `from` cuando envías mensajes proactivos.

**Cómo se obtuvo en el proyecto original**: Visible en la sección WhatsApp > API Setup del dashboard, debajo del número de teléfono asociado.

##### WHATSAPP_API_VERSION

- Valor actual: `v25.0`
- Ubicación: **wrangler.toml** (variable `[vars]`)
- Define la versión de la Graph API de Meta a utilizar.
- **Importante**: Si Meta deprecia esta versión, actualizar este valor en `wrangler.toml` es suficiente. No requiere cambios en el código.

**Cómo se obtuvo en el proyecto original**: Se eligió `v25.0` como la versión más reciente disponible al momento del desarrollo. La versión se usa de forma consistente en todos los scripts de suscripción y en el pipeline de CI/CD.

#### Paso C: Configurar el Webhook en Meta Dashboard

1. Ve a **WhatsApp > Configuration** en el Meta App Dashboard.
2. En **Callback URL**, ingresa: `https://TU-WORKER.workers.dev/webhook/whatsapp`
3. En **Verify Token**, ingresa el mismo valor de `WHATSAPP_VERIFY_TOKEN`.
4. Haz clic en **Manage > webhook fields** y asegúrate de que `messages` esté suscrito.

**Nota**: Esta configuración en el dashboard es un backup. El pipeline de CI/CD la realiza automáticamente vía API en cada despliegue (ver `core-deploy.yml`, paso "Activate Webhooks").

---

### 4. Google Gemini (API Key)

1. Ve a [Google AI Studio](https://aistudio.google.com/apikey).
2. Haz clic en **Create API Key**.
3. Selecciona un proyecto de Google Cloud (o crea uno nuevo).
4. Copia la API Key generada.

**Modelo utilizado**: `gemini-3.1-flash-lite` (configurado en `wrangler.toml` como `AI_MODEL_NAME`).

**Límites del plan gratuito**: 15 requests/minuto, 1,500 requests/día. Suficiente para el volumen de un taller mecánico.

**Cómo se obtuvo en el proyecto original**: Se generó desde AI Studio con un proyecto de Google Cloud. Se eligió Gemini sobre OpenAI/Anthropic por ser completamente gratuito, alineado con la filosofía de costo cero del proyecto.

---

## 🗺 Mapa Completo de Variables de Entorno

### Variables Obligatorias (sin ellas el Worker no arranca)

| Variable | Origen | Almacenamiento | Descripción |
|---|---|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Dashboard | GitHub Secret + env | UUID de la cuenta CF |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Tokens | GitHub Secret + env | Token de despliegue (no se inyecta en Worker) |
| `FRONTEND_BOT_TOKEN` | BotFather (@BotFather) | GitHub Secret + Wrangler Secret | Token del bot de clientes Telegram |
| `BACKEND_BOT_TOKEN` | BotFather (@BotFather) | GitHub Secret + Wrangler Secret | Token del bot de administración Telegram |
| `TELEGRAM_ADMIN_IDS` | @userinfobot (Telegram) | GitHub Secret + Wrangler Secret | IDs de administradores (comma-separated) |
| `BORG_SECRET_KEY` | Generado con `openssl rand -hex 32` | GitHub Secret + Wrangler Secret | Secreto maestro 32-byte hex para HMAC y cookies firmadas |
| `GEMINI_API_KEY` | Google AI Studio | GitHub Secret + Wrangler Secret | Clave de acceso a Gemini AI |
| `WHATSAPP_ACCESS_TOKEN` | Meta WhatsApp API Setup | GitHub Secret + Wrangler Secret | Token EAAG* para enviar mensajes WhatsApp |
| `WHATSAPP_APP_SECRET` | Meta App Settings | GitHub Secret + Wrangler Secret | Secret de la app Meta (HMAC webhook validation) |
| `WHATSAPP_VERIFY_TOKEN` | Definido por ti | GitHub Secret + Wrangler Secret | Token de verificación del webhook WhatsApp |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta WhatsApp API Setup | GitHub Secret + Wrangler Secret | ID del número de teléfono business |
| `META_APP_ID` | Meta App Settings | GitHub Secret (CI-only) | ID de la app Meta (para suscripción webhook) |
| `META_APP_ACCESS_TOKEN` | Construido: `APP_ID|APP_SECRET` | GitHub Secret (CI-only) | App-level token para suscripción Meta |
| `TALLER_LATITUD` | Google Maps (tu taller) | Wrangler Secret | Coordenada latitud del taller |
| `TALLER_LONGITUD` | Google Maps (tu taller) | Wrangler Secret | Coordenada longitud del taller |
| `TALLER_MAPS_URL` | Google Maps | Wrangler Secret | URL de Google Maps del taller |

### Variables Opcionales (tienen defaults razonables)

| Variable | Default | Descripción |
|---|---|---|
| `FRONTEND_BOT_INFO` | — | JSON con identidad del bot frontend (vía `provision-secrets.sh`) |
| `BACKEND_BOT_INFO` | — | JSON con identidad del bot backend (vía `provision-secrets.sh`) |
| `RETENTION_LOGS_DAYS` | `7` | Días de retención de logs del sistema |
| `RETENTION_UPDATES_HOURS` | `24` | Horas de retención de updates procesados |
| `RETENTION_WHATSAPP_DAYS` | `30` | Días de retención de mensajes WhatsApp |

### Variables de Configuración (en `wrangler.toml`, no son secretos)

| Variable | Valor | Ubicación |
|---|---|---|
| `AI_MODEL_NAME` | `gemini-3.1-flash-lite` | `wrangler.toml` `[vars]` |
| `BORG_VERSION` | `9.7.0-TITANIUM` | `wrangler.toml` `[vars]` |
| `WORKER_URL` | `https://TU-WORKER.workers.dev` | `wrangler.toml` `[vars]` |
| `WHATSAPP_API_VERSION` | `v25.0` | `wrangler.toml` `[vars]` |

---

## 🚀 Despliegue Paso a Paso

### Fase 0: Fork y Clon del Repositorio

```bash
# 1. Fork el repositorio en GitHub
#    Ve a: https://github.com/OGJRx/miniaturev3
#    Haz clic en "Fork" → Crea tu propio fork

# 2. Clona tu fork (rama borg)
git clone --branch borg https://github.com/TU-USUARIO/miniaturev3.git
cd miniaturev3

# 3. Instala dependencias
npm ci
```

### Fase 1: Bases de Datos D1

Necesitas crear dos bases de datos D1 en tu cuenta de Cloudflare.

```bash
# 1. Autenticar wrangler CLI
npx wrangler login

# 2. Crear la base de datos principal (borg)
npx wrangler d1 create borg
# Output: database_id = "TU-UUID-AQUI"

# 3. Crear la base de datos OBD (borg-obd-db)
npx wrangler d1 create borg-obd-db
# Output: database_id = "TU-UUID-AQUI"

# 4. Actualiza borg-core-worker/wrangler.toml con los database_id reales:
#    [[d1_databases]]
#    binding = "DB"
#    database_name = "borg"
#    database_id = "TU-UUID-DE-BORG"     ← reemplazar
#
#    [[d1_databases]]
#    binding = "OBD_DB"
#    database_name = "borg-obd-db"
#    database_id = "TU-UUID-DE-OBD-DB"  ← reemplazar

# 5. Aplicar migraciones (9 migraciones secuenciales)
cd borg-core-worker
npx wrangler d1 migrations apply borg --remote
cd ..

# 6. (Opcional) Poblar base de datos OBD con códigos de falla
bash scripts/populate-obd-db.sh
```

**Cómo funciona el sistema de migraciones**: Cada migración en `borg-core-worker/migrations/` se aplica secuencialmente. El archivo `__d1_migrations` en D1 registra cuáles ya se aplicaron. Las migraciones son idempotentes (usan `IF NOT EXISTS`) para prevenir errores en re-despliegues.

### Fase 2: Configurar GitHub Secrets

Ve a tu fork en GitHub: **Settings > Secrets and variables > Actions > New repository secret**

Crea los siguientes secrets (uno por uno):

```bash
# Cloudflare
CLOUDFLARE_ACCOUNT_ID          = "tu-account-id"
CLOUDFLARE_API_TOKEN           = "tu-api-token"

# Telegram
FRONTEND_BOT_TOKEN             = "123456789:ABCdef..."
BACKEND_BOT_TOKEN              = "123456789:XYZuvw..."
TELEGRAM_ADMIN_IDS             = "123456789,987654321"

# Seguridad
BORG_SECRET_KEY                = " Genera con: openssl rand -hex 32"

# IA
GEMINI_API_KEY                 = "AIza..."

# WhatsApp
WHATSAPP_ACCESS_TOKEN          = "EAAG..."
WHATSAPP_APP_SECRET            = "abc123def456..."
WHATSAPP_VERIFY_TOKEN          = "tu-token-arbitrario-seguro"
WHATSAPP_PHONE_NUMBER_ID       = "1092822373921606"

# Meta (CI-only, para suscripción webhook)
META_APP_ID                    = "964668749748476"
META_APP_ACCESS_TOKEN          = "964668749748476|abc123def456..."  # APP_ID|APP_SECRET

# Taller (opcional pero recomendado)
TALLER_LATITUD                 = "10.4885"
TALLER_LONGITUD                = "-66.8815"
TALLER_MAPS_URL                = "https://www.google.com/maps/..."
```

**Generación del BORG_SECRET_KEY**:

```bash
# Generar un secreto maestro seguro de 32 bytes
openssl rand -hex 32
# Output: a1b2c3d4e5f6... (64 caracteres hex)
```

**Importante**: `META_APP_ACCESS_TOKEN` NO es un token que obtienes de Meta directamente. Se construye concatenando `META_APP_ID` y `WHATSAPP_APP_SECRET` con un pipe `|`. Este fue uno de los hallazgos más críticos del proyecto (descubierto durante la Auditoría #20): el User Access Token (`EAAG...`) no tiene permisos para el endpoint `/subscriptions`; solo el App Access Token (`ID|SECRET`) funciona.

### Fase 3: Despliegue Automático (GitHub Actions)

Una vez que los GitHub Secrets están configurados, el despliegue es completamente automático:

```bash
# Simplemente haz push a la rama 'borg'
git push origin borg
```

El pipeline **TITANIUM CORE - Unified Pipeline** (`core-deploy.yml`) ejecutará automáticamente:

1. **Entropy Check**: merge conflict markers, any-scanner (0 tolerancia), lint, type-check, tests (78/78), security audit
2. **Validate Secrets**: verifica que todos los secrets requeridos estén presentes
3. **Verify D1 Connection**: confirma conectividad con la base de datos remota
4. **Apply D1 Migrations**: aplica cualquier migración pendiente
5. **Deploy Core Worker**: despliega el Worker a Cloudflare
6. **Sync Wrangler Secrets**: sincroniza todos los secrets del Worker (no requiere intervención manual)
7. **Activate Webhooks**: registra automáticamente los webhooks de Telegram (frontend + backend) y suscribe el webhook de WhatsApp en Meta Graph API
8. **Notify Success**: envía notificación de despliegue exitoso a los admins vía Telegram

**Trigger manual** (si necesitas re-desplegar sin cambiar código):

```bash
# Desde GitHub: Actions > TITANIUM CORE > Run workflow
# O ejecuta el workflow_dispatch desde la interfaz de GitHub
```

### Fase 4: Activación de Webhooks

Si prefieres activar los webhooks manualmente en lugar de depender del pipeline:

```bash
# 1. Exportar variables
export BACKEND_BOT_TOKEN="..."
export FRONTEND_BOT_TOKEN="..."
export BORG_SECRET_KEY="..."
export WORKER_URL="https://tu-worker.workers.dev"

# 2. Ejecutar script de sincronización unificada
bash scripts/sync-webhooks.sh

# 3. Para suscribir WhatsApp específicamente:
export WHATSAPP_ACCESS_TOKEN="EAAG..."
export META_APP_ID="964668749748476"
export WHATSAPP_VERIFY_TOKEN="tu-token"
export WHATSAPP_CALLBACK_URL="https://tu-worker.workers.dev/webhook/whatsapp"
bash scripts/subscribe-whatsapp-webhook.sh
```

### Fase 5: Verificación End-to-End

Después del despliegue, verifica que todo funciona:

```bash
# 1. Verificar que el Worker responde
curl -s -o /dev/null -w "%{http_code}" "https://tu-worker.workers.dev/"
# Esperado: 404 (no hay ruta raíz, es normal)

# 2. Verificar webhooks Telegram (deben devolver 401 sin firma correcta)
curl -s -o /dev/null -w "%{http_code}" "https://tu-worker.workers.dev/webhook/frontend"
# Esperado: 401

curl -s -o /dev/null -w "%{http_code}" "https://tu-worker.workers.dev/webhook/backend"
# Esperado: 401

# 3. Verificar webhook WhatsApp (GET challenge)
curl "https://tu-worker.workers.dev/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=TU_TOKEN&hub.challenge=test123"
# Esperado: 200 con body "test123"

# 4. Probar Frontend Bot en Telegram
# Abre tu bot frontend y envía /start
# Debería responder con el menú de agendamiento

# 5. Probar Backend Bot en Telegram
# Abre tu bot backend y envía /start
# Debería responder con el Panel Admin

# 6. Probar WhatsApp
# Envía un mensaje al número de WhatsApp Business
# Debería responder con el flujo de agendamiento

# 7. Verificar base de datos
cd borg-core-worker
npx wrangler d1 execute borg --remote --command "SELECT name FROM sqlite_master WHERE type='table'"
# Debería listar todas las tablas (users, sessions, tickets, etc.)

# 8. Verificar observabilidad
npx wrangler tail
# Debería mostrar logs en tiempo real del Worker
```

---

## 🖥 Despliegue Manual (Alternativa CLI)

Si no quieres usar GitHub Actions, puedes desplegar completamente desde la terminal:

```bash
# 1. Aplicar migraciones D1
cd borg-core-worker
npx wrangler d1 migrations apply borg --remote
cd ..

# 2. Provisionar secretos estáticos
cd borg-core-worker
echo '{"id":BOT_ID,"is_bot":true,"first_name":"Borg Telegate","username":"borg_frontend_bot"}' | npx wrangler secret put FRONTEND_BOT_INFO
echo '{"id":BOT_ID,"is_bot":true,"first_name":"Borg Backend","username":"borg_backend_bot"}' | npx wrangler secret put BACKEND_BOT_INFO
echo "10.4885" | npx wrangler secret put TALLER_LATITUD
echo "-66.8815" | npx wrangler secret put TALLER_LONGITUD
echo "https://www.google.com/maps/..." | npx wrangler secret put TALLER_MAPS_URL
echo "1092822373921606" | npx wrangler secret put WHATSAPP_PHONE_NUMBER_ID
cd ..

# 3. Sincronizar secretos del Worker
# (El script provision-secrets.sh cubre los estáticos; los sensibles se inyectan uno a uno)
cd borg-core-worker
echo "TU_TOKEN" | npx wrangler secret put FRONTEND_BOT_TOKEN
echo "TU_TOKEN" | npx wrangler secret put BACKEND_BOT_TOKEN
echo "TU_KEY" | npx wrangler secret put GEMINI_API_KEY
echo "TU_SECRETO" | npx wrangler secret put BORG_SECRET_KEY
echo "TU_TOKEN" | npx wrangler secret put WHATSAPP_ACCESS_TOKEN
echo "TU_SECRET" | npx wrangler secret put WHATSAPP_APP_SECRET
echo "TU_TOKEN" | npx wrangler secret put WHATSAPP_VERIFY_TOKEN
echo "TU_IDS" | npx wrangler secret put TELEGRAM_ADMIN_IDS
cd ..

# 4. Desplegar el Worker
cd borg-core-worker && npx wrangler deploy && cd ..

# 5. Activar webhooks
bash scripts/sync-webhooks.sh
bash scripts/subscribe-whatsapp-webhook.sh
```

---

## 📁 Estructura del Repositorio

```
miniaturev3/                          # Raíz del monorepo (borg branch)
├── borg-core-worker/                 # Worker principal (Cloudflare Workers)
│   ├── src/
│   │   ├── index.ts                  # Entry point, rutas, bots, cron
│   │   ├── routes/
│   │   │   └── webhook-whatsapp.ts   # Handler del webhook WhatsApp
│   │   ├── booking-orchestrator.ts    # Orquestador unificado de citas
│   │   ├── whatsapp-booking.ts        # Lógica de booking vía WhatsApp
│   │   └── calendar-template.ts       # Template del mini-app calendario
│   ├── migrations/                    # 9 migraciones D1 secuenciales
│   │   ├── 0001_baseline_create.sql  # Tablas base (users, sessions, tickets, etc.)
│   │   ├── 0002_missing_indexes.sql   # Índices adicionales
│   │   ├── 0003_business_metrics.sql  # Métricas de negocio
│   │   ├── 0004_cleanup_dead_infrastructure.sql  # Limpieza idempotente
│   │   ├── 0005_composite_index_tickets.sql      # Índice compuesto tickets
│   │   ├── 0006_business_metrics_idempotency.sql  # Idempotencia métricas
│   │   ├── 0007_notifications_table.sql           # Tabla notificaciones
│   │   ├── 0008_tech_debt_purge.sql               # Purga de deuda técnica
│   │   └── 0009_wa_api_errors.sql                 # Log de errores API WhatsApp
│   ├── wrangler.toml                  # Configuración del Worker (D1, vars, crons)
│   ├── package.json
│   └── tsconfig.json
├── shared/                           # Código compartido (módulos del monorepo)
│   ├── types/
│   │   ├── index.ts                   # CoreEnv interface, tipos principales
│   │   └── constants.ts               # Constantes del sistema
│   ├── security/
│   │   ├── bot-setup.ts               # Middleware grammY (trace, idempotency)
│   │   ├── crypto.ts                  # HMAC, cookies firmadas
│   │   ├── callbacks.ts               # Parseo seguro de callback queries
│   │   └── index.ts                   # Re-exports
│   ├── services/
│   │   ├── agent-factory.ts           # Factory de agentes Gemini IA
│   │   ├── booking-core.ts            # Lógica de negocio de citas
│   │   ├── borg-logger.ts            # Logger persistente en D1
│   │   ├── circuit-breaker.ts         # Circuit Breaker genérico
│   │   ├── admin-notification.ts      # Notificaciones al administrador
│   │   ├── maintenance-service.ts     # Auditorías de mantenimiento
│   │   ├── obd-session.ts            # Sesiones de diagnóstico OBD
│   │   ├── ia-queue.ts               # Cola asíncrona de trabajos IA
│   │   ├── response-helper.ts         # Helpers de respuesta
│   │   ├── slot-validator.ts          # Validador de franjas horarias
│   │   ├── telegram-api.ts            # Wrapper de Telegram API
│   │   └── ticket-creator.ts          # Creación atómica de tickets
│   ├── whatsapp/
│   │   ├── whatsapp-api.ts            # Cliente HTTP de WhatsApp Cloud API
│   │   ├── whatsapp-errors.ts         # Errores tipados de WhatsApp
│   │   └── whatsapp-types.ts          # Tipos de WhatsApp
│   ├── ui/
│   │   ├── menu-factory.ts            # Factory de menús inlinekeyboard
│   │   ├── ui-manager.ts              # Gestor de UI (safeReply, safeEdit)
│   │   ├── formatters.ts              # Formateo de horas/fechas
│   │   ├── prompts.ts                # Prompts de agentes IA
│   │   ├── timezone.ts               # Zona horaria Venezuela (VET)
│   │   ├── html-utils.ts             # Utilidades HTML
│   │   └── timezone.ts               # Utilidades de tiempo
│   └── obd-lookup.ts                  # Servicio de búsqueda OBD-II + FTS5
├── tests/                             # Suite de pruebas unitarias (78 tests)
│   ├── whatsapp-api.test.ts
│   ├── circuit-breaker-v2.test.ts
│   ├── booking-core.test.ts
│   ├── calendar-xss.test.ts
│   ├── formatters.test.ts
│   └── ... (13 archivos de tests)
├── scripts/                           # Scripts operativos
│   ├── provision-secrets.sh           # Provisionar secretos estáticos
│   ├── subscribe-whatsapp-webhook.sh  # Suscribir webhook WhatsApp en Meta
│   ├── sync-webhooks.sh               # Sincronizar TODOS los webhooks
│   ├── borg-setup.sh                  # SDK CLI para despliegue rápido
│   ├── rotate-borg-secret.sh          # Rotación del secreto maestro
│   ├── cleanup-github-secrets.sh      # Limpieza de secrets huérfanos
│   ├── populate-obd-db.sh             # Poblar DB OBD con códigos de falla
│   └── agent-sync.sh                  # Sincronización de ramas
├── .github/workflows/
│   ├── core-deploy.yml                # Pipeline CI/CD unificado (21 steps)
│   └── logs-monitor.yml               # Captura de logs en tiempo real
├── package.json                       # Monorepo root (workspaces)
├── vitest.config.ts                   # Configuración de tests
├── tsconfig.json                      # TypeScript config raíz
├── eslint.config.js                   # Linting estricto
├── .dev.vars.example                  # Template de variables locales
├── borg.md                            # Manual del operador (protocolo BORG)
└── worklog.md                         # Registro de trabajo por agentes
```

---

## 🔧 Scripts de Operación

Todos los scripts están en `scripts/` y son ejecutables desde la raíz del repositorio.

| Script | Propósito | Uso |
|---|---|---|
| `provision-secrets.sh` | Inyecta secretos estáticos al Worker (Bot Info, coordenadas, Phone ID) | `cd borg-core-worker && bash ../scripts/provision-secrets.sh` |
| `subscribe-whatsapp-webhook.sh` | Suscribe el webhook de WhatsApp en Meta Graph API con verificación de challenge | `export WHATSAPP_ACCESS_TOKEN=... && export META_APP_ID=... && bash scripts/subscribe-whatsapp-webhook.sh` |
| `sync-webhooks.sh` | Sincroniza TODOS los webhooks (Telegram frontend + backend + WhatsApp Meta) y verifica endpoints | `export BACKEND_BOT_TOKEN=... && bash scripts/sync-webhooks.sh` |
| `rotate-borg-secret.sh` | Genera un nuevo `BORG_SECRET_KEY` de 32 bytes e instrucciones de rotación | `bash scripts/rotate-borg-secret.sh` |
| `cleanup-github-secrets.sh` | Clasifica y elimina secrets innecesarios del repositorio GitHub | `export GITHUB_REPO=owner/repo && bash scripts/cleanup-github-secrets.sh` |
| `populate-obd-db.sh` | Aplica migraciones y carga ~45 batches de códigos OBD-II en la base de datos OBD | `bash scripts/populate-obd-db.sh` |
| `borg-setup.sh` | SDK interactivo para despliegue rápido de nuevos nodos | `bash scripts/borg-setup.sh` |
| `agent-sync.sh` | Sincroniza el código local con la rama remota principal | `bash scripts/agent-sync.sh` |

---

## 🔄 CI/CD Pipeline

El pipeline se define en `.github/workflows/core-deploy.yml` y se ejecuta automáticamente en cada push a la rama `borg`.

### Fases del Pipeline (21 steps)

```
┌──────────────────────────────────────┐
│     🔬 ENTROPY CHECK (Job 1)          │
│  ┌─ Merge conflict markers           │
│  ├─ Any Scanner (zero tolerance)      │
│  ├─ ESLint (strict, max-warnings 10) │
│  ├─ TypeScript type check            │
│  ├─ Vitest (78 tests)                │
│  └─ Security audit (npm audit)       │
├──────────────────────────────────────┤
│     🚀 DEPLOY CORE (Job 2)           │
│  ┌─ Validate Secrets (17 variables)   │
│  ├─ Verify D1 Connection              │
│  ├─ Apply D1 Migrations               │
│  ├─ Deploy Core Worker                │
│  ├─ Sync Wrangler Secrets (11 vars)   │
│  ├─ Activate Telegram Webhooks (x2)   │
│  ├─ Subscribe WhatsApp Meta           │
│  ├─ Verify WhatsApp Challenge         │
│  └─ Notify Admin (Telegram)           │
└──────────────────────────────────────┘
```

### Características del Pipeline

- **Concurrency control**: Un solo despliegue a la vez por ref. No se cancelan despliegues en progreso.
- **Environment protection**: El job `deploy-core` usa el environment `production` de GitHub (puedes agregar required reviewers).
- **OIDC Authentication**: El token de Cloudflare se obtiene vía `id-token: write` sin secrets expuestos.
- **Retry automático**: La suscripción de WhatsApp tiene 1 retry con espera de 5 segundos.
- **Notificación de éxito**: Envía mensaje a los administradores vía Telegram al completar.

---

## 💰 Presupuesto Free Tier

| Recurso | Límite Free Tier | Uso Estimado BORGPTRON | Margen |
|---|---|---|---|
| **Workers CPU Time** | 10ms/request | ~5-8ms/request | ~20-50% |
| **Workers Requests** | 100,000/day | ~500-5,000/day | ~95% |
| **D1 Storage** | 500 MB | ~5-20 MB | ~96% |
| **D1 Reads** | 5M/day | ~50,000/day | ~99% |
| **D1 Writes** | 100K/day | ~5,000/day | ~95% |
| **Subrequests** | 50/request | ~3-5/request | ~90% |
| **Memory** | 128 MB | ~30-50 MB | ~60% |
| **Cron Triggers** | Ilimitados | Cada 10 min (off-peak: 30%) | ✅ |
| **Gemini API** | 1,500/day | ~50-200/day | ~87% |

### Optimizaciones de Consumo

- **Cron off-peak**: Entre 00:00-06:00 VET, se saltan el 70% de las ejecuciones del cron (ahorra CPU y reads de D1).
- **Circuit Breaker**: Evita llamadas innecesarias a APIs caídas (ahorra subrequests).
- **Idempotency**: Cada Telegram update se procesa exactamente una vez (evita duplicados).
- **IA Queue asíncrona**: Los trabajos de IA se procesan en lote vía cron, no en el request path (ahorra CPU time).

---

## 🔧 Solución de Problemas

### Error: "Missing secret: XXX" en el pipeline

**Causa**: Uno o más GitHub Secrets no están configurados.

**Solución**: Ve a Settings > Secrets > Actions y agrega el secret faltante. El pipeline valida 17 secrets antes de desplegar. La lista completa está en la sección [Mapa de Variables](#-mapa-completo-de-variables-de-entorno).

### Error: WhatsApp Meta subscription failed

**Causa más común**: `META_APP_ACCESS_TOKEN` no tiene permisos para el endpoint `/subscriptions`.

**Solución**: Verifica que `META_APP_ACCESS_TOKEN` tenga el formato `APP_ID|APP_SECRET` (no el token `EAAG...`). El User Access Token no funciona para suscripciones. Fue un hallazgo crítico de la Auditoría #20.

```bash
# Verificar formato correcto
echo "$META_APP_ID|$WHATSAPP_APP_SECRET"
# Ejemplo: 964668749748476|abc123def456ghi789
```

### Error: WhatsApp challenge returns HTTP 403/405

**Causa**: `WHATSAPP_VERIFY_TOKEN` no está sincronizado como Wrangler secret en el Worker.

**Solución**:
```bash
cd borg-core-worker
echo "TU_TOKEN" | npx wrangler secret put WHATSAPP_VERIFY_TOKEN
```

O haz un push para que el pipeline lo sincronice automáticamente.

### Error: D1 SQLITE_AUTH

**Causa**: El `CLOUDFLARE_API_TOKEN` no tiene permisos suficientes para D1.

**Solución**: Regenera el API Token con permisos `Account > D1 > Edit` (ver [sección 1](#1-cloudflare-account-id--api-token)).

### Error: WhatsApp returns 401 Unauthorized

**Causa**: `WHATSAPP_ACCESS_TOKEN` expirado o inválido.

**Solución**: Genera un nuevo token en Meta App Dashboard > WhatsApp > API Setup. Actualiza el secret en GitHub y haz push para sincronizar.

### Error: "any" count > 0 en pipeline

**Causa**: Código con tipos implícitos `any`.

**Solución**: El Any Scanner (zero tolerance) bloquea el despliegue. Corrige los tipos antes de hacer push.

### Webhook Telegram devuelve 401

**Causa**: `BORG_SECRET_KEY` cambió pero los webhooks no se re-registraron.

**Solución**:
```bash
# 1. Actualizar el secreto en el Worker
echo "NUEVO_SECRETO" | npx wrangler secret put BORG_SECRET_KEY
# 2. Re-registrar webhooks
bash scripts/sync-webhooks.sh
```

---

## 📈 Trayectoria del Proyecto (Historial de Auditorías)

BORGPTRON ha pasado por 20+ auditorías técnicas sucesivas, cada una resolviendo hallazgos específicos y endureciendo el sistema. Esta trayectoria documenta cómo se alcanzó el estado actual del MVP.

### Auditorías de Estabilidad Base (#1-#6)

| Auditoría | Enfoque | Hallazgos | Resultado Clave |
|---|---|---|---|
| **#1** | Baseline (v9.7.0) | 46 findings | Identificación completa de deuda técnica |
| **#2** (PR #4) | CI/CD | 18 findings | Pipeline endurecido con checks automáticos |
| **#3** (PR #5) | D1 Indexes | 15 findings | Índices de performance + tests |
| **#4** | CSS + Provisioning | 14 findings | Fix de estilos + script de secretos |
| **#5** | Críticos | 8 findings (2 CRITICAL) | Eliminación de `!` non-null assertions (5→0) |
| **#6** | Correcciones finales | Bind precision, tests, crypto docs | Código limpio para producción |

### Auditorías de Endurecimiento (#9-#13)

| Auditoría | Enfoque | Resultado Clave |
|---|---|---|
| **#9** | SQLITE_AUTH + Workflow | Resolución de permisos D1 + pipeline hardening |
| **#10** | TITANIUM HARDENING | Optimización de cron (70% skip off-peak), HMAC validation, GPS coordinates, keywords de flujo WhatsApp |
| **#11** | INFRASTRUCTURE MIGRATION | Migración `borgptron-db` → `borg`, refactor global de referencias |
| **#12** | TEMPORAL INTEGRITY | Erradicación de `toISOString()`, implementación de `SqliteDateTime` branded type |
| **#13** | TECHNICAL DEBT PURGE | Eliminación de código muerto, idempotencia en migraciones, monitoreo D1 |

### Auditorías de Integración WhatsApp (#19-#20)

| Auditoría | Enfoque | Resultado Clave |
|---|---|---|
| **#19** | WhatsApp Integration | Bug fixes: `messaging_postbacks` removal, token type mismatch, Validate Secrets env block |
| **#20** | Defensive Layers | 3 capas defensivas: paginación de listas (10 items), fallback de errores, observabilidad (wa_api_errors table) |

### Logros Técnicos Destacados

- **78/78 tests passing**: Suite completa sin fallos.
- **Zero `any` tolerance**: Scanner bloquea despliegues con tipos implícitos.
- **Zero non-null assertions**: Eliminadas completamente (5→0).
- **Pipeline 21/21 steps green**: Desde Entropy Check hasta notificación de admin.
- **WhatsApp Meta subscription active**: `{"success":true}` verificado vía API.
- **D1 migrations idempotent**: Las 9 migraciones se pueden re-aplicar sin error.
- **Free tier budget compliance**: Todo opera dentro de límites gratuitos de Cloudflare.

---

## ⚡ Comandos Rápidos de Referencia

```bash
# Desarrollo
npm ci                          # Instalar dependencias
npm run test                    # Ejecutar tests (78/78)
npm run lint:strict             # Lint estricto (bloqueante en CI)
npm run check-types             # Verificar tipos TypeScript
npm run any-scanner             # Contar tipos 'any' en producción

# Despliegue
cd borg-core-worker && npx wrangler deploy    # Desplegar Worker
npx wrangler d1 migrations apply borg --remote  # Aplicar migraciones D1

# Operación
bash scripts/sync-webhooks.sh                       # Sincronizar webhooks
bash scripts/subscribe-whatsapp-webhook.sh          # Suscribir WhatsApp
npx wrangler tail                                    # Logs en tiempo real
npx wrangler d1 execute borg --remote --command="SQL"  # Query D1

# Seguridad
bash scripts/rotate-borg-secret.sh                  # Rotar secreto maestro
bash scripts/cleanup-github-secrets.sh               # Limpiar secrets huérfanos
```

---

## 📚 Recursos Adicionales

- [Manual del Operador (borg.md)](borg.md) — Protocolo detallado de comandos CLI y diagnósticos de bajo nivel.
- [Meta WhatsApp Cloud API Docs](https://developers.facebook.com/docs/whatsapp/cloud-api) — Referencia oficial de la API de WhatsApp.
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/) — Documentación de Workers, D1 y wrangler.
- [grammY Framework](https://grammy.dev/) — Framework de bots Telegram utilizado.
- [Gemini API Docs](https://ai.google.dev/docs) — Referencia de la API de Gemini.

---

## 📖 Disciplina de Desarrollo (Titanium Workflow)

Para contribuir a BORGPTRON, se deben seguir estas reglas de ingeniería:

1. **Test-Driven Development (TDD)**: Escribir el test fallido (Rojo) antes de la implementación (Verde).
2. **Aislamiento por Worktrees**: Nunca trabajes directamente en la rama principal. Crea un worktree aislado para cada feature.
3. **Zero `any` Tolerance**: El Any-Scanner bloquea el despliegue si detecta tipos implícitos sin justificación estructural.
4. **Git Notes para Auditoría**: Cada tarea completada debe llevar un resumen técnico adjunto.

---

© 2026 BORGPTRON Core Journey. Mantén la latencia baja, mantén el núcleo frío.
