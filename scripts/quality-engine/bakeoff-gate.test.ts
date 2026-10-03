import { describe, expect, it } from 'vitest';
import { evaluateGate, GATE_JOINT_MIN, type VideoArmScores } from '../bakeoff-gate';

const vids = Array.from({ length: 14 }, (_, i) => `v${i}`);
const mk = (factual: number, style: number): VideoArmScores => ({ videoId: 'x', factual, style });

function fixture(haikuF: number, haikuS: number, armF: number, armS: number) {
  const haiku = vids.map(v => ({ videoId: v, factual: haikuF, style: haikuS }));
  const arm = vids.map(v => ({ videoId: v, factual: armF, style: armS }));
  return { arm, haiku };
}

describe('evaluateGate (ADR 038 §4b)', () => {
  it('PASS fixture: all videos jointly >=90/85, medians met, worst-case met, no regression', () => {
    const r = evaluateGate(fixture(95, 90, 93, 88));
    expect(r.pass).toBe(true);
    expect(r.failures).toEqual([]);
    expect(r.jointPassCount).toBe(14);
  });

  it('fails when fewer than 12/14 videos jointly pass', () => {
    // 11 videos pass, 3 sit just under the joint bar
    const { haiku, arm } = fixture(95, 90, 93, 88);
    for (let i = 0; i < 3; i++) arm[i] = { videoId: arm[i]!.videoId, factual: 89.9, style: 88 };
    const r = evaluateGate({ arm, haiku });
    expect(r.pass).toBe(false);
    expect(r.jointPassCount).toBe(11);
    expect(r.failures.some(f => f.includes(`joint pass 11/14 < ${GATE_JOINT_MIN}/14`))).toBe(true);
  });

  it('fails when the arm median factual < 90', () => {
    const r = evaluateGate(fixture(95, 90, 88, 88));
    expect(r.pass).toBe(false);
    expect(r.failures.some(f => f.includes('median factual'))).toBe(true);
  });

  it('fails when the arm median style < 85', () => {
    const r = evaluateGate(fixture(95, 90, 93, 82));
    expect(r.pass).toBe(false);
    expect(r.failures.some(f => f.includes('median style'))).toBe(true);
  });

  it('fails on a single worst-case video below 80 factual (others above)', () => {
    const { haiku, arm } = fixture(95, 90, 93, 88);
    arm[0] = { videoId: 'v0', factual: 78, style: 88 };
    const r = evaluateGate({ arm, haiku });
    expect(r.pass).toBe(false);
    expect(r.failures.some(f => f.includes('worst-case factual 78'))).toBe(true);
  });

  it('fails on a single worst-case video below 75 style', () => {
    const { haiku, arm } = fixture(95, 90, 93, 88);
    arm[0] = { videoId: 'v0', factual: 93, style: 70 };
    const r = evaluateGate({ arm, haiku });
    expect(r.pass).toBe(false);
    expect(r.failures.some(f => f.includes('worst-case style 70'))).toBe(true);
  });

  it('fails on a per-video regression > 10 vs haiku (factual)', () => {
    const { haiku, arm } = fixture(95, 90, 93, 88);
    arm[5] = { videoId: 'v5', factual: 83, style: 88 }; // haiku 95 − 83 = 12
    const r = evaluateGate({ arm, haiku });
    expect(r.pass).toBe(false);
    expect(r.failures.some(f => f.includes('factual regression vs haiku 12'))).toBe(true);
  });

  it('fails on a per-video regression > 10 vs haiku (style)', () => {
    const { haiku, arm } = fixture(95, 90, 93, 88);
    arm[5] = { videoId: 'v5', factual: 93, style: 78 }; // haiku 90 − 78 = 12
    const r = evaluateGate({ arm, haiku });
    expect(r.pass).toBe(false);
    expect(r.failures.some(f => f.includes('style regression vs haiku 12'))).toBe(true);
  });

  it('exactly-10 regression passes the bar', () => {
    const { haiku, arm } = fixture(95, 90, 93, 88);
    arm[5] = { videoId: 'v5', factual: 85, style: 88 }; // 10, not > 10
    arm[6] = { videoId: 'v6', factual: 93, style: 80 }; // 10, not > 10
    const r = evaluateGate({ arm, haiku });
    expect(r.failures.some(f => f.includes('regression'))).toBe(false);
  });

  it('missing arm/haiku rows count as failures (no silent pass)', () => {
    const haiku = vids.map(v => ({ videoId: v, factual: 95, style: 90 }));
    const arm = vids.slice(0, 13).map(v => ({ videoId: v, factual: 93, style: 88 }));
    const r = evaluateGate({ arm, haiku });
    expect(r.pass).toBe(false);
    expect(r.failures.length).toBeGreaterThan(0);
  });

  it('edge values work as inline fixtures', () => {
    expect(mk(90, 85)).toEqual({ videoId: 'x', factual: 90, style: 85 });
  });
});
