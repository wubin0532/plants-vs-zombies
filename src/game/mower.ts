import type Phaser from "phaser";

/** Draw once, then batch the enlarged mower as a GPU sprite during gameplay. */
export function bakeMower(scene: Phaser.Scene) {
  const atlas = scene.textures.createCanvas("mower", 512, 96)!;
  const c = atlas.context;
  const rounded = (x: number, y: number, w: number, h: number, r: number, color: string) => {
    c.fillStyle = color;
    c.beginPath();
    c.roundRect(x, y, w, h, r);
    c.fill();
  };
  for (let frame = 0; frame < 4; frame++) {
    c.save();
    c.translate(frame * 128, 0);
    c.fillStyle = "#15241640";
    c.beginPath(); c.ellipse(69, 84, 49, 7, 0, 0, Math.PI * 2); c.fill();
    // Rear handle and rubber grip, raised above the engine housing.
    c.lineCap = "round";
    c.lineJoin = "round";
    c.strokeStyle = "#283437"; c.lineWidth = 8;
    c.beginPath(); c.moveTo(42, 62); c.lineTo(24, 18); c.lineTo(9, 18); c.stroke();
    c.strokeStyle = "#bbc6b7"; c.lineWidth = 4;
    c.beginPath(); c.moveTo(42, 61); c.lineTo(24, 18); c.lineTo(9, 18); c.stroke();
    c.strokeStyle = "#283437"; c.lineWidth = 8;
    c.beginPath(); c.moveTo(8, 18); c.lineTo(23, 18); c.stroke();
    // Broad red cutting deck, metal bumper, air-cooled motor and fuel cap.
    rounded(25, 55, 91, 24, 9, "#702d29");
    rounded(26, 50, 87, 23, 8, "#d14b36");
    rounded(31, 51, 76, 5, 2, "#f68a56");
    rounded(40, 33, 49, 24, 7, "#303e3b");
    rounded(44, 29, 43, 15, 5, "#d1cbb0");
    rounded(54, 25, 21, 6, 2, "#293734");
    rounded(99, 62, 21, 9, 3, "#b7c1aa");
    rounded(30, 58, 12, 5, 2, "#f5d476");
    c.strokeStyle = "#69796b"; c.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      c.beginPath(); c.moveTo(49 + i * 9, 35); c.lineTo(49 + i * 9, 40); c.stroke();
    }
    for (const x of [42, 98]) {
      c.fillStyle = "#1c292b";
      c.beginPath(); c.arc(x, 76, 13, 0, Math.PI * 2); c.fill();
      c.strokeStyle = "#485754"; c.lineWidth = 2;
      c.beginPath(); c.arc(x, 76, 10, 0, Math.PI * 2); c.stroke();
      c.fillStyle = "#b7c5b6";
      c.beginPath(); c.arc(x, 76, 6, 0, Math.PI * 2); c.fill();
      c.strokeStyle = "#53645b"; c.lineWidth = 2;
      for (let spoke = 0; spoke < 3; spoke++) {
        const angle = frame * Math.PI / 6 + spoke * Math.PI * 2 / 3;
        c.beginPath(); c.moveTo(x, 76);
        c.lineTo(x + Math.cos(angle) * 6, 76 + Math.sin(angle) * 6); c.stroke();
      }
    }
    c.restore();
    atlas.add(frame, 0, frame * 128, 0, 128, 96);
  }
  atlas.refresh();
}
