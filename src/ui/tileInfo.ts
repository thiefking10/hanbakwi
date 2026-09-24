import { BOARD, RULES, buildCost } from "../engine/board";
import type { GameState } from "../engine/types";
import { LEVEL_NAMES } from "./theme";

/** 칸을 눌렀을 때 보여줄 설명 줄들 (제목 줄 + 안내 줄들). */
export function describeTile(index: number, state: GameState | null): { title: string; lines: string[] } {
  const def = BOARD[index];
  const lines: string[] = [];
  const owner = state?.tiles[index].owner ?? null;
  const level = state?.tiles[index].level ?? 0;

  switch (def.type) {
    case "city": {
      lines.push(`땅값 ${def.price}만원 · 건물 한 단계당 ${buildCost(def)}만원`);
      lines.push(
        "통행료: " + RULES.rentRates.map((rate, i) => `${LEVEL_NAMES[i]} ${Math.round((def.price ?? 0) * rate)}`).join(" · ") + " (만원)",
      );
      lines.push(`같은 색 땅을 모두 가지면 땅 상태의 통행료가 ${RULES.monopolyMultiplier}배예요.`);
      break;
    }
    case "transport":
      lines.push(`값 ${def.price}만원 · 통행료는 가진 교통편 하나당 ${RULES.transportRent}만원`);
      break;
    case "start":
      lines.push(`지나가거나 도착하면 월급 ${RULES.salary}만원을 받아요.`);
      break;
    case "island":
      lines.push("더블이 나오면 탈출해요. 벌금을 내고 나올 수도 있고, 세 번 실패하면 벌금을 내고 나와요.");
      lines.push(`벌금 ${RULES.islandFine}만원. 그냥 지나가면 아무 일도 없어요.`);
      break;
    case "rest":
      lines.push("세금으로 모인 돈을 모두 가져가요.");
      break;
    case "travel":
      lines.push("도착하면 원하는 칸으로 날아갈 수 있어요. (월급은 없어요)");
      break;
    case "tax":
      lines.push(`세금 ${def.amount}만원을 내요. 낸 돈은 휴게소에 모여요.`);
      break;
    case "card":
      lines.push("여행카드를 한 장 뽑아요. 좋은 일도, 나쁜 일도 생겨요.");
      break;
  }

  if (def.type === "city" || def.type === "transport") {
    if (owner === null) lines.push("아직 주인이 없어요.");
    else lines.push(`주인: ${state?.players[owner].name}${def.type === "city" ? ` · 지금 ${LEVEL_NAMES[level]}` : ""}`);
  }
  return { title: def.name, lines };
}
