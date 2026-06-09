import { describe, it, expect } from 'vitest';
import { sanitiseInput } from '../../src/lib/security.js';

describe('sanitiseInput', () => {
  it('strips HTML tags', () => {
    expect(sanitiseInput('<script>alert(1)</script>hello')).toBe('hello');
    expect(sanitiseInput('<b>bold</b> text')).toBe('bold text');
  });

  it('strips javascript: URIs', () => {
    expect(sanitiseInput('javascript:alert(1)')).toBe('alert(1)');
  });

  it('enforces max length', () => {
    const long = 'a'.repeat(5000);
    expect(sanitiseInput(long, 100).length).toBe(100);
  });

  it('trims whitespace', () => {
    expect(sanitiseInput('  hello  ')).toBe('hello');
  });

  it('passes normal pool maintenance messages', () => {
    const msg = 'Hola, la bomba no funciona. ¿Pueden venir hoy?';
    expect(sanitiseInput(msg)).toBe(msg);
  });
});
