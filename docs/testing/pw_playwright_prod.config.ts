// Re-export prod config with @playwright/test pre-resolved to web/node_modules only
// This avoids the pnpm monorepo double-require (root alias vs web alias).
const PLAYWRIGHT_WEB = '/home/kellyb_dev/projects/hex-yt-intel/web/node_modules';

// Intercept the resolver so @playwright/test always maps to the web install
const Module = await import('module');
const origResolve = Module.createRequire ? Module.createRequire(PLAYWRIGHT_WEB + '/notused.js').resolve : null;
(Module as any)._load = (function(orig: any) {
  return function(request: string, parent: any, isMain: boolean, options?: any) {
    // Only intercept for the known-clean path
    if (request === '@playwright/test') {
      const resolved = orig(PLAYWRIGHT_WEB + '/notused.js', parent, isMain, options) as any;
      if (resolved && resolved.path) {
        const patches: Record<string, string> = {
          [PLAYWRIGHT_WEB + '/node_modules/@playwright/test']: PLAYWRIGHT_WEB + '/node_modules/@playwright/test',
        };
        return orig(patches[resolved.path] || resolved.path, parent, isMain, options);
      }
    }
    return orig(request, parent, isMain, options);
  };
})((Module as any)._load);

// Now safely import — web/node_modules/@playwright/test will return the single resolved path
export { default, defineConfig, devices } from '/home/kellyb_dev/projects/hex-yt-intel/web/playwright.prod.config.ts';
