export type SoundKind =
  | "plant"
  | "sun"
  | "win"
  | "lose"
  | "click"
  | "pea"
  | "frost"
  | "spore"
  | "lob"
  | "bite"
  | "groan"
  | "death"
  | "hit"
  | "metal"
  | "explosion"
  | "freeze"
  | "mower"
  | "jump"
  | "shovel";
export type SoundEvent = { kind: SoundKind; x?: number; source?: string };
/** Synthesized PCM and pitched voices: no network, no autoplay dependency. */
export class GardenAudio {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private voices = new Set<AudioScheduledSourceNode>();
  private last = new Map<string, number>();
  private noise: AudioBuffer | null = null;
  private _enabled = true;
  private _volume = 0.65;
  played = 0;
  get enabled() {
    return this._enabled;
  }
  set enabled(value: boolean) {
    this._enabled = value;
    if (this.ctx && this.master)
      this.master.gain.setTargetAtTime(
        value ? this._volume : 0,
        this.ctx.currentTime,
        0.015,
      );
    if (!value) this.stop();
  }
  get volume() {
    return this._volume;
  }
  set volume(value: number) {
    this._volume = Math.max(0, Math.min(1, value));
    if (this.ctx && this.master)
      this.master.gain.setTargetAtTime(
        this.enabled ? this._volume : 0,
        this.ctx.currentTime,
        0.015,
      );
  }
  async unlock() {
    try {
      if (!this.ctx) {
        const Context =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        this.ctx = new Context();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.enabled ? this.volume : 0;
        this.compressor = this.ctx.createDynamicsCompressor();
        this.compressor.threshold.value = -16;
        this.compressor.ratio.value = 6;
        this.master.connect(this.compressor);
        this.compressor.connect(this.ctx.destination);
        this.noise = this.ctx.createBuffer(
          1,
          this.ctx.sampleRate * 2,
          this.ctx.sampleRate,
        );
        const data = this.noise.getChannelData(0);
        let seed = 7121;
        for (let i = 0; i < data.length; i++) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          data[i] = seed / 2147483648 - 1;
        }
      }
      if (this.ctx.state === "suspended") await this.ctx.resume();
    } catch {
      return false;
    }
    return this.ctx?.state === "running";
  }
  play(kind: SoundKind, x = 4) {
    if (!this.enabled) return;
    if (!this.ctx || this.ctx.state !== "running") {
      void this.unlock().then((ok) => {
        if (ok) this.play(kind, x);
      });
      return;
    }
    const ctx = this.ctx,
      now = ctx.currentTime;
    const gap =
      kind === "groan"
        ? 2.8
        : kind === "bite"
          ? 0.16
          : kind === "hit" || kind === "pea"
            ? 0.055
            : kind === "metal"
              ? 0.1
              : 0.075;
    if (
      now - (this.last.get(kind) ?? -Infinity) < gap ||
      this.voices.size >= 36
    )
      return;
    this.last.set(kind, now);
    this.played++;
    const bus = ctx.createGain(),
      pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-0.8, Math.min(0.8, (x - 4) / 6));
    bus.connect(pan);
    pan.connect(this.master!);
    let end = 0.2;
    const voice = (
      freq: number,
      to: number,
      duration: number,
      gain = 0.16,
      type: OscillatorType = "sine",
      delay = 0,
    ) => {
      const osc = ctx.createOscillator(),
        amp = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now + delay);
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(20, to),
        now + delay + duration,
      );
      amp.gain.setValueAtTime(0.0001, now + delay);
      amp.gain.exponentialRampToValueAtTime(gain, now + delay + 0.012);
      amp.gain.exponentialRampToValueAtTime(0.0001, now + delay + duration);
      osc.connect(amp);
      amp.connect(bus);
      this.voices.add(osc);
      osc.onended = () => {
        this.voices.delete(osc);
        osc.disconnect();
        amp.disconnect();
      };
      osc.start(now + delay);
      osc.stop(now + delay + duration + 0.02);
      end = Math.max(end, delay + duration + 0.1);
    };
    const noise = (duration: number, freq: number, gain = 0.12, delay = 0) => {
      const source = ctx.createBufferSource(),
        filter = ctx.createBiquadFilter(),
        amp = ctx.createGain();
      source.buffer = this.noise;
      filter.type = "bandpass";
      filter.frequency.value = freq;
      filter.Q.value = 0.65;
      amp.gain.setValueAtTime(gain, now + delay);
      amp.gain.exponentialRampToValueAtTime(0.0001, now + delay + duration);
      source.connect(filter);
      filter.connect(amp);
      amp.connect(bus);
      this.voices.add(source);
      source.onended = () => {
        this.voices.delete(source);
        source.disconnect();
        filter.disconnect();
        amp.disconnect();
      };
      source.start(now + delay);
      source.stop(now + delay + duration);
      end = Math.max(end, delay + duration + 0.1);
    };
    switch (kind) {
      case "pea":
        voice(510, 140, 0.11, 0.19, "triangle");
        noise(0.055, 1700, 0.12);
        break;
      case "frost":
        voice(1100, 410, 0.19, 0.13);
        noise(0.16, 4600, 0.13);
        break;
      case "spore":
        noise(0.25, 620, 0.3);
        voice(150, 85, 0.18, 0.1, "triangle");
        break;
      case "lob":
        voice(170, 420, 0.17, 0.13, "triangle");
        noise(0.14, 800, 0.12);
        break;
      case "bite":
        noise(0.12, 850, 0.35);
        voice(140, 62, 0.09, 0.13, "sawtooth");
        noise(0.1, 1300, 0.16, 0.12);
        break;
      case "groan":
        voice(79, 49, 0.8, 0.16, "sawtooth");
        voice(158, 106, 0.75, 0.075, "triangle");
        voice(235, 149, 0.65, 0.045, "sine", 0.08);
        break;
      case "death":
        voice(130, 35, 0.5, 0.17, "sawtooth");
        noise(0.25, 360, 0.2, 0.12);
        break;
      case "metal":
        voice(1700, 460, 0.19, 0.12, "triangle");
        voice(2320, 890, 0.14, 0.07);
        break;
      case "hit":
        noise(0.07, 1350, 0.22);
        voice(160, 74, 0.08, 0.13);
        break;
      case "explosion":
        noise(0.7, 260, 0.75);
        noise(0.3, 1700, 0.3);
        voice(110, 25, 0.7, 0.4);
        break;
      case "freeze":
        voice(1600, 240, 0.8, 0.14);
        noise(0.65, 5200, 0.25);
        break;
      case "mower":
        voice(65, 180, 0.9, 0.18, "sawtooth");
        noise(1.3, 260, 0.38);
        break;
      case "jump":
        voice(180, 700, 0.26, 0.17, "triangle");
        break;
      case "plant":
        noise(0.16, 440, 0.28);
        voice(230, 105, 0.14, 0.16);
        break;
      case "shovel":
        noise(0.15, 2400, 0.22);
        voice(480, 120, 0.12, 0.1, "triangle");
        break;
      case "sun":
        voice(880, 880, 0.2, 0.12);
        voice(1320, 1320, 0.24, 0.11, "sine", 0.09);
        break;
      case "win":
        [523, 659, 784, 1046].forEach((f, i) =>
          voice(f, f, 0.3, 0.14, "triangle", i * 0.14),
        );
        break;
      case "lose":
        [392, 330, 262].forEach((f, i) =>
          voice(f, f * 0.9, 0.4, 0.13, "triangle", i * 0.2),
        );
        break;
      default:
        voice(440, 330, 0.09, 0.09);
    }
    // Disconnect mixing nodes after the longest scheduled voice finishes.
    const tail = ctx.createConstantSource();
    tail.offset.value = 0;
    tail.connect(bus);
    this.voices.add(tail);
    tail.onended = () => {
      this.voices.delete(tail);
      tail.disconnect();
      bus.disconnect();
      pan.disconnect();
    };
    tail.start();
    tail.stop(now + end);
  }
  stop() {
    for (const voice of this.voices) {
      try {
        voice.stop();
      } catch {}
    }
    this.voices.clear();
    this.last.clear();
  }
  dispose() {
    this.stop();
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
  }
}
export function plantSound(id: string): SoundKind {
  if (["snowpea", "winter", "ice"].includes(id)) return "frost";
  if (["puff", "fume", "scaredy", "sea", "gloom"].includes(id)) return "spore";
  if (["cabbage", "kernel", "melon", "cob"].includes(id)) return "lob";
  return "pea";
}
