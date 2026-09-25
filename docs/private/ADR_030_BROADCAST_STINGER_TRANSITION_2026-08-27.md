# ADR 030: Broadcast Stinger Transition & Player Latency Concealment

### Status
Accepted

### Context
Automated playback progression between non-contiguous highlight segments causes harsh, abrupt audio/visual jump cuts. Additionally, seeking the YouTube iframe player across distant timestamps introduces visible iframe buffering spinners and layout repaint flashes.

### Decision
Implement a 1.2-second branded client-side broadcast transition overlay (`HighlightsTransitionOverlay`):
1. **Timing & Easing**: $0.35\text{s}$ fade-to-dark $\to 0.50\text{s}$ seek hold $\to 0.35\text{s}$ fade-from-dark using cubic-bezier easing `[0.4, 0.0, 0.2, 1]`.
2. **Sensory & WCAG 2.2 Compliance**: Strictly avoid white strobing or high-contrast flashes per WCAG 2.2 SC 2.3.1 (Three Flashes or Below Threshold). Restrict palette to deep slate obsidian (`#090D16`) with an emerald ambient glow (`#10B981`) and soft low-pass audio swell (`200Hz - 800Hz`).
3. **Latency Concealment**: Player mutes and initiates `seekTo(nextSegment.start)` at $t = \text{segment.end} - 0.35\text{s}$ while the overlay covers the iframe.
4. **Export Readiness**: Component contract designed to provide identical timing metadata for server-side MP4 rendering (Remotion/FFmpeg) with embedded dynamic QR code attribution.

### Consequences
- **Positive**: Eliminates jump-cut disorientation and completely masks iframe seek latency.
- **Positive**: Establishes unified VINTEL branding across web playback and future social exports.
- **Negative**: Adds a lightweight Framer Motion state listener to the playback loop.

## Addendum (2026-09-26): Swoosh Stinger & Visual Sync
The transition sound has been replaced with an industry-standard "swoosh/whoosh" (Arabic broadcast style). The visual wipe is now a directional slide/whip-pan timed to the swoosh. The swoosh volume dynamically tracks the player volume (via YouTube `getVolume()`/mute state).
