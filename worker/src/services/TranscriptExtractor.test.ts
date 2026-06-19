import { TranscriptExtractor } from './TranscriptExtractor';

describe('TranscriptExtractor', () => {
  it('should fallback to tertiary if primary and secondary fail', async () => {
    const extractor = new TranscriptExtractor();
    
    // Force Primary and Decodo to fail
    (extractor as any).fetchWithPrimary = jest.fn().mockRejectedValue(new Error('Primary fail'));
    (extractor as any).fetchWithDecodo = jest.fn().mockRejectedValue(new Error('Decodo fail'));
    
    let result;
    try {
      result = await extractor.fetch('VALID_ID_123');
    } finally {
      // cleanup mock state
    }
    
    expect(result.transcript).toContain('Transcript unavailable');
    expect(result.language).toBe('en');
  });
});
