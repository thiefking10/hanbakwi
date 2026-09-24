/**
 * 폰 흔들기를 알아내는 계산 (센서 값만 받으니 화면 없이 시험할 수 있다).
 * 가속도가 갑자기 크게 바뀐 순간(임계값 이상)이 짧은 시간에 여러 번 나오면 "흔들었다"고 본다.
 */
export class ShakeAnalyzer {
  private previous: [number, number, number] | null = null;
  private hits: number[] = [];
  private lastFire = -Infinity;

  constructor(
    private readonly threshold = 8,
    private readonly required = 4,
    private readonly windowMs = 800,
    private readonly cooldownMs = 1500,
  ) {}

  /** 센서 값 하나(x, y, z 가속도)와 시각(밀리초)을 넣는다. 흔들었다고 판단한 순간 true. */
  feed(x: number, y: number, z: number, timeMs: number): boolean {
    const prev = this.previous;
    this.previous = [x, y, z];
    if (!prev) return false;

    const change = Math.hypot(x - prev[0], y - prev[1], z - prev[2]);
    if (change >= this.threshold) this.hits.push(timeMs);
    this.hits = this.hits.filter((t) => timeMs - t <= this.windowMs);

    if (this.hits.length >= this.required && timeMs - this.lastFire >= this.cooldownMs) {
      this.lastFire = timeMs;
      this.hits = [];
      return true;
    }
    return false;
  }

  reset(): void {
    this.previous = null;
    this.hits = [];
  }
}

type PermissionRequester = { requestPermission?: () => Promise<"granted" | "denied"> };

/** 실제 폰의 움직임 센서(devicemotion)를 듣고, 흔들면 onShake를 부른다. */
export class ShakeDetector {
  onShake: (() => void) | null = null;
  private readonly analyzer = new ShakeAnalyzer();
  private listening = false;
  /** 센서 값이 한 번이라도 들어왔는지 (컴퓨터에서는 false로 남는다) */
  hasSensor = false;

  /** 아이폰(사파리)은 화면을 누른 뒤에 허락을 받아야 센서를 쓸 수 있다. */
  get needsPermission(): boolean {
    const motion = (window as unknown as { DeviceMotionEvent?: PermissionRequester }).DeviceMotionEvent;
    return typeof motion?.requestPermission === "function";
  }

  get supported(): boolean {
    return typeof window !== "undefined" && "DeviceMotionEvent" in window;
  }

  /**
   * 사용자가 화면을 누른 순간에 부른다. 아이폰이면 허락 창을 띄운다.
   * 허락 결과와 상관없이 일단 듣기를 시작한다 (허락이 안 됐다면 값이 안 들어올 뿐이다).
   */
  async enable(): Promise<void> {
    if (!this.supported) return;
    const motion = (window as unknown as { DeviceMotionEvent: PermissionRequester }).DeviceMotionEvent;
    if (motion.requestPermission) {
      try {
        await motion.requestPermission();
      } catch {
        // 거절되거나 지원하지 않으면 값이 안 들어올 뿐이다.
      }
    }
    this.listen();
  }

  private listen(): void {
    if (this.listening) return;
    this.listening = true;
    window.addEventListener("devicemotion", (event) => {
      const a = event.accelerationIncludingGravity;
      if (!a || a.x === null || a.y === null || a.z === null) return;
      this.hasSensor = true;
      if (this.analyzer.feed(a.x, a.y, a.z, performance.now())) this.onShake?.();
    });
  }
}
