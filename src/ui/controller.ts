import { chooseAction, type AiStyle } from "../ai/ai";
import { BOARD, RULES } from "../engine/board";
import { createGame, currentPlayer, dispatch, isLegal, legalActions } from "../engine/game";
import { eulReul } from "../engine/josa";
import type { Action, GameEvent, GameOptions, GameState, PlayerSetup } from "../engine/types";
import type { Db, Unsubscribe } from "../net/db";
import {
  deleteRoom,
  publishState,
  removeAction,
  sendAction,
  setStatus,
  watchActions,
  watchMeta,
  watchState,
  type ActionMessage,
  type RosterEntry,
} from "../net/room";
import { audio } from "./audio";
import { BoardView } from "./boardView";
import { el, sleep } from "./dom";
import { Hud } from "./hud";
import { buildResultScreen } from "./screens";
import { ShakeDetector } from "./shake";
import { describeTile } from "./tileInfo";
import { DIE_FACES, LEVEL_NAMES } from "./theme";

interface Choice {
  label: string;
  action: Action;
  primary?: boolean;
}

/** 온라인 판에서 이 기기의 역할 */
export interface OnlineSession {
  db: Db;
  code: string;
  pid: string;
  role: "host" | "client";
  /** 이 기기 사람의 게임 안 플레이어 번호 */
  myIndex: number;
  roster: RosterEntry[];
}

/** 기다리는 사람이 이 시간(밀리초) 동안 안 움직이면 방장이 컴퓨터로 대신하게 할 수 있다. */
const IDLE_TAKEOVER_MS = 30_000;

/**
 * 한 판을 진행한다: 화면 그리기, 사람의 선택 기다리기, AI 차례, 사건 애니메이션.
 * - 혼자/한 폰(local): 이 기기가 규칙을 처리하고 사람 자리는 모두 이 화면에서 고른다.
 * - 온라인 방장(host): 규칙을 처리하고 새 상태를 모두에게 올린다. 다른 사람의 행동은 받아서 처리한다.
 * - 온라인 참가자(client): 올라온 상태를 받아 보여주고, 내 차례에만 행동을 방장에게 보낸다.
 */
export class GameController {
  readonly root = el("div", { class: "game" });
  private readonly board: BoardView;
  private readonly hud = new Hud();
  private readonly banner = el("div", { class: "c-banner" });
  private readonly dice = [el("span", { class: "die", text: DIE_FACES[1] }), el("span", { class: "die", text: DIE_FACES[1] })];
  private readonly info = el("div", { class: "c-info" });
  private readonly actions = el("div", { class: "c-actions" });

  private state!: GameState;
  private styles: AiStyle[] = [];
  private runId = 0;
  private fast = false;
  private travelPick: ((tile: number) => void) | null = null;
  private cancelChoice: (() => void) | null = null;
  private readonly shake = new ShakeDetector();

  private session: OnlineSession | null = null;
  private readonly unsubscribes: Unsubscribe[] = [];
  private inbox: { key: string; message: ActionMessage }[] = [];
  private remoteWaiter: (() => void) | null = null;
  private presentQueue: Promise<void> = Promise.resolve();

  constructor(private readonly onExit: () => void) {
    this.board = new BoardView((index) => this.onTileTap(index));
    const diceBox = el("div", { class: "c-dice" }, this.dice);
    this.board.center.append(this.banner, diceBox, this.info, this.actions);
    this.root.append(this.board.root, this.hud.root);

    this.hud.speedButton.addEventListener("click", () => {
      this.fast = !this.fast;
      this.hud.speedButton.textContent = this.fast ? "▶ 보통 속도" : "⏩ 빠르게";
    });
    this.hud.soundButton.addEventListener("click", () => {
      audio.enabled = !audio.enabled;
      this.hud.soundButton.textContent = audio.enabled ? "🔊" : "🔇";
    });
    this.hud.menuButton.addEventListener("click", () => {
      if (window.confirm("게임을 그만하고 처음 화면으로 돌아갈까요?")) this.stop();
    });
  }

