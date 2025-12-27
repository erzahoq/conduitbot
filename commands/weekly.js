const { SlashCommandBuilder, AttachmentBuilder } = require("discord.js");
const fs = require("fs").promises;
const path = require("path");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const {
  ensureVisibleOnDark,
  darkenColor,
  drawAvatarOutline,
  formatNum,
  getLevelFromXP
} = require("../helpers/functions");

// colours used for the small level badges
let LEVEL_COLOURS = [];
function getBaseColourForLevel(level) {
  if (LEVEL_COLOURS.length === 0) return "#4fe4dc";
  const safeLevel = Math.max(0, Math.floor(level));
  const index = safeLevel % LEVEL_COLOURS.length;
  return LEVEL_COLOURS[index];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("weeklylb")
    .setDescription("Shows the top XP users this week."),

  async execute(interaction) {
    await interaction.deferReply();

    // load weekly xp file
    const weeklyPath = path.join(__dirname, "..", "data", "xp_weekly.json");
    const raw = await fs.readFile(weeklyPath, "utf8");
    const weeklyData = JSON.parse(raw);

    const xpData = weeklyData.users || {};

    const sorted = Object.entries(xpData)
      .sort((a, b) => (b[1]?.xp ?? 0) - (a[1]?.xp ?? 0))
      .slice(0, 10);

    // canvas size + row height
    const rowHeight = 140;
    const width = 1200;
    const height = 80 + sorted.length * rowHeight;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    // background — dark checkerboard
    ctx.fillStyle = "#162024";
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "#192327";
    const box = 40;
    for (let y = 0; y < height; y += box) {
      for (let x = 0; x < width; x += box) {
        if (((x / box) + (y / box)) % 2 === 0) ctx.fillRect(x, y, box, box);
      }
    }

    // title
    ctx.fillStyle = "#4fe4dc";
    ctx.font = "70px Lexend Bold";
    ctx.textAlign = "center";
    ctx.fillText("WEEKLY LEADERBOARD", width / 2, 70);

    // draw each row
    let yOffset = 120;

    for (let i = 0; i < sorted.length; i++) {
      const [userId, data] = sorted[i];
      const xp = Math.floor(data?.xp ?? 0);

      // derive a level from the weekly xp (fine for a small badge)
      const level = getLevelFromXP(xp);
      const rank = i + 1;

      let member;
      try {
        member = await interaction.guild.members.fetch(userId);
      } catch {
        continue;
      }

      const user = member.user;

      const avatarX = 60;
      const avatarY = yOffset + 10;
      const avatarSize = 110;

      const avatarURL = user.displayAvatarURL({ extension: "png", size: 256 });
      const avatarImg = await loadImage(avatarURL);

      ctx.save();
      ctx.beginPath();
      ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(avatarImg, avatarX, avatarY, avatarSize, avatarSize);
      ctx.restore();

      drawAvatarOutline(ctx, avatarX, avatarY, avatarSize, "#4fe4dc", 7);

      // rank styling (gold/silver/bronze for top 3)
      ctx.font = "70px Lexend Bold";
      ctx.textAlign = "left";

      let rankStyle = "#4fe4dc";
      let rankStroke = null;

      if (rank === 1 || rank === 2 || rank === 3) {
        const grad = ctx.createLinearGradient(avatarX + avatarSize + 30, avatarY, avatarX + 300, avatarY + 80);

        if (rank === 1) {
          grad.addColorStop(0, "#fff6d0");
          grad.addColorStop(0.5, "#ffdd55");
          grad.addColorStop(1, "#d8a600");
        } else if (rank === 2) {
          grad.addColorStop(0, "#f0f0f0");
          grad.addColorStop(0.5, "#c0c0c0");
          grad.addColorStop(1, "#8c8c8c");
        } else {
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

      // name + auto-resize to fit
      let username = user.username.toUpperCase();
      let nameX = avatarX + avatarSize + 170;
      let nameY = avatarY + 75;

      let size = 60;
      for (; size >= 24; size -= 2) {
        ctx.font = `${size}px Lexend Bold`;
        if (ctx.measureText(username).width < 520) break;
      }

      ctx.fillStyle = "#4fe4dc";
      ctx.font = `${size}px Lexend Bold`;
      ctx.fillText(username, nameX, nameY);

      // weekly xp label
      ctx.font = "32px Lexend";
      ctx.fillStyle = "#b6c2cf";
      ctx.fillText(`Weekly XP: ${formatNum(xp)}`, nameX, nameY + 45);

      // mini hex badge with level number
      const hexX = width - 200;
      const hexY = avatarY + 55;
      const hexRadius = 45;

      const baseColour = ensureVisibleOnDark(getBaseColourForLevel(level));
      const dark = darkenColor(baseColour, 0.4);

      let c = baseColour;
      if (rank === 1) c = "#ffd700";
      if (rank === 2) c = "#c0c0c0";
      if (rank === 3) c = "#cd7f32";

      ctx.strokeStyle = dark;
      ctx.lineWidth = 7;
      drawHex(ctx, hexX, hexY, hexRadius);

      ctx.strokeStyle = c;
      ctx.lineWidth = 10;
      drawHex(ctx, hexX, hexY, hexRadius);

      ctx.fillStyle = c;
      ctx.font = "52px Lexend Bold";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(level.toString(), hexX, hexY);

      yOffset += rowHeight;
    }

    const buffer = canvas.toBuffer("image/png");
    const file = new AttachmentBuilder(buffer, { name: "weeklyleaderboard.png" });

    return interaction.editReply({ files: [file] });
  },
};

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
