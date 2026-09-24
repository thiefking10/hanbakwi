import boardData from "../../data/board.json";
import cardData from "../../data/cards.json";
import rulesData from "../../data/rules.json";
import type { CardDef, Rules, TileDef, TileState } from "./types";

export const BOARD = boardData as TileDef[];
export const CARDS = cardData as CardDef[];
export const RULES = rulesData as Rules;

export const TILE_COUNT = BOARD.length;

export function tileIndexByName(name: string, board: TileDef[] = BOARD): number {
  return board.findIndex((t) => t.name === name);
}

/** 무인도 칸의 위치. 감옥처럼 갇히는 곳이다. */
export function islandIndex(board: TileDef[] = BOARD): number {
  return board.findIndex((t) => t.type === "island");
}

/** 같은 색 묶음에 속한 칸 번호들 */
export function groupMembers(group: number, board: TileDef[] = BOARD): number[] {
  const members: number[] = [];
  board.forEach((tile, i) => {
    if (tile.type === "city" && tile.group === group) members.push(i);
  });
  return members;
}

/** 이 칸을 한 단계 올릴 때(또는 처음 지을 때) 드는 돈 */
export function buildCost(tile: TileDef, rules: Rules = RULES): number {
  return Math.round((tile.price ?? 0) * rules.buildCostRate);
}

/** 이 칸에 들어간 돈의 합 (땅값 + 지은 건물). 팔 때와 재산 계산에 쓴다. */
export function tileValue(index: number, tiles: TileState[], board: TileDef[] = BOARD, rules: Rules = RULES): number {
  const def = board[index];
  return (def.price ?? 0) + buildCost(def, rules) * (tiles[index].level > 0 ? tiles[index].level : 0);
}

/** 한 사람이 같은 색 묶음을 전부 가지고 있는지 */
export function ownsWholeGroup(owner: number, group: number, tiles: TileState[], board: TileDef[] = BOARD): boolean {
  return groupMembers(group, board).every((i) => tiles[i].owner === owner);
}

/** 다른 사람이 이 칸에 멈췄을 때 내야 하는 통행료 */
export function rentFor(index: number, tiles: TileState[], board: TileDef[] = BOARD, rules: Rules = RULES): number {
  const def = board[index];
  const state = tiles[index];
  if (state.owner === null) return 0;

  if (def.type === "transport") {
    const owned = board.filter((t, i) => t.type === "transport" && tiles[i].owner === state.owner).length;
    return rules.transportRent * owned;
  }
  if (def.type !== "city") return 0;

  const base = Math.round((def.price ?? 0) * rules.rentRates[state.level]);
  const monopoly = state.level === 0 && def.group !== undefined && ownsWholeGroup(state.owner, def.group, tiles, board);
  return monopoly ? base * rules.monopolyMultiplier : base;
}
