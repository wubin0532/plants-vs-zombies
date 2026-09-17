/**
 * 生成道具类美术（结合本项目画风：厚描边、渐变上色、卡通高光）。
 * 产出全部为独立贴图，替换同名文件即可被 AI 出图覆盖：
 *   public/assets/mower.png                512×96（4 帧 × 128×96，触地线 y=89）
 *   public/assets/terrain/{grave,vase,ice,crater}.webp
 *   public/assets/water/{water-strip,water-ripple}.webp
 *   public/assets/tokens/{token-sun,token-coin}.webp
 */
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

/**
 * AI 重绘优先：assets-source/redraw/ 里已有的文件名，说明该资产已由 AI 出图，
 * 并通过 scripts/import-redraw.mjs 接入。此时程序化生成器必须让路，
 * 否则 `npm run assets` 会用程序化版本把 AI 美术覆盖掉。
 */
const redraw = (name) => {
  const stem = name.replace(/\.[^.]+$/, "");
  return [".webp", ".png", ".jpg", ".jpeg"].some((e) => existsSync(`assets-source/redraw/${stem}${e}`));
};

for (const dir of ["public/assets/terrain", "public/assets/water", "public/assets/tokens"])
  await mkdir(dir, { recursive: true });

const png = (svg, w, h) => sharp(Buffer.from(svg)).resize(w, h).png().toBuffer();

