import { describe, it, expect, beforeEach } from "vitest";
import { adminAuthGuard } from "../shared/security";
import { CoreEnv, BorgExecutionContext } from "../shared/types";

describe("adminAuthGuard", () => {
  let req: Request;
  let env: Partial<CoreEnv>;
  let ctx: BorgExecutionContext;

  beforeEach(() => {
    env = {
      TELEGRAM_ADMIN_IDS: "123,456",
      BORG_SECRET_KEY: "secret",
    };
    ctx = { traceId: "1", waitUntil: () => {} };
  });

  it("should return 400 for malformed JSON", async () => {
    req = new Request("https://example.com", {
      method: "POST",
      body: "not-json",
    });
    const res = await adminAuthGuard(req, env as CoreEnv, ctx);
    expect(res?.status).toBe(400);
  });

  it("should return 403 for non-admin user", async () => {
    const body = JSON.stringify({
      update_id: 1,
      message: { from: { id: 789 } },
    });
    req = new Request("https://example.com", {
      method: "POST",
      body,
    });
    const res = await adminAuthGuard(req, env as CoreEnv, ctx);
    expect(res?.status).toBe(403);
  });

  it("should return null (pass) for admin user", async () => {
    const body = JSON.stringify({
      update_id: 1,
      message: { from: { id: 123 } },
    });
    req = new Request("https://example.com", {
      method: "POST",
      body,
    });
    const res = await adminAuthGuard(req, env as CoreEnv, ctx);
    expect(res).toBe(null);
  });
});
