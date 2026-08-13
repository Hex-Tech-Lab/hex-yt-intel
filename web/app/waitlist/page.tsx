'use client';

import * as Sentry from '@sentry/nextjs';
import { useState, useCallback } from 'react';
import type { FormEvent } from 'react';

type Status = 'idle' | 'loading' | 'done' | 'error';

/**
 * Shared across both form mounts (hero + footer CTA) so a signup in one
 * reflects in the other instead of leaving a stale "empty form" below
 * (Ultrareview finding: independent per-mount state).
 */
function useWaitlistSignup() {
  const [status, setStatus] = useState<Status>('idle');

  const submit = useCallback(async (rawEmail: string, honeypot: string) => {
    const email = rawEmail.trim();
    setStatus('loading');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, hp: honeypot }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`waitlist insert failed: ${res.status}`);
      setStatus('done');
    } catch (err) {
      // A client-side abort/timeout isn't a server error worth Sentry noise
      // -- the route already captures real insert failures on its side
      // (Ultrareview finding: AbortError was polluting the error stream).
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        Sentry.captureException(err, { contexts: { waitlist: { layer: 'signup_submit' } } });
      }
      setStatus('error');
    } finally {
      clearTimeout(timeout);
    }
  }, []);

  return { status, submit };
}

function WaitlistForm({ status, submit }: { status: Status; submit: (email: string, honeypot: string) => void }) {
  function handleSubmit(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    const form = submitEvent.currentTarget;
    const email = (form.elements.namedItem('email') as HTMLInputElement).value;
    const honeypot = (form.elements.namedItem('company') as HTMLInputElement).value;
    submit(email, honeypot);
  }

  return (
    <form className="waitlist" onSubmit={handleSubmit}>
      <input
        type="text"
        name="company"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }}
      />
      <input
        type="email"
        name="email"
        placeholder="you@channel.com"
        required
        maxLength={320}
        autoComplete="email"
        aria-label="Email address"
      />
      <button type="submit" className="primary" disabled={status === 'loading' || status === 'done'}>
        {status === 'done' ? 'On the list.' : status === 'loading' ? 'Joining...' : 'Get early access'}
      </button>
      <p role="status" aria-live="polite" style={{ margin: 0, width: '100%', fontSize: 13 }}>
        {status === 'error' && <span style={{ color: '#E24B1B' }}>Something went wrong — try again in a moment.</span>}
      </p>
    </form>
  );
}