/* ------------------------------- 小推车 ---------------------------------- */
// 4 帧：轮辐旋转 + 车身轻微起伏。触地线固定在 y=89（配合游戏内 origin 89/96）。
// 造型按"游戏内 82×61.5 像素下依然能认出是割草机"来设计：车身短而厚、轮子大、
// 引擎与推杆都有明确体积，避免变成一条红色长条。
async function mower() {
  const FW = 128, FH = 96, frames = 4;
  const frameSvg = (f) => {
    const a = (f * Math.PI) / 6;
    const bob = f % 2 ? 0.8 : 0;
    const O = 'stroke="#5d1f18" stroke-width="2.5" stroke-linejoin="round"';
    const wheel = (cx) => `
      <circle cx="${cx}" cy="73" r="16" fill="#1b2426" stroke="#0d1416" stroke-width="2.5"/>
      <circle cx="${cx}" cy="73" r="11.5" fill="none" stroke="#4d5c58" stroke-width="2"/>
      <circle cx="${cx}" cy="73" r="7" fill="url(#hub)" stroke="#5f6d69" stroke-width="1.5"/>
      ${[0, 1, 2].map((k) => {
        const ang = a + (k * Math.PI * 2) / 3;
        return `<line x1="${cx}" y1="73" x2="${cx + Math.cos(ang) * 7}" y2="${73 + Math.sin(ang) * 7}" stroke="#3d4a47" stroke-width="2.2"/>`;
      }).join("")}`;
    return `<g transform="translate(0 ${bob})">
      <ellipse cx="66" cy="89" rx="42" ry="5" fill="#101a14" opacity=".32"/>
      <!-- 推杆：粗且有握把 -->
      <path d="M46 58 L28 28 L15 27" fill="none" stroke="#1d282b" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M46 57 L28 28 L15 27" fill="none" stroke="#a6b6ab" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="8" y="21" width="13" height="11" rx="5" fill="#263234" stroke="#141d1f" stroke-width="2"/>
      <!-- 车身：短而厚 -->
      <rect x="34" y="54" width="66" height="27" rx="11" fill="url(#deck)" ${O}/>
      <rect x="39" y="56" width="52" height="7" rx="3.5" fill="#ffa077" opacity=".5"/>
      <rect x="37" y="73" width="60" height="6" rx="3" fill="#8a3126" opacity=".75"/>
      <!-- 前唇 / 出草口 -->
      <rect x="96" y="60" width="13" height="12" rx="4" fill="url(#metal)" stroke="#6f6a55" stroke-width="2"/>
      <!-- 引擎罩与空滤 -->
      <rect x="46" y="33" width="40" height="25" rx="9" fill="#8f3a2c" ${O}/>
      <rect x="52" y="24" width="30" height="13" rx="5" fill="#2a3634" stroke="#161f1e" stroke-width="2.5"/>
      <rect x="56" y="18" width="22" height="8" rx="4" fill="url(#metal)" stroke="#6f6a55" stroke-width="2"/>
      <circle cx="88" cy="40" r="4.5" fill="#f0c765" stroke="#8a6c22" stroke-width="1.6"/>
      ${[0, 1, 2].map((i) => `<line x1="${58 + i * 8}" y1="27" x2="${58 + i * 8}" y2="34" stroke="#5d6d68" stroke-width="2"/>`).join("")}
      ${wheel(46)}${wheel(90)}
    </g>`;
  };
  const buf = Buffer.alloc(FW * frames * FH * 4);
  for (let f = 0; f < frames; f++) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${FW}" height="${FH}">
      <defs>
        <linearGradient id="deck" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#f06a4c"/><stop offset=".55" stop-color="#d94a33"/><stop offset="1" stop-color="#a32f24"/></linearGradient>
        <linearGradient id="metal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#eae5cd"/><stop offset="1" stop-color="#a8a48a"/></linearGradient>
        <radialGradient id="hub" cx="38%" cy="34%" r="70%">
          <stop offset="0" stop-color="#d7ded6"/><stop offset="1" stop-color="#8d9a94"/></radialGradient>
      </defs>${frameSvg(f)}</svg>`;
    const { data, info } = await sharp(await png(svg, FW, FH))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (let y = 0; y < FH; y++)
      for (let x = 0; x < FW; x++) {
        const s = (y * FW + x) * info.channels, d = (y * FW + x + f * FW) * 4;
        buf[d] = data[s];
        buf[d + 1] = data[s + 1];
        buf[d + 2] = data[s + 2];
        buf[d + 3] = data[s + 3];
      }
  }
  await sharp(buf, { raw: { width: FW * frames, height: FH, channels: 4 } })
    .png()
    .toFile("public/assets/mower.png");
  console.log("public/assets/mower.png 512x96");
}

/* ------------------------------- 地形地块 -------------------------------- */
const outline = 'stroke="#3a4a44" stroke-width="3" stroke-linejoin="round"';

async function terrain() {
  // 墓碑 120×140：底边贴格心下方
  const grave = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="140">
    <defs><linearGradient id="st" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#dfe6e4"/><stop offset=".55" stop-color="#b3bfbd"/><stop offset="1" stop-color="#8d9a99"/></linearGradient></defs>
    <ellipse cx="60" cy="126" rx="40" ry="10" fill="#1d2a2c" opacity=".35"/>
    <path d="M22 128V56a38 38 0 0 1 76 0v72Z" fill="url(#st)" ${outline}/>
    <path d="M30 124V57a30 30 0 0 1 14-25v92Z" fill="#ffffff" opacity=".22"/>
    <path d="M60 62v46M44 78h32" stroke="#7c8a88" stroke-width="7" stroke-linecap="round" fill="none"/>
    <path d="M74 96l8 10-6 12" stroke="#8a9795" stroke-width="2" fill="none"/>
    <ellipse cx="34" cy="126" rx="12" ry="5" fill="#5c7a4a" opacity=".8"/>
    <circle cx="88" cy="124" r="5" fill="#7d9c5c"/><circle cx="76" cy="128" r="4" fill="#9ab86d"/>
  </svg>`;
  // 罐子 110×120
  const vase = `<svg xmlns="http://www.w3.org/2000/svg" width="110" height="120">
    <defs><linearGradient id="cl" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#e6c79b"/><stop offset=".5" stop-color="#c1986a"/><stop offset="1" stop-color="#8d6a45"/></linearGradient></defs>
    <ellipse cx="55" cy="108" rx="34" ry="9" fill="#2a2118" opacity=".35"/>
    <path d="M30 44q-14 30 6 50 12 12 19 12t19-12q20-20 6-50Z" fill="url(#cl)" ${outline}/>
    <rect x="26" y="30" width="58" height="16" rx="4" fill="#d9b184" ${outline}/>
    <path d="M38 62q10 10 8 26M70 58q-8 12-4 30" stroke="#9a7448" stroke-width="3" fill="none"/>
    <ellipse cx="42" cy="70" rx="7" ry="12" fill="#fff" opacity=".18"/>
    <path d="M52 96l10 6-6 10" stroke="#7d5c3a" stroke-width="2" fill="none"/>
  </svg>`;
  // 冰道 120×90
  const ice = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90">
    <defs><linearGradient id="ic" x1="0" y1="0" x2=".6" y2="1">
      <stop offset="0" stop-color="#e8f7ff"/><stop offset=".45" stop-color="#a9dced"/><stop offset="1" stop-color="#6fa9c4"/></linearGradient></defs>
    <path d="M14 46q6-26 34-30 30-4 46 12 16 16 4 34-14 20-46 20-40 0-38-36Z" fill="url(#ic)" fill-opacity=".92" stroke="#5c93ad" stroke-width="3"/>
    <path d="M26 40q14-14 34-12M22 56q18 8 40 6M40 74l14-40M62 76l12-32" stroke="#ffffff" stroke-width="3" fill="none" opacity=".75"/>
    <circle cx="88" cy="30" r="4" fill="#fff" opacity=".8"/>
  </svg>`;
  // 弹坑 120×80
  const crater = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80">
    <defs><radialGradient id="cr" cx="50%" cy="45%" r="60%">
      <stop offset="0" stop-color="#241f19"/><stop offset=".6" stop-color="#3c3227"/><stop offset="1" stop-color="#5b4c3a"/></radialGradient></defs>
    <ellipse cx="60" cy="44" rx="52" ry="30" fill="url(#cr)" opacity=".95"/>
    <ellipse cx="60" cy="44" rx="52" ry="30" fill="none" stroke="#2b2119" stroke-width="3"/>
    <path d="M22 30q18-10 40-8M34 58q22 8 44 0" stroke="#6b5a45" stroke-width="3" fill="none" opacity=".8"/>
    <circle cx="30" cy="24" r="5" fill="#4a3d2f"/><circle cx="94" cy="30" r="4" fill="#4a3d2f"/>
    <circle cx="52" cy="66" r="5" fill="#43372a"/><circle cx="82" cy="62" r="3" fill="#43372a"/>
    <path d="M40 18q6-12 16-14M76 16q8-8 16-6" stroke="#8a8378" stroke-width="3" fill="none" opacity=".35"/>
  </svg>`;
  const items = [
    ["grave", grave, 120, 140],
    ["vase", vase, 110, 120],
    ["ice", ice, 120, 90],
    ["crater", crater, 120, 80],
  ];
  for (const [name, svg, w, h] of items) {
    await sharp(await png(svg, w, h)).webp({ quality: 88 }).toFile(`public/assets/terrain/${name}.webp`);
    console.log(`public/assets/terrain/${name}.webp ${w}x${h}`);
  }
}

