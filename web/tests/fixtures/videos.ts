/**
 * Test Video Fixtures
 * Pre-analyzed YouTube videos with cached markdown content
 */

export const testVideos = {
  shortEducational: {
    id: 'video-short-001',
    videoId: 'dQw4w9WgXcQ',
    title: 'Introduction to React Hooks',
    duration: 600,
    channel: 'Tech Academy',
  },

  longTechnical: {
    id: 'video-long-001',
    videoId: 'jL6XPnSKdq0',
    title: 'Advanced Node.js Architecture Patterns',
    duration: 3600,
    channel: 'Backend Masters',
  },

  multiLanguage: {
    id: 'video-multi-001',
    videoId: 'pt1Lf5pVZVE',
    title: 'Introduction aux Hooks React',
    duration: 600,
    channel: 'École de Technologie',
  },

  unavailableVideo: {
    id: 'video-unavailable-001',
    videoId: 'deletedVideoId123',
    title: '[DELETED] Original Video Title',
    duration: 0,
    channel: 'Unknown',
  },

  longTranscript: {
    id: 'video-longtranscript-001',
    videoId: 'longVideoId999',
    title: 'Complete JavaScript Course - 12 Hours',
    duration: 43200,
    channel: 'JS Academy',
  },
};

/**
 * Cached analysis content (16-section markdown format)
 */
export const cachedAnalyses = {
  shortEducational: `# YouTube Content Intelligence Analysis

**Video**: Introduction to React Hooks
**Channel**: Tech Academy
**Duration**: 10 minutes

## 1. Executive Summary
This tutorial introduces React Hooks for state management in functional components.

## 2. Key Concepts
- useState: Add state to functional components
- useEffect: Handle side effects

## 3. Target Audience
Beginner to intermediate React developers.

## 4. Learning Outcomes
- Understand useState and useEffect
- Manage component lifecycle

## 5. Technical Deep Dive
Hook rules and implementation patterns.

## 6. Practical Examples
Real-world examples with forms and API calls.

## 7. Common Pitfalls
Missing dependencies and stale closures.

## 8. Performance Considerations
useCallback and useMemo patterns.

## 9. Best Practices
Custom Hooks and proper dependency tracking.

## 10. Industry Applications
Essential for modern React development.

## 11. Comparison with Alternatives
Class components vs functional components.

## 12. Future Relevance
Fundamental to React 18+ concurrent features.

## 13. Code Quality Metrics
Clean, readable code patterns.

## 14. Security Considerations
XSS prevention and safe dependencies.

## 15. Engagement Metrics
Clear explanations and practical examples.

## 16. Resource Links
React documentation and community resources.
`,

  longTechnical: `# YouTube Content Intelligence Analysis

**Video**: Advanced Node.js Architecture Patterns
**Channel**: Backend Masters
**Duration**: 60 minutes

## 1. Executive Summary
Enterprise-scale Node.js architecture and microservices patterns.

## 2. Key Concepts
- Microservices architecture
- Service discovery and load balancing
- Distributed tracing and observability

## 3. Target Audience
Advanced Node.js developers implementing production systems.

## 4. Learning Outcomes
- Design microservices architectures
- Deploy distributed systems

## 5. Technical Deep Dive
Service Registry patterns and event streaming.

## 6. Practical Examples
Docker and Kubernetes orchestration.

## 7. Common Pitfalls
Distributed system complexity and consistency challenges.

## 8. Performance Considerations
Horizontal scaling and connection pooling.

## 9. Best Practices
Twelve-factor app methodology and circuit breakers.

## 10. Industry Applications
Used by Netflix, Uber, AWS.

## 11. Comparison with Alternatives
Monolith vs microservices tradeoffs.

## 12. Future Relevance
Critical for cloud-native development.

## 13. Code Quality Metrics
Production-ready error handling.

## 14. Security Considerations
Service-to-service authentication and authorization.

## 15. Engagement Metrics
Comprehensive coverage and expert insights.

## 16. Resource Links
CQRS and Event Sourcing documentation.
`,
};

/**
 * Redis cache entries (simulate cache hit/miss)
 */
export const redisCacheEntries = {
  freshAnalysis: {
    key: 'analysis:dQw4w9WgXcQ:user-free-001',
    value: cachedAnalyses.shortEducational,
    ttl: 3600,
    createdAt: Date.now(),
  },

  staleAnalysis: {
    key: 'analysis:jL6XPnSKdq0:user-pro-001',
    value: cachedAnalyses.longTechnical,
    ttl: -1,
    createdAt: Date.now() - 90 * 60 * 1000,
  },

  rateLimitEntry: {
    key: 'rate-limit:user-free-001:monthly',
    value: '2',
    ttl: 259200,
    metadata: {
      tier: 'free',
      limit: 3,
      used: 2,
      remaining: 1,
    },
  },
};

/**
 * Helper to get analysis record from cache
 */
export function getAnalysisFromCache(videoId: string, userId: string = 'user-free-001') {
  const cacheKey = `analysis:${videoId}:${userId}`;
  const entry = Object.values(redisCacheEntries).find((e) => e.key === cacheKey);
  return entry || null;
}

/**
 * Helper to create custom video fixture
 */
export function createTestVideo(overrides: Partial<typeof testVideos.shortEducational> = {}) {
  return {
    ...testVideos.shortEducational,
    ...overrides,
  };
}
