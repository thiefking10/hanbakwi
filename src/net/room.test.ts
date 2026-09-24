import { describe, expect, it } from "vitest";
import { dispatch } from "../engine/game";
import type { GameState } from "../engine/types";
import { MemoryDb } from "./db";
import {
  createRoom,
  deleteRoom,
  joinRoom,
  leaveSlot,
  publishState,
  removeAction,
  sendAction,
  setSlotKind,
  startGame,
  watchActions,
  watchMeta,
  watchSlots,
  watchState,
  type ActionMessage,
  type RoomMeta,
  type Slot,
} from "./room";

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function newRoom(db = new MemoryDb()): Promise<{ db: MemoryDb; code: string }> {
  const code = await createRoom(db, "host-pid", "방장", 40);
  return { db, code };
}

describe("MemoryDb", () => {
  it("값을 쓰고 읽고 지운다", async () => {
    const db = new MemoryDb();
    await db.set("a/b/c", { x: 1 });
    expect(await db.get("a/b/c")).toEqual({ x: 1 });
    expect(await db.get("a/b")).toEqual({ c: { x: 1 } });
    await db.remove("a/b/c");
    expect(await db.get("a/b/c")).toBeNull();
  });

  it("바뀔 때마다 알려주고, 알림을 끊으면 더는 안 온다", async () => {
    const db = new MemoryDb();
    const seen: unknown[] = [];
    const stop = db.onValue("v", (value) => seen.push(value));
    await tick();
    await db.set("v", 1);
    await tick();
    await db.set("v", 2);
    await tick();
    stop();
    await db.set("v", 3);
    await tick();
    expect(seen).toEqual([null, 1, 2]);
  });

  it("자식 알림은 이미 있던 것과 새 것을 순서대로 한 번씩 준다", async () => {
    const db = new MemoryDb();
    await db.push("list", "a");
    const keys: string[] = [];
    const values: unknown[] = [];
    db.onChildAdded("list", (key, value) => {
      keys.push(key);
      values.push(value);
    });
    await tick();
    await db.push("list", "b");
    await tick();
    expect(values).toEqual(["a", "b"]);
    expect(new Set(keys).size).toBe(2);
  });

  it("트랜잭션은 undefined를 돌려주면 취소된다", async () => {
    const db = new MemoryDb();
    const first = await db.transaction("slot", (c) => (c === null ? "me" : undefined));
    const second = await db.transaction("slot", (c) => (c === null ? "you" : undefined));
    expect(first.committed).toBe(true);
    expect(second.committed).toBe(false);
    expect(await db.get("slot")).toBe("me");
  });
});