/* -------------------------------- 水面 ----------------------------------- */
async function water() {
  // 半透明水面叠加层：只用极淡的冷色渐变与细波纹，避免出现"圆点阵"平铺痕迹
  const W = 891, H = 168;
  const grad = `<defs>
      <linearGradient id="wv" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#8fd7e8" stop-opacity=".10"/>
        <stop offset=".5" stop-color="#5fb6d6" stop-opacity=".18"/>
        <stop offset="1" stop-color="#3d8fb4" stop-opacity=".12"/></linearGradient>
      <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".14" stop-color="#fff"/>
        <stop offset=".86" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
      <mask id="fm"><rect width="${W}" height="${H}" fill="url(#fade)"/></mask>
    </defs>`;
  const lines = Array.from({ length: 34 }, (_, i) => {
    const x = -40 + ((i * 173) % (W + 80));
    const y = 16 + ((i * 61) % (H - 32));
    const len = 90 + (i % 5) * 46;
    return `<path d="M${x} ${y}q${len / 2}-5 ${len} 0" stroke="#eafcff" stroke-width="${i % 3 === 0 ? 2 : 1}" fill="none" opacity="${0.05 + (i % 4) * 0.02}"/>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${grad}
    <rect width="${W}" height="${H}" fill="url(#wv)" mask="url(#fm)"/>
    <g mask="url(#fm)">${lines}</g>
  </svg>`;
  await sharp(await png(svg, W, H)).webp({ quality: 88 }).toFile("public/assets/water/water-strip.webp");
  console.log(`public/assets/water/water-strip.webp ${W}x${H}`);

  // 可平铺的细波纹：更淡、更细，平铺时不显重复
  const RW = 512, RH = 128;
  const ripples = Array.from({ length: 22 }, (_, i) => {
    const x = (i * 97) % RW, y = 10 + ((i * 37) % (RH - 20)), len = 60 + (i % 4) * 34;
    return `<path d="M${x} ${y}q${len / 2}-5 ${len} 0" stroke="#eafcff" stroke-width="1.5" fill="none" opacity="${0.1 + (i % 3) * 0.05}"/>`;
  }).join("");
  const ripple = `<svg xmlns="http://www.w3.org/2000/svg" width="${RW}" height="${RH}">${ripples}</svg>`;
  await sharp(await png(ripple, RW, RH)).webp({ quality: 88 }).toFile("public/assets/water/water-ripple.webp");
  console.log(`public/assets/water/water-ripple.webp ${RW}x${RH}`);
}

/* -------------------------------- Token ---------------------------------- */
async function tokens() {
  const sun = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96">
    <defs>
      <radialGradient id="core" cx="38%" cy="32%" r="72%">
        <stop offset="0" stop-color="#fffbe0"/><stop offset=".45" stop-color="#ffd95c"/><stop offset="1" stop-color="#e79a24"/></radialGradient>
      <radialGradient id="halo" cx="50%" cy="50%" r="50%">
        <stop offset=".55" stop-color="#ffe08a" stop-opacity=".55"/><stop offset="1" stop-color="#ffcf5c" stop-opacity="0"/></radialGradient>
    </defs>
    <circle cx="48" cy="48" r="46" fill="url(#halo)"/>
    ${Array.from({ length: 12 }, (_, i) => {
      const a = (i * Math.PI) / 6;
      const x1 = 48 + Math.cos(a) * 27, y1 = 48 + Math.sin(a) * 27;
      const x2 = 48 + Math.cos(a) * 40, y2 = 48 + Math.sin(a) * 40;
      const x3 = 48 + Math.cos(a + 0.22) * 31, y3 = 48 + Math.sin(a + 0.22) * 31;
      return `<path d="M${x1} ${y1}L${x2} ${y2}L${x3} ${y3}Z" fill="#f7b731" opacity=".9"/>`;
    }).join("")}
    <circle cx="48" cy="48" r="30" fill="url(#core)" stroke="#d9932a" stroke-width="3"/>
    <ellipse cx="38" cy="36" rx="10" ry="7" fill="#fffde6" opacity=".75"/>
  </svg>`;
  const coin = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96">
    <defs><linearGradient id="gold" x1="0" y1="0" x2=".7" y2="1">
      <stop offset="0" stop-color="#fff3b0"/><stop offset=".45" stop-color="#f0c14b"/><stop offset="1" stop-color="#c8901f"/></linearGradient></defs>
    <ellipse cx="48" cy="50" rx="30" ry="38" fill="url(#gold)" stroke="#a97b35" stroke-width="3"/>
    <ellipse cx="48" cy="50" rx="23" ry="30" fill="none" stroke="#fff0a8" stroke-width="3" opacity=".8"/>
    <path d="M56 34q-18-9-19 9 0 8 13 8 15 3 4 15-9 5-16-1" fill="none" stroke="#b8811f" stroke-width="4" stroke-linecap="round"/>
    <ellipse cx="38" cy="30" rx="8" ry="6" fill="#fffbdc" opacity=".7"/>
  </svg>`;
  await sharp(await png(sun, 96, 96)).webp({ quality: 90 }).toFile("public/assets/tokens/token-sun.webp");
  await sharp(await png(coin, 96, 96)).webp({ quality: 90 }).toFile("public/assets/tokens/token-coin.webp");
  console.log("public/assets/tokens/token-sun.webp / token-coin.webp 96x96");
}

if (!redraw("mower")) await mower();
else console.log("mower.png: 已由 AI 重绘提供，跳过程序化生成");
if (["grave","vase","ice","crater"].every((f) => redraw(f)))
  console.log("地形贴图: 已由 AI 重绘提供，跳过程序化生成");
else await terrain();
if (redraw("water-strip") && redraw("water-ripple"))
  console.log("水面贴图: 已由 AI 重绘提供，跳过程序化生成");
else await water();
if (redraw("token-sun") && redraw("token-coin"))
  console.log("token 贴图: 已由 AI 重绘提供，跳过程序化生成");
else await tokens();
