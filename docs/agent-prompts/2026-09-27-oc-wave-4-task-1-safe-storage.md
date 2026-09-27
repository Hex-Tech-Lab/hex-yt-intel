# Mission: Wave 4 - Task 1: Sentry HEX-YT-INTEL-5V (`localStorage` null/SecurityError fix)

Time limit is strict; do not read unrelated files.

1. Create `web/lib/utils/safe-storage.ts`. It must implement the `StateStorage` interface for Zustand (`getItem(name: string): string | null | Promise<string | null>`, `setItem(name: string, value: string): void | Promise<void>`, `removeItem(name: string): void | Promise<void>`) plus standard synchronous helpers (`safeLocalStorage` and `safeSessionStorage`).
2. The implementation MUST use `try/catch` around the actual access of `window.localStorage` and `window.sessionStorage` to prevent Android WebView SecurityErrors (e.g. `typeof window !== 'undefined'` followed by `try { const s = window.localStorage; ... } catch { ... }`).
3. If it catches an error or `window.localStorage` is null/undefined, fall back to an in-memory `Map<string, string>`.
4. Update `web/store/useInputStore.ts`, `web/store/useChatStore.ts`, `web/lib/chat/outbox.ts`, and `web/components/templates/console/ChatDock.tsx` to import and use this safe storage instead of bare `localStorage`.

Provide the unified diffs. No explanations.
