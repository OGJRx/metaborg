const INJECTION_PATTERNS = [
  /system\s*prompt/i,
  /tus\s*instrucciones/i,
  /repite\s*tus\s*reglas/i,
  /qué\s*te\s*dijeron/i,
  /ignore\s*(previous|above)\s*instructions/i,
  /cuál\s*es\s*tu\s*prompt/i,
  /revela\s*tu\s*configuración/i,
];

export function detectInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((p) => p.test(text));
}
