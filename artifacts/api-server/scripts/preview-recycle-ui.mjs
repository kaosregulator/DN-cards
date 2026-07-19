import { createCanvas } from "@napi-rs/canvas";
import fs from "node:fs/promises";
import path from "node:path";

const WIDTH = 900;
const HEIGHT = 700;
const canvas = createCanvas(WIDTH, HEIGHT);
const ctx = canvas.getContext("2d");

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// Discord dark theme background
ctx.fillStyle = "#36393f";
ctx.fillRect(0, 0, WIDTH, HEIGHT);

// Message background
ctx.fillStyle = "#2f3136";
roundRect(24, 24, WIDTH - 48, HEIGHT - 48, 16);
ctx.fill();

// Bot avatar placeholder
ctx.fillStyle = "#5865f2";
ctx.beginPath();
ctx.arc(70, 80, 24, 0, Math.PI * 2);
ctx.fill();
ctx.fillStyle = "#ffffff";
ctx.font = "bold 18px sans-serif";
ctx.textAlign = "center";
ctx.textBaseline = "middle";
ctx.fillText("DN", 70, 80);

// Bot name
ctx.textAlign = "left";
ctx.fillStyle = "#ffffff";
ctx.font = "bold 20px sans-serif";
ctx.fillText("DN Cards", 106, 70);
ctx.fillStyle = "#a3a6aa";
ctx.font = "14px sans-serif";
ctx.fillText("Today at 12:34 PM", 210, 70);

// Embed side bar
ctx.fillStyle = "#2ecc71";
ctx.fillRect(106, 106, 4, 420);

// Embed title
ctx.fillStyle = "#ffffff";
ctx.font = "bold 18px sans-serif";
ctx.fillText("♻️ Recycle Card Generator", 124, 126);

// Embed description
ctx.fillStyle = "#b9bbbe";
ctx.font = "15px sans-serif";
ctx.fillText("Pick a card from the dropdown to view it, or tap one of the quick actions below.", 124, 156);

// Placeholder canvas area (hub cards)
ctx.fillStyle = "#1a1c23";
roundRect(124, 180, 620, 230, 12);
ctx.fill();
ctx.fillStyle = "#4f545c";
ctx.font = "16px sans-serif";
ctx.textAlign = "center";
ctx.fillText("[Hub canvas: top duplicate cards]", 124 + 620/2, 180 + 230/2);
ctx.textAlign = "left";

// Select menu label
ctx.fillStyle = "#b9bbbe";
ctx.font = "12px sans-serif";
ctx.fillText("PICK A CARD TO RECYCLE", 124, 440);

// Discord select menu dropdown
function drawSelectMenu(x, y, w, h, placeholder, options) {
  ctx.fillStyle = "#202225";
  roundRect(x, y, w, h, 8);
  ctx.fill();
  ctx.strokeStyle = "#40444b";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "#b9bbbe";
  ctx.font = "14px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(placeholder, x + 14, y + h/2);
  // dropdown arrow
  ctx.fillStyle = "#b9bbbe";
  ctx.beginPath();
  ctx.moveTo(x + w - 22, y + h/2 - 4);
  ctx.lineTo(x + w - 14, y + h/2 - 4);
  ctx.lineTo(x + w - 18, y + h/2 + 4);
  ctx.fill();
  // Expanded options
  let oy = y + h + 8;
  const optH = 48;
  ctx.fillStyle = "#18191c";
  roundRect(x, oy, w, options.length * optH + 8, 8);
  ctx.fill();
  options.forEach((opt, i) => {
    const optY = oy + 4 + i * optH;
    ctx.fillStyle = i === 0 ? "#5865f2" : "#18191c";
    roundRect(x + 4, optY, w - 8, optH - 2, 4);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "14px sans-serif";
    ctx.fillText(opt.label, x + 14, optY + 17);
    ctx.fillStyle = "#b9bbbe";
    ctx.font = "12px sans-serif";
    ctx.fillText(opt.description, x + 14, optY + 35);
  });
}

const options = [
  { label: "⭐⭐⭐ Commander X", description: "×12 copies" },
  { label: "⭐⭐ Lieutenant Vance", description: "×7 copies" },
  { label: "⭐ Sergeant K9", description: "×5 copies" },
];

drawSelectMenu(124, 454, 620, 42, "🔍 Pick a card to recycle…", options);

// Buttons
function drawButton(x, y, w, h, label, color, textColor = "#ffffff") {
  ctx.fillStyle = color;
  roundRect(x, y, w, h, 6);
  ctx.fill();
  ctx.fillStyle = textColor;
  ctx.font = "bold 14px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + w/2, y + h/2);
}

drawButton(124, 620, 170, 38, "♻️ Recycle Top Card", "#3ba55c");
drawButton(310, 620, 240, 38, "🌟 Merge All into Top Card", "#5865f2");

const outDir = "screenshots";
await fs.mkdir(outDir, { recursive: true });
const outPath = path.join(outDir, "recycle-select-menu-preview.png");
const buffer = await canvas.encode("png");
await fs.writeFile(outPath, buffer);
console.log(outPath);
