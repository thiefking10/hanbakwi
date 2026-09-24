import "./ui/style.css";
import { FIREBASE_CONFIG } from "./net/firebaseConfig";
import { FirebaseDb } from "./net/firebaseDb";
import type { Db, Unsubscribe } from "./net/db";
import {
  createRoom,
  deleteRoom,
  joinRoom,
  leaveSlot,
  setSlotKind,
  startGame,
  watchMeta,
  watchSlots,
  type RoomMeta,
  type Slot,
} from "./net/room";
import { GameController, type OnlineSession } from "./ui/controller";
import { buildCreateScreen, buildJoinScreen, buildLobby, buildMenu } from "./ui/onlineScreens";
import { buildSetupScreen } from "./ui/screens";
import type { GameState } from "./engine/types";

const app = document.getElementById("app") as HTMLElement;

// ---------------------------------------------------------------- 기기 식별값과 저장

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function read(key: string): string | null {
  return storage()?.getItem(key) ?? null;
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) storage()?.removeItem(key);
    else storage()?.setItem(key, value);
  } catch {
    // 저장이 막힌 환경에서는 그냥 넘어간다.
  }
}

/** 이 기기를 구분하는 값 (다시 접속했을 때 같은 자리로 돌아오는 데 쓴다). */
function devicePid(): string {
  let pid = read("boardgame:pid");
  if (!pid) {
    pid = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
    write("boardgame:pid", pid);
  }
  return pid;
}

const ROOM_KEY = "boardgame:room";
const NAME_KEY = "boardgame:name";

let dbInstance: Db | null = null;
function getDb(): Db | null {
  if (!FIREBASE_CONFIG) return null;
  if (!dbInstance) dbInstance = new FirebaseDb(FIREBASE_CONFIG);
  return dbInstance;
}

// ---------------------------------------------------------------- 화면 전환

/** 메뉴를 그린다 (저장된 방 정보는 그대로 둔다). */
function renderMenu(): void {
  app.replaceChildren(
    buildMenu({
      onLocal: showLocalSetup,
      onCreate: showCreate,
      onJoin: showJoin,
      onlineReady: FIREBASE_CONFIG !== null,
    }),
  );
}

/** 메뉴로 돌아간다. 참가 중이던 방 기록은 지운다. */
function showMenu(): void {
  write(ROOM_KEY, null);
  renderMenu();
}

function showLocalSetup(): void {
  const setup = buildSetupScreen(({ setups, maxRounds }) => {
    const controller = new GameController(showMenu);
    app.replaceChildren(controller.root);
    controller.start(setups, { maxRounds });
    // 개발용: 콘솔에서 __game.debugState 로 지금 상태를 볼 수 있다.
    (window as unknown as { __game: GameController }).__game = controller;
  });
  const back = document.createElement("button");
  back.className = "ghost-button back-corner";
  back.textContent = "← 처음으로";
  back.addEventListener("click", showMenu);
  setup.append(back);
  app.replaceChildren(setup);
}

function showCreate(): void {
  const db = getDb();
  if (!db) return;
  const screen = buildCreateScreen(read(NAME_KEY) ?? "", (name, maxRounds) => {
    write(NAME_KEY, name);
    createRoom(db, devicePid(), name, maxRounds)
      .then((code) => showLobby(db, code, true))
      .catch((error: Error) => window.alert(error.message));
  }, showMenu);
  app.replaceChildren(screen);
}

function showJoin(): void {
  const db = getDb();
  if (!db) return;
  const { root, showError } = buildJoinScreen(
    read(NAME_KEY) ?? "",
    (code, name) => {
      write(NAME_KEY, name);
      joinRoom(db, code, devicePid(), name)
        .then((result) => {
          if (result.ok) showLobby(db, code, false);
          else if (result.reason === "notfound") showError("그 코드의 방이 없어요.");
          else if (result.reason === "full") showError("방이 가득 찼어요.");
          else showError("이미 시작한 방이에요.");
        })
        .catch(() => showError("연결에 실패했어요. 인터넷을 확인해 주세요."));
    },
    showMenu,
  );
  app.replaceChildren(root);
}

