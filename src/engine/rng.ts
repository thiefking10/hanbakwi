/** 상태를 밖에 저장할 수 있는 난수 (mulberry32). 같은 상태에서 시작하면 같은 순서로 나온다. */
export function nextRandom(state: { rng: number }): number {
  state.rng = (state.rng + 0x6d2b79f5) >>> 0;
  let t = state.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** 1 이상 sides 이하의 정수 */
export function rollDie(state: { rng: number }, sides = 6): number {
  return 1 + Math.floor(nextRandom(state) * sides);
}

/** 0..count-1을 무작위 순서로 섞는다. */
export function shuffledIndices(state: { rng: number }, count: number): number[] {
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(nextRandom(state) * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}
