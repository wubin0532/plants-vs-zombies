export type SoundKind =
  | "smash"
  | "chomp"
  | "land"
  | "step"
  | "break"
  | "music"
  | "ambient"
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
  mix = { battle: 1, music: 0.25, environment: 0.3, ui: 0.65 };
  private priorities = new Map<AudioScheduledSourceNode, number>();
  private musicBeat = -1;
  private ambientBeat = -1;
  private pressure = 0;
  private duckUntil = 0;
  private buses = new Map<GainNode, { level: number; important: boolean }>();
  private variant = 0;
  update(time: number, pressure: number) {
    this.pressure = pressure;
    const beat = Math.floor(time / (pressure > 0.6 ? 0.4 : 0.6));
    if (beat !== this.musicBeat) {
      this.musicBeat = beat;
      this.play("music");
    }
    const ambient = Math.floor(time / 4);
    if (ambient !== this.ambientBeat) {
      this.ambientBeat = ambient;
      this.play("ambient");
    }
  }
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
  play(kind: SoundKind, x = 4, source?: string) {
    if (!this.enabled) return;
    if (!this.ctx || this.ctx.state !== "running") {
      void this.unlock().then((ok) => {
        if (ok) this.play(kind, x, source);
      });
      return;
    }
    const ctx = this.ctx,
      now = ctx.currentTime;
    const gap =
      kind === "step"
        ? 0.16
        : kind === "groan"
          ? 2.8
          : kind === "bite"
            ? 0.16
            : kind === "hit" || kind === "pea"
              ? 0.055
              : kind === "metal"
                ? 0.1
                : 0.075;
    const key = kind === "explosion" ? kind + (source || "") : kind;
    const important = [
      "explosion",
      "freeze",
      "win",
      "lose",
      "mower",
      "smash",
    ].includes(kind);
    if (now - (this.last.get(key) ?? -Infinity) < gap) return;
    if (this.voices.size >= 36) {
      if (!important) return;
      for (const voice of [...this.voices]) {
        if ((this.priorities.get(voice) ?? 0) < 2) {
          try {
            voice.stop();
          } catch {}
          this.voices.delete(voice);
          this.priorities.delete(voice);
        }
        if (this.voices.size < 22) break;
      }
      if (this.voices.size >= 48) return;
    }
    this.last.set(key, now);
    this.played++;
    if (important) {
      this.duckUntil = now + 0.65;
      for (const [node, info] of this.buses)
        if (!info.important) {
          node.gain.cancelScheduledValues(now);
          node.gain.setTargetAtTime(info.level * 0.4, now, 0.02);
          node.gain.setTargetAtTime(info.level, now + 0.65, 0.15);
        }
    }
    const group =
      kind === "music"
        ? "music"
        : kind === "ambient"
          ? "environment"
          : ["sun", "click", "win", "lose"].includes(kind)
            ? "ui"
            : "battle";
    const bus = ctx.createGain(),
      pan = ctx.createStereoPanner();
    const duck = now < this.duckUntil && !important ? 0.4 : 1;
    bus.gain.value = this.mix[group] * duck;
    this.buses.set(bus, { level: this.mix[group], important });
    pan.pan.value = Math.max(-0.8, Math.min(0.8, (x - 4) / 6));
    bus.connect(pan);
    pan.connect(this.master!);
    const variation = [0.95, 1.03, 0.99, 1.06, 1][this.variant++ % 5];
    let end = 0.2;
    const voice = (
      freq: number,
      to: number,
      duration: number,
      gain = 0.16,
      type: OscillatorType = "sine",
      delay = 0,
    ) => {
      freq *= kind === "music" ? 1 : variation;
      to *= kind === "music" ? 1 : variation;
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
      this.priorities.set(osc, important ? 2 : 0);
      osc.onended = () => {
        this.voices.delete(osc);
        this.priorities.delete(osc);
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
      source.playbackRate.value = variation;
      filter.type = "bandpass";
      filter.frequency.value = freq;
      filter.Q.value = 0.65;
      amp.gain.setValueAtTime(gain, now + delay);
      amp.gain.exponentialRampToValueAtTime(0.0001, now + delay + duration);
      source.connect(filter);
      filter.connect(amp);
      amp.connect(bus);
      this.voices.add(source);
      this.priorities.set(source, important ? 2 : 0);
      source.onended = () => {
        this.voices.delete(source);
        this.priorities.delete(source);
        source.disconnect();
        filter.disconnect();
        amp.disconnect();
      };
      source.start(now + delay);
      source.stop(now + delay + duration);
      end = Math.max(end, delay + duration + 0.1);
    };
    switch (kind) {
      case "smash":
        noise(0.45, 180, 0.55);
        voice(85, 28, 0.4, 0.3);
        noise(0.18, 1700, 0.25, 0.04);
        break;
      case "chomp":
        noise(0.13, 700, 0.35);
        voice(160, 65, 0.18, 0.15, "triangle");
        noise(0.16, 1100, 0.15, 0.14);
        break;
      case "land":
        noise(0.18, 330, 0.2);
        voice(90, 50, 0.15, 0.1);
        break;
      case "step":
        noise(
          0.12,
          source === "garg" ? 150 : 450,
          source === "garg" ? 0.28 : 0.09,
        );
        if (source === "garg") voice(65, 35, 0.15, 0.13);
        break;
      case "break":
        noise(0.3, 1800, 0.3);
        voice(1400, 400, 0.2, 0.1, "triangle");
        break;
      case "music": {
        const notes =
          this.pressure > 0.6
            ? [130.81, 155.56, 196, 233.08, 196, 155.56, 146.83, 174.61]
            : [196, 246.94, 293.66, 329.63, 293.66, 246.94, 220, 164.81];
        const note = notes[this.musicBeat % notes.length] || 196;
        voice(note, note, 0.5, 0.075, "triangle");
        voice(note / 2, note / 2, 0.6, 0.05);
        break;
      }
      case "ambient":
        noise(1.5, 600, 0.04);
        voice(1800, 2100, 0.14, 0.025, "sine", 0.3);
        voice(2200, 1900, 0.18, 0.018, "sine", 0.55);
        break;
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
        if (source === "cone") {
          noise(0.12, 650, 0.25);
          voice(230, 95, 0.1, 0.09, "triangle");
          break;
        }
        voice(1700, 460, 0.19, 0.12, "triangle");
        voice(2320, 890, 0.14, 0.07);
        break;
      case "hit":
        noise(0.07, 1350, 0.22);
        voice(160, 74, 0.08, 0.13);
        break;
      case "explosion":
        if (source === "jalapeno") {
          noise(0.9, 1500, 0.45);
          noise(0.6, 420, 0.35);
          voice(200, 50, 0.45, 0.2);
        } else if (source === "potato") {
          noise(0.35, 160, 0.6);
          noise(0.5, 1100, 0.25, 0.04);
          voice(85, 30, 0.35, 0.35);
        } else if (source === "doom") {
          voice(65, 24, 1.3, 0.45);
          noise(1.4, 180, 0.7);
          noise(0.3, 2400, 0.3);
          noise(0.9, 420, 0.3, 0.25);
        } else {
          noise(0.7, 260, 0.65);
          noise(0.18, 2200, 0.4);
          voice(source === "cob" ? 80 : 110, 28, 0.7, 0.38);
          noise(0.6, 950, 0.2, 0.2);
        }
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
    this.priorities.set(tail, important ? 2 : 0);
    tail.onended = () => {
      this.voices.delete(tail);
      this.priorities.delete(tail);
      tail.disconnect();
      this.buses.delete(bus);
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
    this.priorities.clear();
    this.musicBeat = -1;
    this.ambientBeat = -1;
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