  // ---------------------------------------------------------------- 시작과 끝

  /** 혼자/한 폰으로 시작한다. */
  start(setups: PlayerSetup[], options: GameOptions, seed = Math.floor(Math.random() * 1_000_000) + 1): void {
    this.boot(createGame(setups, seed, options));
    void this.loop(this.runId);
  }

  /** 온라인 판에 들어온다. 방장은 규칙을 진행하고, 참가자는 올라오는 상태를 보여준다. */
  startOnline(session: OnlineSession, state: GameState): void {
    this.session = session;
    this.boot(state);
    if (session.role === "host") {
      this.unsubscribes.push(watchActions(session.db, session.code, (key, message) => this.receiveRemote(key, message)));
      void this.loop(this.runId);
    } else {
      this.unsubscribes.push(watchState(session.db, session.code, (next) => this.enqueuePresent(next)));
      this.unsubscribes.push(
        watchMeta(session.db, session.code, (meta) => {
          if (meta === null) {
            window.alert("방장이 방을 닫았어요.");
            this.stop();
          }
        }),
      );
      // 처음 상태에서 내 차례로 시작하는 경우도 있으니 한 번 그려 준다.
      this.state = { ...state, seq: state.seq - 1 };
    }
  }

  private boot(state: GameState): void {
    // 소리와 흔들기 센서는 사용자가 화면을 누른 순간에만 켤 수 있다 (시작 버튼을 누를 때 불린다).
    audio.unlock();
    void this.shake.enable();
    this.runId += 1;
    this.state = state;
    this.styles = state.players.map((_, i) => (i % 2 === 0 ? "bold" : "careful"));
    this.board.setPlayers(state.players.length);
    state.players.forEach((p, i) => this.board.jumpToken(i, p.position));
    this.dice.forEach((die) => (die.textContent = DIE_FACES[1]));
    this.refresh();
  }

  stop(): void {
    this.runId += 1;
    this.cancelChoice?.();
    for (const unsubscribe of this.unsubscribes.splice(0)) unsubscribe();
    const session = this.session;
    if (session?.role === "host") void deleteRoom(session.db, session.code);
    this.onExit();
  }

  /** 개발용: 화면 밖에서 현재 상태를 볼 수 있게 한다. */
  get debugState(): GameState {
    return this.state;
  }

  // ---------------------------------------------------------------- 진행 (혼자/방장)

  private delay(ms: number): Promise<void> {
    return sleep(this.fast ? ms * 0.35 : ms);
  }

  private refresh(): void {
    this.board.render(this.state);
    this.hud.update(this.state);
    const s = this.state;
    this.board.highlight(s.phase === "over" ? null : currentPlayer(s).position);
  }

  /** 이 기기 화면에서 직접 고르는 사람 자리인지 */
  private isHere(playerIndex: number): boolean {
    const player = this.state.players[playerIndex];
    if (player.kind !== "human") return false;
    return this.session ? playerIndex === this.session.myIndex : true;
  }

  private async loop(id: number): Promise<void> {
    while (id === this.runId) {
      const s = this.state;
      if (s.phase === "over") {
        await this.finishGame(id);
        return;
      }
      const player = currentPlayer(s);

      if (s.phase === "end") {
        this.actions.replaceChildren();
        await this.delay(500);
        await this.apply(id, { type: "endTurn" });
        continue;
      }

      if (s.phase === "roll") this.setBanner(`${player.name}님의 차례`);

      if (player.kind === "ai") {
        this.info.replaceChildren(el("div", { text: "🤖 생각 중…" }));
        this.actions.replaceChildren();
        await this.delay(650);
        if (id !== this.runId) return;
        await this.apply(id, chooseAction(s, this.styles[player.id]));
      } else if (this.isHere(player.id)) {
        const action = await this.askHuman(s);
        if (id !== this.runId) return;
        if (action) await this.apply(id, action);
      } else {
        const action = await this.waitRemote(player.id);
        if (id !== this.runId) return;
        if (action === "takeover") {
          this.takeover(player.id);
          continue;
        }
        await this.apply(id, action);
      }
    }
  }