/** 대기실. 방장은 자리를 정하고 시작하고, 참가자는 시작을 기다린다. 이미 시작한 방이면 바로 게임으로 들어간다. */
function showLobby(db: Db, code: string, isHost: boolean): void {
  const pid = devicePid();
  write(ROOM_KEY, code);
  const unsubscribes: Unsubscribe[] = [];
  let slots: Slot[] = [];
  let meta: RoomMeta | null = null;
  let entered = false;

  const closeLobby = (): void => {
    for (const u of unsubscribes.splice(0)) u();
  };

  const mySlot = (): number => slots.findIndex((s) => s.kind === "human" && s.pid === pid);

  const lobby = buildLobby({
    code,
    isHost,
    mySlot: mySlot,
    onToggleAi: (slot, kind) => void setSlotKind(db, code, slot, kind),
    onStart: () => {
      void startGame(db, code).then((started) => {
        if (!started) lobby.showError("시작할 수 없어요. 2명 이상 필요해요.");
      });
    },
    onLeave: () => {
      closeLobby();
      if (isHost) void deleteRoom(db, code);
      else void leaveSlot(db, code, Math.max(mySlot(), 0), pid);
      showMenu();
    },
  });
  app.replaceChildren(lobby.root);

  const refreshLobby = (): void => lobby.update(slots, meta);

  const enterGame = async (): Promise<void> => {
    if (entered || !meta || meta.status === "lobby") return;
    entered = true;
    const raw = (await db.get(`rooms/${code}/state`)) as { json?: string } | null;
    if (!raw?.json) {
      entered = false;
      return;
    }
    const state = JSON.parse(raw.json) as GameState;
    const myIndex = meta.roster.findIndex((r) => r.pid === pid);
    if (myIndex < 0) {
      closeLobby();
      showMenu();
      return;
    }
    closeLobby();
    const session: OnlineSession = { db, code, pid, role: meta.hostPid === pid ? "host" : "client", myIndex, roster: meta.roster };
    const controller = new GameController(showMenu);
    app.replaceChildren(controller.root);
    controller.startOnline(session, state);
    (window as unknown as { __game: GameController }).__game = controller;
  };

  unsubscribes.push(
    watchSlots(db, code, (next) => {
      slots = next;
      refreshLobby();
    }),
  );
  unsubscribes.push(
    watchMeta(db, code, (next) => {
      const previous = meta;
      meta = next;
      if (next === null) {
        if (previous !== null && !entered) {
          closeLobby();
          write(ROOM_KEY, null);
          window.alert("방이 닫혔어요.");
          showMenu();
        }
        return;
      }
      refreshLobby();
      void enterGame();
    }),
  );
}

// ---------------------------------------------------------------- 시작

/** 앱을 다시 열었을 때 (폰에서 다른 앱을 쓰다 돌아온 경우 등) 참가 중이던 방으로 돌아간다. */
async function resumeIfPossible(): Promise<boolean> {
  const code = read(ROOM_KEY);
  const db = getDb();
  if (!code || !db) return false;
  try {
    const result = await joinRoom(db, code, devicePid(), read(NAME_KEY) ?? "참가자");
    if (!result.ok) {
      write(ROOM_KEY, null);
      return false;
    }
    const room = (await db.get(`rooms/${code}/meta`)) as { hostPid?: string } | null;
    showLobby(db, code, room?.hostPid === devicePid());
    return true;
  } catch {
    return false;
  }
}

if (new URLSearchParams(window.location.search).get("dev") === "online") {
  // 개발용: 방장과 참가자를 한 화면에서 시험한다.
  void import("./devOnline").then((m) => m.runOnlineDemo(app));
} else {
  renderMenu();
  void resumeIfPossible();
}
