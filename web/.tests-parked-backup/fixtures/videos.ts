/**
 * Test Video Fixtures
 * Video data for pairwise testing
 */

export const testVideos = {
  shortEducational: {
    id: 'dQw4w9WgXcQ',
    title: 'Learn React Basics in 5 Minutes',
    duration: 300,
    category: 'education',
  },

  longTechnical: {
    id: 'jNQXAC9IVRw',
    title: 'Advanced TypeScript Patterns and Best Practices',
    duration: 3600,
    category: 'technical',
  },

  mediumEntertainment: {
    id: 'kxLojiokoi8',
    title: 'Building a Full Stack App in 2026',
    duration: 1800,
    category: 'entertainment',
  },

  newUnanalyzed: {
    id: 'newvideo123xyz',
    title: 'Fresh Content Not Yet Analyzed',
    duration: 600,
    category: 'education',
  },

  privateVideo: {
    id: 'privateXYZ999',
    title: 'Private Video (Access Denied)',
    duration: 1200,
    category: 'restricted',
  },

  deletedVideo: {
    id: 'deletedasdf111',
    title: 'Deleted Video (Not Found)',
    duration: 0,
    category: 'unavailable',
  },
};

/**
 * Helper to create custom video fixture
 */
export function createTestVideo(overrides: Partial<typeof testVideos.shortEducational> = {}) {
  return {
    ...testVideos.shortEducational,
    ...overrides,
  };
}
