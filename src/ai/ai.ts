import { BOARD, RULES, TILE_COUNT, groupMembers, rentFor, tileValue } from "../engine/board";
import { legalActions } from "../engine/game";
import type { Action, GameState } from "../engine/types";

/** bold는 돈이 좀 빠듯해도 과감하게 사고 짓고, careful은 돈을 넉넉히 남겨 둔다. */
export type AiStyle = "bold" | "careful";

/** 사거나 지은 뒤에도 최소한 남겨 두려는 돈 */
const RESERVE: Record<AiStyle, number> = { bold: 60, careful: 300 };

/** 이 땅을 사면 한 묶음이 완성되거나, 남은 상대가 못 가지게 막을 수 있는지 점수를 준다. */
function tileScore(state: GameState, playerId: number, index: number): number {
  const def = BOARD[index];
  let score = 0;
  if (def.type === "transport") {
    const owned = BOARD.filter((t, i) => t.type === "transport" && state.tiles[i].owner === playerId).length;
    return 2 + owned * 2;
  }
  if (def.type !== "city" || def.group === undefined) return 0;
  const members = groupMembers(def.group);
  const mine = members.filter((i) => state.tiles[i].owner === playerId).length;
  const others = members.filter((i) => state.tiles[i].owner !== null && state.tiles[i].owner !== playerId).length;
  score += mine * 3;
  if (mine === members.length - 1 && others === 0) score += 6; // 이걸 사면 묶음 완성
  if (others > 0 && mine === 0) score -= 1; // 이미 남이 가진 묶음은 매력이 떨어짐
  return score;
}

function chooseTravel(state: GameState, playerId: number, style: AiStyle): Action {
  const player = state.players[playerId];
  let best: { tile: number; score: number } | null = null;

  for (let tile = 0; tile < TILE_COUNT; tile++) {
    if (tile === player.position) continue;
    const def = BOARD[tile];
    let score = -100;
    const owner = state.tiles[tile].owner;

    if (def.type === "city" || def.type === "transport") {
      if (owner === null && player.money - (def.price ?? 0) >= RESERVE[style]) {
        score = 10 + tileScore(state, playerId, tile) + (def.price ?? 0) / 100;
      } else if (owner === playerId) {
        score = state.tiles[tile].level < 3 ? 5 : -5;
      } else if (owner !== null) {
        score = -50 - rentFor(tile, state.tiles); // 남의 땅은 통행료가 무서워서 피한다
      }
    } else if (def.type === "rest") {
      score = state.pool > 150 ? 8 : -1;
    } else if (def.type === "start" || def.type === "card") {
      score = 0;
    }
    if (!best || score > best.score) best = { tile, score };
  }
  return best && best.score > -50 ? { type: "travelTo", tile: best.tile } : { type: "skip" };
}

/** 지금 상태에서 AI가 할 행동 하나를 고른다. 항상 legalActions 중 하나다. */
export function chooseAction(state: GameState, style: AiStyle = "bold"): Action {
  const legal = legalActions(state);
  const has = (type: Action["type"]) => legal.some((a) => a.type === type);
  const player = state.players[state.current];

  if (state.phase === "roll") {
    // 돈이 넉넉하고 땅이 많이 남아 있으면 벌금을 내고 빨리 나와서 땅을 산다.
    const unowned = state.tiles.filter((t, i) => t.owner === null && BOARD[i].price !== undefined).length;
    if (has("payFine") && player.money > RULES.islandFine + RESERVE[style] + 300 && unowned > 6) return { type: "payFine" };
    return { type: "roll" };
  }

  if (state.phase === "decide" && state.decision) {
    const decision = state.decision;
    if (decision.type === "buy") {
      const score = tileScore(state, player.id, decision.tile);
      const afterMoney = player.money - decision.price;
      const must = score >= 6; // 묶음 완성은 조금 무리해도 산다
      if (afterMoney >= RESERVE[style] || (must && afterMoney >= 0)) return { type: "buy" };
      return { type: "skip" };
    }
    if (decision.type === "build") {
      const def = BOARD[decision.tile];
      const worthIt = def.group !== undefined && groupMembers(def.group).every((i) => state.tiles[i].owner === player.id);
      const reserve = worthIt ? RESERVE[style] / 2 : RESERVE[style] * 2;
      return player.money - decision.cost >= reserve ? { type: "build" } : { type: "skip" };
    }
    return chooseTravel(state, player.id, style);
  }

  if (state.phase === "end") return { type: "endTurn" };
  return legal[0];
}

/** 이 땅이 내 재산 중 얼마나 되는지 (화면 표시용으로도 쓸 수 있다) */
export function ownedValue(state: GameState, playerId: number): number {
  let total = 0;
  state.tiles.forEach((t, i) => {
    if (t.owner === playerId) total += tileValue(i, state.tiles);
  });
  return total;
}
