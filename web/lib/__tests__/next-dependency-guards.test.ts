import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// __dirname here is web/lib/__tests__ (vitest ESM shims it); two levels up is web/.
const WEB_DIR = path.resolve(__dirname, '../..');
const INSTALLED_NEXT_DIR = path.resolve(WEB_DIR, 'node_modules/next');
const INSTALLED_ECN_DIR = path.resolve(WEB_DIR, 'node_modules/eslint-config-next');

/** Reads the version field from an installed package's package.json. */
const readPkgVersion = (pkgDir: string): string => {
  const pkg = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8')) as {
    version?: string;
  };
  if (!pkg.version) throw new Error(`No version field found for ${pkgDir}`);
  return pkg.version;
};

/** Parses "x.y.z" (ignoring prerelease suffixes) into numeric parts. */
const parseMajorMinor = (version: string): [number, number, number] => {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw new Error(`Unparseable version: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
};

/** Three-part semver comparison: negative = left older, 0 = equal. */
const compareSemver = (leftVersion: string, rightVersion: string): number => {
  const leftParts = parseMajorMinor(leftVersion);
  const rightParts = parseMajorMinor(rightVersion);
  for (let i = 0; i < 3; i++) {
    if (leftParts[i] !== rightParts[i]) return leftParts[i] - rightParts[i];
  }
  return 0;
};

const MIN_NEXT_VERSION = '16.3.3';

describe('Next.js dependency-version guards (PR #317 security regression coverage)', () => {
  it('installed next is >= 16.3.3 (CVE floor — guards regression to the vulnerable 16.2.x line)', () => {
    const installed = readPkgVersion(INSTALLED_NEXT_DIR);
    expect(
      compareSemver(installed, MIN_NEXT_VERSION),
      `installed next ${installed} is older than the CVE-fix floor ${MIN_NEXT_VERSION}`
    ).toBeGreaterThanOrEqual(0);
  });

  it('declared next dependency matches the CVE floor', () => {
    const pkg = JSON.parse(
      readFileSync(path.join(WEB_DIR, 'package.json'), 'utf8')
    ) as { devDependencies?: Record<string, string> };
    const declaredNext = pkg.devDependencies?.next;
    expect(declaredNext, 'next missing from web/package.json devDependencies').toBeDefined();
    expect(
      declaredNext?.startsWith('16.3.'),
      `declared next ${String(declaredNext)} is not on the 16.3.x line`
    ).toBe(true);
  });

  it('eslint-config-next declared version matches the pnpm-workspace.yaml override pin (drift guard)', () => {
    // eslint-config-next is NOT expected to track next's version: it is
    // deliberately pinned at 14.2.16 via pnpm-workspace.yaml overrides
    // (ESLint 8.x frozen stack; >=15 requires ESLint 9 + flat config).
    // Real drift incident (PR #317 round 2): package.json claimed 16.2.6
    // while the override silently resolved 14.2.16.
    const wsYaml = readFileSync(
      path.resolve(WEB_DIR, '../pnpm-workspace.yaml'),
      'utf8'
    );
    const pinMatch = wsYaml.match(/"eslint-config-next":\s*"([^"]+)"/);
    expect(pinMatch, 'override pin missing from pnpm-workspace.yaml').not.toBeNull();

    const pkg = JSON.parse(
      readFileSync(path.join(WEB_DIR, 'package.json'), 'utf8')
    ) as { devDependencies?: Record<string, string> };
    const declared = pkg.devDependencies?.['eslint-config-next'];

    const ecnPin = pinMatch?.[1];
    expect(ecnPin, 'override pin missing from pnpm-workspace.yaml').toBeDefined();

    // Declared == resolved (override wins in pnpm, so these must agree).
    expect(declared).toBe(ecnPin);
    expect(readPkgVersion(INSTALLED_ECN_DIR)).toBe(ecnPin);
  });
});
