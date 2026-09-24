import { describe, expect, it } from "vitest";
import { ShakeAnalyzer } from "./shake";

/** 60Hz로 센서 값을 넣는다. 흔들리는 동안에는 축을 번갈아 크게 흔든다. */
function run(analyzer: ShakeAnalyzer, seconds: number, amplitude: number, startMs = 0): number[] {
  const fires: number[] = [];
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) {
    const t = startMs + (i * 1000) / 60;
    const sign = i % 2 === 0 ? 1 : -1;
    if (analyzer.feed(sign * amplitude, 0, 9.8, t)) fires.push(t);
  }
  return fires;
}

describe("ShakeAnalyzer", () => {
  it("가만히 있거나 살짝 움직이면 반응하지 않는다", () => {
    const a = new ShakeAnalyzer();
    expect(run(a, 3, 0)).toEqual([]);
    expect(run(a, 3, 2, 4000)).toEqual([]);
  });

  it("세게 흔들면 반응한다", () => {
    const a = new ShakeAnalyzer();
    const fires = run(a, 1, 12);
    expect(fires.length).toBeGreaterThanOrEqual(1);
    expect(fires[0]).toBeLessThan(400);
  });

  it("한 번 반응한 뒤에는 잠시 기다렸다가 다시 반응한다", () => {
    const a = new ShakeAnalyzer();
    const fires = run(a, 1.2, 12);
    expect(fires).toHaveLength(1);
    const later = run(a, 1, 12, 5000);
    expect(later.length).toBeGreaterThanOrEqual(1);
  });

  it("툭 한 번 치는 정도로는 반응하지 않는다", () => {
    const a = new ShakeAnalyzer();
    a.feed(0, 0, 9.8, 0);
    expect(a.feed(20, 0, 9.8, 16)).toBe(false);
    expect(a.feed(0, 0, 9.8, 32)).toBe(false);
    expect(a.feed(0, 0, 9.8, 48)).toBe(false);
  });
});