  private async apply(id: number, action: Action): Promise<void> {
    const next = dispatch(this.state, action);
    if (next === this.state) return;
    this.state = next;
    if (this.session?.role === "host") {
      void publishState(this.session.db, this.session.code, next);
    }
    await this.play(id, next.events);
    if (id === this.runId) this.refresh();
  }

  private async finishGame(id: number): Promise<void> {
    this.info.replaceChildren();
    this.actions.replaceChildren();
    if (this.session?.role === "host") void setStatus(this.session.db, this.session.code, "over");
    await this.delay(700);
    if (id === this.runId) this.showResult();
  }

  // ---------------------------------------------------------------- 온라인: 방장이 받는 쪽

  private receiveRemote(key: string, message: ActionMessage): void {
    const session = this.session;
    if (!session) return;
    void removeAction(session.db, session.code, key);
    this.inbox.push({ key, message });
    this.remoteWaiter?.();
  }

  /** 받아 둔 행동 중, 지금 이 사람의 차례에 맞는 것을 꺼낸다. */
  private takeValidRemote(playerIndex: number): Action | null {
    const session = this.session;
    if (!session) return null;
    while (this.inbox.length > 0) {
      const { message } = this.inbox.shift() as { key: string; message: ActionMessage };
      const entry = session.roster[message.player];
      if (message.player !== playerIndex || !entry || entry.pid !== message.pid) continue;
      if (isLegal(this.state, message.action)) return message.action;
    }
    return null;
  }

  /** 다른 기기의 사람이 행동을 보낼 때까지 기다린다. 너무 오래 걸리면 컴퓨터로 대신할 수 있다. */
  private waitRemote(playerIndex: number): Promise<Action | "takeover"> {
    const name = this.state.players[playerIndex].name;
    this.info.replaceChildren(el("div", { text: `⏳ ${name}님을 기다리는 중…` }));
    this.actions.replaceChildren();
    return new Promise((resolve) => {
      const startedRunId = this.runId;
      const cleanup = (): void => {
        this.remoteWaiter = null;
        window.clearTimeout(idleTimer);
        this.actions.replaceChildren();
      };
      const check = (): void => {
        if (startedRunId !== this.runId) {
          cleanup();
          return;
        }
        const action = this.takeValidRemote(playerIndex);
        if (action) {
          cleanup();
          resolve(action);
        }
      };
      const idleTimer = window.setTimeout(() => {
        const button = el("button", { class: "ghost-button", text: `컴퓨터가 ${name}님 대신 하기` });
        button.addEventListener("click", () => {
          cleanup();
          resolve("takeover");
        });
        this.actions.replaceChildren(button);
      }, IDLE_TAKEOVER_MS);
      this.remoteWaiter = check;
      check();
    });
  }

  /** 오래 응답이 없는 사람 자리를 컴퓨터로 바꾼다 (방장만). */
  private takeover(playerIndex: number): void {
    const next = structuredClone(this.state);
    next.players[playerIndex].kind = "ai";
    next.seq += 1;
    next.log.push(`${next.players[playerIndex].name}님 대신 컴퓨터가 이어서 해요.`);
    next.events = [];
    this.state = next;
    if (this.session) void publishState(this.session.db, this.session.code, next);
    this.refresh();
  }

  // ---------------------------------------------------------------- 온라인: 참가자가 받는 쪽

  private enqueuePresent(next: GameState): void {
    const id = this.runId;
    this.presentQueue = this.presentQueue.then(() => this.present(id, next)).catch(() => undefined);
  }

