//todo: make the ranks gold/silver/bronze use percentiles instead of absolute positions

const {
  SlashCommandBuilder,
  AttachmentBuilder,
  EmbedBuilder
} = require("discord.js");
const fs = require("fs").promises;
const path = require("path");
const { GlobalFonts, createCanvas, loadImage } = require("@napi-rs/canvas");
const { getEffectiveMultiplier, formatMultiplier, loadMultipliers } = require("../helpers/xpmult");


const { 
  ensureVisibleOnDark,
  darkenColor,
  drawAvatarOutline,
  formatNum,
  getLevelFromXP,
  xpForLevel
} = require("../helpers/functions"); // path depends on your project

//get colours
let LEVEL_COLOURS = [];

async function loadLevelColours() {
  const filePath = path.join(__dirname, "..", "data", "level_colours.txt");
  const raw = await fs.readFile(filePath, "utf8");

  LEVEL_COLOURS = raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => /^#?[0-9A-Fa-f]{6}$/.test(line)) // keep only hex values
    .map(line => line.startsWith("#") ? line : "#" + line); // ensure # prefix
}

// Immediately load at startup
loadLevelColours();


GlobalFonts.registerFromPath(
  path.join(__dirname, "..", "assets", "fonts", "Lexend-ExtraBold.ttf"),
  "Lexend Bold"
);

GlobalFonts.registerFromPath(
  path.join(__dirname, "..", "assets", "fonts", "Lexend-SemiBold.ttf"),
  "Lexend"
);

/* ---------------- XP + LEVEL FUNCTIONS ---------------- */

