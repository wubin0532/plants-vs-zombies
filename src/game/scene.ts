import type { Engine } from "./engine";
import type { RenderOptions } from "./scene-class";
export type { RenderOptions };
/** Phaser loads on demand so the home page never pays for the engine bundle. */
export async function mountGame(
  parent: HTMLElement,
  engine: Engine,
  notify: () => void,
  options: RenderOptions = {},
) {
  const [{ GardenScene }, Phaser] = await Promise.all([
    import("./scene-class"),
    import("phaser"),
  ]);
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: 1200,
    height: 690,
    transparent: true,
    antialias: true,
    render: {
      // AUTO retains Canvas fallback; this is a browser hint, not a GPU guarantee.
      powerPreference: "high-performance",
      antialiasGL: false,
    },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: new GardenScene(engine, notify, options),
    audio: { noAudio: true },
  });
}
