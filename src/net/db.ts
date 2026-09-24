export type Unsubscribe = () => void;

/**
 * 실시간 데이터베이스를 쓰는 데 필요한 기능만 뽑은 것.
 * 진짜(Firebase)와 시험용(MemoryDb)이 같은 모양이라, 방 만들기·입장·진행 코드를 서버 없이 시험할 수 있다.
 * 경로는 "rooms/1234/meta" 처럼 /로 이은 글자다. 값은 글자, 숫자, 참거짓, 객체이고 null은 "없음"이다.
 */
export interface Db {
  get(path: string): Promise<unknown>;
  set(path: string, value: unknown): Promise<void>;
  remove(path: string): Promise<void>;
  /** 새 자식을 만들고 그 이름(키)을 돌려준다. 키는 시간순으로 정렬된다. */
  push(path: string, value: unknown): Promise<string>;
  /** 현재 값을 보고 새 값을 정한다. update가 undefined를 돌려주면 취소한다. */
  transaction(path: string, update: (current: unknown) => unknown): Promise<{ committed: boolean; value: unknown }>;
  /** 값이 처음과 바뀔 때마다 부른다 (없으면 null). */
  onValue(path: string, callback: (value: unknown) => void): Unsubscribe;
  /** 이미 있는 자식과 새로 생기는 자식마다 한 번씩 부른다. */
  onChildAdded(path: string, callback: (key: string, value: unknown) => void): Unsubscribe;
}

function split(path: string): string[] {
  return path.split("/").filter((part) => part.length > 0);
}

interface ValueListener {
  path: string;
  last: string;
  callback: (value: unknown) => void;
}

interface ChildListener {
  path: string;
  seen: Set<string>;
  callback: (key: string, value: unknown) => void;
}

/** 메모리 안에서 동작하는 가짜 데이터베이스 (시험용). 실제처럼 알림은 조금 늦게(비동기로) 온다. */
export class MemoryDb implements Db {
  private root: Record<string, unknown> = {};
  private valueListeners = new Set<ValueListener>();
  private childListeners = new Set<ChildListener>();
  private counter = 0;

  private read(path: string): unknown {
    let node: unknown = this.root;
    for (const part of split(path)) {
      if (node === null || typeof node !== "object") return null;
      node = (node as Record<string, unknown>)[part];
      if (node === undefined) return null;
    }
    return node === undefined ? null : structuredClone(node);
  }

  private write(path: string, value: unknown): void {
    const parts = split(path);
    if (parts.length === 0) {
      this.root = (value as Record<string, unknown>) ?? {};
      return;
    }
    let node = this.root;
    for (let i = 0; i < parts.length - 1; i++) {
      const next = node[parts[i]];
      if (next === null || typeof next !== "object") node[parts[i]] = {};
      node = node[parts[i]] as Record<string, unknown>;
    }
    const last = parts[parts.length - 1];
    if (value === null || value === undefined) delete node[last];
    else node[last] = structuredClone(value);
  }

  private notify(): void {
    for (const listener of [...this.valueListeners]) {
      const value = this.read(listener.path);
      const json = JSON.stringify(value);
      if (json === listener.last) continue;
      listener.last = json;
      queueMicrotask(() => {
        if (this.valueListeners.has(listener)) listener.callback(value);
      });
    }
    for (const listener of [...this.childListeners]) {
      const children = this.read(listener.path);
      if (children === null || typeof children !== "object") continue;
      for (const key of Object.keys(children as object).sort()) {
        if (listener.seen.has(key)) continue;
        listener.seen.add(key);
        const value = (children as Record<string, unknown>)[key];
        queueMicrotask(() => {
          if (this.childListeners.has(listener)) listener.callback(key, value);
        });
      }
    }
  }

  async get(path: string): Promise<unknown> {
    return this.read(path);
  }

  async set(path: string, value: unknown): Promise<void> {
    this.write(path, value);
    this.notify();
  }

  async remove(path: string): Promise<void> {
    this.write(path, null);
    this.notify();
  }

  async push(path: string, value: unknown): Promise<string> {
    this.counter += 1;
    const key = `k${String(this.counter).padStart(8, "0")}`;
    this.write(`${path}/${key}`, value);
    this.notify();
    return key;
  }

  async transaction(path: string, update: (current: unknown) => unknown): Promise<{ committed: boolean; value: unknown }> {
    const current = this.read(path);
    const next = update(current);
    if (next === undefined) return { committed: false, value: current };
    this.write(path, next);
    this.notify();
    return { committed: true, value: next };
  }

  onValue(path: string, callback: (value: unknown) => void): Unsubscribe {
    const listener: ValueListener = { path, last: JSON.stringify(this.read(path)), callback };
    this.valueListeners.add(listener);
    queueMicrotask(() => {
      if (this.valueListeners.has(listener)) callback(this.read(path));
    });
    return () => this.valueListeners.delete(listener);
  }

  onChildAdded(path: string, callback: (key: string, value: unknown) => void): Unsubscribe {
    const listener: ChildListener = { path, seen: new Set(), callback };
    this.childListeners.add(listener);
    queueMicrotask(() => {
      if (this.childListeners.has(listener)) this.notify();
    });
    return () => this.childListeners.delete(listener);
  }
}
