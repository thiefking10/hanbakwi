import { RULES } from "../engine/board";
import type { RoomMeta, Slot } from "../net/room";
import { el } from "./dom";
import { GAME_LENGTHS } from "./lengths";
import { PLAYER_COLORS } from "./theme";

/** 처음 메뉴: 한 폰으로 / 방 만들기 / 방 들어가기 */
export function buildMenu(options: {
  onLocal: () => void;
  onCreate: () => void;
  onJoin: () => void;
  onlineReady: boolean;
}): HTMLElement {
  const root = el("div", { class: "screen setup" });
  root.append(el("div", { class: "title", text: "한 바퀴 여행" }));
  root.append(el("div", { class: "subtitle", text: "도시를 사고, 건물을 짓고, 통행료를 모아 1등이 되어 보세요!" }));

  const local = el("button", { class: "big-button wide", text: "🤖 한 폰으로 하기 (컴퓨터와 함께)" });
  local.addEventListener("click", options.onLocal);
  const create = el("button", { class: "big-button wide alt", text: "🏠 방 만들기 (친구와 각자 폰으로)" });
  create.addEventListener("click", options.onCreate);
  const join = el("button", { class: "big-button wide alt", text: "🔑 방 들어가기 (코드 입력)" });
  join.addEventListener("click", options.onJoin);
  create.disabled = !options.onlineReady;
  join.disabled = !options.onlineReady;

  root.append(local, create, join);
  if (!options.onlineReady) {
    root.append(el("div", { class: "hint", text: "온라인 기능은 아직 준비 중이에요. (Firebase 설정이 필요해요)" }));
  }
  return root;
}

/** 방 만들기: 내 이름과 게임 길이 */
export function buildCreateScreen(
  savedName: string,
  onCreate: (name: string, maxRounds: number) => void,
  onBack: () => void,
): HTMLElement {
  let rounds = RULES.maxRounds;
  const root = el("div", { class: "screen setup" });
  root.append(el("div", { class: "title small", text: "방 만들기" }));

  const input = el("input", { class: "name-input wide-input", attrs: { type: "text", maxlength: "8", placeholder: "내 이름" } });
  input.value = savedName;

  const lengthBox = el("div", { class: "lengths" });
  const renderLengths = (): void => {
    lengthBox.replaceChildren();
    for (const option of GAME_LENGTHS) {
      const chip = el("button", { class: "chip", text: option.label });
      chip.classList.toggle("selected", option.rounds === rounds);
      chip.addEventListener("click", () => {
        rounds = option.rounds;
        renderLengths();
      });
      lengthBox.append(chip);
    }
  };
  renderLengths();

  const create = el("button", { class: "big-button", text: "방 만들기" });
  create.addEventListener("click", () => onCreate(input.value.trim() || "방장", rounds));
  const back = el("button", { class: "ghost-button", text: "뒤로" });
  back.addEventListener("click", onBack);

  root.append(input, lengthBox, el("div", { class: "row" }, [back, create]));
  return root;
}

/** 방 들어가기: 4자리 코드와 내 이름 */
export function buildJoinScreen(
  savedName: string,
  onJoin: (code: string, name: string) => void,
  onBack: () => void,
): { root: HTMLElement; showError: (message: string) => void } {
  const root = el("div", { class: "screen setup" });
  root.append(el("div", { class: "title small", text: "방 들어가기" }));

  const code = el("input", {
    class: "name-input wide-input code-input",
    attrs: { type: "text", inputmode: "numeric", maxlength: "4", placeholder: "방 코드 4자리" },
  });
  const name = el("input", { class: "name-input wide-input", attrs: { type: "text", maxlength: "8", placeholder: "내 이름" } });
  name.value = savedName;
  const error = el("div", { class: "error", text: "" });

  const join = el("button", { class: "big-button", text: "들어가기" });
  join.addEventListener("click", () => {
    const value = code.value.trim();
    if (!/^\d{4}$/.test(value)) {
      error.textContent = "방 코드는 숫자 4자리예요.";
      return;
    }
    error.textContent = "";
    onJoin(value, name.value.trim() || "참가자");
  });
  const back = el("button", { class: "ghost-button", text: "뒤로" });
  back.addEventListener("click", onBack);

  root.append(code, name, error, el("div", { class: "row" }, [back, join]));
  return { root, showError: (message) => (error.textContent = message) };
}

export interface LobbyOptions {
  code: string;
  isHost: boolean;
  mySlot: () => number;
  onToggleAi: (slot: number, kind: "ai" | "empty") => void;
  onStart: () => void;
  onLeave: () => void;
}

/** 대기실: 방 코드, 자리 4개, (방장) 컴퓨터 넣기·시작 버튼 */
export function buildLobby(options: LobbyOptions): { root: HTMLElement; update: (slots: Slot[], meta: RoomMeta | null) => void; showError: (m: string) => void } {
  const root = el("div", { class: "screen setup" });
  root.append(el("div", { class: "subtitle", text: "친구에게 이 코드를 알려 주세요" }));
  root.append(el("div", { class: "room-code", text: options.code }));

  const slotsBox = el("div", { class: "slots lobby-slots" });
  const info = el("div", { class: "hint" });
  const error = el("div", { class: "error" });
  const start = el("button", { class: "big-button", text: "시작하기" });
  start.addEventListener("click", options.onStart);
  const leave = el("button", { class: "ghost-button", text: options.isHost ? "방 닫기" : "나가기" });
  leave.addEventListener("click", options.onLeave);
  root.append(slotsBox, info, error, el("div", { class: "row" }, options.isHost ? [leave, start] : [leave]));

  const update = (slots: Slot[], meta: RoomMeta | null): void => {
    slotsBox.replaceChildren();
    slots.forEach((slot, i) => {
      const row = el("div", { class: "slot" });
      const dot = el("span", { class: "pdot big" });
      dot.style.background = PLAYER_COLORS[i];
      const label =
        slot.kind === "empty"
          ? "빈자리"
          : slot.kind === "ai"
            ? `🤖 ${slot.name}`
            : `${slot.name}${i === options.mySlot() ? " (나)" : ""}${meta && slot.pid === meta.hostPid ? " 👑" : ""}`;
      row.append(dot, el("span", { class: `slot-name ${slot.kind}`, text: label }));
      if (options.isHost && slot.kind !== "human") {
        const button = el("button", { class: "kind-button", text: slot.kind === "empty" ? "컴퓨터 넣기" : "비우기" });
        button.addEventListener("click", () => options.onToggleAi(i, slot.kind === "empty" ? "ai" : "empty"));
        row.append(button);
      }
      slotsBox.append(row);
    });
    const count = slots.filter((s) => s.kind !== "empty").length;
    start.disabled = count < 2;
    start.textContent = count < 2 ? "2명 이상 필요해요" : `시작하기 (${count}명)`;
    info.textContent = options.isHost ? `${meta ? (meta.maxRounds > 0 ? `${meta.maxRounds}바퀴` : "끝까지") : ""} · 빈자리는 컴퓨터로 채울 수 있어요.` : "방장이 시작할 때까지 기다려 주세요…";
  };

  return { root, update, showError: (message) => (error.textContent = message) };
}
