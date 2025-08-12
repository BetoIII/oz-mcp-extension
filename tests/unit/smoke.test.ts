import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('has a chrome mock in test env', () => {
    expect(globalThis).toHaveProperty('chrome');
    expect(typeof (globalThis as any).chrome.runtime.sendMessage).toBe('function');
  });
});