  /** 방장이 올린 새 상태를 화면에 보여준다. 바로 다음 상태면 애니메이션으로, 놓친 것이 있으면 바로 맞춘다. */
  private async present(id: number, next: GameState): Promise<void> {
    if (id !== this.runId) return;
    const previous = this.state;
    if (next.seq === previous.seq) return;
    this.cancelChoice?.();

    this.state = next;
    if (next.seq === previous.seq + 1 && next.events.length > 0) {
      await this.play(id, next.events);
    } else {
      next.players.forEach((p, i) => this.board.jumpToken(i, p.position));
    }
    if (id !== this.runId) return;
    this.refresh();

    if (next.phase === "over") {
      await this.finishGame(id);
      return;
    }
    const me = this.session?.myIndex ?? -1;
    if (next.phase === "roll") this.setBanner(`${currentPlayer(next).name}님의 차례`);
    if (next.phase !== "end" && next.current === me && next.players[me].kind === "human") {
      void this.askHuman(next).then((action) => {
        if (action && id === this.runId && this.state.seq === next.seq) this.sendMine(action);
      });
    } else if (next.phase !== "end") {
      const who = currentPlayer(next);
      this.info.replaceChildren(el("div", { text: `${who.kind === "ai" ? "🤖 " : "⏳ "}${who.name}님이 하는 중…` }));
      this.actions.replaceChildren();
    }
  }

  private sendMine(action: Action): void {
    const session = this.session;
    if (!session) return;
    void sendAction(session.db, session.code, { player: session.myIndex, pid: session.pid, action });
  }

  // ---------------------------------------------------------------- 사건 보여주기

  private setBanner(text: string): void {
    this.banner.textContent = text;
  }

  private async rollDiceAnimation(final: [number, number]): Promise<void> {
    this.info.replaceChildren();
    this.actions.replaceChildren();
    this.dice.forEach((die) => die.classList.add("rolling"));
    const end = performance.now() + (this.fast ? 250 : 700);
    while (performance.now() < end) {
      this.dice.forEach((die) => (die.textContent = DIE_FACES[1 + Math.floor(Math.random() * 6)]));
      await sleep(70);
    }
    this.dice.forEach((die, i) => {
      die.classList.remove("rolling");
      die.textContent = DIE_FACES[final[i]];
    });
    await this.delay(350);
  }

  private async play(id: number, events: GameEvent[]): Promise<void> {
    for (const event of events) {
      if (id !== this.runId) return;
      if (event.type === "turn") continue;
      if (event.type === "roll" && event.dice) {
        audio.dice();
        await this.rollDiceAnimation(event.dice);
        continue;
      }
      if (event.type === "move" && event.to !== undefined) {
        await this.board.walkToken(event.player, event.to, this.fast ? 40 : 130, () => audio.step());
        continue;
      }
      this.setBanner(event.text);
      this.refresh();
      this.playSound(event);
      await this.delay(event.type === "info" ? 500 : 750);
    }
  }

  private playSound(event: GameEvent): void {
    switch (event.type) {
      case "buy":
      case "salary":
      case "rest":
        audio.coin();
        break;
      case "build":
        audio.build();
        break;
      case "rent":
      case "tax":
      case "sell":
        audio.pay();
        break;
      case "card":
        audio.card();
        break;
      case "island":
      case "bankrupt":
        audio.bad();
        break;
      case "gameover":
        audio.fanfare();
        break;
    }
  }

  // ---------------------------------------------------------------- 사람의 선택

