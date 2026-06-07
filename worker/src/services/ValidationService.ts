/**
 * ValidationService - Pure Service (stateless)
 *
 * Validates the 11-dimension UCIS analysis structure. Config-only / stateless:
 * safe to share across requests.
 */
export class ValidationService {
  /**
   * Validate 11D analysis structure: requires at least 8/11 dimension headers.
   * Gate before caching / marking complete.
   */
  validate12D(analysis: unknown): boolean {
    if (typeof analysis !== 'string') return false;

    const trimmed = analysis.trim();
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed?.schemaVersion !== '2.0') return false;
        const dims = parsed?.dimensions;
        return Array.isArray(dims) && dims.length >= 8;
      } catch {
        return false;
      }
    }

    if (trimmed.startsWith('#')) {
      const requiredDimensions = [
        'DIMENSION 1', 'DIMENSION 2', 'DIMENSION 3', 'DIMENSION 4',
        'DIMENSION 5', 'DIMENSION 6', 'DIMENSION 7', 'DIMENSION 8',
        'DIMENSION 9', 'DIMENSION 10', 'DIMENSION 11',
      ];
      return requiredDimensions.filter((dim) => analysis.includes(dim)).length >= 8;
    }

    return false;
  }
}
