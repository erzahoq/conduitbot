const {
  SlashCommandBuilder,
  AttachmentBuilder
} = require("discord.js");

const fs = require("fs").promises;
const path = require("path");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

// import your existing rank utils:
const { xpForLevel, getLevelFromXP } = require("../helpers/functions"); 
// OR adjust path to wherever you store xp functions.

const { 
  ensureVisibleOnDark,
  darkenColor,
  drawAvatarOutline,
  formatNum
} = require("../helpers/functions"); // path depends on your project

//get colours
let LEVEL_COLOURS = [];
function getBaseColourForLevel(level) {
  if (LEVEL_COLOURS.length === 0) return "#4fe4dc"; // fallback

  const safeLevel = Math.max(0, Math.floor(level));

  // If level exceeds list length, loop the list
  const index = safeLevel % LEVEL_COLOURS.length;

  return LEVEL_COLOURS[index];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Shows the top XP users in the server."),

  async execute(interaction) {
    await interaction.deferReply();


    // --- Load XP JSON ---
    const xpPath = path.join(__dirname, "..", "data", "xp.json");
    const raw = await fs.readFile(xpPath, "utf8");
    const xpData = JSON.parse(raw);

    // Sort users by XP
    const sorted = Object.entries(xpData)
      .sort((a, b) => b[1].xp - a[1].xp)
      .slice(0, 10); // top 10

    // --- Canvas sizing ---
    const rowHeight = 140;
    const width = 1200;
    const height = 80 + sorted.length * rowHeight;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    // --- BACKGROUND (checkerboard) ---
    ctx.fillStyle = "#162024";
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "#192327";
    const box = 40;
    for (let y = 0; y < height; y += box) {
      for (let x = 0; x < width; x += box) {
        if (((x / box) + (y / box)) % 2 === 0) {
          ctx.fillRect(x, y, box, box);
        }
      }
    }

    // --- Title ---
    ctx.fillStyle = "#4fe4dc";
    ctx.font = "70px Lexend Bold";
    ctx.textAlign = "center";
    ctx.fillText("LEADERBOARD", width / 2, 70);

    // --- Row rendering ---
    let yOffset = 120;

    for (let i = 0; i < sorted.length; i++) {
      const [userId, data] = sorted[i];
      const xp = Math.floor(data.xp);
      const level = getLevelFromXP(xp);

      const rank = i + 1;

      // fetch member
      let member;
      try {
        member = await interaction.guild.members.fetch(userId);
      } catch {
        continue; // user left server
      }

      const user = member.user;

      // row positions
      const avatarX = 60;
      const avatarY = yOffset + 10;
      const avatarSize = 110;

      // --- Avatar ---
      const avatarURL = user.displayAvatarURL({ extension: "png", size: 256 });
      const avatarImg = await loadImage(avatarURL);

      ctx.save();
      ctx.beginPath();
      ctx.arc(avatarX + avatarSize/2, avatarY + avatarSize/2, avatarSize/2, 0, Math.PI*2);
      ctx.clip();
      ctx.drawImage(avatarImg, avatarX, avatarY, avatarSize, avatarSize);
      ctx.restore();

      drawAvatarOutline(ctx, avatarX, avatarY, avatarSize, "#4fe4dc", 7);

      // --- Rank text (#1 etc) ---
      ctx.font = "70px Lexend Bold";
      ctx.textAlign = "left";

      let rankStyle = "#4fe4dc";
      let rankStroke = null;

      // Metallic for 1–3
      if (rank === 1 || rank === 2 || rank === 3) {
        const grad = ctx.createLinearGradient(avatarX + avatarSize + 30, avatarY, avatarX + 300, avatarY + 80);
        if (rank === 1) {
          grad.addColorStop(0, "#fff6d0");
          grad.addColorStop(0.5, "#ffdd55");
          grad.addColorStop(1, "#d8a600");
        }
        else if (rank === 2) {
          grad.addColorStop(0, "#f0f0f0");
          grad.addColorStop(0.5, "#c0c0c0");
          grad.addColorStop(1, "#8c8c8c");
        }
        else if (rank === 3) {
          grad.addColorStop(0, "#ffe2c2");
          grad.addColorStop(0.5, "#cd7f32");
          grad.addColorStop(1, "#8a4e1f");
        }
        rankStyle = grad;
        rankStroke = "rgba(0,0,0,0.6)";
      }

      if (rankStroke) {
        ctx.strokeStyle = rankStroke;
        ctx.lineWidth = 6;
        ctx.strokeText(`#${rank}`, avatarX + avatarSize + 30, avatarY + 75);
      }

      ctx.fillStyle = rankStyle;
      ctx.fillText(`#${rank}`, avatarX + avatarSize + 30, avatarY + 75);

      // --- Username ---
      let username = user.username.toUpperCase();
      let nameX = avatarX + avatarSize + 170;
      let nameY = avatarY + 75;

      // auto-fit
      let size = 60;
      for (; size >= 24; size -= 2) {
        ctx.font = `${size}px Lexend Bold`;
        if (ctx.measureText(username).width < 520) break;
      }

      ctx.fillStyle = "#4fe4dc";
      ctx.font = `${size}px Lexend Bold`;
      ctx.fillText(username, nameX, nameY);

      // --- XP TEXT ---
      ctx.font = "32px Lexend";
      ctx.fillStyle = "#b6c2cf";

      ctx.fillText(
        `XP: ${formatNum(xp)}`,
        nameX,
        nameY + 45
      );

      // --- MINI HEX LEVEL ---
      const hexX = width - 200;
      const hexY = avatarY + 55;
      const hexRadius = 45;

      const baseColour = ensureVisibleOnDark(getBaseColourForLevel(level));
      const dark = darkenColor(baseColour, 0.4);

      // Override for top 3
      let c = baseColour;
      if (rank === 1) c = "#ffd700";
      if (rank === 2) c = "#c0c0c0";
      if (rank === 3) c = "#cd7f32";

      // hex outline (dark)
      ctx.strokeStyle = dark;
      ctx.lineWidth = 7;
      drawHex(ctx, hexX, hexY, hexRadius);

      // progress outline (bright)
      ctx.strokeStyle = c;
      ctx.lineWidth = 10;
      drawHex(ctx, hexX, hexY, hexRadius);

      // level text inside hex
      ctx.fillStyle = c;
      ctx.font = "52px Lexend Bold";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(level.toString(), hexX, hexY);

      yOffset += rowHeight;
    }

    const buffer = canvas.toBuffer("image/png");
    const file = new AttachmentBuilder(buffer, { name: "leaderboard.png" });

    return interaction.editReply({ files: [file] });
  },
};



// Helper to draw a hexagon
function drawHex(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    const px = x + r * Math.cos(angle);
    const py = y + r * Math.sin(angle);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.stroke();
}
