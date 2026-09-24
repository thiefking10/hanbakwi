import { BOARD, CARDS, RULES, TILE_COUNT, buildCost, islandIndex, rentFor, tileIndexByName, tileValue } from "./board";
import { eulReul, euroRo } from "./josa";
import { rollDie, shuffledIndices } from "./rng";
import type { Action, GameEvent, GameOptions, GameState, Player, PlayerSetup } from "./types";

const MAX_LOG = 60;
/** 카드로 이동한 뒤 또 카드로 이동하는 연쇄를 막는 깊이 제한 */
const MAX_CHAIN = 2;

export interface DispatchOptions {
  /** 테스트나 디버그에서 주사위 눈을 정한다. 온라인 대전에서는 쓰지 않는다. */
  dice?: [number, number];
}

/** 새 판을 만든다. 2~4명이어야 하고, 시드가 같으면 같은 판이 나온다. */
export function createGame(setups: PlayerSetup[], seed: number, options: GameOptions = {}): GameState {
  if (setups.length < 2 || setups.length > RULES.maxPlayers) {
    throw new Error(`플레이어는 2~${RULES.maxPlayers}명이어야 해요.`);
  }
  const state: GameState = {
    players: setups.map((setup, id) => ({
      id,
      name: setup.name,
      kind: setup.kind,
      color: id,
      position: 0,
      money: RULES.startMoney,
      inIsland: false,
      islandTurns: 0,
      bankrupt: false,
      doubles: 0,
    })),
    tiles: BOARD.map(() => ({ owner: null, level: 0 })),
    current: 0,
    phase: "roll",
    dice: null,
    decision: null,
    pool: 0,
    round: 1,
    maxRounds: options.maxRounds ?? RULES.maxRounds,
    rng: seed >>> 0,
    deck: [],
    deckPos: 0,
    log: [],
    events: [],
    winner: null,
    seq: 0,
  };
  state.deck = shuffledIndices(state, CARDS.length);
  emit(state, { type: "turn", player: 0, text: `${state.players[0].name}님의 차례예요.` });
  state.events = [];
  return state;
}

export function currentPlayer(state: GameState): Player {
  return state.players[state.current];
}

/** 재산 = 가진 돈 + 가진 땅과 건물의 값 */
export function netWorth(state: GameState, playerId: number): number {
  const player = state.players[playerId];
  if (player.bankrupt) return 0;
  let total = player.money;
  state.tiles.forEach((tile, i) => {
    if (tile.owner === playerId) total += tileValue(i, state.tiles);
  });
  return total;
}

/** 지금 할 수 있는 행동 목록 (화면의 버튼과 AI가 쓴다) */
export function legalActions(state: GameState): Action[] {
  if (state.phase === "over") return [];
  const player = currentPlayer(state);

  if (state.phase === "roll") {
    const actions: Action[] = [{ type: "roll" }];
    if (player.inIsland && player.money >= RULES.islandFine) actions.push({ type: "payFine" });
    return actions;
  }
  if (state.phase === "decide" && state.decision) {
    if (state.decision.type === "buy") return [{ type: "buy" }, { type: "skip" }];
    if (state.decision.type === "build") return [{ type: "build" }, { type: "skip" }];
    const actions: Action[] = [];
    for (let tile = 0; tile < TILE_COUNT; tile++) {
      if (tile !== player.position) actions.push({ type: "travelTo", tile });
    }
    actions.push({ type: "skip" });
    return actions;
  }
  if (state.phase === "end") return [{ type: "endTurn" }];
  return [];
}

export function isLegal(state: GameState, action: Action): boolean {
  return legalActions(state).some((a) => a.type === action.type && (a.type !== "travelTo" || a.tile === (action as { tile: number }).tile));
}

/**
 * 행동 하나를 실행한 새 상태를 돌려준다 (원래 상태는 바꾸지 않는다).
 * 지금 할 수 없는 행동이면 받은 상태를 그대로 돌려준다.
 */
export function dispatch(state: GameState, action: Action, options: DispatchOptions = {}): GameState {
  if (!isLegal(state, action)) return state;
  const s = structuredClone(state);
  s.events = [];
  s.seq += 1;

  switch (action.type) {
    case "roll":
      doRoll(s, options.dice);
      break;
    case "payFine":
      doPayFine(s);
      break;
    case "buy":
      doBuy(s);
      break;
    case "build":
      doBuild(s);
      break;
    case "skip":
      s.decision = null;
      s.phase = "end";
      break;
    case "travelTo":
      doTravel(s, action.tile);
      break;
    case "endTurn":
      doEndTurn(s);
      break;
  }
  return s;
}

