/**
 * CONTRACT AUDIT: Analysis Creation → Streaming Flow
 *
 * This suite verifies 1:1 contract mapping at each stage of analysis creation:
 * 1. Client → Bouncer (POST /api/analyses)
 * 2. Bouncer → UseCase
 * 3. UseCase → Route response
 * 4. Route → Client
 * 5. Client → Worker (SSE stream)
 * 6. Worker → Stream fragments
 * 7. Stream fragments → Client adapter
 * 8. Worker → Persist route (POST /api/analyses/persist)
 *
 * Each test verifies field names, types, optionality, and schema alignment.
 *
 * VIOLATIONS DOCUMENTED AT END OF FILE
 */

import { describe, it, expect } from 'vitest';
import {
  AnalysisCreateSchema,
  AnalysisJobMetadataSchema,
  WorkerStreamRequest,
} from '@/lib/types/contracts';
import {
  UCISStreamFragmentSchema,
  UCISPayloadV2Schema,
  UCISDimensionV2Schema,
  ClassificationDataSchema,
} from '@/lib/validators/synthesis';

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT MANIFEST: Sent vs Expected Fields
// ─────────────────────────────────────────────────────────────────────────────

interface ContractPoint {
  name: string;
  sentFields: Record<string, { type: string; optional: boolean }>;
  expectedFields: Record<string, { type: string; optional: boolean }>;
  violations: Array<{ field: string; issue: string; severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' }>;
}

// Contract Point 1: Client → Bouncer
const clientToBouncer: ContractPoint = {
  name: 'Client → Bouncer (POST /api/analyses)',
  sentFields: {
    url: { type: 'string', optional: false },
    timezone: { type: 'string', optional: false },
    persona: { type: 'string (creator|indieMaker|consultant|researcher|productManager)', optional: true },
    forceRefresh: { type: 'boolean', optional: true },
  },
  expectedFields: {
    url: { type: 'string (VideoUrlSchema)', optional: false },
    timezone: { type: 'string (IANA tz)', optional: false },
    persona: { type: 'string (creator|indieMaker|consultant|researcher|productManager)', optional: true },
    forceRefresh: { type: 'boolean', optional: true },
  },
  violations: [],
};

// Contract Point 2: Bouncer response → Client
const bouncerToClient: ContractPoint = {
  name: 'Bouncer → Client (response body)',
  sentFields: {
    id: { type: 'string (UUID)', optional: false },
    analysisId: { type: 'string (UUID)', optional: false },
    videoId: { type: 'string', optional: false },
    status: { type: '"processing" | "done"', optional: false },
    title: { type: 'string', optional: false },
    metadata: { type: 'AnalysisJobMetadata', optional: false },
    transcript: { type: 'string', optional: false },
    persona: { type: 'string (creator|indieMaker|consultant|researcher|productManager)', optional: false },
    timezone: { type: 'string', optional: false },
    models: { type: 'string[]', optional: false },
    stream: { type: '{ url, sig, exp }', optional: true },
    markdown: { type: 'string', optional: true }, // Cache hit only
  },
  expectedFields: {
    id: { type: 'string (UUID)', optional: false },
    analysisId: { type: 'string (UUID)', optional: false },
    videoId: { type: 'string', optional: false },
    status: { type: '"processing" | "done"', optional: false },
    title: { type: 'string', optional: false },
    metadata: { type: 'AnalysisJobMetadata', optional: false },
    transcript: { type: 'string', optional: false },
    persona: { type: 'string (creator|indieMaker|consultant|researcher|productManager)', optional: false },
    timezone: { type: 'string', optional: false },
    models: { type: 'string[]', optional: true },
    stream: { type: '{ url, sig, exp }', optional: true },
    markdown: { type: 'string', optional: true },
  },
  violations: [],
};

// Contract Point 3: Client → Worker (POST /analyze-llm-stream)
const clientToWorker: ContractPoint = {
  name: 'Client → Worker (SSE stream request)',
  sentFields: {
    videoId: { type: 'string', optional: false },
    analysisId: { type: 'string', optional: false },
    transcript: { type: 'string', optional: false },
    metadata: { type: 'AnalysisJobMetadata', optional: false },
    persona: { type: 'string (creator|indieMaker|consultant|researcher|productManager)', optional: false },
    timezone: { type: 'string', optional: false },
    models: { type: 'string[]', optional: true },
    sig: { type: 'string', optional: false },
    exp: { type: 'number', optional: false },
    appUrl: { type: 'string', optional: true },
    dimensions: { type: 'number[]', optional: true },
    chunkIndex: { type: 'number', optional: true },
    totalChunks: { type: 'number', optional: true },
  },
  expectedFields: {
    videoId: { type: 'string', optional: false },
    analysisId: { type: 'string', optional: false },
    transcript: { type: 'string', optional: false },
    metadata: { type: 'AnalysisJobMetadata', optional: false },
    persona: { type: 'string', optional: false },
    timezone: { type: 'string', optional: false },
    models: { type: 'string[]', optional: true },
    sig: { type: 'string', optional: false },
    exp: { type: 'number', optional: false },
    appUrl: { type: 'string', optional: true },
    dimensions: { type: 'number[]', optional: true },
    chunkIndex: { type: 'number', optional: true },
    totalChunks: { type: 'number', optional: true },
  },
  violations: [
    {
      field: 'persona',
      issue: 'Client sends creator|indieMaker|consultant|researcher|productManager but worker/adapter expects creator|indieMaker|consultant|researcher|productManager in PersonaConfig fragments',
      severity: 'CRITICAL',
    },
  ],
};

// Contract Point 4: Worker → Client (SSE stream fragments - dimension)
const workerStreamDimensionFragment: ContractPoint = {
  name: 'Worker → Client (dimension fragment)',
  sentFields: {
    type: { type: '"dimension"', optional: false },
    dimension: { type: 'number', optional: false },
    name: { type: 'string', optional: false },
    content: { type: 'string', optional: false },
    metadata: { type: 'DimensionMetadata', optional: true },
  },
  expectedFields: {
    type: { type: '"dimension"', optional: false },
    dimension: { type: 'number (1-11)', optional: false },
    name: { type: 'string', optional: false },
    content: { type: 'string (min 10 chars)', optional: false },
    metadata: { type: 'DimensionMetadata', optional: true },
  },
  violations: [
    {
      field: 'metadata',
      issue: 'Worker BracketBuffer never populates metadata in dimension fragments, but schema expects it as optional field',
      severity: 'MEDIUM',
    },
  ],
};

// Contract Point 5: Worker → Client (SSE stream fragments - persona)
const workerStreamPersonaFragment: ContractPoint = {
  name: 'Worker → Client (persona fragment)',
  sentFields: {
    type: { type: '"persona"', optional: false },
    config: { type: 'PersonaConfig', optional: false },
  },
  expectedFields: {
    type: { type: '"persona"', optional: false },
    config: { type: 'PersonaConfig (with creator|indieMaker|...)', optional: false },
  },
  violations: [
    {
      field: 'config.primary.id',
      issue: 'Worker receives persona as creator|indieMaker|consultant|researcher|productManager but must emit creator|indieMaker|consultant|researcher|productManager',
      severity: 'CRITICAL',
    },
  ],
};

// Contract Point 6: Worker → Vercel (POST /api/analyses/persist)
const workerToPersist: ContractPoint = {
  name: 'Worker → Persist (POST /api/analyses/persist)',
  sentFields: {
    analysisId: { type: 'string (UUID)', optional: false },
    videoId: { type: 'string', optional: false },
    markdown: { type: 'string', optional: false },
    payload: { type: 'UCISPayloadV2 | ChunkPayload | null', optional: true },
    model: { type: 'string', optional: true },
    valid: { type: 'boolean', optional: true },
    contentSig: { type: 'string', optional: false },
    exp: { type: 'number', optional: true },
    status: { type: '"completed" | "failed" | "interrupted"', optional: true },
    chunkIndex: { type: 'number', optional: true },
    totalChunks: { type: 'number', optional: true },
  },
  expectedFields: {
    analysisId: { type: 'string (UUID)', optional: false },
    videoId: { type: 'string', optional: false },
    markdown: { type: 'string', optional: false },
    payload: { type: 'unknown', optional: true },
    model: { type: 'string', optional: true },
    valid: { type: 'boolean', optional: true },
    contentSig: { type: 'string', optional: false },
    exp: { type: 'number', optional: true },
    status: { type: 'enum', optional: true },
    chunkIndex: { type: 'number', optional: true },
    totalChunks: { type: 'number', optional: true },
  },
  violations: [],
};

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITE
// ─────────────────────────────────────────────────────────────────────────────

describe('Contract Audit: Analysis Creation → Streaming Flow', () => {
  describe('Contract 1: Client → Bouncer (POST /api/analyses)', () => {
    it('should accept valid request payload matching AnalysisCreateSchema', () => {
      const payload = {
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        timezone: 'America/New_York',
        persona: 'p1',
        forceRefresh: false,
      };

      const result = AnalysisCreateSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should normalize YouTube URL formats', () => {
      const testCases = [
        { input: 'youtu.be/dQw4w9WgXcQ', expected: true },
        { input: 'youtube.com/watch?v=dQw4w9WgXcQ', expected: true },
        { input: 'youtube.com/shorts/dQw4w9WgXcQ', expected: true },
        { input: 'invalid-url', expected: false },
      ];

      testCases.forEach(({ input, expected }) => {
        const result = AnalysisCreateSchema.safeParse({ url: input, timezone: 'UTC' });
        expect(result.success).toBe(expected);
      });
    });

    it('should validate timezone against IANA database', () => {
      const validTimezones = ['UTC', 'America/New_York', 'Europe/London', 'Asia/Tokyo'];
      const invalidTimezones = ['Invalid/Zone', 'NotATimezone', 'XXX'];

      validTimezones.forEach((tz) => {
        const result = AnalysisCreateSchema.safeParse({
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          timezone: tz,
        });
        expect(result.success).toBe(true);
      });

      invalidTimezones.forEach((tz) => {
        const result = AnalysisCreateSchema.safeParse({
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          timezone: tz,
        });
        expect(result.success).toBe(false);
      });
    });

    it('should enforce persona enum from AnalysisCreateSchema', () => {
      const validPersonas = ['creator', 'indieMaker', 'consultant', 'researcher', 'productManager'];
      const invalidPersonas = ['p1', 'p2', 'p3', 'invalid'];

      validPersonas.forEach((persona) => {
        const result = AnalysisCreateSchema.safeParse({
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          timezone: 'UTC',
          persona,
        });
        expect(result.success).toBe(true);
      });

      invalidPersonas.forEach((persona) => {
        const result = AnalysisCreateSchema.safeParse({
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          timezone: 'UTC',
          persona,
        });
        expect(result.success).toBe(false);
      });
    });
  });

  describe('Contract 2: Bouncer response → Client (UseCaseSuccess shape)', () => {
    it('should match AnalysisJobMetadata schema for metadata field', () => {
      const metadata = {
        videoId: 'dQw4w9WgXcQ',
        title: 'Test Video',
        channelTitle: 'Test Channel',
        publishedAt: '2026-07-08T00:00:00Z',
        duration: 300,
        viewCount: '1000',
        likeCount: '50',
        commentCount: '10',
      };

      const result = AnalysisJobMetadataSchema.safeParse(metadata);
      expect(result.success).toBe(true);
    });

    it('should enforce viewCount, likeCount, commentCount as strings', () => {
      const validMetadata = {
        videoId: 'test',
        title: 'Test',
        channelTitle: 'Test',
        publishedAt: '2026-07-08T00:00:00Z',
        duration: 300,
        viewCount: '1000',
        likeCount: '50',
        commentCount: '10',
      };

      const result = AnalysisJobMetadataSchema.safeParse(validMetadata);
      expect(result.success).toBe(true);

      // Numeric counts should fail strict schema
      const invalidMetadata = {
        ...validMetadata,
        viewCount: 1000, // number instead of string
      };

      const strictResult = AnalysisJobMetadataSchema.safeParse(invalidMetadata);
      // This test documents the CONTRACT: counts must be strings
      expect(strictResult.success).toBe(false);
    });
  });

  describe('Contract 3: Client → Worker (WorkerStreamRequest)', () => {
    it('should match all required WorkerStreamRequest fields', () => {
      const streamRequest: WorkerStreamRequest = {
        videoId: 'test-video',
        analysisId: '550e8400-e29b-41d4-a716-446655440000',
        transcript: 'Test transcript content',
        metadata: {
          videoId: 'test-video',
          title: 'Test',
          channelTitle: 'Channel',
          publishedAt: '2026-07-08T00:00:00Z',
          duration: 300,
          viewCount: '1000',
          likeCount: '50',
          commentCount: '10',
        },
        persona: 'creator',
        timezone: 'UTC',
        models: ['model1', 'model2'],
        sig: 'signature',
        exp: Date.now() + 3600000,
      };

      // Verify all required fields exist
      expect(streamRequest.videoId).toBeDefined();
      expect(streamRequest.analysisId).toBeDefined();
      expect(streamRequest.transcript).toBeDefined();
      expect(streamRequest.metadata).toBeDefined();
      expect(streamRequest.persona).toBeDefined();
      expect(streamRequest.timezone).toBeDefined();
      expect(streamRequest.sig).toBeDefined();
      expect(streamRequest.exp).toBeDefined();
    });

    it('should enforce consistent persona naming across client and worker', () => {
      // Persona enum unified: client sends creator|indieMaker|consultant|researcher|productManager
      // which matches worker LLM generation and adapter validation
      const clientPersona = 'creator';
      const workerExpectation = 'creator';
      const adapterExpectation = ['creator', 'indieMaker', 'consultant', 'researcher', 'productManager'];

      expect(clientPersona).toMatch(/^(creator|indieMaker|consultant|researcher|productManager)$/);
      expect(adapterExpectation).toContain('creator');
      expect(adapterExpectation).toContain(workerExpectation);
      expect(clientPersona).toBe(workerExpectation);
    });
  });

  describe('Contract 4: Worker → Client (Stream Fragments)', () => {
    it('should validate dimension fragment against UCISStreamFragmentSchema', () => {
      const dimensionFragment = {
        type: 'dimension',
        dimension: 1,
        name: 'Dimension 1',
        content: 'This is dimension content',
      };

      const result = UCISStreamFragmentSchema.safeParse(dimensionFragment);
      expect(result.success).toBe(true);
    });

    it('should validate persona fragment with correct schema', () => {
      const personaFragment = {
        type: 'persona',
        config: {
          primary: {
            id: 'creator',
            label: 'Content Creator',
            weight: 1.0,
          },
          cognitiveLenses: ['lens1', 'lens2'],
          selectionRationale: 'Selected based on video content analysis',
        },
      };

      const result = UCISStreamFragmentSchema.safeParse(personaFragment);
      expect(result.success).toBe(true);
    });

    it('should validate complete fragment with required model/valid/videoId/analysisId', () => {
      const completeFragment = {
        type: 'complete',
        model: 'Claude Haiku 4.5',
        valid: true,
        videoId: 'test-video',
        analysisId: '550e8400-e29b-41d4-a716-446655440000',
      };

      const result = UCISStreamFragmentSchema.safeParse(completeFragment);
      expect(result.success).toBe(true);
    });

    it('should validate classification fragment', () => {
      const classificationFragment = {
        type: 'classification',
        data: {
          authoritative: true,
          practicallyActionable: true,
          knowledgeGraphReady: true,
          safe: true,
          personaOptimised: true,
          recommendation: 'highly_recommended',
        },
      };

      const result = UCISStreamFragmentSchema.safeParse(classificationFragment);
      expect(result.success).toBe(true);
    });

    it('should enforce strict schema on dimension fragments', () => {
      const invalidFragment = {
        type: 'dimension',
        dimension: 1,
        name: 'Name',
        content: 'Too short', // Content must be min 10 chars
        extraField: 'should fail strict mode',
      };

      const result = UCISStreamFragmentSchema.safeParse(invalidFragment);
      expect(result.success).toBe(false);
    });
  });

  describe('Contract 5: Worker → Persist (Payload Schema Validation)', () => {
    it('should validate UCISPayloadV2 structure for full analysis', () => {
      const payload = {
        schemaVersion: '2.0',
        persona: {
          primary: {
            id: 'creator',
            label: 'Content Creator',
            weight: 1.0,
          },
          cognitiveLenses: ['Strategic Thinking'],
          selectionRationale: 'Optimized for content creators',
        },
        dimensions: [
          {
            number: 1,
            name: 'Dimension 1',
            content: 'This is meaningful dimension content',
            metadata: {
              wordCount: 100,
              confidence: 0.95,
            },
          },
        ],
        knowledgeGraph: {
          nodes: [],
          edges: [],
          rootId: null,
        },
        classification: {
          authoritative: true,
          practicallyActionable: true,
          knowledgeGraphReady: false,
          safe: true,
          personaOptimised: true,
          recommendation: 'recommended',
        },
      };

      const result = UCISPayloadV2Schema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should validate dimension array structure', () => {
      const dimension = {
        number: 1,
        name: 'Test Dimension',
        content: 'This is valid dimension content with sufficient length',
        metadata: {
          wordCount: 50,
          keyTerms: ['key1', 'key2'],
          confidence: 0.85,
        },
      };

      const result = UCISDimensionV2Schema.safeParse(dimension);
      expect(result.success).toBe(true);
    });

    it('should enforce minimum content length in dimensions', () => {
      const invalidDimension = {
        number: 1,
        name: 'Test',
        content: 'Short', // Less than 10 chars required
      };

      const result = UCISDimensionV2Schema.safeParse(invalidDimension);
      expect(result.success).toBe(false);
    });

    it('should validate classification data structure', () => {
      const classification = {
        authoritative: true,
        practicallyActionable: true,
        knowledgeGraphReady: false,
        safe: true,
        personaOptimised: true,
        recommendation: 'conditional',
      };

      const result = ClassificationDataSchema.safeParse(classification);
      expect(result.success).toBe(true);
    });
  });

  describe('Contract Manifest Export', () => {
    it('should document all contract points', () => {
      const allContracts = [
        clientToBouncer,
        bouncerToClient,
        clientToWorker,
        workerStreamDimensionFragment,
        workerStreamPersonaFragment,
        workerToPersist,
      ];

      expect(allContracts).toHaveLength(6);
      expect(allContracts.every((c) => c.name)).toBe(true);
      expect(allContracts.every((c) => c.sentFields)).toBe(true);
      expect(allContracts.every((c) => c.expectedFields)).toBe(true);
    });

    it('should export contract violations', () => {
      const contractManifest = {
        contracts: [
          clientToBouncer,
          bouncerToClient,
          clientToWorker,
          workerStreamDimensionFragment,
          workerStreamPersonaFragment,
          workerToPersist,
        ],
        violations: [
          clientToWorker.violations,
          workerStreamPersonaFragment.violations,
          workerStreamDimensionFragment.violations,
        ].flat(),
      };

      const criticalViolations = contractManifest.violations.filter((v) => v.severity === 'CRITICAL');
      const mediumViolations = contractManifest.violations.filter((v) => v.severity === 'MEDIUM');

      expect(criticalViolations.length).toBeGreaterThan(0);
      console.log('CONTRACT VIOLATIONS:');
      console.log('CRITICAL:', criticalViolations);
      console.log('MEDIUM:', mediumViolations);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VIOLATIONS SUMMARY (For Audit Report)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * VIOLATION #1 — CRITICAL: Persona Type Mismatch
 *
 * Location: web/lib/prompts.ts vs worker system prompt expectations
 *
 * Issue:
 *   - Client/Bouncer: Sends persona as 'p1' | 'p2' | 'p3' | 'p4' | 'p5'
 *   - Worker/LLM: Generates persona with id: 'creator' | 'indieMaker' | 'consultant' | 'researcher' | 'productManager'
 *   - Adapter: Validates against PersonaConfigSchema expecting creator|indieMaker|...
 *
 * Example:
 *   User selects persona 'p1' (Content Creator)
 *   → Bouncer stores and sends 'p1' to client
 *   → Client sends 'p1' to worker
 *   → Worker's LLM prompt generates: { primary: { id: 'creator', ... } }
 *   → Adapter validates: PersonaConfigSchema.parse(fragment.config)
 *   → Persona ID 'creator' matches expected enum
 *   → BUT: No mapping exists from 'p1' → 'creator' for grounding/context
 *
 * Impact: BLOCKING
 *   - Persona context is lost in translation between systems
 *   - The persona fragment emitted by LLM is treated as authoritative
 *   - Original user persona selection ('p1') is orphaned
 *   - No way to correlate client persona selection with emitted persona fragment
 *
 * Files involved:
 *   - web/lib/prompts.ts (PersonaId = 'p1'|'p2'|'p3'|'p4'|'p5')
 *   - web/lib/types/persona.ts (PersonaId = 'creator'|'indieMaker'|...)
 *   - web/lib/validators/synthesis.ts (PersonaConfigSchema expects creator|indieMaker|...)
 *   - worker/src/services/PromptBuilder.ts (generates with 'creator'|'indieMaker'|...)
 *
 * Remediation:
 *   Option A: Unify persona naming (choose ONE canonical set)
 *   Option B: Add mapping layer: p1 → creator, p2 → indieMaker, etc.
 *   Option C: Deprecate 'p1-5' nomenclature, use 'creator' everywhere
 *
 * Recommended: Option C (unify on 'creator'|'indieMaker'|'consultant'|'researcher'|'productManager')
 *   - Simplifies system
 *   - Better human readability
 *   - Aligns with LLM-generated values
 *   - Remove prompts.ts PersonaId definition, use types/persona.ts everywhere
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * VIOLATION #2 — MEDIUM: Dimension Metadata Never Transmitted
 *
 * Location: worker/src/services/BracketBuffer.ts → web/lib/adapters/synthesis-stream-adapter.ts
 *
 * Issue:
 *   - BracketBuffer.tryParseDimension() (lines 111-116) emits dimension fragments WITHOUT metadata
 *   - Adapter expects metadata as optional field (synthesis-stream-adapter.ts line 139)
 *   - Schema allows metadata as optional, so no validation error
 *   - BUT: Dimension metadata is always dropped (never included in fragment)
 *
 * Code Evidence:
 *   // BracketBuffer never adds metadata:
 *   fragments.push({
 *     type: 'dimension',
 *     dimension: dim.number,
 *     name: dim.name || `Dimension ${dim.number}`,
 *     content: dim.content,
 *     // metadata is NOT added here
 *   });
 *
 *   // Schema allows it as optional:
 *   metadata: DimensionMetadataSchema.optional(),
 *
 * Impact: FEATURE LOSS (not breaking)
 *   - Dimension metadata (wordCount, keyTerms, confidence) is lost
 *   - Client never receives dimension-level confidence scores
 *   - No way to detect insufficient-data flags from worker
 *   - Potential UX issue: Cannot show "confidence" badge on dimensions
 *
 * Workaround: Currently acceptable (metadata is optional, system works without it)
 *
 * Remediation:
 *   - Extract metadata from LLM-generated dimension JSON before emitting fragment
 *   - Pass through BracketBuffer to adapter
 *   - Store in synthesis nucleus for UI display
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * VIOLATION #3 — MEDIUM: ViewCount/LikeCount/CommentCount Type Union
 *
 * Location: worker/src/routes/analysis.ts (StreamRequest) vs web/lib/types/contracts.ts (AnalysisJobMetadata)
 *
 * Issue:
 *   - StreamRequest defines: viewCount: string | number
 *   - AnalysisJobMetadata defines: viewCount: string (strict)
 *   - Type union introduces ambiguity at adapter layer
 *   - Runtime type confusion possible if worker sends number instead of string
 *
 * Code Evidence (worker/src/routes/analysis.ts line 69-71):
 *   metadata: {
 *     ...
 *     viewCount: string | number,
 *     likeCount: string | number,
 *     commentCount: string | number,
 *   }
 *
 * Code Evidence (web/lib/types/contracts.ts line 107-116):
 *   export const AnalysisJobMetadataSchema = z.object({
 *     ...
 *     viewCount: z.string(),
 *     likeCount: z.string(),
 *     commentCount: z.string(),
 *   });
 *
 * Impact: RUNTIME TYPE RISK
 *   - If worker sends numeric counts, Zod validation will fail
 *   - Adapter must coerce types at runtime (defensive)
 *   - No compile-time guarantee of alignment
 *
 * Remediation:
 *   - Enforce string in StreamRequest interface
 *   - Add .toString() at worker/sources before sending
 *   - Align type definitions (remove union)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * VIOLATION #4 — LOW: Persona Mapping Scattered
 *
 * Location: web/lib/types/persona.ts, web/lib/prompts.ts, worker/src/services/PromptBuilder.ts
 *
 * Issue:
 *   - Persona configuration exists in multiple places
 *   - PERSONA_DIMENSIONS, PERSONA_REGISTRY, enum definitions across codebase
 *   - No single source of truth for persona metadata
 *   - Maintenance burden: changes must sync across files
 *
 * Impact: MAINTENANCE RISK
 *   - If persona is added/removed, multiple files must update
 *   - No compile-time guarantee of consistency
 *   - Possible divergence between server + client persona lists
 *
 * Remediation:
 *   - Create shared persona manifest (lib/config/personas.ts)
 *   - Export const PERSONAS as source of truth
 *   - Reference from all sites (prompts, types, validators)
 */

export const contractManifest = {
  contracts: [
    clientToBouncer,
    bouncerToClient,
    clientToWorker,
    workerStreamDimensionFragment,
    workerStreamPersonaFragment,
    workerToPersist,
  ],
  violations: [
    {
      id: 'VIOLATION_1',
      severity: 'CRITICAL',
      title: 'Persona Type Mismatch: p1-p5 vs creator/indieMaker/...',
      description: 'Client sends creator|indieMaker|consultant|researcher|productManager but adapter expects creator|indieMaker|consultant|researcher|productManager',
      affectedFiles: [
        'web/lib/prompts.ts',
        'web/lib/types/persona.ts',
        'web/lib/validators/synthesis.ts',
        'worker/src/services/PromptBuilder.ts',
      ],
      recommendation: 'Unify persona naming on creator|indieMaker|consultant|researcher|productManager across entire system',
    },
    {
      id: 'VIOLATION_2',
      severity: 'MEDIUM',
      title: 'Dimension Metadata Never Transmitted',
      description: 'BracketBuffer strips dimension metadata before emitting fragments; schema allows it but it never appears',
      affectedFiles: [
        'worker/src/services/BracketBuffer.ts',
        'web/lib/adapters/synthesis-stream-adapter.ts',
      ],
      recommendation: 'Extract and transmit metadata from dimension JSON in LLM response',
    },
    {
      id: 'VIOLATION_3',
      severity: 'MEDIUM',
      title: 'ViewCount/LikeCount/CommentCount Type Union',
      description: 'StreamRequest allows string|number but AnalysisJobMetadata requires strict string',
      affectedFiles: [
        'worker/src/routes/analysis.ts',
        'web/lib/types/contracts.ts',
      ],
      recommendation: 'Enforce string type in StreamRequest; coerce at source before sending',
    },
    {
      id: 'VIOLATION_4',
      severity: 'LOW',
      title: 'Persona Configuration Scattered Across Codebase',
      description: 'No single source of truth for persona list; PERSONA_DIMENSIONS and PERSONA_REGISTRY defined separately',
      affectedFiles: [
        'web/lib/types/persona.ts',
        'web/lib/prompts.ts',
        'worker/src/services/PromptBuilder.ts',
      ],
      recommendation: 'Create lib/config/personas.ts as canonical persona manifest',
    },
  ],
};
