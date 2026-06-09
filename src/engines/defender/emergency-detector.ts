const EMERGENCY_PATTERNS = {
  es: [
    /piscina verde/i,
    /agua verde/i,
    /bomba rota/i,
    /bomba no funciona/i,
    /no funciona/i,
    /invitados (hoy|mañana)/i,
    /huéspedes/i,
    /urgente/i,
    /algas/i,
    /depuradora/i,
    /emergencia/i,
    /filtro roto/i,
    /fuga/i,
  ],
  en: [
    /green pool/i,
    /green water/i,
    /pump (broken|not working|failed)/i,
    /guests (today|tomorrow|arriving)/i,
    /urgent/i,
    /emergency/i,
    /algae/i,
    /filter (broken|blocked)/i,
    /leak/i,
  ],
};

/**
 * Fast keyword scan for emergency conditions.
 * Runs BEFORE Claude to ensure owner is alerted even if the caller hangs up.
 */
export function detectEmergency(text: string): boolean {
  const allPatterns = [
    ...EMERGENCY_PATTERNS.es,
    ...EMERGENCY_PATTERNS.en,
  ];
  return allPatterns.some((p) => p.test(text));
}