function emit(s: GameState, event: GameEvent): void {
  s.events.push(event);
  s.log.push(event.text);
  if (s.log.length > MAX_LOG) s.log.splice(0, s.log.length - MAX_LOG);
}

function me(s: GameState): Player {
  return s.players[s.current];
}

function tileName(index: number): string {
  return BOARD[index].name;
}

// ---------------------------------------------------------------- 돈

/** 가진 땅 중 가장 싼 것을 은행에 판다. */
function sellCheapest(s: GameState, playerId: number): boolean {
  let best = -1;
  let bestValue = Infinity;
  s.tiles.forEach((tile, i) => {
    if (tile.owner !== playerId) return;
    const value = tileValue(i, s.tiles);
    if (value < bestValue) {
      best = i;
      bestValue = value;
    }
  });
  if (best < 0) return false;
  const proceeds = Math.round(bestValue * RULES.sellRate);
  const player = s.players[playerId];
  player.money += proceeds;
  s.tiles[best] = { owner: null, level: 0 };
  emit(s, { type: "sell", player: playerId, tile: best, amount: proceeds, text: `${player.name}님이 돈이 모자라 ${eulReul(tileName(best))} ${proceeds}만원에 팔았어요.` });
  return true;
}

/**
 * payer가 amount를 낸다. receiver가 null이면 은행에 낸다.
 * 모자라면 땅을 팔아서 채우고, 그래도 모자라면 파산한다. 실제로 낸 금액을 돌려준다.
 */
function pay(s: GameState, payerId: number, receiverId: number | null, amount: number): number {
  const payer = s.players[payerId];
  while (payer.money < amount && sellCheapest(s, payerId)) {
    // 돈이 채워질 때까지 계속 판다.
  }
  if (payer.money >= amount) {
    payer.money -= amount;
    if (receiverId !== null) s.players[receiverId].money += amount;
    return amount;
  }
  const paid = payer.money;
  payer.money = 0;
  if (receiverId !== null) s.players[receiverId].money += paid;
  declareBankrupt(s, payerId);
  return paid;
}

function declareBankrupt(s: GameState, playerId: number): void {
  const player = s.players[playerId];
  player.bankrupt = true;
  player.inIsland = false;
  s.tiles.forEach((tile, i) => {
    if (tile.owner === playerId) s.tiles[i] = { owner: null, level: 0 };
  });
  emit(s, { type: "bankrupt", player: playerId, text: `${player.name}님이 파산했어요.` });

  const alive = s.players.filter((p) => !p.bankrupt);
  if (alive.length === 1) finish(s, alive[0].id);
  else s.phase = "end";
  s.decision = null;
}

function finish(s: GameState, winnerId: number): void {
  s.winner = winnerId;
  s.phase = "over";
  s.decision = null;
  emit(s, { type: "gameover", player: winnerId, text: `${s.players[winnerId].name}님이 우승했어요! 🎉` });
}

// ---------------------------------------------------------------- 이동

function doRoll(s: GameState, forced?: [number, number]): void {
  const player = me(s);
  const dice: [number, number] = forced ?? [rollDie(s), rollDie(s)];
  const sum = dice[0] + dice[1];
  const isDouble = dice[0] === dice[1];
  s.dice = dice;
  emit(s, { type: "roll", player: player.id, dice, text: `${player.name}님이 주사위를 굴렸어요! (${dice[0]} + ${dice[1]} = ${sum})` });

  if (player.inIsland) {
    if (isDouble) {
      player.inIsland = false;
      player.islandTurns = 0;
      emit(s, { type: "island", player: player.id, text: `더블! ${player.name}님이 무인도를 탈출했어요.` });
      moveBy(s, sum);
      return;
    }
    player.islandTurns += 1;
    if (player.islandTurns >= RULES.maxIslandTurns) {
      player.inIsland = false;
      player.islandTurns = 0;
      emit(s, { type: "island", player: player.id, text: `${player.name}님이 벌금 ${RULES.islandFine}만원을 내고 무인도를 나왔어요.` });
      pay(s, player.id, null, RULES.islandFine);
      if (s.phase === "over" || player.bankrupt) return;
      moveBy(s, sum);
      return;
    }
    emit(s, { type: "island", player: player.id, text: `${player.name}님은 아직 무인도에 있어요. (${player.islandTurns}/${RULES.maxIslandTurns})` });
    s.phase = "end";
    return;
  }

  player.doubles = isDouble ? player.doubles + 1 : 0;
  if (player.doubles >= 3) {
    emit(s, { type: "island", player: player.id, text: `더블이 세 번 연속! ${player.name}님이 무인도로 가요.` });
    sendToIsland(s);
    return;
  }
  moveBy(s, sum);
}

