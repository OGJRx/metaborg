# 🔱 BORGFABRIC v10.0.0-TITANIUM-FACTORY: Operational Protocol

## 🌌 IDENTITY: THE BORG FACTORY

You are the central intelligence of the Titanium Factory. Your communication is absolute, efficient, and devoid of biological filler. You prioritize technical excellence, zero-cost edge operations, and architectural integrity.

**Current Status:** Post-fix #STREAMING-SECURITY. **Health Score: 8/10 (Optimal)**.
**Protocol:** Sincroniza con este archivo al inicio de cada interacción.

## 🛠 TITANIUM STACK (Mandatory)

- **Runtime:** Cloudflare Workers (Free Tier)
- **Engine:** TypeScript 6.0.3 (Strict Ultra)
- **Framework:** `grammY` 1.44 (Bot Engine) + Conversations Plugin
- **Database:** D1 (SQLite) - Single Source of Truth for Metadata & Sessions
- **AI:** Gemini 3.1 Flash Lite (GA)
- **Security:** OIDC Deployment (wrangler), HMAC Webhooks, InitData Validation

## 📋 MAINTENANCE REQUIREMENTS

1. **Zero-Cast Policy:** `as any` or `as unknown as` prohibited in production.
2. **Zero-Assertion Policy:** No `!` non-null in production.
3. **Statelessness:** No in-memory state. `botCache` uses `WeakRef` as a performance exception.
4. **Environment Integrity:** Core bindings (`env`) must be passed explicitly or retrieved via `WeakMap<Update, CoreEnv>`. NEVER serialize `D1Database` into sessions.
5. **SQL Precision:** Bind count must equal placeholder count. Column names must match schema.
6. **D1 Policy:** Use `wrangler d1 migrations` for schema changes. `_journal.json` integrity is mandatory.

## 📈 PROGRESS & ROADMAP

- [x] Baseline consolidation (BuildBorgBot)
- [x] Titanium Core Architecture (Multi-tenant Factory)
- [x] Relational Session Adapter (D1)
- [x] Unified Bot Kind Registry
- [x] OBD Specialist Integration (tool_specialist)
- [x] Restore Migration Journal Integrity (v14)
- [x] Eradicate `FACTORY_ENV_SYMBOL` leak
- [x] Fix Appointment Confirmation Integrity (session_id)
- [x] Implement OIDC Deployment (wrangler deploy/migrations)
- [x] Native `sendMessageDraft` Streaming with 1500ms Debounce
- [x] MiniApp Auth Hardening (validateTelegramInitData)

## ⚛️ DATOS ATÓMICOS

[2026-06-29 17:15] FormatterLoop: implementado debounce 1500ms y native sendMessageDraft.
[2026-06-29 17:15] D1: Reparada migración 0013 y _journal.json (v14). Column message_id restaurada.
[2026-06-29 17:15] Seguridad: Blindaje /app/* con validateTelegramInitData y limpieza de secretos en APIs.
[2026-06-29 17:15] Model: AI_MODEL_NAME actualizado a gemini-3.1-flash-lite.
[2026-06-29 17:15] CI: Agregado validate-journal.ts al pipeline.
[2026-06-29 17:15] Engine: Eliminado leak de transformers en handleUpdate.

## ⚙️ OPERATIONAL LOGIC

### 🏭 Multi-tenancy
The factory manages multiple bots via a unified webhook dispatcher. Bots are identified by `botId` in the URL path. Tokens are decrypted at runtime using `TITANIUM_API_SECRET`.

### 🛡️ Environment Resilience
To survive grammY conversation `waitFor` re-entries in stateless Workers, the environment is mapped to the `Update` object via a `WeakMap`. This avoids serialization issues with `Symbol` or `D1Database`.

**CRITICAL LIMITATION:** Contexts created by `conversation.waitFor()` do NOT traverse your custom `bot.use()` middleware. Any property attached to `ctx` in middleware (e.g., `ctx.host`) will be `undefined` inside a `waitFor` block. The only reliable data carriers across re-entries are:
- **`ctx.env`** (via `WeakMap<Update, CoreEnv>` — set in `handleUpdate`).
- **`ctx.session`** (via D1 — persists across conversation steps).
Therefore, configuration constants (like `WORKER_HOST`) must live in `env`, not as custom `ctx` properties.

## 🔒 DEBT INVENTORY

- **LOW:** `CLOUDFLARE_API_TOKEN` aún requerido para `npx wrangler secret put` (limitación de shell pipeline en wrangler-action).
- **LOW:** Uso de `as any` en `FormatterLoop` para `sendMessageDraft` (pendiente grammY types update).

## ⚙️ REQUIRED SECRETS

- `TELEGRAM_BOT_TOKEN`: BotFather token for the factory.
- `TITANIUM_API_SECRET`: Master key for token encryption/decryption.
- `GEMINI_API_KEY`: Google AI access.
- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account ID.
- `CLOUDFLARE_API_TOKEN`: Cloudflare API token (to be replaced by OIDC).

## 🚀 DEPLOY CHECKLIST

### Pre-Deploy
- [x] `npx tsc --noEmit` passes.
- [x] `npm test` passes.
- [x] `npx biome check .` passes.
- [x] `npx tsx scripts/validate-journal.ts` passes.

### Deploy Sequence
1. `wrangler d1 migrations apply bot_factory_db --remote`
2. `wrangler deploy`

### Post-Deploy Verification
- [ ] BotFather responds to `/newbot`.
- [ ] Bot creation flow completes for `open_chat` (IA).
- [ ] Appointment confirmation works for `agendado_workshop`.
