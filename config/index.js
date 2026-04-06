const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const CONFIG_DIR = path.join(ROOT_DIR, 'config');

const OWNER_IDS = [
  '717099413138440252',
];

const BOT_OWNER_IDS = [
  '717099413138440252',
  '535478766739259436',
];

const XP_ADMIN_IDS = BOT_OWNER_IDS;

const SEND_AUTHORIZED_IDS = [
  ...OWNER_IDS,
];

const PATHS = {
  data: {
    xp: path.join(DATA_DIR, 'xp.json'),
    xpWeekly: path.join(DATA_DIR, 'xp_weekly.json'),
    xpRoles: path.join(DATA_DIR, 'xp_roles.json'),
    xpMultipliers: path.join(DATA_DIR, 'xp_multipliers.json'),
    gambleCooldowns: path.join(DATA_DIR, 'gamble_cooldowns.json'),
    gambleReminders: path.join(DATA_DIR, 'gamble_reminders.json'),
    gambleStats: path.join(DATA_DIR, 'gamble_stats.json'),
    messageLog: path.join(DATA_DIR, 'message_log.txt'),
  },
  config: {
    weekly: path.join(CONFIG_DIR, 'weekly_config.json'),
    replacements: path.join(CONFIG_DIR, 'replacements.json'),
    blocked: path.join(CONFIG_DIR, 'blocked.json'),
    levelColours: path.join(CONFIG_DIR, 'level_colours.txt'),
  },
};

const DEFAULTS = {
  gambleCooldownMs: 8 * 60 * 60 * 1000,
  xpMessageCooldownMs: 60 * 1000,
};

module.exports = {
  ROOT_DIR,
  DATA_DIR,
  CONFIG_DIR,
  PATHS,
  OWNER_IDS,
  BOT_OWNER_IDS,
  XP_ADMIN_IDS,
  SEND_AUTHORIZED_IDS,
  DEFAULTS,
};
