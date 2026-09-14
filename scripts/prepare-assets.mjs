import sharp from "sharp";
import { mkdir, copyFile, writeFile } from "node:fs/promises";
const root = "assets-source/";
const plantIds =
  "pea sunflower cherry wallnut potato snowpea chomper repeater puff sunshroom fume grave hypno scaredy ice doom lily squash three kelp jalapeno spike torch tallnut sea lantern cactus blover split star pumpkin magnet cabbage pot kernel coffee garlic umbrella marigold melon gatling twin gloom cattail winter goldmagnet spikerock cob imitater".split(
    " ",
  );
const zombieIds =
  "basic flag cone pole bucket paper screen football dancer backup ducky snorkel zomboni bobsled dolphin jack balloon digger pogo yeti bungee catapult garg imp boss ladder".split(
    " ",
  );
await mkdir("public/assets/portraits", { recursive: true });
await mkdir("public/assets/backgrounds", { recursive: true });
await mkdir("public/assets/fx", { recursive: true });
async function split(
  file,
  cols,
  rows,
  ids,
  prefix,
  w,
  h,
  folder = "portraits",
) {
  const path = root + file,
    meta = await sharp(path).metadata();
  for (let i = 0; i < ids.length; i++) {
    const x = Math.round(((i % cols) * meta.width) / cols),
      y = Math.round((Math.floor(i / cols) * meta.height) / rows),
      right = Math.round((((i % cols) + 1) * meta.width) / cols),
      bottom = Math.round(((Math.floor(i / cols) + 1) * meta.height) / rows);
    const crop = await sharp(path)
      .extract({ left: x, top: y, width: right - x, height: bottom - y })
      .png()
      .toBuffer();
    const trimmed = await sharp(crop).trim({ threshold: 18 }).png().toBuffer();
    const fitted = await sharp(trimmed)
      .resize(w - 14, h - 18, { fit: "inside" })
      .png()
      .toBuffer();
    const m = await sharp(fitted).metadata();
    await sharp({
      create: { width: w, height: h, channels: 4, background: "#00000000" },
    })
      .composite([
        {
          input: fitted,
          left: Math.round((w - m.width) / 2),
          top: h - m.height - 7,
        },
      ])
      .webp({ quality: 80 })
      .toFile(`public/assets/${folder}/${prefix}${ids[i]}.webp`);
  }
}
await split("plants.png", 7, 7, plantIds, "p-", 160, 160);
await split("zombies.png", 6, 5, zombieIds, "z-", 160, 200);
await split(
  "fx.png",
  4,
  4,
  Array.from({ length: 16 }, (_, i) => String(i)),
  "fx-",
  192,
  192,
  "fx",
);
await sharp(root + "day.png")
  .resize(1200, 690, { fit: "fill" })
  .webp({ quality: 80 })
  .toFile("public/assets/backgrounds/day.webp");
await sharp("public/assets/backgrounds/day.webp")
  .modulate({ brightness: 0.48, saturation: 0.65 })
  .tint("#778da9")
  .webp({ quality: 80 })
  .toFile("public/assets/backgrounds/night.webp");
await sharp("public/assets/portraits/p-pea.webp")
  .resize(48, 48)
  .png()
  .toFile("public/favicon.png");
console.log("Prepared 49 plant, 26 zombie, 16 VFX WebPs and backgrounds.");
await sharp(root + "pool.png")
  .resize(1200, 690, { fit: "fill" })
  .webp({ quality: 80 })
  .toFile("public/assets/backgrounds/pool.webp");
await sharp(root + "roof.png")
  .resize(1200, 690, { fit: "fill" })
  .webp({ quality: 80 })
  .toFile("public/assets/backgrounds/roof.webp");

// Align the generated pool bands to the exact two water lanes, without moving the house.
const pool = await sharp("public/assets/backgrounds/pool.webp").png().toBuffer();
const bands = [];
for (const [from, to, start, end] of [
  [116, 252, 116, 284],
  [252, 431, 284, 452],
  [431, 620, 452, 620],
]) {
  const input = await sharp(pool)
    .extract({ left: 210, top: from, width: 891, height: to - from })
    .resize(891, end - start)
    .png()
    .toBuffer();
  bands.push({ input, left: 210, top: start });
}
await sharp(pool)
  .composite(bands)
  .webp({ quality: 80 })
  .toFile("public/assets/backgrounds/pool.webp");
await sharp("public/assets/backgrounds/pool.webp")
  .modulate({ brightness: 0.48, saturation: 0.65 })
  .tint("#778da9")
  .webp({ quality: 80 })
  .toFile("public/assets/backgrounds/fog.webp");
