/**
 * Test Video Fixtures
 * Pre-analyzed YouTube videos with cached markdown content
 * Used for cache hit/miss testing and shared content scenarios
 */

export const testVideos = {
  // Short educational video (~10 min)
  shortEducational: {
    id: 'video-short-001',
    videoId: 'dQw4w9WgXcQ', // Generic example
    title: 'Introduction to React Hooks',
    description: 'Learn the fundamentals of React Hooks in 10 minutes',
    duration: 600, // 10 minutes in seconds
    channel: 'Tech Academy',
    uploadedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days ago
    transcript: `[00:00] Hello everyone, welcome to the React Hooks tutorial.
[00:05] Today we're going to learn about useState and useEffect.
[00:15] useState allows you to add state to functional components.
[00:30] The first element is the state value, the second is the setter.
[01:00] Let's look at a practical example...`,
  },

  // Long technical video (~60 min)
  longTechnical: {
    id: 'video-long-001',
    videoId: 'jL6XPnSKdq0',
    title: 'Advanced Node.js Architecture Patterns',
    description: 'Deep dive into enterprise Node.js microservices architecture',
    duration: 3600, // 60 minutes
    channel: 'Backend Masters',
    uploadedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 days ago
    transcript: `[00:00] Welcome to Advanced Node.js Architecture Patterns.
[00:30] Today we'll cover microservices, load balancing, and distributed systems.
[05:00] First, let's discuss the monolith vs microservices tradeoff...
[15:30] Next, we'll implement a service registry pattern...
[45:00] Finally, let's talk about observability and distributed tracing...`,
  },

  // Multi-language video (transcript in different language)
  multiLanguage: {
    id: 'video-multi-001',
    videoId: 'pt1Lf5pVZVE',
    title: 'Introduction aux Hooks React',
    description: 'Apprenez les fondamentaux des React Hooks',
    duration: 600,
    channel: 'École de Technologie',
    uploadedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
    transcript: `[00:00] Bonjour à tous, bienvenue au tutoriel React Hooks.
[00:10] Aujourd'hui, nous allons apprendre useState et useEffect.
[00:30] useState vous permet d'ajouter un état aux composants fonctionnels...`,
  },

  // Private/deleted video (for error testing)
  unavailableVideo: {
    id: 'video-unavailable-001',
    videoId: 'deletedVideoId123',
    title: '[DELETED] Original Video Title',
    description: 'This video is no longer available',
    duration: 0,
    channel: 'Unknown',
    uploadedAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
    transcript: '', // Empty transcript for deleted videos
  },

  // Very long transcript (> 50KB, tests timeout handling)
  longTranscript: {
    id: 'video-longtranscript-001',
    videoId: 'longVideoId999',
    title: 'Complete JavaScript Course - 12 Hours',
    description: 'Full JavaScript course from beginner to advanced',
    duration: 43200, // 12 hours
    channel: 'JS Academy',
    uploadedAt: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString(),
    transcript: generateLongTranscript(50000), // Generated to be ~50KB
  },
};

/**
 * Cached analysis content (16-section markdown format)
 * Used for cache hit testing
 */