function hexToRgba(hex, alpha = 1) {
  let c = hex.replace("#", "");
  if (c.length === 3) {
    c = c.split("").map(ch => ch + ch).join("");
  }
  const num = parseInt(c, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getBaseColourForLevel(level) {
  if (LEVEL_COLOURS.length === 0) return "#4fe4dc"; // fallback

  const safeLevel = Math.max(0, Math.floor(level));

  // If level exceeds list length, loop the list
  const index = safeLevel % LEVEL_COLOURS.length;

  return LEVEL_COLOURS[index];
}

/* ---------------- RANK CARD DRAWING ---------------- */

async function generateRankCard(
  memberOrUser,
  xp,
  level,
  rank,
  progress,
  needed,
  multiplier,
  behindXP,
  behindRankLabel
) {

  const user = memberOrUser.user || memberOrUser;
  const member = memberOrUser.user ? memberOrUser : null;

  const width = 1430;
  const height = 330;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // --- LAYOUT ANCHORS ---
  const avatarX = 40;
  const avatarY = 40;
  const avatarSize = 160;

  // hex on the far right
  const hexRadius = height / 2.7;
  const centerX = width - 180; // further from right edge so glow stays on canvas
  const centerY = height / 2;

  // y-positions for the right-side lines
  const bulletYs = [75, 135, 185, 235];


  // ----- COLOUR PALETTE -----

  let levelColour = ensureVisibleOnDark(getBaseColourForLevel(level));
  let levelDarkColour = darkenColor(levelColour, 0.5);

  const uiBaseColourHex = "#4fe4dc";
  let uiFillStyle = uiBaseColourHex;
  let uiStrokeStyle = uiBaseColourHex;
  let uiDarkStrokeStyle = darkenColor(uiBaseColourHex, 0.5);

  let rankFillStyle = uiFillStyle;
  let rankStrokeStyle = null;

// Move rank upward to fill old username space
  const rankTextX = avatarX + avatarSize + 20;
  const rankTextY = avatarY + 10;   // move UP



  const rankBehindY = rankTextY + 100; // a bit tighter under the rank



  // Metallic override for top 3
  if (rank === 1 || rank === 2 || rank === 3) {
    const grad = ctx.createLinearGradient(
      rankTextX,
      rankTextY - 60,
      rankTextX + 260,
      rankTextY + 20
    );

    if (rank === 1) {
      grad.addColorStop(0.0, "#fff8d5");
      grad.addColorStop(0.25, "#ffe37a");
      grad.addColorStop(0.5, "#ffd700");
      grad.addColorStop(0.75, "#e3b400");
      grad.addColorStop(1.0, "#fff1a0");
      uiDarkStrokeStyle = "#b18400";

      levelColour = "#ffd700";
      levelDarkColour = darkenColor(levelColour, 0.5);
    } else if (rank === 2) {
      grad.addColorStop(0.0, "#f8f8f8");
      grad.addColorStop(0.25, "#d8d8d8");
      grad.addColorStop(0.5, "#c0c0c0");
      grad.addColorStop(0.75, "#9e9e9e");
      grad.addColorStop(1.0, "#f4f4f4");
      uiDarkStrokeStyle = "#777777";

      levelColour = "#c0c0c0";
      levelDarkColour = darkenColor(levelColour, 0.5);
    } else if (rank === 3) {
      grad.addColorStop(0.0, "#ffe0c0");
      grad.addColorStop(0.25, "#e8a06a");
      grad.addColorStop(0.5, "#cd7f32");
      grad.addColorStop(0.75, "#9a5a24");
      grad.addColorStop(1.0, "#f3c08a");
      uiDarkStrokeStyle = "#6a3f18";

      levelColour = "#cd7f32";
      levelDarkColour = darkenColor(levelColour, 0.5);
    }

    uiFillStyle = grad;
    uiStrokeStyle = grad;
    rankFillStyle = grad;
    rankStrokeStyle = "rgba(0, 0, 0, 0.6)";
  }

  // ----- BACKGROUND (checkerboard) -----
  ctx.fillStyle = "#162024";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#192327";
  const boxSize = 40;
  for (let y = 0; y < height; y += boxSize) {
    for (let x = 0; x < width; x += boxSize) {
      if ((x / boxSize + y / boxSize) % 2 === 0) {
        ctx.fillRect(x, y, boxSize, boxSize);
      }
    }
  }

  // ----- AVATAR -----
  const avatarURL = user.displayAvatarURL({ extension: "png", size: 256 });
  const avatar = await loadImage(avatarURL);

  ctx.save();
  ctx.beginPath();
  ctx.arc(
    avatarX + avatarSize / 2,
    avatarY + avatarSize / 2,
    avatarSize / 2,
    0,
    Math.PI * 2
  );
  ctx.clip();
  ctx.drawImage(avatar, avatarX, avatarY, avatarSize, avatarSize);
  ctx.restore();

  drawAvatarOutline(ctx, avatarX, avatarY, avatarSize, uiStrokeStyle, 8);

  // handle / tag
  // Put handle directly under avatar
  const handleX = avatarX + avatarSize / 2;  // centered under avatar
  const handleY = avatarY + avatarSize + 10; // right below the circle

  ctx.font = `30px Lexend`;
  ctx.fillStyle = "#b6c2cf";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(`@${user.username.toLowerCase()}`, handleX, handleY);


  // ----- RANK TEXT (big # on left-bottom) -----
  ctx.font = "100px Lexend Bold";
  ctx.lineJoin = "round";
  ctx.lineWidth = 6;
  ctx.textAlign = "left";


  let rankDisplay = rank === 0 ? "-" : `#${rank}`;

  if (rankStrokeStyle) {
    ctx.strokeStyle = rankStrokeStyle;
    ctx.strokeText(rankDisplay, rankTextX, rankTextY);
  }

  ctx.fillStyle = rankFillStyle;
  ctx.fillText(rankDisplay, rankTextX, rankTextY);

  // ----- BEHIND TEXT UNDER RANK -----
  if (behindXP != null && behindRankLabel) {
    ctx.font = "32px Lexend";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#b6c2cf";

    ctx.fillText(
      `${formatNum(behindXP)} behind ${behindRankLabel}`,
      rankTextX + 0,
      rankBehindY
    );
  }


  // RIGHT-SIDE XP INFO (closer to rank block)
  const xpLeft = Math.max(0, needed - progress);
  // just to the right of avatar + rank block
  const infoX = avatarX + avatarSize + 370; 

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  // Line 1: current / needed
  ctx.font = "70px Lexend";
  ctx.fillStyle = uiFillStyle;
  ctx.fillText(
    `${formatNum(progress)} / ${formatNum(needed)}`,
    infoX,
    bulletYs[0]
  );

  // Line 2: XP left
  ctx.font = "32px Lexend";
  ctx.fillStyle = "#b6c2cf";
  ctx.fillText(
    `${formatNum(xpLeft)} XP to next`,
    infoX,
    bulletYs[1]
  );

  // Line 3: total xp
  ctx.font = "38px Lexend";
  ctx.fillStyle = uiFillStyle;
  ctx.fillText(
    `${formatNum(xp)} total`,
    infoX,
    bulletYs[2]
  );

  // Line 4: gain + "behind" (if applicable)
  ctx.font = "32px Lexend";
  ctx.fillStyle = "#b6c2cf";

  const multText = formatMultiplier(
    Number.isFinite(multiplier) ? multiplier : 1
  );

  let extraLine = `${multText} gain`;

  ctx.fillText(extraLine, infoX, bulletYs[3]);


  // ----- HEXAGON PROGRESS BAR (LEVEL COLOUR) -----
  const percent = Math.max(
    0,
    Math.min(needed > 0 ? progress / needed : 0, 1)
  );
  const segments = 6;
  const fullRadians = Math.PI * 2;

  const hexPoints = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i * fullRadians) / segments - Math.PI / 2;
    hexPoints.push({
      x: centerX + hexRadius * Math.cos(angle),
      y: centerY + hexRadius * Math.sin(angle),
    });
  }

  // background outline
  ctx.strokeStyle = levelDarkColour;
  ctx.lineWidth = 10;
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(hexPoints[0].x, hexPoints[0].y);
  for (let i = 1; i < hexPoints.length; i++) {
    ctx.lineTo(hexPoints[i].x, hexPoints[i].y);
  }
  ctx.closePath();
  ctx.stroke();

  // progress outline
  ctx.strokeStyle = levelColour;
  ctx.lineWidth = 20;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const segLengths = [];
  let totalPerim = 0;
  for (let i = 0; i < segments; i++) {
    const p1 = hexPoints[i];
    const p2 = hexPoints[(i + 1) % segments];
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    segLengths.push(len);
    totalPerim += len;
  }

  let remaining = totalPerim * percent;
  if (remaining > 0) {
    ctx.beginPath();
    let firstMoveDone = false;

    for (let i = 0; i < segments && remaining > 0; i++) {
      const p1 = hexPoints[i];
      const p2 = hexPoints[(i + 1) % segments];
      const len = segLengths[i];

      if (!firstMoveDone) {
        ctx.moveTo(p1.x, p1.y);
        firstMoveDone = true;
      }

      if (remaining >= len) {
        ctx.lineTo(p2.x, p2.y);
        remaining -= len;
      } else {
        const t = remaining / len;
        const ex = p1.x + (p2.x - p1.x) * t;
        const ey = p1.y + (p2.y - p1.y) * t;
        ctx.lineTo(ex, ey);
        remaining = 0;
        break;
      }
    }

    ctx.stroke();
  }

  // ----- GLOW BEHIND LEVEL -----
  let glowInnerColor = hexToRgba(levelColour, 0.7);
  let glowOuterColor = hexToRgba(levelColour, 0);

  if (rank === 1) {
    glowInnerColor = "rgba(194, 165, 0, 0.9)";
    glowOuterColor = "rgba(255, 215, 0, 0)";
  } else if (rank === 2) {
    glowInnerColor = "rgba(122, 122, 122, 0.9)";
    glowOuterColor = "rgba(192, 192, 192, 0)";
  } else if (rank === 3) {
    glowInnerColor = "rgba(175, 104, 34, 0.9)";
    glowOuterColor = "rgba(205, 127, 50, 0)";
  }

  const glowRadius = hexRadius * 1.3;
  const glowGrad = ctx.createRadialGradient(
    centerX, centerY, 0,
    centerX, centerY, glowRadius
  );

  glowGrad.addColorStop(0, glowInnerColor);
  glowGrad.addColorStop(1, glowOuterColor);

  ctx.save();
  ctx.fillStyle = glowGrad;
  ctx.beginPath();
  ctx.arc(centerX, centerY, glowRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // ----- LEVEL TEXT INSIDE HEX -----
  const levelText = `${level}`;
  ctx.fillStyle = levelColour;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const maxWidth = hexRadius * 1.4;
  let fontSize = hexRadius;

  for (let size = hexRadius; size >= 20; size -= 4) {
    ctx.font = `${size}px Lexend Bold`;
    const metrics = ctx.measureText(levelText);
    if (metrics.width <= maxWidth) {
      fontSize = size;
      break;
    }
  }

  ctx.font = `${fontSize}px Lexend Bold`;
  ctx.fillText(levelText, centerX, centerY);

  return canvas.toBuffer("image/png");
}



/* ---------------- SLASH COMMAND ---------------- */


module.exports = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('View your or another member\'s level and xp progress.')
    .addUserOption(option =>
      option
        .setName('member')
        .setDescription('Member which you\'d like to view')
        .setRequired(false)
    ),

   async execute(interaction) {
    const targetUser = interaction.options.getUser("member") || interaction.user;

    const xpPath = path.join(__dirname, "..", "data", "xp.json");
    const raw = await fs.readFile(xpPath, "utf8");
    const xpData = JSON.parse(raw);

    const xp = Math.floor(xpData[targetUser.id]?.xp ?? 0);
    const level = Math.floor(getLevelFromXP(xp));

    const nextLevelXP = Math.floor(xpForLevel(level + 1));
    const currentLevelXP = Math.floor(xpForLevel(level));

    const memberObj = interaction.guild?.members.cache.get(targetUser.id);

    let progress = Math.floor(xp - currentLevelXP);
    const needed = Math.floor(nextLevelXP - currentLevelXP);
    if (progress < 0) progress = 0; // extra safety, though xpForLevel(0)=0 should already prevent this

    // XP multiplier for this user
    const mults = await loadMultipliers();

let memberSafe = memberObj;
if (!memberSafe) {
    try { 
        memberSafe = await interaction.guild.members.fetch(targetUser.id);
    } catch {
        // still null — use a dummy member object so role logic doesn’t break
        memberSafe = { roles: { cache: new Map() }, id: targetUser.id };
    }
}

const multiplier = getEffectiveMultiplier(memberSafe, interaction.channel, mults);



    // If you want REAL ranking, sort xp.json by XP:
    const sorted = Object.entries(xpData)
      .sort((a, b) => b[1].xp - a[1].xp)
      .map(([id]) => id);

    const rank = sorted.indexOf(targetUser.id) + 1;

    let behindXP = null;
    let behindRankLabel = null;

    if (rank > 1) {
      const aboveId = sorted[rank - 2]; // user directly above
      const aboveXP = Math.floor(xpData[aboveId]?.xp ?? 0);
      behindXP = Math.max(0, aboveXP - xp);
      behindRankLabel = `#${rank - 1}`;
    }


    /* --- Generate card image --- */
    const buffer = await generateRankCard(
      memberObj || targetUser,
      xp,
      level,
      rank,
      progress,
      needed,
      multiplier,
      behindXP,
      behindRankLabel
    );


    const attachment = new AttachmentBuilder(buffer, {
      name: "rank.png",
    });

    const embed = new EmbedBuilder().setColor("#1c7d50").setImage("attachment://rank.png");

    return interaction.reply({ files: [attachment] });
  },
};
