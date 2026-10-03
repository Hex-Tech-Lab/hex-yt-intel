/**
 * TranscriptTimeMarkers (worker) — thin re-export of the shared, isomorphic
 * time-marker annotation in web/lib (R3b Phase 2.6 time-sync), same pattern
 * as TranscriptSlice.ts.
 */

export {
  annotateWithTimeMarkers,
  formatClock,
  hasEstimatedTimes,
  timeAnnotatedReasons,
} from '../../../web/lib/jev/transcript-time-markers';