describe("방 만들기와 입장", () => {
  it("방을 만들면 방장이 0번 자리에 앉는다", async () => {
    const { db, code } = await newRoom();
    expect(code).toMatch(/^\d{4}$/);
    const slots: Slot[][] = [];
    watchSlots(db, code, (s) => slots.push(s));
    await tick();
    expect(slots[0][0]).toEqual({ kind: "human", name: "방장", pid: "host-pid" });
    expect(slots[0].slice(1).every((s) => s.kind === "empty")).toBe(true);
  });

  it("이미 있는 코드가 나오면 다른 코드를 찾는다", async () => {
    const db = new MemoryDb();
    const values = [0.0, 0.0, 0.5];
    const random = () => values.shift() ?? 0.9;
    const first = await createRoom(db, "a", "가", 40, random);
    const second = await createRoom(db, "b", "나", 40, random);
    expect(first).not.toBe(second);
  });

  it("참가자는 빈 자리에 차례로 앉고, 꽉 차면 못 들어온다", async () => {
    const { db, code } = await newRoom();
    expect(await joinRoom(db, code, "p1", "가")).toEqual({ ok: true, slot: 1 });
    expect(await joinRoom(db, code, "p2", "나")).toEqual({ ok: true, slot: 2 });
    expect(await joinRoom(db, code, "p3", "다")).toEqual({ ok: true, slot: 3 });
    expect(await joinRoom(db, code, "p4", "라")).toEqual({ ok: false, reason: "full" });
  });

  it("같은 기기가 다시 들어오면 원래 자리로 돌아온다", async () => {
    const { db, code } = await newRoom();
    await joinRoom(db, code, "p1", "가");
    expect(await joinRoom(db, code, "p1", "가")).toEqual({ ok: true, slot: 1 });
  });

  it("없는 방이거나 이미 시작한 방에는 들어갈 수 없다", async () => {
    const { db, code } = await newRoom();
    expect(await joinRoom(db, "9999", "p1", "가")).toEqual({ ok: false, reason: "notfound" });
    await joinRoom(db, code, "p1", "가");
    await startGame(db, code, 1);
    expect(await joinRoom(db, code, "late", "늦음")).toEqual({ ok: false, reason: "started" });
    expect(await joinRoom(db, code, "p1", "가")).toEqual({ ok: true, slot: 1 });
  });

  it("참가자가 나가면 자리가 비고, 방장은 컴퓨터를 앉힐 수 있다", async () => {
    const { db, code } = await newRoom();
    await joinRoom(db, code, "p1", "가");
    await leaveSlot(db, code, 1, "someone-else");
    let slots: Slot[] = [];
    watchSlots(db, code, (s) => (slots = s));
    await tick();
    expect(slots[1].kind).toBe("human");
    await leaveSlot(db, code, 1, "p1");
    await tick();
    expect(slots[1].kind).toBe("empty");

    await setSlotKind(db, code, 1, "ai");
    await tick();
    expect(slots[1].kind).toBe("ai");
    await joinRoom(db, code, "p2", "나");
    await tick();
    expect(slots[2].pid).toBe("p2");
    await setSlotKind(db, code, 2, "empty");
    await tick();
    expect(slots[2].kind).toBe("human");
  });

  it("방 정보 변화를 알려준다", async () => {
    const { db, code } = await newRoom();
    const metas: (RoomMeta | null)[] = [];
    watchMeta(db, code, (m) => metas.push(m));
    await tick();
    expect(metas[0]?.status).toBe("lobby");
    expect(metas[0]?.maxRounds).toBe(40);
    await joinRoom(db, code, "p1", "가");
    await startGame(db, code, 7);
    await tick();
    expect(metas[metas.length - 1]?.status).toBe("playing");
    await deleteRoom(db, code);
    await tick();
    expect(metas[metas.length - 1]).toBeNull();
  });
});

describe("게임 시작과 진행", () => {
  it("혼자서는 시작할 수 없고, 컴퓨터를 앉히면 시작한다", async () => {
    const { db, code } = await newRoom();
    expect(await startGame(db, code, 1)).toBeNull();
    await setSlotKind(db, code, 2, "ai");
    const started = await startGame(db, code, 1);
    expect(started?.roster.map((r) => [r.slot, r.kind])).toEqual([[0, "human"], [2, "ai"]]);
    expect(started?.state.players.map((p) => p.kind)).toEqual(["human", "ai"]);
    expect(started?.state.maxRounds).toBe(40);
  });

  it("방장이 올린 상태를 참가자가 그대로 받는다", async () => {
    const { db, code } = await newRoom();
    await joinRoom(db, code, "p1", "가");
    const started = await startGame(db, code, 3);
    let received: GameState | null = null;
    watchState(db, code, (s) => (received = s));
    await tick();
    expect(received).toEqual(started?.state);

    const next = dispatch(started?.state as GameState, { type: "roll" });
    await publishState(db, code, next);
    await tick();
    expect((received as GameState | null)?.seq).toBe(next.seq);
    expect(received).toEqual(next);
  });

  it("참가자의 행동이 방장에게 순서대로 전달되고, 처리하면 지워진다", async () => {
    const { db, code } = await newRoom();
    const got: ActionMessage[] = [];
    const keys: string[] = [];
    watchActions(db, code, (key, message) => {
      keys.push(key);
      got.push(message);
    });
    await sendAction(db, code, { player: 1, pid: "p1", action: { type: "roll" } });
    await sendAction(db, code, { player: 1, pid: "p1", action: { type: "travelTo", tile: 12 } });
    await tick();
    expect(got.map((m) => m.action)).toEqual([{ type: "roll" }, { type: "travelTo", tile: 12 }]);
    expect(got[0].pid).toBe("p1");
    await removeAction(db, code, keys[0]);
    expect(await db.get(`rooms/${code}/actions/${keys[0]}`)).toBeNull();
  });
});
