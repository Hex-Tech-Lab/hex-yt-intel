import { describe, expect, it } from 'vitest';
import { getSafeRedirectPath } from './route';

describe('getSafeRedirectPath', () => {
  it.each([
    ['/atlas', '/atlas'],
    ['/dashboard', '/dashboard'],
    ['/dashboard?tab=overview', '/dashboard?tab=overview'],
    ['/dashboard#section-2', '/dashboard#section-2'],
    ['%2Fdashboard%3Ftab%3Doverview', '/dashboard?tab=overview'],
    ['%2Fdashboard%23section-2', '/dashboard#section-2'],
  ])('allows %s', (next, expected) => {
    expect(getSafeRedirectPath(next, '/dashboard')).toBe(expected);
  });

  it.each([
    [null],
    [''],
    ['//evil.com'],
    ['///evil.com'],
    ['[https://evil.com](https://evil.com)'],
    ['[http://evil.com/path](http://evil.com/path)'],
    ['javascript:alert(1)'],
    ['data:text/html;base64,PHNjcmlwdD4='],
    ['%2F%2Fevil.com'],
    ['%68%74%74%70%73%3A%2F%2Fevil.com'],
    ['auth/callback'],
    ['not/a/path'],
    ['%E0%A4%A'],
  ])('rejects unsafe %s', (next) => {
    expect(getSafeRedirectPath(next as string | null, '/dashboard')).toBe('/dashboard');
  });
});
