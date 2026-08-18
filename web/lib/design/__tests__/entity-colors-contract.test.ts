/**
 * Contract test: POLE+O is the single canonical entity-type vocabulary,
 * enforced by kg_entities' Postgres CHECK constraint and by
 * normalizeEntityType() at every write boundary (see entity-taxonomy.ts).
 * entity-colors.ts only ever needs to color POLE+O values -- this test is
 * the drift guard for that invariant, and for normalizeEntityType() still
 * covering every legacy value the worker's old 8-value enum ever produced
 * (root-caused 2026-08-15 as the "everything renders gray" bug; the fix
 * is normalization at the boundary, not a second palette to keep in sync).
 */
import { describe, it, expect } from 'vitest';
import { ENTITY_HEX, ENTITY_RGB, ENTITY_DEFAULT_HEX, entityHex, entityRgb, type EntityType } from '../entity-colors';
import { normalizeEntityType, type PoleOType } from '../entity-taxonomy';

const POLE_O_TYPES: PoleOType[] = ['Person', 'Organization', 'Location', 'Event', 'Object'];

// The worker's legacy 8-value lowercase enum -- kept here only as a fixed
// historical list to assert normalizeEntityType() still maps every one of
// them, not as a live import (no shared package links worker/ and web/).
const LEGACY_WORKER_VALUES = ['person', 'concept', 'framework', 'tool', 'organization', 'study', 'trend', 'metric'];

describe('entity type taxonomy contract (POLE+O canonical)', () => {
  it('ENTITY_HEX has exactly the 5 POLE+O keys, no more, no less', () => {
    expect(Object.keys(ENTITY_HEX).sort()).toEqual([...POLE_O_TYPES].sort());
  });

  it('ENTITY_RGB has the same keys as ENTITY_HEX', () => {
    expect(Object.keys(ENTITY_RGB).sort()).toEqual(Object.keys(ENTITY_HEX).sort());
  });

  it('every POLE+O type resolves to a real, distinct color, never the gray fallback', () => {
    const colors = POLE_O_TYPES.map((entityType) => entityHex(entityType));
    for (const [i, entityType] of POLE_O_TYPES.entries()) {
      expect(colors[i]).not.toBe(ENTITY_DEFAULT_HEX);
      expect(ENTITY_HEX[entityType as EntityType]).toBeDefined();
    }
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('unknown/unnormalized input falls back to gray, not a crash', () => {
    expect(entityHex('totally-unknown-type')).toBe(ENTITY_DEFAULT_HEX);
    expect(entityHex(undefined)).toBe(ENTITY_DEFAULT_HEX);
    expect(entityHex(null)).toBe(ENTITY_DEFAULT_HEX);
    expect(entityRgb('totally-unknown-type')).toBe(entityRgb(undefined));
  });

  it('normalizeEntityType maps every legacy worker value to a POLE+O type that resolves to a real color', () => {
    for (const legacy of LEGACY_WORKER_VALUES) {
      const normalized = normalizeEntityType(legacy);
      expect(POLE_O_TYPES).toContain(normalized);
      expect(entityHex(normalized)).not.toBe(ENTITY_DEFAULT_HEX);
    }
  });

  it('normalizeEntityType is idempotent on already-canonical POLE+O values', () => {
    for (const canonical of POLE_O_TYPES) {
      expect(normalizeEntityType(canonical)).toBe(canonical);
    }
  });
});
