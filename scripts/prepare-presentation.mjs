/** Reproducible, original vector artwork, rasterized for Phaser and the asset gallery. */
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
const root = 'public/assets/presentation';
await mkdir(root, { recursive: true });
const defs = `<defs><radialGradient id="green" cx="32%" cy="24%"><stop stop-color="#edffb7"/><stop offset=".45" stop-color="#9dcd4e"/><stop offset="1" stop-color="#467b30"/></radialGradient><radialGradient id="ice" cx="30%" cy="25%"><stop stop-color="#ffffff"/><stop offset=".4" stop-color="#b9f2fa"/><stop offset="1" stop-color="#458dbd"/></radialGradient><radialGradient id="purple" cx="30%" cy="25%"><stop stop-color="#f6e5ff"/><stop offset=".4" stop-color="#c696de"/><stop offset="1" stop-color="#705298"/></radialGradient><linearGradient id="gold" x2=".8" y2="1"><stop stop-color="#fff5ad"/><stop offset=".45" stop-color="#ffdc62"/><stop offset="1" stop-color="#d9892e"/></linearGradient><linearGradient id="flame" x1="0" x2="1"><stop stop-color="#ee693b" stop-opacity="0"/><stop offset=".4" stop-color="#f36e32"/><stop offset=".8" stop-color="#ffbf53"/><stop offset="1" stop-color="#fff5b4"/></linearGradient></defs>`;
const outline = 'stroke="#46653b" stroke-width="3" stroke-linejoin="round"';
const snowflake = `<path d="M64 37v54M41 50l46 28M41 78l46-28M58 42l6 6 6-6M58 86l6-6 6 6" fill="none" stroke="#fff" stroke-width="3" opacity=".8"/>`;
const leaf = `<path d="M37 83Q18 49 53 33Q90 18 103 54Q114 93 73 99Q50 103 37 83Z" fill="url(#green)" ${outline}/><path d="M44 86Q48 45 85 43M45 74Q78 75 89 52M52 88Q87 92 98 64M62 47Q73 60 76 72" fill="none" stroke="#d6eda1" stroke-width="4"/>`;
const melon = (ice=false) => `<ellipse cx="65" cy="65" rx="43" ry="35" fill="url(#${ice?'ice':'green'})" stroke="${ice?'#426d94':'#315f35'}" stroke-width="3"/><path d="M44 34Q18 66 45 96M63 30Q40 64 64 100M82 33Q65 65 83 97M99 45Q91 65 99 85" stroke="${ice?'#6cafd1':'#40793c'}" stroke-width="7" fill="none"/><ellipse cx="52" cy="45" rx="15" ry="7" fill="#fff" opacity=".25"/>${ice?snowflake:''}`;
const assets = {
 pea: `<circle cx="64" cy="64" r="35" fill="url(#green)" ${outline}/><ellipse cx="51" cy="47" rx="12" ry="8" fill="#fff" opacity=".65"/>`,
 icepea: `<circle cx="64" cy="64" r="35" fill="url(#ice)" stroke="#517ba2" stroke-width="3"/>${snowflake}`,
 spore: `<path d="M15 64Q28 41 48 48Q38 27 61 35Q95 26 104 52Q115 79 89 91Q67 106 46 86Q23 96 26 76Q7 85 15 64Z" fill="url(#purple)" stroke="#806090" stroke-width="2"/><circle cx="55" cy="54" r="6" fill="#fff" opacity=".5"/><circle cx="81" cy="72" r="4" fill="#efdbff"/><circle cx="10" cy="42" r="4" fill="#c696de" opacity=".6"/>`,
 needle: `<path d="M12 56L33 43 113 64 33 83 12 72 40 65Z" fill="url(#green)" stroke="#426548" stroke-width="3"/><path d="M33 57L109 64 35 68" fill="#f0f2c9"/><path d="M17 47L31 61 12 78" fill="none" stroke="#68833c" stroke-width="4"/>`,
 homing: `<path d="M8 38L44 57 112 64 44 71 8 90 23 64Z" fill="#8aa7b6" stroke="#405c72" stroke-width="3"/><path d="M31 57L110 64 31 68" fill="#f3f8e3"/><path d="M13 46L36 63 14 82" fill="none" stroke="#75c5b6" stroke-width="5"/>`,
 cabbage: leaf,
 kernel: `<path d="M38 89Q25 68 36 44Q48 23 74 30Q99 38 97 64Q94 88 73 98Q50 104 38 89Z" fill="url(#gold)" stroke="#aa7734" stroke-width="3"/><path d="M45 48Q48 36 65 37" fill="none" stroke="#fff9ca" stroke-width="8" stroke-linecap="round"/><path d="M49 89Q70 87 84 72" fill="none" stroke="#e4ab42" stroke-width="4"/>`,
 butter: `<path d="M25 46L78 32 104 47 104 87 51 101 25 84Z" fill="#e3a638" stroke="#a87834" stroke-width="3" stroke-linejoin="round"/><path d="M25 46L78 32 104 47 51 62Z" fill="#fff4a0"/><path d="M25 46L51 62V101L25 84Z" fill="#ffdf67"/><path d="M35 52L52 62 52 87" fill="none" stroke="#fff7bd" stroke-width="5"/><path d="M63 83Q80 82 90 75" fill="none" stroke="#ffd96b" stroke-width="5"/>`,
 melon: melon(), winter: melon(true),
 star: `<path d="M64 16L77 47 112 49 85 71 94 106 64 87 34 106 43 71 16 49 51 47Z" fill="url(#gold)" stroke="#a47c32" stroke-width="3" stroke-linejoin="round"/><path d="M64 29L64 68 31 53 55 52Z" fill="#fffbc0" opacity=".8"/><circle cx="55" cy="63" r="3" fill="#80653b"/><circle cx="73" cy="63" r="3" fill="#80653b"/>`,
 fire: `<path d="M5 30Q30 55 43 39L30 14Q67 20 77 41Q112 32 116 65Q112 102 76 89Q51 113 17 100L37 78Q15 79 3 65L28 58Z" fill="url(#flame)"/><ellipse cx="86" cy="65" rx="24" ry="25" fill="#ffd667"/><ellipse cx="93" cy="61" rx="13" ry="15" fill="#fff5bd"/>`,
 cob: `<path d="M18 73L31 43Q55 25 100 40L114 63 100 84Q61 99 31 91Z" fill="url(#gold)" stroke="#897238" stroke-width="3"/><path d="M32 45L44 89M49 38L60 92M67 37L78 89M85 39L96 84M28 59L104 53M26 74L105 69" stroke="#d49734" stroke-width="3"/><path d="M4 89Q12 56 34 43L37 93Z" fill="#65974d" stroke="#426b39" stroke-width="3"/>`,
 basketball: `<circle cx="64" cy="64" r="40" fill="#e69543" stroke="#5c4d39" stroke-width="4"/><path d="M24 64h80M64 24v80M38 34Q80 64 38 94M91 34Q48 64 91 94" fill="none" stroke="#714d30" stroke-width="3"/><ellipse cx="49" cy="43" rx="13" ry="8" fill="#ffce8b" opacity=".6"/>`,
 snowball: `<path d="M27 41L56 23 86 30 106 57 99 87 70 105 39 95 22 69Z" fill="url(#ice)" stroke="#6b9dbc" stroke-width="3"/>${snowflake}`,
 sun: `<path d="M64 4L72 28 92 13 91 39 118 36 102 57 125 69 99 79 109 104 82 99 72 125 58 101 35 116 36 89 9 92 26 69 3 57 29 47 18 23 45 29Z" fill="#f8c653"/><circle cx="64" cy="64" r="32" fill="url(#gold)" stroke="#d5a144" stroke-width="3"/><ellipse cx="54" cy="49" rx="12" ry="8" fill="#fffac7"/>`,
 coin: `<ellipse cx="64" cy="65" rx="32" ry="42" fill="url(#gold)" stroke="#a97b35" stroke-width="4"/><ellipse cx="64" cy="64" rx="24" ry="32" fill="none" stroke="#ffef9f" stroke-width="4"/><path d="M74 42Q49 30 48 54Q48 64 66 65Q88 71 72 87Q59 93 49 83M64 34v62" fill="none" stroke="#ba8434" stroke-width="5"/>`,
 shield: `<path d="M64 14L104 30V64Q102 94 64 114Q26 94 24 64V30Z" fill="#b0d7d5" fill-opacity=".55" stroke="#e5ffed" stroke-width="4"/><path d="M44 61L59 77 88 43" fill="none" stroke="#faffd7" stroke-width="7" stroke-linecap="round"/>`,
 magnet: `<path d="M32 28V68Q32 101 64 101Q96 101 96 68V28" fill="none" stroke="#743859" stroke-width="22"/><path d="M32 28V49M96 28V49" fill="none" stroke="#d2e5df" stroke-width="21"/><path d="M14 42L6 53M114 42L122 53M61 8L64 20" stroke="#f2c66d" stroke-width="4"/>`,
 crack: `<path d="M48 15L61 36 49 53 76 68 60 89 75 113M49 53L29 61M76 68L98 54M60 89L40 96" fill="none" stroke="#493e32" stroke-width="5" stroke-linejoin="round"/><path d="M51 16L65 36 54 52M80 68L65 89" fill="none" stroke="#ecd496" stroke-width="2"/>`,
 iceblock: `<path d="M24 36L77 20 108 37 103 103 46 115 20 94Z" fill="#a3e9f6" fill-opacity=".38" stroke="#c7f6ff" stroke-width="3"/><path d="M24 36L48 53 108 37M48 53L46 115M34 52L32 84M84 51L61 90M97 76L81 97" fill="none" stroke="#efffff" stroke-width="4" opacity=".8"/>`,
 sleep: `<path d="M27 73H52L27 98H53M61 32H98L61 65H99" fill="none" stroke="#e9e6ff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`,
 splash: `<path d="M15 89L32 74 24 42 49 65 61 20 73 62 100 34 93 73 115 88Q65 112 15 89Z" fill="#9de2e0" fill-opacity=".7" stroke="#d5fff2" stroke-width="3"/><circle cx="17" cy="30" r="5" fill="#c0f4ee"/><circle cx="110" cy="19" r="4" fill="#c0f4ee"/>`,
 dust: `<path d="M20 85Q1 56 35 57Q29 28 56 35Q74 14 89 48Q123 47 109 80Q92 109 68 95Q43 111 20 85Z" fill="#cbb998" fill-opacity=".65"/>`,
 impact: `<path d="M64 6L73 44 111 22 87 55 125 67 85 77 107 111 72 87 59 125 50 85 16 108 39 73 4 60 43 51 23 17 55 42Z" fill="#fff3bd"/><circle cx="64" cy="65" r="16" fill="#ffffff"/>`,
 bloom: `<g fill="#f5d6ed" stroke="#b37fa8" stroke-width="2"><ellipse cx="64" cy="42" rx="16" ry="27"/><ellipse cx="85" cy="62" rx="27" ry="16"/><ellipse cx="64" cy="86" rx="16" ry="27"/><ellipse cx="41" cy="63" rx="27" ry="16"/></g><circle cx="64" cy="64" r="17" fill="url(#gold)"/>`,
 wind: `<path d="M13 43H91Q117 42 104 26Q96 17 85 26M8 66H107M23 85H83Q104 85 94 103Q85 114 74 103" fill="none" stroke="#d8f2db" stroke-width="7" stroke-linecap="round"/>`,
 ring: `<circle cx="64" cy="64" r="45" fill="none" stroke="#e4d3fa" stroke-width="7"/><circle cx="64" cy="64" r="33" fill="none" stroke="#af91cf" stroke-width="3" stroke-dasharray="8 12"/>`,
};
for (const [id, body] of Object.entries(assets)) {
 const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">${defs}${body}</svg>`;
 await writeFile(`${root}/${id}.svg`,svg);
 await sharp(Buffer.from(svg)).webp({lossless:true}).toFile(`${root}/${id}.webp`);
}
await writeFile(`${root}/manifest.json`, JSON.stringify({version:1,license:'Original artwork created for this project',size:128,assets:Object.keys(assets)},null,2)+'\n');
console.log(`Prepared ${Object.keys(assets).length} presentation illustrations (SVG + transparent WebP).`);
