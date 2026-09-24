/** 효과음을 Web Audio로 직접 합성한다 (음원 파일 없음). */
class BoardAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  enabled = true;

  /** 브라우저는 화면을 누르기 전에는 소리를 막는다. 누른 순간에 켠다. */
  unlock(): void {
    this.context();
  }

  private context(): AudioContext {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.6;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  /** 톤 하나: 시작 주파수에서 끝 주파수로 미끄러지며 사라진다. */
  private tone(from: number, to: number, duration: number, gain: number, type: OscillatorType = "sine", delay = 0): void {
    if (!this.enabled) return;
    const ctx = this.context();
    const at = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(to, 20), at + duration);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.linearRampToValueAtTime(gain, at + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(amp);
    amp.connect(this.master as GainNode);
    osc.start(at);
    osc.stop(at + duration + 0.02);
  }

  /** 짧게 걸러낸 잡음 (주사위 굴러가는 소리 등) */
  private burst(freq: number, duration: number, gain: number, delay = 0): void {
    if (!this.enabled) return;
    const ctx = this.context();
    if (!this.noise) {
      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    const at = ctx.currentTime + delay;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = freq * (0.9 + Math.random() * 0.2);
    filter.Q.value = 1.2;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.linearRampToValueAtTime(gain, at + 0.005);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(filter);
    filter.connect(amp);
    amp.connect(this.master as GainNode);
    source.start(at);
    source.stop(at + duration + 0.02);
  }

  /** 말이 한 칸 움직일 때 */
  step(): void {
    this.tone(520, 380, 0.07, 0.18, "triangle");
  }

  /** 주사위가 굴러가는 소리 */
  dice(): void {
    for (let i = 0; i < 7; i++) this.burst(2200 + i * 150, 0.05, 0.5, i * 0.085);
  }

  /** 돈을 받거나 땅을 살 때 */
  coin(): void {
    this.tone(880, 880, 0.12, 0.22, "square");
    this.tone(1320, 1320, 0.3, 0.2, "square", 0.09);
  }

  /** 통행료나 세금을 낼 때 */
  pay(): void {
    this.tone(300, 120, 0.22, 0.32, "triangle");
    this.burst(600, 0.12, 0.3);
  }

  /** 건물을 지을 때 */
  build(): void {
    this.burst(900, 0.06, 0.5);
    this.tone(330, 660, 0.25, 0.22, "triangle", 0.08);
  }

  /** 여행카드를 뽑을 때 */
  card(): void {
    [660, 830, 990].forEach((f, i) => this.tone(f, f, 0.18, 0.18, "sine", i * 0.08));
  }

  /** 나쁜 일 (무인도, 파산) */
  bad(): void {
    this.tone(400, 120, 0.5, 0.3, "sawtooth");
  }

  /** 우승 */
  fanfare(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, f, 0.3, 0.22, "triangle", i * 0.14));
  }
}

export const audio = new BoardAudio();
