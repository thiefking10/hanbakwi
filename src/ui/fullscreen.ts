const buttons = new Set<HTMLButtonElement>();

function supported(): boolean {
  return typeof document.documentElement.requestFullscreen === "function";
}

async function toggle(): Promise<void> {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen({ navigationUI: "hide" });
      // 가로 화면으로 고정한다 (지원하는 기기에서만 된다).
      await (screen.orientation as unknown as { lock?: (orientation: string) => Promise<void> }).lock?.("landscape");
    }
  } catch {
    // 거절되거나 지원하지 않으면 그냥 넘어간다.
  }
}

function label(compact: boolean): string {
  if (document.fullscreenElement) return compact ? "⛶ 끄기" : "⛶ 전체화면 끄기";
  return compact ? "⛶ 전체" : "⛶ 전체화면";
}

document.addEventListener("fullscreenchange", () => {
  for (const button of buttons) button.textContent = label(button.dataset.compact === "1");
});

/**
 * 전체화면 버튼을 만든다. 크롬 같은 브라우저의 주소창과 탭 줄을 숨겨 화면을 넓힌다.
 * 전체화면을 지원하지 않는 브라우저(아이폰 사파리)에서는 버튼이 숨겨진다 (대신 "홈 화면에 추가"를 쓴다).
 * 전체화면 요청은 손가락을 뗄 때(click) 해야 브라우저가 허락한다.
 */
export function createFullscreenButton(className: string, compact = false): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = className;
  button.dataset.compact = compact ? "1" : "0";
  button.textContent = label(compact);
  if (!supported()) button.style.display = "none";
  button.addEventListener("click", () => void toggle());
  buttons.add(button);
  return button;
}
