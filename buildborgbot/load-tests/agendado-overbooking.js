import { check, sleep } from "k6";
import http from "k6/http";

export const options = {
  vus: 100,
  duration: "10s",
};

export default function () {
  const url = `${__ENV.WORKER_URL_STAGING}/webhook/agendado-test-slug`;
  // Simulate a Telegram/WhatsApp update for appointment booking
  const payload = JSON.stringify({
    update_id: Math.floor(Math.random() * 1000000),
    message: {
      from: { id: 12345678, first_name: "Test User" },
      chat: { id: 12345678, type: "private" },
      text: "Confirmar", // Assuming this triggers the atomic ticket creation
    },
  });

  const params = {
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": "test-webhook-secret",
    },
  };

  const res = http.post(url, payload, params);

  check(res, {
    "is status 200": (r) => r.status === 200,
  });

  sleep(0.1);
}
