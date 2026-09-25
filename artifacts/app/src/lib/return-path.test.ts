import { describe, expect, it } from 'vitest';
import { safeReturnPath } from './return-path';

describe('safeReturnPath', () => {
  it('keeps same-origin paths with their query', () => {
    expect(safeReturnPath('/reports/custom?rows=program&cols=glAccount')).toBe(
      '/reports/custom?rows=program&cols=glAccount',
    );
    expect(safeReturnPath('/')).toBe('/');
  });
  it('falls back for anything that could leave the origin', () => {
    for (const bad of [
      '',
      'https://evil.example/',
      '//evil.example/x',
      '/\\evil.example',
      '/\\\\evil.example',
      '/x\u0000y',
      '/x y',
      'javascript:alert(1)',
      'runs',
    ])
      expect(safeReturnPath(bad), bad).toBe('/runs');
  });
});
