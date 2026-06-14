/**
 * Test script for Dream Sequence Webhook
 * Simulates a QStash request to the webhook endpoint
 */

async function testWebhook() {
  const payload = {
    tenantId: 'test-tenant-123',
    analysisId: 'test-analysis-456'
  };

  try {
    const response = await fetch('http://localhost:5173/api/webhooks/dream-sequence', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'upstash-signature': 'dev-bypass'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    console.log('[Test] Response:', { status: response.status, data });
  } catch (error) {
    console.error('[Test] Webhook invocation failed:', error);
  }
}

testWebhook();
