import { describe, expect, it } from "vitest";
import { createGame, dispatch, isLegal, legalActions } from "../engine/game";
import type { GameState, PlayerSetup } from "../engine/types";
import { chooseAction, type AiStyle } from "./ai";

const AIS: PlayerSetup[] = [
  { name: "가", kind: "ai" },
  { name: "나", kind: "ai" },
  { name: "다", kind: "ai" },
  { name: "라", kind: "ai" },
];
const STYLES: AiStyle[] = ["bold", "careful", "bold", "careful"];

function play(seed: number, count: number, maxSteps: number): { state: GameState; steps: number } {
  let state = createGame(AIS.slice(0, count), seed, { maxRounds: 40 });
  let steps = 0;
  while (state.phase !== "over" && steps < maxSteps) {
    const action = chooseAction(state, STYLES[state.current]);
    expect(isLegal(state, action)).toBe(true);
    const next = dispatch(state, action);
    expect(next).not.toBe(state);
    state = next;
    steps++;
  }
  return { state, steps };
}

describe("AI", () => {
  it("항상 지금 할 수 있는 행동만 고른다", () => {
    const state = createGame(AIS.slice(0, 3), 5);
    const legal = legalActions(state);
    expect(legal.some((a) => a.type === chooseAction(state).type)).toBe(true);
  });

  it("AI끼리 두면 40바퀴 안에 모든 판이 승자가 나온다", () => {
    let finished = 0;
    const total = 30;
    for (let seed = 1; seed <= total; seed++) {
      const { state } = play(seed, 3 + (seed % 2), 20000);
      if (state.phase === "over") {
        finished++;
        expect(state.winner).not.toBeNull();
      }
    }
    expect(finished).toBe(total);
  }, 120000);

  it("10바퀴 제한으로 시작하면 10바퀴가 끝나기 전에 승자가 정해진다", () => {
    for (let seed = 1; seed <= 6; seed++) {
      let state = createGame(AIS.slice(0, 2 + (seed % 3)), seed, { maxRounds: 10 });
      let steps = 0;
      while (state.phase !== "over" && steps < 5000) {
        state = dispatch(state, chooseAction(state, STYLES[state.current]));
        steps++;
      }
      expect(state.phase).toBe("over");
      expect(state.winner).not.toBeNull();
      expect(state.round).toBeLessThanOrEqual(11);
    }
  });

  it("땅을 사고 건물을 짓는다 (아무것도 안 하는 AI가 아니다)", () => {
    let bought = 0;
    let built = 0;
    for (let seed = 1; seed <= 5; seed++) {
      let state = createGame(AIS.slice(0, 3), seed);
      for (let step = 0; step < 600 && state.phase !== "over"; step++) {
        state = dispatch(state, chooseAction(state, STYLES[state.current]));
        for (const e of state.events) {
          if (e.type === "buy") bought++;
          if (e.type === "build") built++;
        }
      }
    }
    expect(bought).toBeGreaterThan(10);
    expect(built).toBeGreaterThan(0);
  });
});
