import { createGame } from "../engine/game";
import type { Action, GameState, PlayerSetup } from "../engine/types";
import type { Db, Unsubscribe } from "./db";

export const SLOT_COUNT = 4;

export type SlotKind = "empty" | "human" | "ai";

/** 방의 자리 하나 */
export interface Slot {
  kind: SlotKind;
  name: string;
  /** 이 자리에 앉은 기기의 식별값 (사람만) */
  pid: string;
}

/** 게임이 시작될 때 정해지는 참가자 목록 (게임 안의 플레이어 번호 순서) */
export interface RosterEntry {
  slot: number;
  pid: string;
  kind: "human" | "ai";
  name: string;
}

export interface RoomMeta {
  hostPid: string;
  status: "lobby" | "playing" | "over";
  maxRounds: number;
  seed: number;
  createdAt: number;
  roster: RosterEntry[];
}

/** 폰에서 방 안에서 보내는 행동 하나 */
export interface ActionMessage {
  player: number;
  pid: string;
  action: Action;
}

const emptySlot = (): Slot => ({ kind: "empty", name: "", pid: "" });

const roomPath = (code: string): string => `rooms/${code}`;

/** 네 자리 숫자 방 코드 */
export function randomCode(random: () => number = Math.random): string {
  return String(1000 + Math.floor(random() * 9000));
}

function parseSlots(value: unknown): Slot[] {
  const raw = (value ?? {}) as Record<string, Partial<Slot>>;
  const list = Array.isArray(value) ? (value as Partial<Slot>[]) : Object.keys(raw).sort().map((k) => raw[k]);
  return Array.from({ length: SLOT_COUNT }, (_, i) => {
    const slot = list[i];
    return slot && slot.kind ? { kind: slot.kind, name: slot.name ?? "", pid: slot.pid ?? "" } : emptySlot();
  });
}

function parseMeta(value: unknown): RoomMeta | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<RoomMeta> & { roster?: unknown };
  const roster = Array.isArray(raw.roster) ? (raw.roster as RosterEntry[]) : Object.values((raw.roster ?? {}) as Record<string, RosterEntry>);
  return {
    hostPid: raw.hostPid ?? "",
    status: raw.status ?? "lobby",
    maxRounds: raw.maxRounds ?? 0,
    seed: raw.seed ?? 0,
    createdAt: raw.createdAt ?? 0,
    roster,
  };
}

/** 방을 만든다. 방장이 0번 자리에 앉는다. 만들어진 방 코드를 돌려준다. */
export async function createRoom(
  db: Db,
  hostPid: string,
  hostName: string,
  maxRounds: number,
  random: () => number = Math.random,
): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const code = randomCode(random);
    const result = await db.transaction(roomPath(code), (current) => {
      if (current !== null && current !== undefined) return undefined; // 이미 있는 코드
      return {
        meta: { hostPid, status: "lobby", maxRounds, seed: 0, createdAt: Date.now() },
        slots: [
          { kind: "human", name: hostName, pid: hostPid },
          emptySlot(),
          emptySlot(),
          emptySlot(),
        ],
      };
    });
    if (result.committed) return code;
  }
  throw new Error("방 코드를 만들지 못했어요. 잠시 뒤에 다시 해 보세요.");
}

export type JoinResult = { ok: true; slot: number } | { ok: false; reason: "notfound" | "started" | "full" };

/** 방에 들어간다. 같은 기기가 다시 들어오면 원래 자리로 돌아간다. */
export async function joinRoom(db: Db, code: string, pid: string, name: string): Promise<JoinResult> {
  const room = (await db.get(roomPath(code))) as { meta?: unknown; slots?: unknown } | null;
  const meta = parseMeta(room?.meta);
  if (!room || !meta) return { ok: false, reason: "notfound" };

  const slots = parseSlots(room.slots);
  const existing = slots.findIndex((s) => s.kind === "human" && s.pid === pid);
  if (existing >= 0) return { ok: true, slot: existing };
  if (meta.status !== "lobby") return { ok: false, reason: "started" };

  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    const result = await db.transaction(`${roomPath(code)}/slots/${slot}`, (current) => {
      const c = current as Partial<Slot> | null;
      if (c && c.kind && c.kind !== "empty") return undefined;
      return { kind: "human", name, pid } satisfies Slot;
    });
    if (result.committed) return { ok: true, slot };
  }
  return { ok: false, reason: "full" };
}

