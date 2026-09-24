import { RULES } from "../engine/board";
import { netWorth } from "../engine/game";
import type { GameState, PlayerSetup } from "../engine/types";
import { el } from "./dom";
import { GAME_LENGTHS } from "./lengths";
import { PLAYER_COLORS, PLAYER_COLOR_NAMES } from "./theme";

type SlotKind = "human" | "ai" | "none";

export interface SetupResult {
  setups: PlayerSetup[];
  maxRounds: number;
}

/** 시작 화면: 플레이어 자리 4개(사람/컴퓨터/없음)와 게임 길이를 고른다. */
export function buildSetupScreen(onStart: (result: SetupResult) => void): HTMLElement {
  const kinds: SlotKind[] = ["human", "ai", "ai", "ai"];
  const names = ["", "", "", ""];
  let rounds = RULES.maxRounds;

  const root = el("div", { class: "screen setup" });
  root.append(el("div", { class: "title", text: "한 바퀴 여행" }));
  root.append(el("div", { class: "subtitle", text: "도시를 사고, 건물을 짓고, 통행료를 모아 1등이 되어 보세요!" }));

  const slotsBox = el("div", { class: "slots" });
  const startButton = el("button", { class: "big-button", text: "시작하기" });

  const defaultName = (i: number): string => (kinds[i] === "human" ? `플레이어${i + 1}` : `컴퓨터${i + 1}`);

  const renderSlots = (): void => {
    slotsBox.replaceChildren();
    kinds.forEach((kind, i) => {
      const slot = el("div", { class: "slot" });
      const dot = el("span", { class: "pdot big" });
      dot.style.background = PLAYER_COLORS[i];
      dot.title = PLAYER_COLOR_NAMES[i];

      const input = el("input", { class: "name-input", attrs: { type: "text", maxlength: "8", placeholder: defaultName(i) } });
      input.value = names[i];
      input.disabled = kind === "none";
      input.addEventListener("input", () => {
        names[i] = input.value;
      });

      const toggle = el("button", { class: "kind-button", text: kind === "human" ? "사람" : kind === "ai" ? "컴퓨터" : "없음" });
      toggle.classList.add(`kind-${kind}`);
      toggle.addEventListener("click", () => {
        const order: SlotKind[] = ["human", "ai", "none"];
        kinds[i] = order[(order.indexOf(kind) + 1) % order.length];
        renderSlots();
      });
      slot.append(dot, toggle, input);
      slotsBox.append(slot);
    });
    const active = kinds.filter((k) => k !== "none").length;
    startButton.disabled = active < 2;
    startButton.textContent = active < 2 ? "2명 이상 골라 주세요" : "시작하기";
  };

  const lengthBox = el("div", { class: "lengths" });
  const renderLengths = (): void => {
    lengthBox.replaceChildren();
    for (const option of GAME_LENGTHS) {
      const button = el("button", { class: "chip", text: option.label });
      button.classList.toggle("selected", option.rounds === rounds);
      button.addEventListener("click", () => {
        rounds = option.rounds;
        renderLengths();
      });
      lengthBox.append(button);
    }
  };

  startButton.addEventListener("click", () => {
    const setups: PlayerSetup[] = [];
    kinds.forEach((kind, i) => {
      if (kind === "none") return;
      setups.push({ name: names[i].trim() || defaultName(i), kind });
    });
    onStart({ setups, maxRounds: rounds });
  });

  root.append(slotsBox, lengthBox, startButton);
  root.append(el("div", { class: "hint", text: "사람 자리가 여러 개면 한 폰을 돌려가며 해요." }));
  renderSlots();
  renderLengths();
  return root;
}

/** 결과 화면: 승자와 재산 순위. */
export function buildResultScreen(state: GameState, onAgain: () => void): HTMLElement {
  const root = el("div", { class: "overlay" });
  const box = el("div", { class: "modal result" });
  const winner = state.winner !== null ? state.players[state.winner] : null;
  box.append(el("div", { class: "title small", text: winner ? `🏆 ${winner.name}님 우승!` : "게임 끝" }));

  const ranking = state.players
    .map((p) => ({ p, worth: netWorth(state, p.id) }))
    .sort((a, b) => b.worth - a.worth);
  ranking.forEach(({ p, worth }, i) => {
    const row = el("div", { class: "rank-row" });
    const dot = el("span", { class: "pdot" });
    dot.style.background = PLAYER_COLORS[p.id];
    row.append(
      el("span", { class: "rank-no", text: `${i + 1}` }),
      dot,
      el("span", { class: "rank-name", text: p.name + (p.kind === "ai" ? " 🤖" : "") }),
      el("span", { class: "rank-worth", text: p.bankrupt ? "파산" : `${worth.toLocaleString("ko-KR")}만원` }),
    );
    box.append(row);
  });
  const again = el("button", { class: "big-button", text: "다시 하기" });
  again.addEventListener("click", onAgain);
  box.append(again);
  root.append(box);
  return root;
}
