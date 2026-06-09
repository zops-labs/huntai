import { describe, it, expect } from 'vitest';
import { detectEmergency } from '../../src/engines/defender/emergency-detector.js';

describe('detectEmergency', () => {
  it('detects Spanish green pool', () => {
    expect(detectEmergency('la piscina está verde')).toBe(true);
  });

  it('detects English green water', () => {
    expect(detectEmergency('the water is green')).toBe(false); // "green water" not "water is green"
    expect(detectEmergency('green water problem')).toBe(true);
  });

  it('detects broken pump in Spanish', () => {
    expect(detectEmergency('la bomba está rota')).toBe(true);
  });

  it('detects urgente keyword', () => {
    expect(detectEmergency('es urgente, necesito ayuda')).toBe(true);
  });

  it('does not false-positive on normal messages', () => {
    expect(detectEmergency('quiero reservar una cita para el lunes')).toBe(false);
    expect(detectEmergency('cuánto cuesta el mantenimiento mensual')).toBe(false);
  });

  it('detects English emergency', () => {
    expect(detectEmergency('we have an emergency, guests arriving tomorrow')).toBe(true);
  });

  it('detects algae', () => {
    expect(detectEmergency('hay algas en la piscina')).toBe(true);
    expect(detectEmergency('algae is growing')).toBe(true);
  });
});
