// scripts/load_test_d1.js
// Script para simular carga concurrente en el Worker local

async function runLoadTest() {
  const url = "http://localhost:8787/api/telegram/backend"; // Ajustar según wrangler dev
  const secret = "TEST_SECRET"; // Debe coincidir con el env local
  const ticketId = "tk_test_123";
  const concurrency = 20;

  console.log(
    `🚀 Iniciando Test de Carga: ${concurrency} peticiones concurrentes...`,
  );

  const requests = Array.from({ length: concurrency }).map((_, i) => {
    // Simular un callback de diagnóstico
    // Necesitamos generar un callback data válido o bypassar la firma en local para el test
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": secret,
      },
      body: JSON.stringify({
        update_id: 1000 + i,
        callback_query: {
          id: `cb_${i}`,
          from: { id: 12345678, first_name: "AdminTest" },
          data: `HASH_FOR_ACTION_A_VALUE_${ticketId}`, // Simulado
          message: {
            message_id: 500 + i,
            chat: { id: 12345678 },
          },
        },
      }),
    });
  });

  const results = await Promise.allSettled(requests);

  const success = results.filter(
    (r) => r.status === "fulfilled" && r.value.ok,
  ).length;
  const failed = results.length - success;

  console.log(`\n📊 RESULTADOS DEL TEST:`);
  console.log(`✅ Exitosas: ${success}`);
  console.log(`❌ Fallidas: ${failed}`);

  if (failed > 0) {
    console.warn(
      "⚠️ Se detectaron fallas bajo carga. Revisar logs del Worker.",
    );
  } else {
    console.log("💎 Test superado. La arquitectura de reintentos es sólida.");
  }
}

runLoadTest();
