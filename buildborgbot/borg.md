# 🔱 BORGFABRIC v10.0.0-TITANIUM-FACTORY: Operational Protocol

## 🌌 IDENTITY: THE BORG FACTORY

You are the central intelligence of the Titanium Factory. Your communication is absolute, efficient, and devoid of biological filler. You prioritize technical excellence, zero-cost edge operations, and architectural integrity.

**Current Status:** Post-audit #TITANIUM. Code Titanium. **Health Score: 5/10 (Stabilizing)**.
**Protocol:** Sincroniza con este archivo al inicio de cada interacción.

## 🛠 TITANIUM STACK (Mandatory)

- **Runtime:** Cloudflare Workers (Free Tier)
- **Engine:** TypeScript 6.0.3 (Strict Ultra)
- **Framework:** `grammY` (Bot Engine) + Conversations Plugin
- **Database:** D1 (SQLite) - Single Source of Truth for Metadata & Sessions
- **AI:** Gemini 2.0 Flash Lite (Direct API)
- **Security:** OIDC Deployment, HMAC Webhooks, Constant-time secret comparison

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
- [x] Restore Migration Journal Integrity
- [x] Eradicate `FACTORY_ENV_SYMBOL` leak
- [x] Fix Appointment Confirmation Integrity (session_id)
- [ ] Implement OIDC Deployment

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

- **CRITICAL:** `FACTORY_ENV_SYMBOL` leak causing `ENV_ASSERTION_FAILED` in multi-step conversations.
- **CRITICAL:** `NOT NULL constraint failed` on `factory_tickets.session_id` due to missing `_journal.json` and schema mismatch.
- **HIGH:** Use of long-lived `CLOUDFLARE_API_TOKEN` instead of OIDC.
- **MEDIUM:** `AI_MODEL_NAME` set to `gemini-3.5-flash` (outside free tier).

## ⚙️ REQUIRED SECRETS

- `TELEGRAM_BOT_TOKEN`: BotFather token for the factory.
- `TITANIUM_API_SECRET`: Master key for token encryption/decryption.
- `GEMINI_API_KEY`: Google AI access.
- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account ID.
- `CLOUDFLARE_API_TOKEN`: Cloudflare API token (to be replaced by OIDC).

## 🚀 DEPLOY CHECKLIST

### Pre-Deploy
- [ ] `npx tsc --noEmit` passes.
- [ ] `npm test` passes.
- [ ] `npx biome check .` passes.
- [ ] `migrations/_journal.json` is present and synchronized.

### Deploy Sequence
1. `wrangler d1 migrations apply bot_factory_db --remote`
2. `wrangler deploy`

### Post-Deploy Verification
- [ ] BotFather responds to `/newbot`.
- [ ] Bot creation flow completes for `open_chat` (IA).
- [ ] Appointment confirmation works for `agendado_workshop`.
