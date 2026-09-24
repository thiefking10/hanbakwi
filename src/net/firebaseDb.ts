import { initializeApp, type FirebaseOptions } from "firebase/app";
import {
  getDatabase,
  get,
  onChildAdded,
  onValue,
  push,
  ref,
  remove,
  runTransaction,
  set,
  type Database,
} from "firebase/database";
import type { Db, Unsubscribe } from "./db";

/** 진짜 Firebase 실시간 데이터베이스를 Db 모양으로 감싼 것. */
export class FirebaseDb implements Db {
  private readonly database: Database;

  constructor(config: FirebaseOptions) {
    this.database = getDatabase(initializeApp(config));
  }

  async get(path: string): Promise<unknown> {
    return (await get(ref(this.database, path))).val();
  }

  async set(path: string, value: unknown): Promise<void> {
    await set(ref(this.database, path), value);
  }

  async remove(path: string): Promise<void> {
    await remove(ref(this.database, path));
  }

  async push(path: string, value: unknown): Promise<string> {
    const child = push(ref(this.database, path));
    await set(child, value);
    return child.key as string;
  }

  async transaction(path: string, update: (current: unknown) => unknown): Promise<{ committed: boolean; value: unknown }> {
    const result = await runTransaction(ref(this.database, path), (current) => update(current ?? null));
    return { committed: result.committed, value: result.snapshot.val() };
  }

  onValue(path: string, callback: (value: unknown) => void): Unsubscribe {
    return onValue(ref(this.database, path), (snapshot) => callback(snapshot.val()));
  }

  onChildAdded(path: string, callback: (key: string, value: unknown) => void): Unsubscribe {
    return onChildAdded(ref(this.database, path), (snapshot) => callback(snapshot.key as string, snapshot.val()));
  }
}
