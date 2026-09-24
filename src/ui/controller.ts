import { chooseAction, type AiStyle } from "../ai/ai";
import { BOARD, RULES } from "../engine/board";
import { eulReul } from "../engine/josa";
import { createGame, currentPlayer, dispatch, legalActions } from "../engine/game";
import type { Action, GameEvent, GameState, GameOptions, PlayerSetup } from "../engine/types";
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

/** 한 판을 진행한다: 화면 그리기, 사람의 선택 기다리기, AI 차례, 사건 애니메이션. */
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
  private readonly shake = new ShakeDetector();

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

  start(setups: PlayerSetup[], options: GameOptions, seed = Math.floor(Math.random() * 1_000_000) + 1): void {
    // 소리와 흔들기 센서는 사용자가 화면을 누른 순간에만 켤 수 있다 (start는 시작 버튼을 누를 때 불린다).
    audio.unlock();
    void this.shake.enable();
    this.runId += 1;
    this.state = createGame(setups, seed, options);
    this.styles = setups.map((_, i) => (i % 2 === 0 ? "bold" : "careful"));
    this.board.setPlayers(setups.length);
    this.dice.forEach((die) => (die.textContent = DIE_FACES[1]));
    this.refresh();
    void this.loop(this.runId);
  }

  stop(): void {
    this.runId += 1;
    this.onExit();
  }

  /** 개발용: 화면 밖에서 현재 상태를 볼 수 있게 한다. */
  get debugState(): GameState {
    return this.state;
  }

  // ---------------------------------------------------------------- 진행

  private delay(ms: number): Promise<void> {
    return sleep(this.fast ? ms * 0.35 : ms);
  }

  private refresh(): void {
    this.board.render(this.state);
    this.hud.update(this.state);
    const s = this.state;
    this.board.highlight(s.phase === "over" ? null : currentPlayer(s).position);
  }

  private async loop(id: number): Promise<void> {
    while (id === this.runId) {
      const s = this.state;
      if (s.phase === "over") {
        this.info.replaceChildren();
        this.actions.replaceChildren();
        await this.delay(700);
        if (id === this.runId) this.showResult();
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
      } else {
        const action = await this.askHuman(s);
        if (id !== this.runId) return;
        await this.apply(id, action);
      }
    }
  }

  private async apply(id: number, action: Action): Promise<void> {
    const next = dispatch(this.state, action);
    if (next === this.state) return;
    this.state = next;
    await this.play(id, next.events);
    if (id === this.runId) this.refresh();
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

  private askHuman(s: GameState): Promise<Action> {
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
  private choose(lines: string[], buttons: Choice[], options: { space?: Action; picking?: boolean } = {}): Promise<Action> {
    return new Promise((resolve) => {
      const onKey = (e: KeyboardEvent): void => {
        if (e.code === "Space" && options.space) finish(options.space);
      };
      const finish = (action: Action): void => {
        window.removeEventListener("keydown", onKey);
        this.shake.onShake = null;
        this.travelPick = null;
        this.board.setPickable(false);
        this.info.replaceChildren();
        this.actions.replaceChildren();
        resolve(action);
      };

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
