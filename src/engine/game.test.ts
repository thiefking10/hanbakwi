import { describe, expect, it } from "vitest";
import { BOARD, CARDS, RULES, TILE_COUNT, groupMembers, rentFor, tileIndexByName } from "./board";
import { createGame, currentPlayer, dispatch, isLegal, legalActions, netWorth } from "./game";
import type { GameState, PlayerSetup } from "./types";

const SETUPS: PlayerSetup[] = [
  { name: "가", kind: "human" },
  { name: "나", kind: "human" },
  { name: "다", kind: "ai" },
];

function newGame(count = 3, seed = 1): GameState {
  return createGame(SETUPS.slice(0, count), seed);
}

/** 상태를 복사해서 원하는 대로 고친 것을 돌려준다 (테스트에서 상황을 만들 때 쓴다). */
function mutate(state: GameState, fn: (s: GameState) => void): GameState {
  const copy = structuredClone(state);
  fn(copy);
  return copy;
}

function roll(state: GameState, a: number, b: number): GameState {
  return dispatch(state, { type: "roll" }, { dice: [a, b] });
}

describe("판 데이터", () => {
  it("32칸이고 네 모서리와 종류별 개수가 맞다", () => {
    expect(TILE_COUNT).toBe(32);
    for (const i of [0, 8, 16, 24]) expect(["start", "island", "rest", "travel"]).toContain(BOARD[i].type);
    const count = (type: string) => BOARD.filter((t) => t.type === type).length;
    expect(count("city")).toBe(19);
    expect(count("transport")).toBe(4);
    expect(count("card")).toBe(4);
    expect(count("tax")).toBe(1);
  });

  it("도시와 교통편에는 값이 있고, 같은 묶음은 이어진 칸들이다", () => {
    for (const tile of BOARD) {
      if (tile.type === "city" || tile.type === "transport") expect(tile.price).toBeGreaterThan(0);
      if (tile.type === "city") expect(tile.group).toBeGreaterThan(0);
    }
    for (let group = 1; group <= 8; group++) {
      const members = groupMembers(group);
      expect(members.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("카드가 가리키는 칸 이름이 모두 실제로 있다", () => {
    for (const card of CARDS) {
      if (card.effect.type === "moveTo") expect(tileIndexByName(card.effect.tile)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("시작", () => {
  it("2~4명만 시작할 수 있다", () => {
    expect(() => createGame([SETUPS[0]], 1)).toThrow();
    expect(() => createGame([...SETUPS, ...SETUPS], 1)).toThrow();
    const state = newGame(3);
    expect(state.players.every((p) => p.money === RULES.startMoney)).toBe(true);
    expect(state.phase).toBe("roll");
  });

  it("같은 시드면 같은 판이다", () => {
    const a = newGame(3, 42);
    const b = newGame(3, 42);
    expect(a).toEqual(b);
    let x = a;
    let y = b;
    for (let i = 0; i < 6; i++) {
      x = dispatch(x, legalActions(x)[0]);
      y = dispatch(y, legalActions(y)[0]);
    }
    expect(x).toEqual(y);
  });
});

describe("굴리기와 이동", () => {
  it("주사위만큼 이동하고 도착 안내가 남는다", () => {
    const s = roll(newGame(), 1, 1);
    expect(currentPlayer(s).position).toBe(2);
    expect(s.dice).toEqual([1, 1]);
    expect(s.events.some((e) => e.type === "move")).toBe(true);
  });

  it("출발점을 지나면 월급을 받는다", () => {
    const start = mutate(newGame(), (s) => {
      s.players[0].position = 30;
    });
    const s = roll(start, 2, 4);
    expect(currentPlayer(s).position).toBe(4);
    expect(currentPlayer(s).money).toBe(RULES.startMoney + RULES.salary);
  });

  it("지금 할 수 없는 행동은 무시한다", () => {
    const s = newGame();
    expect(dispatch(s, { type: "buy" })).toBe(s);
    expect(dispatch(s, { type: "endTurn" })).toBe(s);
    expect(isLegal(s, { type: "roll" })).toBe(true);
  });

  it("원래 상태는 바꾸지 않는다", () => {
    const s = newGame();
    const snapshot = structuredClone(s);
    roll(s, 3, 4);
    expect(s).toEqual(snapshot);
  });

  it("더블이면 한 번 더 굴리고, 아니면 다음 사람 차례다", () => {
    let s = roll(newGame(), 2, 2);
    s = dispatch(s, legalActions(s).find((a) => a.type === "buy" || a.type === "skip") ?? { type: "endTurn" });
    if (s.phase === "decide") s = dispatch(s, { type: "skip" });
    s = dispatch(s, { type: "endTurn" });
    expect(s.current).toBe(0);
    expect(s.phase).toBe("roll");

    let t = roll(newGame(), 2, 3);
    if (t.phase === "decide") t = dispatch(t, { type: "skip" });
    t = dispatch(t, { type: "endTurn" });
    expect(t.current).toBe(1);
  });
});

describe("땅 사기와 통행료", () => {
  it("빈 땅에 서면 살지 말지 고르고, 사면 내 땅이 된다", () => {
    let s = roll(newGame(), 1, 1); // 강릉(2)
    expect(s.phase).toBe("decide");
    expect(s.decision).toEqual({ type: "buy", tile: 2, price: 110 });
    s = dispatch(s, { type: "buy" });
    expect(s.tiles[2].owner).toBe(0);
    expect(currentPlayer(s).money).toBe(RULES.startMoney - 110);
    expect(s.phase).toBe("end");
  });

  it("안 사고 넘길 수 있다", () => {
    let s = roll(newGame(), 1, 1);
    s = dispatch(s, { type: "skip" });
    expect(s.tiles[2].owner).toBeNull();
    expect(s.phase).toBe("end");
  });

  it("돈이 모자라면 살 수 없다", () => {
    const start = mutate(newGame(), (s) => {
      s.players[0].money = 50;
    });
    const s = roll(start, 1, 1);
    expect(s.decision).toBeNull();
    expect(s.phase).toBe("end");
  });

  it("남의 땅에 서면 통행료를 낸다", () => {
    const start = mutate(newGame(), (s) => {
      s.tiles[2].owner = 1;
    });
    const s = roll(start, 1, 1);
    const rent = rentFor(2, s.tiles);
    expect(rent).toBe(Math.round(110 * RULES.rentRates[0]));
    expect(s.players[0].money).toBe(RULES.startMoney - rent);
    expect(s.players[1].money).toBe(RULES.startMoney + rent);
  });

  it("같은 색 땅을 다 가지면 통행료가 두 배가 된다", () => {
    const tiles = newGame().tiles;
    tiles[1].owner = 1;
    const single = rentFor(1, tiles);
    tiles[2].owner = 1;
    expect(rentFor(1, tiles)).toBe(single * RULES.monopolyMultiplier);
  });

  it("교통편은 가진 개수만큼 통행료가 오른다", () => {
    const tiles = newGame().tiles;
    const transports = BOARD.map((t, i) => (t.type === "transport" ? i : -1)).filter((i) => i >= 0);
    tiles[transports[0]].owner = 1;
    expect(rentFor(transports[0], tiles)).toBe(RULES.transportRent);
    tiles[transports[1]].owner = 1;
    tiles[transports[2]].owner = 1;
    expect(rentFor(transports[0], tiles)).toBe(RULES.transportRent * 3);
  });
});

describe("건물 짓기", () => {
  it("내 땅에 서면 지을 수 있고, 지을수록 통행료가 오른다", () => {
    const start = mutate(newGame(), (s) => {
      s.tiles[2].owner = 0;
    });
    let s = roll(start, 1, 1);
    expect(s.decision?.type).toBe("build");
    const before = rentFor(2, s.tiles);
    s = dispatch(s, { type: "build" });
    expect(s.tiles[2].level).toBe(1);
    expect(currentPlayer(s).money).toBe(RULES.startMoney - Math.round(110 * RULES.buildCostRate));
    expect(rentFor(2, s.tiles)).toBeGreaterThan(before);
  });

  it("랜드마크(마지막 단계)까지 지으면 더는 짓지 않는다", () => {
    const start = mutate(newGame(), (s) => {
      s.tiles[2] = { owner: 0, level: 3 };
    });
    const s = roll(start, 1, 1);
    expect(s.decision).toBeNull();
    expect(s.phase).toBe("end");
  });
});

describe("세금, 휴게소, 카드", () => {
  it("세금은 휴게소에 모이고 휴게소에 서면 가져간다", () => {
    let s = mutate(newGame(), (st) => {
      st.players[0].position = 3;
    });
    s = roll(s, 2, 2); // 3 -> 7 (세금)
    expect(s.pool).toBe(100);
    expect(currentPlayer(s).money).toBe(RULES.startMoney - 100);

    const atRest = mutate(s, (st) => {
      st.players[st.current].position = 12;
      st.phase = "roll";
    });
    const after = roll(atRest, 2, 2); // 12 -> 16 (휴게소)
    expect(after.pool).toBe(0);
    expect(currentPlayer(after).money).toBe(RULES.startMoney - 100 + 100);
  });

  function cardTest(effectMatch: (c: (typeof CARDS)[number]) => boolean, prepare?: (s: GameState) => void): GameState {
    const cardIndex = CARDS.findIndex(effectMatch);
    expect(cardIndex).toBeGreaterThanOrEqual(0);
    const start = mutate(newGame(), (s) => {
      s.deck = [cardIndex, ...s.deck.filter((i) => i !== cardIndex)];
      s.deckPos = 0;
      prepare?.(s);
    });
    return roll(start, 1, 2); // 0 -> 3 (여행카드)
  }

  it("돈을 받는 카드", () => {
    const s = cardTest((c) => c.effect.type === "money" && c.effect.amount > 0);
    expect(currentPlayer(s).money).toBeGreaterThan(RULES.startMoney);
  });

  it("돈을 내는 카드", () => {
    const s = cardTest((c) => c.effect.type === "money" && c.effect.amount < 0);
    expect(currentPlayer(s).money).toBeLessThan(RULES.startMoney);
  });

  it("무인도로 보내는 카드", () => {
    const s = cardTest((c) => c.effect.type === "goIsland");
    expect(currentPlayer(s).inIsland).toBe(true);
    expect(currentPlayer(s).position).toBe(tileIndexByName("무인도"));
    expect(s.phase).toBe("end");
  });

  it("모두에게 받는 카드와 모두에게 주는 카드", () => {
    const collect = cardTest((c) => c.effect.type === "collectFromAll");
    expect(currentPlayer(collect).money).toBe(RULES.startMoney + 40);
    expect(collect.players[1].money).toBe(RULES.startMoney - 20);

    const payAll = cardTest((c) => c.effect.type === "payToAll");
    expect(currentPlayer(payAll).money).toBe(RULES.startMoney - 40);
    expect(payAll.players[2].money).toBe(RULES.startMoney + 20);
  });

  it("서울로 이동하는 카드는 도착한 땅에서 이어서 처리한다", () => {
    const s = cardTest((c) => c.effect.type === "moveTo" && c.effect.tile === "서울");
    expect(currentPlayer(s).position).toBe(tileIndexByName("서울"));
    expect(s.decision?.type).toBe("buy");
  });

  it("뒤로 가는 카드", () => {
    const s = cardTest((c) => c.effect.type === "moveBack");
    expect(currentPlayer(s).position).toBe(0);
  });

  it("카드를 다 쓰면 다시 섞는다", () => {
    let s = newGame();
    const size = s.deck.length;
    s = mutate(s, (st) => {
      st.deckPos = size - 1;
      st.players[0].money = 100000;
    });
    s = roll(s, 1, 2);
    expect(s.deckPos).toBe(0);
    expect(s.deck).toHaveLength(size);
  });
});

describe("무인도", () => {
  const island = tileIndexByName("무인도");

  it("더블이 세 번 연속 나오면 무인도로 간다", () => {
    let s = newGame();
    s = mutate(s, (st) => {
      st.players[0].money = 100000;
      st.players[0].doubles = 2;
    });
    s = roll(s, 3, 3);
    expect(currentPlayer(s).inIsland).toBe(true);
    expect(currentPlayer(s).position).toBe(island);
    expect(s.phase).toBe("end");
    s = dispatch(s, { type: "endTurn" });
    expect(s.current).toBe(1);
  });

  const trapped = (): GameState =>
    mutate(newGame(), (s) => {
      s.players[0].inIsland = true;
      s.players[0].position = island;
    });

  it("더블이 나오면 탈출해서 그만큼 이동하지만 한 번 더 굴리지는 않는다", () => {
    let s = roll(trapped(), 2, 2);
    expect(currentPlayer(s).inIsland).toBe(false);
    expect(currentPlayer(s).position).toBe(island + 4);
    if (s.phase === "decide") s = dispatch(s, { type: "skip" });
    s = dispatch(s, { type: "endTurn" });
    expect(s.current).toBe(1);
  });

  it("벌금을 내고 바로 나올 수 있다", () => {
    let s = trapped();
    expect(isLegal(s, { type: "payFine" })).toBe(true);
    s = dispatch(s, { type: "payFine" });
    expect(currentPlayer(s).inIsland).toBe(false);
    expect(currentPlayer(s).money).toBe(RULES.startMoney - RULES.islandFine);
    expect(s.phase).toBe("roll");
  });

  it("세 번 실패하면 벌금을 내고 나온다", () => {
    let s = trapped();
    for (let i = 0; i < RULES.maxIslandTurns - 1; i++) {
      s = roll(s, 1, 2);
      expect(currentPlayer(s).inIsland).toBe(true);
      expect(s.phase).toBe("end");
      s = mutate(s, (st) => {
        st.phase = "roll";
      });
    }
    s = roll(s, 1, 3);
    expect(currentPlayer(s).inIsland).toBe(false);
    expect(currentPlayer(s).money).toBe(RULES.startMoney - RULES.islandFine);
    expect(currentPlayer(s).position).toBe(island + 4);
  });

  it("벌금 낼 돈이 없으면 벌금 내기 버튼이 없다", () => {
    const s = mutate(trapped(), (st) => {
      st.players[0].money = 10;
    });
    expect(isLegal(s, { type: "payFine" })).toBe(false);
  });
});

describe("세계여행", () => {
  it("세계여행 칸에 서면 원하는 칸으로 날아간다", () => {
    const start = mutate(newGame(), (s) => {
      s.players[0].position = 20;
    });
    let s = roll(start, 1, 3); // 24 세계여행
    expect(s.decision).toEqual({ type: "travel" });
    expect(isLegal(s, { type: "travelTo", tile: 31 })).toBe(true);
    expect(isLegal(s, { type: "travelTo", tile: 24 })).toBe(false);
    s = dispatch(s, { type: "travelTo", tile: 31 });
    expect(currentPlayer(s).position).toBe(31);
    expect(s.decision?.type).toBe("buy");
  });
});

describe("파산과 승리", () => {
  it("돈이 모자라면 땅을 팔아서 낸다", () => {
    const start = mutate(newGame(), (s) => {
      s.players[0].money = 0;
      s.tiles[1].owner = 0;
      s.tiles[2].owner = 1;
    });
    const s = roll(start, 1, 1);
    expect(s.tiles[1].owner).toBeNull();
    expect(s.players[0].money).toBe(Math.round(100 * RULES.sellRate) - Math.round(110 * RULES.rentRates[0]));
    expect(s.players[0].bankrupt).toBe(false);
    expect(s.events.some((e) => e.type === "sell")).toBe(true);
  });

  it("다 팔아도 모자라면 파산하고, 남은 돈은 받는 사람에게 간다", () => {
    const start = mutate(newGame(), (s) => {
      s.players[0].money = 3;
      s.tiles[2] = { owner: 1, level: 3 };
    });
    const s = roll(start, 1, 1);
    expect(s.players[0].bankrupt).toBe(true);
    expect(s.players[1].money).toBe(RULES.startMoney + 3);
    expect(s.phase).toBe("end");
    const next = dispatch(s, { type: "endTurn" });
    expect(next.current).toBe(1);
  });

  it("파산한 사람의 땅은 은행으로 돌아가고 차례에서 빠진다", () => {
    let s = mutate(newGame(), (st) => {
      st.players[1].bankrupt = true;
      st.tiles[5].owner = 1;
      st.phase = "end";
    });
    s = dispatch(s, { type: "endTurn" });
    expect(s.current).toBe(2);
  });

  it("한 명만 남으면 그 사람이 이긴다", () => {
    const start = mutate(newGame(2), (s) => {
      s.players[0].money = 0;
      s.tiles[2] = { owner: 1, level: 3 };
    });
    const s = roll(start, 1, 1);
    expect(s.phase).toBe("over");
    expect(s.winner).toBe(1);
    expect(legalActions(s)).toEqual([]);
  });

  it("재산은 돈과 땅값의 합이다", () => {
    const s = mutate(newGame(), (st) => {
      st.tiles[1].owner = 0;
      st.tiles[2] = { owner: 0, level: 2 };
    });
    expect(netWorth(s, 0)).toBe(RULES.startMoney + 100 + 110 + Math.round(110 * RULES.buildCostRate) * 2);
  });
});

describe("무작위로 끝까지 돌려도 규칙이 깨지지 않는다", () => {
  it("여러 시드로 시뮬레이션한다", () => {
    for (let seed = 1; seed <= 15; seed++) {
      let s = createGame(SETUPS, seed);
      let pick = seed * 7919;
      for (let step = 0; step < 2500 && s.phase !== "over"; step++) {
        const actions = legalActions(s);
        expect(actions.length).toBeGreaterThan(0);
        pick = (pick * 1103515245 + 12345) >>> 0;
        s = dispatch(s, actions[pick % actions.length]);

        for (const p of s.players) {
          expect(p.money).toBeGreaterThanOrEqual(0);
          expect(p.position).toBeGreaterThanOrEqual(0);
          expect(p.position).toBeLessThan(TILE_COUNT);
        }
        s.tiles.forEach((t, i) => {
          if (t.owner !== null) expect(s.players[t.owner].bankrupt).toBe(false);
          if (BOARD[i].type !== "city") expect(t.level).toBe(0);
        });
        if (s.phase === "roll") expect(s.players[s.current].bankrupt).toBe(false);
      }
    }
  }, 60000);
});
