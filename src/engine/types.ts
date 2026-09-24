export type TileType = "start" | "city" | "transport" | "card" | "tax" | "island" | "rest" | "travel";

export interface TileDef {
  name: string;
  type: TileType;
  /** 땅값 (만원). city, transport만 있다. */
  price?: number;
  /** 같은 색 묶음 번호 (city만). 한 묶음을 모두 가지면 통행료가 오른다. */
  group?: number;
  /** 세금 (tax만) */
  amount?: number;
}

export type CardEffect =
  | { type: "money"; amount: number }
  | { type: "moveTo"; tile: string }
  | { type: "moveBack"; steps: number }
  | { type: "goIsland" }
  | { type: "collectFromAll"; amount: number }
  | { type: "payToAll"; amount: number };

export interface CardDef {
  text: string;
  effect: CardEffect;
}

export interface Rules {
  startMoney: number;
  salary: number;
  maxPlayers: number;
  islandFine: number;
  maxIslandTurns: number;
  buildCostRate: number;
  rentRates: number[];
  monopolyMultiplier: number;
  transportRent: number;
  sellRate: number;
  /** 기본 바퀴 수 제한. 0이면 끝까지, 아니면 이 바퀴 수가 지나면 재산이 가장 많은 사람이 이긴다. */
  maxRounds: number;
}

export type PlayerKind = "human" | "ai";

export interface Player {
  id: number;
  name: string;
  kind: PlayerKind;
  /** 말 색 번호 (0~3) */
  color: number;
  position: number;
  money: number;
  inIsland: boolean;
  /** 무인도에서 탈출을 시도한 횟수 */
  islandTurns: number;
  bankrupt: boolean;
  /** 이번 차례에 연속으로 나온 더블 횟수 */
  doubles: number;
}

export interface TileState {
  owner: number | null;
  /** 0 땅, 1 숙소, 2 빌딩, 3 랜드마크 */
  level: number;
}

/** 플레이어가 골라야 하는 것 */
export type Decision =
  | { type: "buy"; tile: number; price: number }
  | { type: "build"; tile: number; cost: number; level: number }
  | { type: "travel" };

/** roll: 굴릴 차례 / decide: 사기·짓기·이동 선택 / end: 차례 끝내기 / over: 게임 끝 */
export type Phase = "roll" | "decide" | "end" | "over";

export type EventType =
  | "roll"
  | "move"
  | "salary"
  | "buy"
  | "build"
  | "rent"
  | "tax"
  | "card"
  | "island"
  | "rest"
  | "sell"
  | "bankrupt"
  | "turn"
  | "gameover"
  | "info";

/** 화면이 애니메이션과 안내문을 만들 때 쓰는 사건 기록 */
export interface GameEvent {
  type: EventType;
  player: number;
  /** 사람이 읽는 한국어 문장 */
  text: string;
  from?: number;
  to?: number;
  amount?: number;
  tile?: number;
  dice?: [number, number];
}

export interface GameState {
  players: Player[];
  tiles: TileState[];
  current: number;
  phase: Phase;
  dice: [number, number] | null;
  decision: Decision | null;
  /** 세금으로 모인 돈. 휴게소에 서면 가져간다. */
  pool: number;
  round: number;
  /** 이 바퀴 수가 지나면 재산이 가장 많은 사람이 이긴다. 0이면 끝까지. */
  maxRounds: number;
  /** 난수 상태 (같은 값에서 시작하면 같은 판이 재현된다) */
  rng: number;
  /** 여행카드 섞인 순서와 다음에 뽑을 위치 */
  deck: number[];
  deckPos: number;
  /** 지금까지의 안내문 (최근 것이 뒤) */
  log: string[];
  /** 가장 최근 행동으로 생긴 사건들 */
  events: GameEvent[];
  winner: number | null;
  /** 행동이 처리될 때마다 1씩 늘어난다. 온라인에서 화면이 놓친 상태가 있는지 알아내는 데 쓴다. */
  seq: number;
}

export type Action =
  | { type: "roll" }
  | { type: "payFine" }
  | { type: "buy" }
  | { type: "skip" }
  | { type: "build" }
  | { type: "travelTo"; tile: number }
  | { type: "endTurn" };

export interface GameOptions {
  /** 바퀴 수 제한 (0이면 끝까지). 없으면 rules.json의 값. */
  maxRounds?: number;
}

export interface PlayerSetup {
  name: string;
  kind: PlayerKind;
}
