import { BOARD, TILE_COUNT } from "../engine/board";
import type { GameState } from "../engine/types";
import { el, sleep } from "./dom";
import { CORNER_ICONS, GROUP_COLORS, LEVEL_ICONS, PLAYER_COLORS, TILE_ICONS, TRANSPORT_ICONS } from "./theme";

const GRID = 9;

/** 칸 번호 → 9x9 격자 안의 (열, 행). 0번 출발이 오른쪽 아래이고 시계 반대 방향으로 돈다. */
export function tileCell(index: number): { col: number; row: number } {
  if (index <= 8) return { col: 8 - index, row: 8 };
  if (index <= 16) return { col: 0, row: 16 - index };
  if (index <= 24) return { col: index - 16, row: 0 };
  return { col: 8, row: index - 24 };
}

/** 말이 한 칸에 겹칠 때 서로 다른 구석에 서도록 하는 위치 (칸 크기 대비) */
const TOKEN_OFFSETS: [number, number][] = [
  [-0.24, -0.16],
  [0.24, -0.16],
  [-0.24, 0.24],
  [0.24, 0.24],
];

/** 판 화면: 32칸, 가운데 안내 영역, 말. */
export class BoardView {
  readonly root = el("div", { class: "board" });
  readonly center = el("div", { class: "board-center" });
  private readonly tiles: HTMLElement[] = [];
  private tokens: HTMLElement[] = [];
  private tokenPositions: number[] = [];
  private pickable = false;

  constructor(private readonly onTileTap: (index: number) => void) {
    BOARD.forEach((def, index) => {
      const { col, row } = tileCell(index);
      const tile = el("div", { class: `tile type-${def.type}` });
      tile.style.gridColumn = String(col + 1);
      tile.style.gridRow = String(row + 1);

      if (def.type === "city" && def.group) {
        const bar = el("div", { class: "tile-bar" });
        bar.style.background = GROUP_COLORS[def.group - 1];
        tile.append(bar);
      }
      const icon =
        def.type === "transport" ? TRANSPORT_ICONS[def.name] : (CORNER_ICONS[def.type] ?? TILE_ICONS[def.type] ?? "");
      if (icon) tile.append(el("div", { class: "tile-icon", text: icon }));
      tile.append(el("div", { class: "tile-name", text: def.name }));
      if (def.price) tile.append(el("div", { class: "tile-price", text: String(def.price) }));
      tile.append(el("div", { class: "tile-level" }));
      tile.addEventListener("click", () => this.onTileTap(index));

      this.tiles.push(tile);
      this.root.append(tile);
    });
    this.root.append(this.center);
  }

  /** 말을 (다시) 만든다. 판을 새로 시작할 때 부른다. */
  setPlayers(count: number): void {
    for (const token of this.tokens) token.remove();
    this.tokens = [];
    this.tokenPositions = [];
    for (let i = 0; i < count; i++) {
      const token = el("div", { class: "token" });
      token.style.background = PLAYER_COLORS[i];
      this.root.append(token);
      this.tokens.push(token);
      this.tokenPositions.push(0);
      this.placeToken(i, 0);
    }
  }

  private placeToken(player: number, index: number): void {
    const { col, row } = tileCell(index);
    const [dx, dy] = TOKEN_OFFSETS[player];
    const token = this.tokens[player];
    token.style.left = `${((col + 0.5 + dx) / GRID) * 100}%`;
    token.style.top = `${((row + 0.5 + dy) / GRID) * 100}%`;
    this.tokenPositions[player] = index;
  }

  /** 말을 바로 옮긴다 (애니메이션 없이). */
  jumpToken(player: number, index: number): void {
    this.placeToken(player, index);
  }

  /** 말을 앞으로 한 칸씩 걸어서 옮긴다. 멀리 이동하는 경우(카드, 세계여행)는 바로 옮긴다. */
  async walkToken(player: number, to: number, stepMs: number, onStep?: () => void): Promise<void> {
    const from = this.tokenPositions[player];
    const distance = (to - from + TILE_COUNT) % TILE_COUNT;
    if (distance === 0) return;
    if (distance > 12 || stepMs <= 0) {
      this.placeToken(player, to);
      await sleep(Math.max(stepMs * 3, 0));
      return;
    }
    for (let step = 1; step <= distance; step++) {
      this.placeToken(player, (from + step) % TILE_COUNT);
      onStep?.();
      await sleep(stepMs);
    }
  }

  /** 소유자, 건물 단계를 화면에 맞춘다. */
  render(state: GameState): void {
    state.tiles.forEach((tile, index) => {
      const element = this.tiles[index];
      const owned = tile.owner !== null;
      element.classList.toggle("owned", owned);
      element.style.setProperty("--owner", owned ? PLAYER_COLORS[tile.owner as number] : "transparent");
      const level = element.querySelector(".tile-level") as HTMLElement;
      level.textContent = tile.level > 0 ? LEVEL_ICONS[tile.level] : "";
    });
    this.tokens.forEach((token, i) => {
      token.classList.toggle("bankrupt", state.players[i]?.bankrupt ?? false);
    });
  }

  /** 세계여행처럼 칸을 눌러 고르는 동안 모든 칸을 눌러 볼 수 있게 표시한다. */
  setPickable(pickable: boolean, current?: number): void {
    this.pickable = pickable;
    this.root.classList.toggle("picking", pickable);
    this.tiles.forEach((tile, i) => tile.classList.toggle("pickable", pickable && i !== current));
  }

  get isPicking(): boolean {
    return this.pickable;
  }

  /** 지금 차례인 플레이어의 말이 서 있는 칸을 강조한다. */
  highlight(index: number | null): void {
    this.tiles.forEach((tile, i) => tile.classList.toggle("focus", i === index));
  }
}