  /** 사람이 고를 수 있는 선택지를 보여주고 결과를 기다린다. 도중에 취소되면 null. */
  private askHuman(s: GameState): Promise<Action | null> {
    const player = currentPlayer(s);
    const legal = legalActions(s);
    const has = (type: Action["type"]) => legal.some((a) => a.type === type);

    if (s.phase === "roll") {
      const buttons: Choice[] = [{ label: "🎲 주사위 굴리기", action: { type: "roll" }, primary: true }];
      if (has("payFine")) buttons.push({ label: `벌금 ${RULES.islandFine}만원 내고 나가기`, action: { type: "payFine" } });
      const lines = player.inIsland ? ["무인도에 갇혔어요! 더블이 나오면 탈출해요."] : [];
      if (this.shake.hasSensor) lines.push("📳 폰을 흔들어서 굴려도 돼요!");
      return this.choose(lines, buttons, { space: { type: "roll" } });
    }

    const decision = s.decision;
    if (s.phase === "decide" && decision) {
      if (decision.type === "buy") {
        const { title, lines } = describeTile(decision.tile, s);
        return this.choose(
          [`📍 ${title}`, ...lines.slice(0, 2)],
          [
            { label: `사기 (${decision.price}만원)`, action: { type: "buy" }, primary: true },
            { label: "넘기기", action: { type: "skip" } },
          ],
        );
      }
      if (decision.type === "build") {
        const name = BOARD[decision.tile].name;
        return this.choose(
          [`🏗️ ${name}에 ${eulReul(LEVEL_NAMES[decision.level])} 지을까요?`],
          [
            { label: `짓기 (${decision.cost}만원)`, action: { type: "build" }, primary: true },
            { label: "넘기기", action: { type: "skip" } },
          ],
        );
      }
      return this.choose(["🌏 세계여행! 가고 싶은 칸을 판에서 눌러 보세요."], [{ label: "안 갈래요", action: { type: "skip" } }], {
        picking: true,
      });
    }
    return Promise.resolve({ type: "endTurn" });
  }

  /** 안내 글과 버튼을 보여주고, 사람이 하나를 고를 때까지 기다린다. */
  private choose(lines: string[], buttons: Choice[], options: { space?: Action; picking?: boolean } = {}): Promise<Action | null> {
    this.cancelChoice?.();
    return new Promise((resolve) => {
      const onKey = (e: KeyboardEvent): void => {
        if (e.code === "Space" && options.space) finish(options.space);
      };
      const finish = (action: Action | null): void => {
        window.removeEventListener("keydown", onKey);
        this.shake.onShake = null;
        this.travelPick = null;
        this.cancelChoice = null;
        this.board.setPickable(false);
        this.info.replaceChildren();
        this.actions.replaceChildren();
        resolve(action);
      };
      this.cancelChoice = () => finish(null);

      this.info.replaceChildren(...lines.map((line) => el("div", { text: line })));
      this.actions.replaceChildren();
      for (const choice of buttons) {
        const button = el("button", { class: choice.primary ? "big-button" : "ghost-button", text: choice.label });
        button.addEventListener("click", () => finish(choice.action));
        this.actions.append(button);
      }
      if (options.space) {
        window.addEventListener("keydown", onKey);
        const space = options.space;
        this.shake.onShake = () => finish(space);
      }
      if (options.picking) {
        this.board.setPickable(true, currentPlayer(this.state).position);
        this.travelPick = (tile) => finish({ type: "travelTo", tile });
      }
    });
  }

  // ---------------------------------------------------------------- 칸 눌러 보기

  private onTileTap(index: number): void {
    if (this.travelPick && index !== currentPlayer(this.state).position) {
      this.travelPick(index);
      return;
    }
    const { title, lines } = describeTile(index, this.state ?? null);
    const overlay = el("div", { class: "overlay" });
    const box = el("div", { class: "modal" }, [
      el("div", { class: "modal-title", text: title }),
      ...lines.map((line) => el("div", { class: "modal-line", text: line })),
    ]);
    const close = el("button", { class: "ghost-button", text: "닫기" });
    close.addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });
    box.append(close);
    overlay.append(box);
    this.root.append(overlay);
  }

  private showResult(): void {
    this.root.append(buildResultScreen(this.state, () => this.stop()));
  }
}
