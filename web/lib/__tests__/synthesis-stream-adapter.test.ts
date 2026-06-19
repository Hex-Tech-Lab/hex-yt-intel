import { describe, it, expect, beforeEach } from 'vitest';
import { SynthesisStreamAdapter } from '../adapters/synthesis-stream-adapter';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import { useAnalysisStore } from '@/store/useAnalysisStore';

describe('SynthesisStreamAdapter', () => {
  let adapter: SynthesisStreamAdapter;

  beforeEach(() => {
    // Reset stores before each test
    useSynthesisNucleus.getState().reset();
    useAnalysisStore.getState().clearTerminal();
    
    // Set userRole as admin to bypass sanitizeLogMessage sanitization in tests
    useAnalysisStore.setState({ userRole: 'admin' });
    
    useAnalysisStore.setState({
      analysis: {
        id: 'test-analysis-id',
        title: 'Test Title',
        analysis_markdown: '',
        created_at: new Date().toISOString(),
        video_id: 'test-video-id',
        user_id: 'mock-user-id',
        status: 'idle',
        dimensions: {},
      },
    });

    useSynthesisNucleus.getState().initializeAnalysis({
      id: 'test-analysis-id',
      videoId: 'test-video-id',
      title: 'Test Title',
    });

    adapter = new SynthesisStreamAdapter();
  });

  describe('healJson', () => {
    it('should heal open braces', () => {
      const broken = '{"schemaVersion": "2.0", "dimensions": [';
      const healed = adapter.healJson(broken);
      expect(healed).not.toBeNull();
      const parsed = JSON.parse(healed!);
      expect(parsed.schemaVersion).toBe('2.0');
      expect(parsed.dimensions).toBeInstanceOf(Array);
    });

    it('should heal unclosed strings', () => {
      const broken = '{"schemaVersion": "2.0", "title": "My Broken Ti';
      const healed = adapter.healJson(broken);
      expect(healed).not.toBeNull();
      const parsed = JSON.parse(healed!);
      expect(parsed.title).toContain('My Broken Ti');
    });

    it('should return null for completely invalid JSON', () => {
      const broken = 'random plaintext';
      const healed = adapter.healJson(broken);
      expect(healed).toBeNull();
    });
  });

  describe('processLine - Fragment Routing', () => {
    it('should process status starting stage', () => {
      const statusLine = JSON.stringify({
        type: 'status',
        stage: 'starting',
        videoId: 'LOrjVQnA4EY',
      });
      adapter.processLine(statusLine);

      const terminalLines = useAnalysisStore.getState().terminalLines;
      expect(terminalLines.some(l => l.message.includes('Edge pipeline start'))).toBe(true);
    });

    it('should process status model stage', () => {
      const statusLine = JSON.stringify({
        type: 'status',
        stage: 'model',
        model: 'Claude Haiku 4.5',
      });
      adapter.processLine(statusLine);

      const terminalLines = useAnalysisStore.getState().terminalLines;
      expect(terminalLines.some(l => l.message.includes('Running model cascade node'))).toBe(true);
    });

    it('should process delta plaintext fragments', () => {
      const deltaLine = JSON.stringify({
        type: 'delta',
        content: 'Hello World',
      });
      adapter.processLine(deltaLine);

      const markdown = useAnalysisStore.getState().analysis?.analysis_markdown;
      expect(markdown).toBe('Hello World');
    });

    it('should process progressive JSON structured stream fragments', () => {
      const delta1 = JSON.stringify({
        type: 'delta',
        content: '{"schemaVersion":"2.0",',
      });
      const delta2 = JSON.stringify({
        type: 'delta',
        content: '"persona":{"primary":{"id":"creator","label":"Creator","weight":0.5},"cognitiveLenses":[],"selectionRationale":""}}',
      });

      adapter.processLine(delta1);
      adapter.processLine(delta2);

      const personaConfig = useSynthesisNucleus.getState().personaConfig;
      expect(personaConfig).not.toBeNull();
      expect(personaConfig?.primary.id).toBe('creator');
    });

    it('should process dimension fragments', () => {
      const dimensionLine = JSON.stringify({
        type: 'dimension',
        dimension: 1,
        name: 'Apex Intelligence',
        content: 'Synthesized dimension details.',
      });
      adapter.processLine(dimensionLine);

      const dimensions = useSynthesisNucleus.getState().analysis?.dimensions;
      expect(dimensions).toBeDefined();
      expect(dimensions?.[1]?.name).toBe('Apex Intelligence');
    });

    it('should process kg structured fragments', () => {
      const kgLine = JSON.stringify({
        type: 'kg',
        nodes: [{
          id: 'N001',
          dimension: 1,
          label: 'Hex-Tech',
          content: 'This is a long content for entity validation.',
          weight: 0.8,
          polarity: 0.5,
          keyTerms: ['hex', 'tech'],
          entityType: 'organization',
        }],
        edges: [],
        rootId: 'N001',
      });
      adapter.processLine(kgLine);

      const kg = useSynthesisNucleus.getState().knowledgeGraph;
      expect(kg).not.toBeNull();
      expect(kg?.nodes[0]?.label).toBe('Hex-Tech');
    });

    it('should handle complete/done status', () => {
      let completeTriggered = false;
      adapter = new SynthesisStreamAdapter({
        onComplete: () => {
          completeTriggered = true;
        },
      });

      const completeLine = JSON.stringify({
        type: 'complete',
        model: 'Claude Haiku 4.5',
        valid: true,
        videoId: 'LOrjVQnA4EY',
        analysisId: 'test-id',
      });
      adapter.processLine(completeLine);

      expect(completeTriggered).toBe(true);
    });

    it('should handle stream error status', () => {
      let errorTriggered = false;
      let errorMessage = '';
      adapter = new SynthesisStreamAdapter({
        onError: (err) => {
          errorTriggered = true;
          errorMessage = err;
        },
      });

      const errorLine = JSON.stringify({
        type: 'error',
        error: 'Cascade timeout exceeded',
      });
      adapter.processLine(errorLine);

      expect(errorTriggered).toBe(true);
      expect(errorMessage).toBe('Cascade timeout exceeded');
    });
  });
});
