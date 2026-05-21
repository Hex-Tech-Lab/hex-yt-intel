/**
 * Pairwise Test Harness
 * 
 * Orchestrates the execution of 38 pre-defined test cases using
 * the established fixtures, mocks, and environment configuration.
 */
import { test, expect } from '@playwright/test';
import { testUsers } from './fixtures/users';
import { testVideos } from './fixtures/videos';
import { createTestRequest } from './config';

test.describe('Phase 2: Happy Path Suite', () => {
  
  test('PW1-001: Production + Supabase + Free + Fresh Cache', async ({ request }) => {
    const user = testUsers.freeUser;
    const video = testVideos.shortEducational;
    
    // Setup: configure request with appropriate context
    const testReq = createTestRequest('PW1-001', user.id);
    
    // Execute: perform the analysis request
    const response = await request.post('/api/analyses', {
      headers: { 
        'Content-Type': 'application/json',
        ...testReq.headers 
      },
      data: { url: `https://youtube.com/watch?v=${video.id}` }
    });
    
    // Verify
    expect(response.ok()).toBeTruthy();
    const json = await response.json();
    expect(json).toHaveProperty('analysis_markdown');
  });

  test('PW1-014: CI + Supabase + Pro + Fresh Cache', async ({ request }) => {
    const user = testUsers.proUser;
    const video = testVideos.shortEducational;
    
    const testReq = createTestRequest('PW1-014', user.id);
    
    const response = await request.post('/api/analyses', {
      headers: { 
        'Content-Type': 'application/json',
        ...testReq.headers 
      },
      data: { url: `https://youtube.com/watch?v=${video.id}` }
    });
    
    expect(response.ok()).toBeTruthy();
  });
});
