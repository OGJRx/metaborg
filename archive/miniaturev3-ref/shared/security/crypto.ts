export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const aBuf = encoder.encode(a);
  const bBuf = encoder.encode(b);

  const aHash = await crypto.subtle.digest("SHA-256", aBuf);
  const bHash = await crypto.subtle.digest("SHA-256", bBuf);

  const aHashArray = new Uint8Array(aHash);
  const bHashArray = new Uint8Array(bHash);

  // timingSafeEqual is available natively in Cloudflare Workers (V8 engine).
  // The fallback below exists solely for Vitest compatibility (Node.js < 20),
  // where crypto.subtle.timingSafeEqual may not be available.
  // To remove this fallback: configure Vitest with Node 20+ or add a
  // crypto.subtle.timingSafeEqual polyfill in tests/setup.ts.
  if (hasTimingSafeEqual(crypto.subtle)) {
    return crypto.subtle.timingSafeEqual(aHash, bHash);
  }

  // Fallback for environments where timingSafeEqual is not available (like Vitest).
  // TODO(audit): Remove fallback once Vitest environment guarantees timingSafeEqual.
  if (aHashArray.length !== bHashArray.length) return false;
  let r = 0;
  for (let i = 0; i < aHashArray.length; i++) {
    const aVal = aHashArray[i];
    const bVal = bHashArray[i];
    if (aVal !== undefined && bVal !== undefined) {
      r |= aVal ^ bVal;
    }
  }
  return r === 0;
}

interface SubtleWithTimingSafeEqual extends SubtleCrypto {
  timingSafeEqual(a: ArrayBuffer, b: ArrayBuffer): boolean;
}

function hasTimingSafeEqual(
  subtle: SubtleCrypto,
): subtle is SubtleWithTimingSafeEqual {
  return (
    "timingSafeEqual" in subtle && typeof subtle.timingSafeEqual === "function"
  );
}

export async function hmacSha256(
  secret: string,
  data: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const dataToSign = encoder.encode(data);
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, dataToSign);
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
