# useRelations Hook

Lazily fetches the LLM-derived stance relations (tangent/contrarian) for a completed analysis. 

## Features
- **Server-Cached**: Fetches from an API that uses Redis caching.
- **Lazy Loading**: Only active when `enabled` is true.
- **Abort Support**: Uses AbortController to cancel pending requests on unmount.
