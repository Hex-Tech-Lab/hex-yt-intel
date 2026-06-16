import { TranscriptExtractor } from './TranscriptExtractor';

async function testFallback() {
  const extractor = new TranscriptExtractor();
  
  // Mock methods by modifying the prototype
  (extractor as any).fetchWithPrimary = async () => { throw new Error('Primary fail'); };
  (extractor as any).fetchWithDecodo = async () => { throw new Error('Decodo fail'); };
  
  console.log('Testing fallback...');
  try {
    const result = await extractor.fetch('VALID_ID_11');
    console.log('Result:', result);
    if (result.transcript.includes('Transcript unavailable')) {
      console.log('Test PASSED');
    } else {
      console.error('Test FAILED');
    }
  } catch (e) {
    console.error('Test FAILED with error:', e);
  }
}

testFallback();
