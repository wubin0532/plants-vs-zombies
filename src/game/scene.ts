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
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: new GardenScene(engine, notify, options),
    audio: { noAudio: true },
  });
}
