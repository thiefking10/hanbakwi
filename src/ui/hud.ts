import { netWorth } from "../engine/game";
import type { GameState } from "../engine/types";
import { el } from "./dom";
import { PLAYER_COLORS } from "./theme";

/** 오른쪽 안내판: 바퀴 수, 플레이어 카드, 최근 기록, 속도 버튼. */
export class Hud {
  readonly root = el("div", { class: "hud" });
  private readonly round = el("div", { class: "hud-round" });
  private readonly cards = el("div", { class: "hud-cards" });
  private readonly log = el("div", { class: "hud-log" });
  readonly speedButton = el("button", { class: "small-button", text: "⏩ 빠르게" });
  readonly soundButton = el("button", { class: "small-button", text: "🔊" });
  readonly menuButton = el("button", { class: "small-button", text: "☰ 그만하기" });

  constructor() {
    const tools = el("div", { class: "hud-tools" }, [this.speedButton, this.soundButton, this.menuButton]);
    this.root.append(this.round, this.cards, this.log, tools);
  }

  update(state: GameState): void {
    this.round.textContent = state.maxRounds > 0 ? `${Math.min(state.round, state.maxRounds)} / ${state.maxRounds}바퀴` : `${state.round}바퀴`;

    this.cards.replaceChildren();
    for (const player of state.players) {
      const owned = state.tiles.filter((t) => t.owner === player.id).length;
      const card = el("div", { class: "pcard" });
      card.classList.toggle("current", state.current === player.id && state.phase !== "over");
      card.classList.toggle("out", player.bankrupt);
      const dot = el("span", { class: "pdot" });
      dot.style.background = PLAYER_COLORS[player.id];
      const name = el("span", { class: "pname", text: player.name + (player.kind === "ai" ? " 🤖" : "") });
      const status = player.bankrupt ? "파산" : player.inIsland ? "무인도" : "";
      const top = el("div", { class: "pcard-top" }, [dot, name, el("span", { class: "pstatus", text: status })]);
      const money = el("div", {
        class: "pmoney",
        text: player.bankrupt ? "—" : `💰 ${player.money.toLocaleString("ko-KR")}만 · 땅 ${owned} · 재산 ${netWorth(state, player.id).toLocaleString("ko-KR")}만`,
      });
      card.append(top, money);
      this.cards.append(card);
    }

    this.log.replaceChildren();
    for (const line of state.log.slice(-5)) this.log.append(el("div", { class: "log-line", text: line }));
    this.log.scrollTop = this.log.scrollHeight;
  }
}
