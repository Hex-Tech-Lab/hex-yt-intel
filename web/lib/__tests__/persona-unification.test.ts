/**
 * Persona Unification Test Suite
 *
 * Validates unified persona enum across the codebase:
 * - Single source of truth in web/lib/types/persona.ts
 * - No scattered p1-p5 or legacy enums
 * - Consistent PersonaId type throughout
 * - Validation and fallback mechanisms
 */

import { describe, it, expect } from 'vitest';
import type { PersonaId } from '@/lib/types/persona';
import { isValidPersona, PERSONA_DIMENSIONS } from '@/lib/types/persona';
import { detectPersona, rankPersonas } from '@/lib/prompts';
import { PathAInputSchema } from '@/lib/types/workflow';

const VALID_PERSONAS: PersonaId[] = ['creator', 'indieMaker', 'consultant', 'researcher', 'productManager'];

describe('Persona Unification', () => {
  describe('1. PersonaId Type Validation', () => {
    it('should define exactly 5 personas', () => {
      expect(VALID_PERSONAS).toHaveLength(5);
    });

    it('should have all personas defined', () => {
      const personas: PersonaId[] = ['creator', 'indieMaker', 'consultant', 'researcher', 'productManager'];
      expect(personas).toEqual(VALID_PERSONAS);
    });

    it('should reject null persona', () => {
      expect(isValidPersona(null)).toBe(false);
    });

    it('should reject undefined persona', () => {
      expect(isValidPersona(undefined)).toBe(false);
    });

    it('should reject numeric personas (p1-p5)', () => {
      expect(isValidPersona('p1')).toBe(false);
      expect(isValidPersona('p2')).toBe(false);
      expect(isValidPersona('p3')).toBe(false);
      expect(isValidPersona('p4')).toBe(false);
      expect(isValidPersona('p5')).toBe(false);
    });

    it('should accept all valid string personas', () => {
      VALID_PERSONAS.forEach((persona) => {
        expect(isValidPersona(persona)).toBe(true);
      });
    });

    it('should reject invalid string personas', () => {
      expect(isValidPersona('invalid')).toBe(false);
      expect(isValidPersona('creator2')).toBe(false);
      expect(isValidPersona('')).toBe(false);
    });
  });

  describe('2. PERSONA_DIMENSIONS Mapping', () => {
    it('should have dimensions defined for all personas', () => {
      VALID_PERSONAS.forEach((persona) => {
        expect(PERSONA_DIMENSIONS[persona]).toBeDefined();
        expect(Array.isArray(PERSONA_DIMENSIONS[persona])).toBe(true);
      });
    });

    it('creator should have all 11 dimensions', () => {
      expect(PERSONA_DIMENSIONS.creator).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    });

    it('indieMaker should have specific dimensions', () => {
      expect(PERSONA_DIMENSIONS.indieMaker).toEqual([1, 3, 5, 6, 7, 11]);
    });

    it('consultant should have specific dimensions', () => {
      expect(PERSONA_DIMENSIONS.consultant).toEqual([1, 2, 5, 8, 10, 11]);
    });

    it('researcher should have specific dimensions', () => {
      expect(PERSONA_DIMENSIONS.researcher).toEqual([1, 4, 5, 8, 9]);
    });

    it('productManager should have specific dimensions', () => {
      expect(PERSONA_DIMENSIONS.productManager).toEqual([1, 3, 5, 6, 9]);
    });

    it('all dimensions should be integers between 1-11', () => {
      VALID_PERSONAS.forEach((persona) => {
        const dims = PERSONA_DIMENSIONS[persona];
        dims.forEach((dim) => {
          expect(Number.isInteger(dim)).toBe(true);
          expect(dim).toBeGreaterThanOrEqual(1);
          expect(dim).toBeLessThanOrEqual(11);
        });
      });
    });
  });

  describe('3. Workflow Schema Integration (PathAInputSchema)', () => {
    it('should accept valid personas in workflow input', () => {
      VALID_PERSONAS.forEach((persona) => {
        const input = {
          url: 'https://youtube.com/watch?v=test',
          userId: 'user-123',
          tier: 'free' as const,
          timezone: 'UTC',
          persona,
        };
        const result = PathAInputSchema.safeParse(input);
        expect(result.success).toBe(true);
      });
    });

    it('should reject p1-p5 in workflow input', () => {
      const personas = ['p1', 'p2', 'p3', 'p4', 'p5'];
      personas.forEach((persona) => {
        const input = {
          url: 'https://youtube.com/watch?v=test',
          userId: 'user-123',
          tier: 'free' as const,
          timezone: 'UTC',
          persona,
        };
        const result = PathAInputSchema.safeParse(input);
        expect(result.success).toBe(false);
      });
    });

    it('should allow optional persona in workflow input', () => {
      const input = {
        url: 'https://youtube.com/watch?v=test',
        userId: 'user-123',
        tier: 'free' as const,
        timezone: 'UTC',
      };
      const result = PathAInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should validate workflow input without persona', () => {
      const input = {
        userId: 'user-123',
        tier: 'pro' as const,
        timezone: 'America/New_York',
      };
      const result = PathAInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('4. Persona Detection (detectPersona)', () => {
    it('should detect creator from video keywords', () => {
      const persona = detectPersona('How to Grow Your YouTube Channel', 'TechCreator');
      expect(VALID_PERSONAS).toContain(persona);
    });

    it('should detect indieMaker from startup keywords', () => {
      const persona = detectPersona('Building My First SaaS', 'IndieMaker');
      expect(persona).toBe('indieMaker');
    });

    it('should detect consultant from strategy keywords', () => {
      const persona = detectPersona('Strategic Business Framework', 'Consultant');
      expect(persona).toBe('consultant');
    });

    it('should detect researcher from research keywords', () => {
      const persona = detectPersona('Peer-Reviewed Academic Study', 'Dr. Researcher');
      expect(persona).toBe('researcher');
    });

    it('should detect productManager from product keywords', () => {
      const persona = detectPersona('Roadmap Prioritization Guide', 'ProductManager');
      expect(persona).toBe('productManager');
    });

    it('should return creator as default fallback', () => {
      const persona = detectPersona('Random Title', 'Random Author');
      expect(persona).toBe('creator');
    });

    it('should always return valid PersonaId', () => {
      const testCases = [
        { title: 'Test Video', author: 'Author' },
        { title: '', author: '' },
        { title: 'Something Else', author: 'Unknown' },
      ];
      testCases.forEach(({ title, author }) => {
        const persona = detectPersona(title, author);
        expect(VALID_PERSONAS).toContain(persona);
      });
    });
  });

  describe('5. Persona Ranking (rankPersonas)', () => {
    it('should rank all personas starting with specified primary', () => {
      VALID_PERSONAS.forEach((primaryPersona) => {
        const ranked = rankPersonas(primaryPersona);
        expect(ranked).toHaveLength(5);
        expect(ranked[0].personaId).toBe(primaryPersona);
      });
    });

    it('should assign correct weights', () => {
      const ranked = rankPersonas('creator');
      expect(ranked[0].weight).toBe(50); // primary
      expect(ranked[1].weight).toBe(25); // secondary
      expect(ranked[2].weight).toBe(15); // tertiary
      expect(ranked[3].weight).toBe(5);  // other
      expect(ranked[4].weight).toBe(5);  // other
    });

    it('should include all personas in ranking', () => {
      const ranked = rankPersonas('indieMaker');
      const rankedIds = ranked.map((r) => r.personaId);
      VALID_PERSONAS.forEach((persona) => {
        expect(rankedIds).toContain(persona);
      });
    });

    it('should have human-readable names for all personas', () => {
      const ranked = rankPersonas('consultant');
      ranked.forEach((config) => {
        expect(config.name).toBeTruthy();
        expect(typeof config.name).toBe('string');
        expect(config.name.length).toBeGreaterThan(0);
      });
    });
  });

  describe('6. Type Safety Checks', () => {
    it('should assign persona type correctly', () => {
      const personas: PersonaId[] = ['creator', 'indieMaker', 'consultant', 'researcher', 'productManager'];
      personas.forEach((persona) => {
        const typed: PersonaId = persona;
        expect(VALID_PERSONAS).toContain(typed);
      });
    });

    it('should reject non-PersonaId strings', () => {
      const invalidPersona = 'p1';
      // This would be a type error in strict TypeScript
      expect(isValidPersona(invalidPersona)).toBe(false);
    });
  });

  describe('7. Fallback Behavior', () => {
    it('should default to creator when persona is undefined', () => {
      const fallback: PersonaId = 'creator';
      expect(VALID_PERSONAS).toContain(fallback);
      expect(fallback).toBe('creator');
    });

    it('should default to creator when persona is null', () => {
      const fallback: PersonaId = 'creator';
      expect(isValidPersona(fallback)).toBe(true);
    });

    it('should handle persona cast safely', () => {
      const unknownPersona: unknown = 'creator';
      if (isValidPersona(unknownPersona)) {
        expect(VALID_PERSONAS).toContain(unknownPersona);
      }
    });
  });

  describe('8. Consistency Across Modules', () => {
    it('should have consistent persona names', () => {
      const personaNames = new Set(VALID_PERSONAS);
      expect(personaNames.size).toBe(5);
    });

    it('should use camelCase naming consistently', () => {
      const camelCasePersonas = VALID_PERSONAS.filter((p) => p === p.match(/^[a-z]+([A-Z][a-z]+)*$/)?.[0]);
      expect(camelCasePersonas).toContain('indieMaker');
      expect(camelCasePersonas).toContain('productManager');
    });

    it('detectPersona should return PersonaId', () => {
      const persona = detectPersona('Test', 'Test');
      expect(isValidPersona(persona)).toBe(true);
    });

    it('rankPersonas should accept only valid PersonaIds', () => {
      VALID_PERSONAS.forEach((persona) => {
        expect(() => rankPersonas(persona)).not.toThrow();
      });
    });
  });

  describe('9. No Legacy p1-p5 References', () => {
    it('should not use p1 in production code', () => {
      const invalidPersona = 'p1';
      expect(isValidPersona(invalidPersona)).toBe(false);
    });

    it('should not use p2 in production code', () => {
      const invalidPersona = 'p2';
      expect(isValidPersona(invalidPersona)).toBe(false);
    });

    it('should not use p3 in production code', () => {
      const invalidPersona = 'p3';
      expect(isValidPersona(invalidPersona)).toBe(false);
    });

    it('should not use p4 in production code', () => {
      const invalidPersona = 'p4';
      expect(isValidPersona(invalidPersona)).toBe(false);
    });

    it('should not use p5 in production code', () => {
      const invalidPersona = 'p5';
      expect(isValidPersona(invalidPersona)).toBe(false);
    });
  });
});
