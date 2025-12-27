const path = require("path");
const fs = require("fs").promises;


function xpForLevel(L) {
  if (L <= 0) return 0; // level 0 starts at 0 XP
  return 500*L + 12 * Math.pow(L, 2.5) + Math.pow(L,(Math.sqrt(L) / 3));
}


function getLevelFromXP(xp) {
  let lvl = 0;
  while (xp >= xpForLevel(lvl + 1)) lvl++;
  return lvl;
}


function ensureVisibleOnDark(hex) {
  let c = hex.replace("#", "");
  if (c.length === 3) {
    c = c.split("").map(ch => ch + ch).join("");
  }
  let num = parseInt(c, 16);
  let r = (num >> 16) & 255;
  let g = (num >> 8) & 255;
  let b = num & 255;

  // relative luminance calculation
  const toLinear = v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };

  const R = toLinear(r);
  const G = toLinear(g);
  const B = toLinear(b);

  const L = 0.2126 * R + 0.7152 * G + 0.0722 * B; // 0 = black, 1 = white

  // if it's too dark, blend towards white
  if (L < 0.10) {
    const factor = 0.4; // 0 = original, 1 = white
    r = Math.round(r + (255 - r) * factor);
    g = Math.round(g + (255 - g) * factor);
    b = Math.round(b + (255 - b) * factor);
  }

  // (optional) if it's *too* bright, nudge it slightly darker
  if (L > 0.95) {
    const factor = 0.2; // blend towards black a bit
    r = Math.round(r * (1 - factor));
    g = Math.round(g * (1 - factor));
    b = Math.round(b * (1 - factor));
  }

  return (
    "#" +
    r.toString(16).padStart(2, "0") +
    g.toString(16).padStart(2, "0") +
    b.toString(16).padStart(2, "0")
  );
}

function darkenColor(hex, amount = 0.25) {
  let c = hex.replace("#", "");
  if (c.length === 3) {
    c = c.split("").map(ch => ch + ch).join("");
  }
  const num = parseInt(c, 16);
  let r = (num >> 16) & 255;
  let g = (num >> 8) & 255;
  let b = num & 255;

  r = Math.max(0, Math.floor(r * (1 - amount)));
  g = Math.max(0, Math.floor(g * (1 - amount)));
  b = Math.max(0, Math.floor(b * (1 - amount)));

  return (
    "#" +
    r.toString(16).padStart(2, "0") +
    g.toString(16).padStart(2, "0") +
    b.toString(16).padStart(2, "0")
  );
}

/* Utility: draw outline around avatar */
function drawAvatarOutline(ctx, x, y, size, color = "#FFFFFF", thickness = 6) {
  const radius = size / 2;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = thickness;
  ctx.beginPath();
  ctx.arc(x + radius, y + radius, radius + thickness / 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function formatNum(n) {
  if (!Number.isFinite(n)) return "0";

  if (n >= 1000000) return (n / 1000000).toFixed(2) + "M";
  if (n >= 1000) return (n / 1000).toFixed(2) + "K";
  return n.toString();
}


// --- XP ROLE CONFIG ---
const xpRolesPath = path.join(__dirname, "..", "data", "xp_roles.json");

// load XP → role mappings
async function loadXPRoleConfig() {
  try {
    const raw = await fs.readFile(xpRolesPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// save config
async function saveXPRoleConfig(cfg) {
  await fs.writeFile(xpRolesPath, JSON.stringify(cfg, null, 2), "utf8");
}

// Main autorole function
async function handleLevelUpRoles(member, level) {
  const guild = member.guild;
  if (!guild) return;

  const cfg = await loadXPRoleConfig();
  const roleId = cfg[level];
  if (!roleId) return; // no role for this level

  const role = guild.roles.cache.get(roleId);
  if (!role) return;

  const me = guild.members.me;
  if (!me || !me.permissions.has("ManageRoles")) {
    console.warn("XP autorole: bot is missing ManageRoles permission.");
    return;
  }

  // Can't assign roles above bot
  if (role.position >= me.roles.highest.position) {
    console.warn(
      `XP autorole: cannot assign role ${role.name} (above bot's highest role).`
    );
    return;
  }

  // Remove all old XP roles first
  const oldRoles = Object.values(cfg).filter(id =>
    member.roles.cache.has(id)
  );

  if (oldRoles.length > 0) {
    await member.roles.remove(oldRoles).catch(err =>
      console.warn("XP autorole: failed to remove old roles:", err)
    );
  }

  // Add the new XP tier role
  await member.roles.add(role).catch(err =>
    console.warn("XP autorole: failed to add role:", err)
  );

  console.log(
    `XP autorole: assigned role ${role.name} to ${member.user.tag} for reaching level ${level}.`
  );
}

function getISOWeekKey(date = new Date()) {
  // ISO week based on UTC so it never breaks on DST
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7; // Mon=1..Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // nearest Thursday
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

module.exports = {
  xpForLevel,
  getLevelFromXP,
  ensureVisibleOnDark,
  darkenColor,
  drawAvatarOutline,
  formatNum,
  loadXPRoleConfig,
  saveXPRoleConfig,
  handleLevelUpRoles,
  getISOWeekKey
};