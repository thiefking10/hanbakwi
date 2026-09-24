import { MemoryDb } from "./net/db";
import { createRoom, joinRoom, setSlotKind, startGame } from "./net/room";
import { GameController, type OnlineSession } from "./ui/controller";

/**
 * 개발용: 주소에 ?dev=online 을 붙이면, 한 화면 안에서 방장과 참가자를 같이 띄워 온라인 진행을 시험한다.
 * (진짜 서버 대신 메모리 데이터베이스를 쓴다. 참가자 화면은 숨겨져 있고 __dev.client 로 조작한다.)
 */
export async function runOnlineDemo(app: HTMLElement): Promise<void> {
  const db = new MemoryDb();
  const code = await createRoom(db, "host-pid", "방장", 20);
  await joinRoom(db, code, "guest-pid", "손님");
  await setSlotKind(db, code, 2, "ai");
  const started = await startGame(db, code, 12345);
  if (!started) throw new Error("시작 실패");

  const make = (pid: string, role: "host" | "client"): GameController => {
    const controller = new GameController(() => undefined);
    const session: OnlineSession = {
      db,
      code,
      pid,
      role,
      myIndex: started.roster.findIndex((r) => r.pid === pid),
      roster: started.roster,
    };
    controller.startOnline(session, started.state);
    return controller;
  };

  const host = make("host-pid", "host");
  const guestBox = document.createElement("div");
  guestBox.style.display = "none";
  const client = make("guest-pid", "client");
  guestBox.append(client.root);
  app.replaceChildren(host.root, guestBox);
  (window as unknown as { __dev: unknown }).__dev = { host, client, db, code };
}
