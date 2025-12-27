const fs = require("fs").promises;
const path = require("path");

const multPath = path.join(__dirname, "..", "data", "xp_multipliers.json");

// Default structure if file doesn't exist / is empty
const DEFAULT_MULTS = {
  default: 1,
  stackingMode: "max",  // "max" = take highest; you can change later
  roles: {},
  channels: {},
  users: {},
};

async function loadMultipliers() {
  try {
    const raw = await fs.readFile(multPath, "utf8");
    if (!raw.trim()) return { ...DEFAULT_MULTS };
    const parsed = JSON.parse(raw);

    // merge with defaults in case some keys are missing
    return {
      ...DEFAULT_MULTS,
      ...parsed,
      roles: parsed.roles || {},
      channels: parsed.channels || {},
      users: parsed.users || {},
    };
  } catch (err) {
    if (err.code === "ENOENT") {
      // file doesn't exist yet → create it
      await fs.writeFile(
        multPath,
        JSON.stringify(DEFAULT_MULTS, null, 2),
        "utf8"
      );
      return { ...DEFAULT_MULTS };
    }
    console.error("Error loading xp_multipliers.json:", err);
    throw err;
  }
}

async function saveMultipliers(mults) {
  const toSave = {
    ...DEFAULT_MULTS,
    ...mults,
    roles: mults.roles || {},
    channels: mults.channels || {},
    users: mults.users || {},
  };

  await fs.writeFile(multPath, JSON.stringify(toSave, null, 2), "utf8");
}

/**
 * Get the effective multiplier for this member in this channel.
 * 
 * Strategy:
 * - start from default
 * - apply channel multiplier if present
 * - apply all role multipliers (according to stackingMode)
 * - apply user multiplier (usually highest priority)
 */
function getEffectiveMultiplier(member, channel, mults) {
  if (!mults) mults = DEFAULT_MULTS;

  // === 0x override (roles)
  if (member.roles && member.roles.cache) {
    for (const [roleId] of member.roles.cache) {
      const rMult = mults.roles[roleId];
      if (rMult === 0) {
        return 0; // immediate hard override
      }
    }
  }

  let result = mults.default ?? 1;
  const mode = mults.stackingMode || "max";

  // 1) channel mult
  const chanMult = mults.channels[channel.id];
  if (typeof chanMult === "number") {
    result = applyStack(result, chanMult, mode);
  }

  // 2) role multipliers
  if (member.roles && member.roles.cache) {
    for (const [roleId] of member.roles.cache) {
      const rMult = mults.roles[roleId];
      if (typeof rMult === "number") {
        result = applyStack(result, rMult, mode);
      }
    }
  }

  // 3) user mult
  const userMult = mults.users[member.id];
  if (typeof userMult === "number") {
    result = applyStack(result, userMult, mode);
  }

  return result;
}



function applyStack(current, incoming, mode) {
  switch (mode) {
    case "sum":
      return current + incoming - 1; // so 1 + 1.5 -> 1.5 effective "extra"
    case "multiply":
      return current * incoming;
    case "max":
    default:
      return Math.max(current, incoming);
  }
}

function formatMultiplier(mult) {
  if (!Number.isFinite(mult)) return "1x";

  if (mult <= 0) return "0x";   // hard override

  // if it's basically an integer, don't show decimals
  const rounded = Math.round(mult * 100) / 100;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-3) {
    return `${Math.round(rounded)}x`;
  }

  return `${rounded.toFixed(2)}x`;
}

async function getUserMultiplier(interaction, targetUser) {
  const mults = await loadMultipliers();

  // no guild = just use default
  if (!interaction.guild) {
    return mults.default ?? 1;
  }

  let member;
  try {
    member = await interaction.guild.members.fetch(targetUser.id);
  } catch {
    return mults.default ?? 1;
  }

  // use the interaction channel if possible; otherwise dummy object
  const channel = interaction.channel || { id: interaction.channelId };

  return getEffectiveMultiplier(member, channel, mults);
}



module.exports = {
  loadMultipliers,
  saveMultipliers,
  getEffectiveMultiplier,
  formatMultiplier,
  getUserMultiplier,
};