export default function WaitlistPage() {
  const { status, submit } = useWaitlistSignup();

  return (
    <>
      <style>{`
        .vintel-waitlist {
          --bg: #EDEEEA; --bg-raised: #E3E4DE; --ink: #15171A; --ink-muted: #5B5F5A;
          --line: #C9CBC2; --accent: #E24B1B; --accent-ink: #FFFFFF; --track: #D5D6CE;
          --mono: ui-monospace, "SF Mono", "Cascadia Mono", "Roboto Mono", Menlo, Consolas, monospace;
          --sans: -apple-system, "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif;
        }
        @media (prefers-color-scheme: dark) {
          .vintel-waitlist:not([data-theme="light"]) {
            --bg: #0B0C0E; --bg-raised: #151719; --ink: #EDEEEA; --ink-muted: #90948E;
            --line: #2A2D2E; --accent: #FF5C26; --accent-ink: #0B0C0E; --track: #1E2022;
          }
        }
        .vintel-waitlist[data-theme="dark"] {
          --bg: #0B0C0E; --bg-raised: #151719; --ink: #EDEEEA; --ink-muted: #90948E;
          --line: #2A2D2E; --accent: #FF5C26; --accent-ink: #0B0C0E; --track: #1E2022;
        }
        .vintel-waitlist * { box-sizing: border-box; }
        .vintel-waitlist {
          margin: 0; background: var(--bg); color: var(--ink); font-family: var(--sans);
          line-height: 1.5; -webkit-font-smoothing: antialiased;
        }
        .vintel-waitlist ::selection { background: var(--accent); color: var(--accent-ink); }
        .wrap { max-width: 1040px; margin: 0 auto; padding: 0 24px; }
        header.top { display: flex; align-items: center; justify-content: space-between; padding: 28px 0 0; }
        .wordmark { font-family: var(--mono); font-size: 15px; font-weight: 600; letter-spacing: -0.02em; }
        .wordmark span { color: var(--accent); }
        nav.top-nav { font-family: var(--mono); font-size: 12.5px; color: var(--ink-muted); letter-spacing: 0.02em; }
        .hero { padding: 88px 0 40px; }
        .eyebrow { font-family: var(--mono); font-size: 12.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); margin: 0 0 20px; }
        h1 { font-family: var(--mono); font-size: clamp(40px, 7vw, 76px); font-weight: 700; letter-spacing: -0.03em; line-height: 0.98; margin: 0 0 24px; text-wrap: balance; }
        h1 .strike { text-decoration: line-through; text-decoration-color: var(--ink-muted); text-decoration-thickness: 3px; color: var(--ink-muted); }
        .sub { font-size: clamp(17px, 2vw, 20px); color: var(--ink-muted); max-width: 560px; margin: 0 0 40px; }
        .sub strong { color: var(--ink); font-weight: 600; }
        .scrubber { border: 1px solid var(--line); border-radius: 4px; padding: 20px 20px 16px; background: var(--bg-raised); margin-bottom: 64px; }
        .scrubber-label { display: flex; justify-content: space-between; font-family: var(--mono); font-size: 11.5px; color: var(--ink-muted); margin-bottom: 10px; font-variant-numeric: tabular-nums; }
        .track { position: relative; height: 40px; background: var(--track); border-radius: 2px; overflow: hidden; }
        .track .filler { position: absolute; inset: 0; background: repeating-linear-gradient(90deg, var(--line) 0 1px, transparent 1px 46px); opacity: 0.6; }
        .keyframe { position: absolute; top: 6px; bottom: 6px; width: 30px; background: var(--accent); border-radius: 2px; }
        .kf1 { left: 4%; } .kf2 { left: 19%; } .kf3 { left: 38%; } .kf4 { left: 57%; } .kf5 { left: 74%; } .kf6 { left: 90%; }
        .playhead { position: absolute; top: -4px; bottom: -4px; width: 2px; background: var(--ink); left: 74%; }
        .playhead::before { content: ""; position: absolute; top: -6px; left: -4px; width: 10px; height: 6px; background: var(--ink); clip-path: polygon(0 0, 100% 0, 50% 100%); }
        .scrubber-footer { display: flex; justify-content: space-between; align-items: baseline; margin-top: 14px; font-family: var(--mono); font-size: 12px; color: var(--ink-muted); }
        .scrubber-footer .result { color: var(--accent); font-weight: 700; font-size: 13px; }
        .cta-row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin-bottom: 8px; }
        .waitlist { display: flex; gap: 10px; flex-wrap: wrap; }
        input[type="email"] { font-family: var(--sans); font-size: 15px; padding: 13px 16px; border: 1px solid var(--line); border-radius: 3px; background: var(--bg); color: var(--ink); min-width: 260px; }
        input[type="email"]:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
        button.primary { font-family: var(--mono); font-size: 14px; font-weight: 700; letter-spacing: 0.01em; padding: 13px 22px; border: none; border-radius: 3px; background: var(--accent); color: var(--accent-ink); cursor: pointer; }
        button.primary:hover { filter: brightness(1.08); }
        button.primary:disabled { opacity: 0.7; cursor: default; }
        button.primary:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
        .fine { font-size: 12.5px; color: var(--ink-muted); margin: 10px 0 0; }
        section.block { padding: 72px 0; border-top: 1px solid var(--line); }
        .kicker { font-family: var(--mono); font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-muted); margin: 0 0 16px; }
        h2 { font-size: clamp(26px, 3.4vw, 36px); font-weight: 700; letter-spacing: -0.015em; margin: 0 0 20px; max-width: 640px; text-wrap: balance; }
        p.lead { font-size: 17px; color: var(--ink-muted); max-width: 580px; margin: 0 0 8px; }
        .compare { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 40px; }
        @media (max-width: 640px) { .compare { grid-template-columns: 1fr; } }
        .compare-card { border: 1px solid var(--line); border-radius: 4px; padding: 22px; }
        .compare-card.bad { opacity: 0.7; }
        .compare-card.good { border-color: var(--accent); }
        .compare-card .tag { font-family: var(--mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-muted); margin-bottom: 12px; }
        .compare-card.good .tag { color: var(--accent); }
        .compare-card h3 { font-size: 18px; margin: 0 0 10px; }
        .compare-card p { font-size: 14.5px; color: var(--ink-muted); margin: 0; }
        .text-lines { display: flex; flex-direction: column; gap: 6px; margin: 14px 0; }
        .text-lines .ln { height: 8px; background: var(--track); border-radius: 2px; }
        .text-lines .ln:nth-child(1) { width: 92%; } .text-lines .ln:nth-child(2) { width: 100%; } .text-lines .ln:nth-child(3) { width: 68%; }
        .frame-strip { display: flex; gap: 5px; margin: 14px 0; }
        .frame-strip .f { flex: 1; aspect-ratio: 16/10; background: var(--accent); border-radius: 2px; opacity: 0.85; }
        .frame-strip .f:nth-child(3) { opacity: 1; outline: 2px solid var(--ink); outline-offset: 1px; }
        .chatline { display: flex; gap: 10px; align-items: flex-start; padding: 16px 18px; background: var(--bg-raised); border: 1px solid var(--line); border-radius: 4px; margin-top: 36px; max-width: 560px; }
        .chatline p { margin: 0; font-size: 15px; }
        .chip { display: inline-flex; align-items: center; font-family: var(--mono); font-size: 12px; color: var(--accent); border: 1px solid var(--accent); border-radius: 20px; padding: 1px 8px; margin-left: 6px; white-space: nowrap; }
        ul.features { list-style: none; margin: 40px 0 0; padding: 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px; }
        @media (max-width: 720px) { ul.features { grid-template-columns: 1fr; } }
        ul.features li { border-top: 1px solid var(--line); padding-top: 16px; }
        ul.features .num { font-family: var(--mono); font-size: 12px; color: var(--accent); display: block; margin-bottom: 10px; }
        ul.features h4 { font-size: 15.5px; margin: 0 0 8px; }
        ul.features p { font-size: 14px; color: var(--ink-muted); margin: 0; }
        footer.vintel-footer { padding: 48px 0 60px; border-top: 1px solid var(--line); font-family: var(--mono); font-size: 12px; color: var(--ink-muted); display: flex; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
      `}</style>

      <div className="vintel-waitlist">
        <header className="top">
          <div className="wrap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
            <div className="wordmark">v<span>·</span>intel</div>
            <nav className="top-nav">EARLY ACCESS — CONTENT CREATORS</nav>
          </div>
        </header>

        <main className="wrap">
          <section className="hero">
            <p className="eyebrow">{'// visual research for creators'}</p>
            <h1>Watch <span className="strike">60&nbsp;min</span> in 4.</h1>
            <p className="sub">
              <strong>v-intel</strong> compresses competitor research videos into a visual pass you can actually see —
              hooks, cuts, on-screen text, the exact frame a claim was made in. Not a text summary. The video, fast.
            </p>

            <div className="scrubber" role="img" aria-label="Timeline showing a 60 minute video compressed to keyframes covering the final 4 minutes of viewing time">
              <div className="scrubber-label">
                <span>00:00</span>
                <span>SOURCE VIDEO — 60:00</span>
                <span>60:00</span>
              </div>
              <div className="track">
                <div className="filler" />
                <div className="keyframe kf1" /><div className="keyframe kf2" /><div className="keyframe kf3" />
                <div className="keyframe kf4" /><div className="keyframe kf5" /><div className="keyframe kf6" />
                <div className="playhead" />
              </div>
              <div className="scrubber-footer">
                <span>6 keypoints jumped, not skimmed</span>
                <span className="result">04:12 elapsed</span>
              </div>
            </div>

            <div className="cta-row">
              <WaitlistForm status={status} submit={submit} />
            </div>
            <p className="fine">First 200 creators get founder pricing. No spam — one email when we open.</p>
          </section>

          <section className="block">
            <p className="kicker">The problem</p>
            <h2>Every summarizer converts your source video into text. That&apos;s exactly the wrong transformation.</h2>
            <p className="lead">
              When you&apos;re researching a competitor&apos;s video, you need the hook edit, the cut rhythm, the thumbnail-worthy
              frame — not a bulleted recap that throws all of it away.
            </p>

            <div className="compare">
              <div className="compare-card bad">
                <p className="tag">Text summarizer</p>
                <h3>Reads like notes</h3>
                <div className="text-lines"><div className="ln" /><div className="ln" /><div className="ln" /></div>
                <p>Words only. The edit, the framing, the b-roll — gone.</p>
              </div>
              <div className="compare-card good">
                <p className="tag">v-intel</p>
                <h3>Looks like the video</h3>
                <div className="frame-strip"><div className="f" /><div className="f" /><div className="f" /><div className="f" /></div>
                <p>The actual cuts, in order, compressed — you see what they did, not what an AI thinks they said.</p>
              </div>
            </div>
          </section>

          <section className="block">
            <p className="kicker">Claim → frame verification</p>
            <h2>Never say something on camera you didn&apos;t actually see said.</h2>
            <p className="lead">Every claim is one click from the exact moment it came from. Twelve seconds, not a six-minute re-scrub.</p>

            <div className="chatline">
              <p>They mention pricing changes at <span className="chip">▶ 14:32</span> — worth checking before you script that angle.</p>
            </div>
          </section>

          <section className="block">
            <p className="kicker">What ships first</p>
            <h2>Built for the research block, not a demo reel.</h2>
            <ul className="features">
              <li><span className="num">01</span><h4>Visual auto-scrubber</h4><p>Keypoint-to-keypoint on the real footage. 60 minutes, a few minutes to watch.</p></li>
              <li><span className="num">02</span><h4>Grounded chat</h4><p>Ask it anything about the video — every answer cites the exact timestamp it came from.</p></li>
              <li><span className="num">03</span><h4>Research library</h4><p>Every video you&apos;ve analyzed, searchable, so last month&apos;s research pays off again today.</p></li>
            </ul>
          </section>

          <section className="block" style={{ borderBottom: '1px solid var(--line)' }}>
            <p className="kicker">Join the waitlist</p>
            <h2>Your next competitor breakdown, in one sitting.</h2>
            <WaitlistForm status={status} submit={submit} />
          </section>
        </main>

        <footer className="vintel-footer wrap">
          <span>v-intel</span>
          <span>See both. Verify in seconds.</span>
        </footer>
      </div>
    </>
  );
}