export const cachedAnalyses = {
  shortEducational: `# YouTube Content Intelligence Analysis

**Video**: Introduction to React Hooks
**Channel**: Tech Academy
**Duration**: 10 minutes
**Analyzed**: 2024-05-01

## 1. Executive Summary
This tutorial introduces React Hooks, enabling state management in functional components through useState and useEffect hooks.

## 2. Key Concepts
- useState: Add state to functional components
- useEffect: Handle side effects in functional components
- Dependency arrays: Control effect execution timing

## 3. Target Audience
Beginner to intermediate React developers seeking to modernize function-based components.

## 4. Learning Outcomes
- Understand useState syntax and usage patterns
- Implement useEffect for side effects
- Manage component lifecycle with Hooks

## 5. Technical Deep Dive
The tutorial covers Hook Rules (only call at top level, in functional components) and demonstrates useState implementation patterns.

## 6. Practical Examples
Real-world examples show form handling, API calls, and state management using Hooks.

## 7. Common Pitfalls
Missing dependencies in useEffect, calling Hooks conditionally, and stale closures.

## 8. Performance Considerations
Proper use of useCallback and useMemo to prevent unnecessary re-renders.

## 9. Best Practices
Custom Hooks extraction, proper dependency tracking, and error boundary integration.

## 10. Industry Applications
Modern React applications exclusively use Hooks; understanding them is critical for professional development.

## 11. Comparison with Alternatives
Comparison with class components and legacy lifecycle methods.

## 12. Future Relevance
Hooks are fundamental to React 18+ concurrent features and Suspense patterns.

## 13. Code Quality Metrics
Clean, readable code with proper Hook ordering and testing strategies.

## 14. Security Considerations
Preventing XSS through proper sanitization and safe Hook dependencies.

## 15. Engagement Metrics
Clear explanations, practical examples, strong pacing for 10-minute format.

## 16. Resource Links
React documentation, interactive Hooks playground, community courses.
`,

  longTechnical: `# YouTube Content Intelligence Analysis

**Video**: Advanced Node.js Architecture Patterns
**Channel**: Backend Masters
**Duration**: 60 minutes
**Analyzed**: 2024-04-01

## 1. Executive Summary
Enterprise-scale Node.js architecture covering microservices patterns, distributed systems, and production reliability.

## 2. Key Concepts
- Microservices architecture benefits and tradeoffs
- Service discovery and load balancing
- Distributed tracing and observability
- Event-driven architectures
- CQRS and event sourcing patterns

## 3. Target Audience
Advanced Node.js developers implementing production systems at scale.

## 4. Learning Outcomes
- Design microservices architectures
- Implement service communication patterns
- Deploy and monitor distributed systems

## 5. Technical Deep Dive
In-depth coverage of: Service Registry patterns, API Gateway implementation, Event streaming with Apache Kafka, Saga pattern for distributed transactions.

## 6. Practical Examples
Complete microservices setup with Docker, Kubernetes orchestration, and production deployment scenarios.

## 7. Common Pitfalls
Distributed system complexity, eventual consistency challenges, network latency handling.

## 8. Performance Considerations
Horizontal scaling, connection pooling, caching strategies for microservices.

## 9. Best Practices
Twelve-factor app methodology, proper logging and tracing, circuit breakers and resilience patterns.

## 10. Industry Applications
Used by Netflix, Uber, Amazon Web Services for global-scale systems.

## 11. Comparison with Alternatives
Monolith vs microservices tradeoffs, serverless vs containers comparison.

## 12. Future Relevance
Critical for cloud-native development and modern DevOps practices.

## 13. Code Quality Metrics
Production-ready patterns with proper error handling and automated testing.

## 14. Security Considerations
Service-to-service authentication, distributed authorization, threat modeling.

## 15. Engagement Metrics
Comprehensive coverage, hands-on demonstrations, expert insights from industry leaders.

## 16. Resource Links
CQRS pattern documentation, Event Sourcing frameworks, microservices best practices.
`,
};

/**
 * Redis cache entries (simulate cache hit/miss)
 */
export const redisCacheEntries = {
  // Fresh cache (< 5 minutes old)
  freshAnalysis: {
    key: 'analysis:dQw4w9WgXcQ:user-free-001',
    value: cachedAnalyses.shortEducational,
    ttl: 3600, // 1 hour remaining
    createdAt: Date.now(),
    metadata: {
      cached_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
    },
  },

  // Stale cache (1-2 hours old, past TTL but still available)
  staleAnalysis: {
    key: 'analysis:jL6XPnSKdq0:user-pro-001',
    value: cachedAnalyses.longTechnical,
    ttl: -1, // Expired TTL
    createdAt: Date.now() - 90 * 60 * 1000, // 90 minutes ago
    metadata: {
      cached_at: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
      expires_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      stale: true,
    },
  },

  // Rate limit entry (successful operations)
  rateLimitEntry: {
    key: 'rate-limit:user-free-001:monthly',
    value: '2', // 2 of 3 analyses used
    ttl: 259200, // 30 days remaining
    metadata: {
      tier: 'free',
      limit: 3,
      used: 2,
      remaining: 1,
    },
  },
};

/**
 * Generate long transcript for testing timeout handling
 * Creates realistic video transcript with timestamps
 */
function generateLongTranscript(targetSize: number): string {
  const baseEntry = '[00:00] Welcome to the JavaScript course. In this comprehensive lesson, we will explore advanced patterns, best practices, and real-world examples.\n';
  const lines: string[] = [];
  let currentSize = 0;
  let timestamp = 0;

  while (currentSize < targetSize) {
    const entry = `[${String(Math.floor(timestamp / 3600)).padStart(2, '0')}:${String(Math.floor((timestamp % 3600) / 60)).padStart(2, '0')}:${String(timestamp % 60).padStart(2, '0')}] This is a detailed explanation of JavaScript concepts at timestamp ${timestamp} seconds in the video transcript. We cover advanced topics including closures, prototypes, async/await patterns, event loops, and modern ES6+ syntax features that every professional developer should understand. Let's dive deeper into each concept.\n`;

    lines.push(entry);
    currentSize += entry.length;
    timestamp += 30; // Add 30 seconds between entries
  }

  return lines.join('');
}

/**
 * Helper to get analysis record from cache
 */
export function getAnalysisFromCache(videoId: string, userId: string = 'user-free-001') {
  const cacheKey = `analysis:${videoId}:${userId}`;
  const entry = Object.values(redisCacheEntries).find(e => e.key === cacheKey);
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