function doPayFine(s: GameState): void {
  const player = me(s);
  player.money -= RULES.islandFine;
  player.inIsland = false;
  player.islandTurns = 0;
  emit(s, { type: "island", player: player.id, amount: RULES.islandFine, text: `${player.name}님이 벌금 ${RULES.islandFine}만원을 내고 무인도를 나왔어요.` });
}

function sendToIsland(s: GameState): void {
  const player = me(s);
  const from = player.position;
  player.position = islandIndex();
  player.inIsland = true;
  player.islandTurns = 0;
  player.doubles = 0;
  emit(s, { type: "move", player: player.id, from, to: player.position, text: `${player.name}님이 무인도에 갇혔어요.` });
  s.decision = null;
  s.phase = "end";
}

function giveSalary(s: GameState): void {
  const player = me(s);
  player.money += RULES.salary;
  emit(s, { type: "salary", player: player.id, amount: RULES.salary, text: `${player.name}님이 출발점을 지나 월급 ${RULES.salary}만원을 받았어요.` });
}

function moveBy(s: GameState, steps: number): void {
  const player = me(s);
  const from = player.position;
  const raw = from + steps;
  player.position = raw % TILE_COUNT;
  emit(s, { type: "move", player: player.id, from, to: player.position, text: `${player.name}님이 ${tileName(player.position)}에 도착했어요.` });
  if (raw >= TILE_COUNT) giveSalary(s);
  landOn(s, 0);
}

function doTravel(s: GameState, tile: number): void {
  const player = me(s);
  const from = player.position;
  player.position = tile;
  s.decision = null;
  emit(s, { type: "move", player: player.id, from, to: tile, text: `${player.name}님이 세계여행으로 ${tileName(tile)}에 날아갔어요.` });
  landOn(s, 1);
}

// ---------------------------------------------------------------- 도착한 칸

function landOn(s: GameState, chain: number): void {
  const player = me(s);
  const index = player.position;
  const def = BOARD[index];
  const tile = s.tiles[index];
  s.decision = null;

  switch (def.type) {
    case "city":
    case "transport": {
      if (tile.owner === null) {
        if (player.money >= (def.price ?? 0)) {
          s.decision = { type: "buy", tile: index, price: def.price ?? 0 };
        } else {
          emit(s, { type: "info", player: player.id, text: `${eulReul(tileName(index))} 사기에는 돈이 모자라요.` });
        }
      } else if (tile.owner === player.id) {
        if (def.type === "city" && tile.level < RULES.rentRates.length - 1) {
          const cost = buildCost(def);
          if (player.money >= cost) s.decision = { type: "build", tile: index, cost, level: tile.level + 1 };
        }
      } else {
        const rent = rentFor(index, s.tiles);
        const owner = s.players[tile.owner];
        emit(s, { type: "rent", player: player.id, tile: index, amount: rent, text: `${player.name}님이 ${owner.name}님에게 통행료 ${rent}만원을 냈어요.` });
        pay(s, player.id, tile.owner, rent);
      }
      break;
    }
    case "tax": {
      const amount = def.amount ?? 0;
      emit(s, { type: "tax", player: player.id, amount, text: `${player.name}님이 세금 ${amount}만원을 냈어요.` });
      s.pool += pay(s, player.id, null, amount);
      break;
    }
    case "card":
      drawCard(s, chain);
      break;
    case "rest": {
      if (s.pool > 0) {
        const amount = s.pool;
        player.money += amount;
        s.pool = 0;
        emit(s, { type: "rest", player: player.id, amount, text: `${player.name}님이 휴게소에서 모인 세금 ${amount}만원을 받았어요.` });
      } else {
        emit(s, { type: "rest", player: player.id, text: `${player.name}님이 휴게소에서 쉬어 가요.` });
      }
      break;
    }
    case "travel":
      s.decision = { type: "travel" };
      break;
    case "island":
      emit(s, { type: "info", player: player.id, text: `${player.name}님은 무인도를 구경만 해요.` });
      break;
    case "start":
      break;
  }

  if (s.phase === "over") return;
  s.phase = s.decision ? "decide" : "end";
}

