import { describe, expect, it } from "vitest";
import { RelationalSessionAdapter } from "../../src/factory/adapter";

describe("Multi-tenant Isolation", () => {
  function createMockDb() {
    const storage = new Map<
      string,
      { step_data: string; paso_actual: number }
    >();
    return {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          first: async () => {
            if (sql.includes("SELECT step_data")) {
              const chatId = args[0];
              const botId = args[1];
              const res = storage.get(`${chatId}:${botId}`);
              if (!res) return null;
              return {
                step_data: JSON.stringify(res.step_data),
                paso_actual: res.paso_actual,
              };
            }
            return null;
          },
          run: async () => {
            if (sql.includes("UPDATE factory_sessions")) {
              const paso_actual = args[0] as number;
              const step_data = JSON.parse(args[1] as string);
              const botId = args[3] as string;
              const chatId = args[5] as string;
              storage.set(`${chatId}:${botId}`, { step_data, paso_actual });
            } else if (sql.includes("INSERT INTO factory_sessions")) {
              const botId = args[1] as string;
              const chatId = args[3] as string;
              const paso_actual = args[4] as number;
              const step_data = JSON.parse(args[5] as string);
              storage.set(`${chatId}:${botId}`, { step_data, paso_actual });
            }
            return { meta: { changes: 1 } };
          },
        }),
      }),
    } as unknown as D1Database;
  }

  it("should isolate sessions between different bots", async () => {
    const db = createMockDb();
    const adapter = new RelationalSessionAdapter(db);

    const keyA = "session:chat123:botA";
    const keyB = "session:chat123:botB";

    await adapter.write(keyA, { step_data: { user: "Alice" }, paso_actual: 1 });
    await adapter.write(keyB, { step_data: { user: "Bob" }, paso_actual: 2 });

    const sessionA = await adapter.read(keyA);
    const sessionB = await adapter.read(keyB);

    expect(sessionA).toEqual({ step_data: { user: "Alice" }, paso_actual: 1 });
    expect(sessionB).toEqual({ step_data: { user: "Bob" }, paso_actual: 2 });
  });

  it("should isolate sessions between different chats for the same bot", async () => {
    const db = createMockDb();
    const adapter = new RelationalSessionAdapter(db);

    const key1 = "session:chat1:botA";
    const key2 = "session:chat2:botA";

    await adapter.write(key1, {
      step_data: { data: "Session 1" },
      paso_actual: 1,
    });
    await adapter.write(key2, {
      step_data: { data: "Session 2" },
      paso_actual: 2,
    });

    const session1 = await adapter.read(key1);
    const session2 = await adapter.read(key2);

    expect(session1).toEqual({
      step_data: { data: "Session 1" },
      paso_actual: 1,
    });
    expect(session2).toEqual({
      step_data: { data: "Session 2" },
      paso_actual: 2,
    });
  });
});
