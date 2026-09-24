import "./ui/style.css";
import { GameController } from "./ui/controller";
import { buildSetupScreen } from "./ui/screens";

const app = document.getElementById("app") as HTMLElement;

function showSetup(): void {
  app.replaceChildren(
    buildSetupScreen(({ setups, maxRounds }) => {
      const controller = new GameController(showSetup);
      app.replaceChildren(controller.root);
      controller.start(setups, { maxRounds });
      // 개발용: 콘솔에서 __game.debugState 로 지금 상태를 볼 수 있다.
      (window as unknown as { __game: GameController }).__game = controller;
    }),
  );
}

showSetup();