export function watchMeta(db: Db, code: string, callback: (meta: RoomMeta | null) => void): Unsubscribe {
  return db.onValue(`${roomPath(code)}/meta`, (value) => callback(parseMeta(value)));
}

export function watchSlots(db: Db, code: string, callback: (slots: Slot[]) => void): Unsubscribe {
  return db.onValue(`${roomPath(code)}/slots`, (value) => callback(parseSlots(value)));
}

/** 방장이 빈자리를 컴퓨터로 바꾸거나 되돌린다. 사람이 앉은 자리는 건드리지 않는다. */
export async function setSlotKind(db: Db, code: string, slot: number, kind: "empty" | "ai", aiName = ""): Promise<void> {
  await db.transaction(`${roomPath(code)}/slots/${slot}`, (current) => {
    const c = current as Partial<Slot> | null;
    if (c && c.kind === "human") return undefined;
    return kind === "ai" ? ({ kind: "ai", name: aiName || `컴퓨터${slot + 1}`, pid: "" } satisfies Slot) : emptySlot();
  });
}

/** 참가자가 방에서 나간다 (게임 시작 전에만). */
export async function leaveSlot(db: Db, code: string, slot: number, pid: string): Promise<void> {
  await db.transaction(`${roomPath(code)}/slots/${slot}`, (current) => {
    const c = current as Partial<Slot> | null;
    if (!c || c.pid !== pid) return undefined;
    return emptySlot();
  });
}

export async function deleteRoom(db: Db, code: string): Promise<void> {
  await db.remove(roomPath(code));
}

/** 방장이 게임을 시작한다: 참가자 목록을 정하고 첫 상태를 올린다. */
export async function startGame(
  db: Db,
  code: string,
  seed: number = Math.floor(Math.random() * 1_000_000) + 1,
): Promise<{ state: GameState; roster: RosterEntry[]; maxRounds: number } | null> {
  const room = (await db.get(roomPath(code))) as { meta?: unknown; slots?: unknown } | null;
  const meta = parseMeta(room?.meta);
  if (!room || !meta) return null;

  const slots = parseSlots(room.slots);
  const roster: RosterEntry[] = [];
  slots.forEach((slot, index) => {
    if (slot.kind === "empty") return;
    roster.push({ slot: index, pid: slot.pid, kind: slot.kind, name: slot.name });
  });
  if (roster.length < 2) return null;

  const setups: PlayerSetup[] = roster.map((r) => ({ name: r.name, kind: r.kind }));
  const state = createGame(setups, seed, { maxRounds: meta.maxRounds });
  await publishState(db, code, state);
  await db.set(`${roomPath(code)}/meta`, { ...meta, status: "playing", seed, roster });
  return { state, roster, maxRounds: meta.maxRounds };
}

export async function setStatus(db: Db, code: string, status: RoomMeta["status"]): Promise<void> {
  await db.set(`${roomPath(code)}/meta/status`, status);
}

// ---------------------------------------------------------------- 진행 중 주고받기

/** 방장이 새 상태를 모두에게 올린다. 상태는 글자 하나로 저장해서 배열·null이 깨지지 않게 한다. */
export async function publishState(db: Db, code: string, state: GameState): Promise<void> {
  await db.set(`${roomPath(code)}/state`, { seq: state.seq, json: JSON.stringify(state) });
}

export function watchState(db: Db, code: string, callback: (state: GameState) => void): Unsubscribe {
  return db.onValue(`${roomPath(code)}/state`, (value) => {
    const raw = value as { json?: string } | null;
    if (raw?.json) callback(JSON.parse(raw.json) as GameState);
  });
}

/** 참가자가 자기 차례에 한 행동을 방장에게 보낸다. */
export async function sendAction(db: Db, code: string, message: ActionMessage): Promise<void> {
  await db.push(`${roomPath(code)}/actions`, { player: message.player, pid: message.pid, json: JSON.stringify(message.action) });
}

export function watchActions(
  db: Db,
  code: string,
  callback: (key: string, message: ActionMessage) => void,
): Unsubscribe {
  return db.onChildAdded(`${roomPath(code)}/actions`, (key, value) => {
    const raw = value as { player?: number; pid?: string; json?: string } | null;
    if (!raw || typeof raw.player !== "number" || !raw.json) return;
    callback(key, { player: raw.player, pid: raw.pid ?? "", action: JSON.parse(raw.json) as Action });
  });
}

export async function removeAction(db: Db, code: string, key: string): Promise<void> {
  await db.remove(`${roomPath(code)}/actions/${key}`);
}