function drawCard(s: GameState, chain: number): void {
  const player = me(s);
  const card = CARDS[s.deck[s.deckPos]];
  s.deckPos += 1;
  if (s.deckPos >= s.deck.length) {
    s.deck = shuffledIndices(s, CARDS.length);
    s.deckPos = 0;
  }
  emit(s, { type: "card", player: player.id, text: `여행카드: ${card.text}` });

  const effect = card.effect;
  switch (effect.type) {
    case "money":
      if (effect.amount >= 0) player.money += effect.amount;
      else pay(s, player.id, null, -effect.amount);
      break;
    case "moveTo": {
      const to = tileIndexByName(effect.tile);
      const from = player.position;
      player.position = to;
      emit(s, { type: "move", player: player.id, from, to, text: `${player.name}님이 ${euroRo(tileName(to))} 이동했어요.` });
      if (to < from) giveSalary(s);
      if (chain < MAX_CHAIN) landOn(s, chain + 1);
      break;
    }
    case "moveBack": {
      const from = player.position;
      player.position = (from - effect.steps + TILE_COUNT) % TILE_COUNT;
      emit(s, { type: "move", player: player.id, from, to: player.position, text: `${player.name}님이 ${euroRo(tileName(player.position))} 물러났어요.` });
      if (chain < MAX_CHAIN) landOn(s, chain + 1);
      break;
    }
    case "goIsland":
      sendToIsland(s);
      break;
    case "collectFromAll":
      for (const other of s.players) {
        if (other.id === player.id || other.bankrupt) continue;
        pay(s, other.id, player.id, effect.amount);
        if (s.phase === "over") return;
      }
      break;
    case "payToAll":
      for (const other of s.players) {
        if (other.id === player.id || other.bankrupt) continue;
        pay(s, player.id, other.id, effect.amount);
        if (player.bankrupt || s.phase === "over") return;
      }
      break;
  }
}

// ---------------------------------------------------------------- 선택

function doBuy(s: GameState): void {
  const player = me(s);
  const decision = s.decision;
  if (!decision || decision.type !== "buy") return;
  player.money -= decision.price;
  s.tiles[decision.tile].owner = player.id;
  emit(s, { type: "buy", player: player.id, tile: decision.tile, amount: decision.price, text: `${player.name}님이 ${eulReul(tileName(decision.tile))} ${decision.price}만원에 샀어요.` });
  s.decision = null;
  s.phase = "end";
}

const LEVEL_NAMES = ["땅", "숙소", "빌딩", "랜드마크"];

function doBuild(s: GameState): void {
  const player = me(s);
  const decision = s.decision;
  if (!decision || decision.type !== "build") return;
  player.money -= decision.cost;
  s.tiles[decision.tile].level = decision.level;
  emit(s, {
    type: "build",
    player: player.id,
    tile: decision.tile,
    amount: decision.cost,
    text: `${player.name}님이 ${tileName(decision.tile)}에 ${eulReul(LEVEL_NAMES[decision.level])} 지었어요. (${decision.cost}만원)`,
  });
  s.decision = null;
  s.phase = "end";
}

// ---------------------------------------------------------------- 차례 넘기기

function doEndTurn(s: GameState): void {
  const player = me(s);
  if (!player.bankrupt && !player.inIsland && player.doubles > 0) {
    s.phase = "roll";
    s.dice = null;
    emit(s, { type: "info", player: player.id, text: `더블이라서 ${player.name}님이 한 번 더 굴려요.` });
    return;
  }
  player.doubles = 0;

  let next = s.current;
  do {
    next = (next + 1) % s.players.length;
  } while (s.players[next].bankrupt);
  if (next <= s.current) s.round += 1;

  if (s.maxRounds > 0 && s.round > s.maxRounds) {
    let best = 0;
    for (const p of s.players) if (netWorth(s, p.id) > netWorth(s, best)) best = p.id;
    finish(s, best);
    return;
  }

  s.current = next;
  s.phase = "roll";
  s.dice = null;
  s.decision = null;
  emit(s, { type: "turn", player: next, text: `${s.players[next].name}님의 차례예요.` });
}
