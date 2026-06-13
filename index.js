// ══════════════════════════════════════════════════════
//  التوكن — ضعه هنا
// ══════════════════════════════════════════════════════
const BOT_TOKEN  = process.env.DISCORD_TOKEN;
const OWNER_ID   = "1410937351731023902"; // صانع البوت — محصّن من الباند/الطرد

const PREFIX    = "+";
const TAX_RATE  = 0.05;

const {
  Client, GatewayIntentBits, Partials, REST, Routes, Collection,
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder,
  SlashCommandBuilder, PermissionFlagsBits, PermissionsBitField,
  ActivityType, ButtonBuilder, ButtonStyle, ChannelType,
} = require("discord.js");

const fs    = require("fs");
const path  = require("path");
const https = require("https");
const http  = require("http");

// ══════════════════════════════════════════════════════
//  Persistence — data.json
// ══════════════════════════════════════════════════════
const DATA_FILE = path.join(__dirname, "data.json");

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {}
  return { guilds: {} };
}

function saveData() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); } catch {}
}

function guild(guildId) {
  if (!db.guilds[guildId]) db.guilds[guildId] = {};
  return db.guilds[guildId];
}

function getAutoReplies(guildId)  { return guild(guildId).autoReplies  ?? (guild(guildId).autoReplies  = []); }
function getBandConfig(guildId)   { return guild(guildId).bandConfig   ?? (guild(guildId).bandConfig   = { shortcuts: [], allowedRoleId: null, logChannelId: null }); }
function getKickConfig(guildId)   { return guild(guildId).kickConfig   ?? (guild(guildId).kickConfig   = { shortcuts: [], allowedRoleId: null, logChannelId: null }); }
function getWarnConfig(guildId)   { return guild(guildId).warnConfig   ?? (guild(guildId).warnConfig   = { shortcuts: [], logChannelId: null }); }
function getWarnings(guildId)     { return guild(guildId).warnings     ?? (guild(guildId).warnings     = {}); }
function getLevelConfig(guildId)  { return guild(guildId).levelConfig  ?? (guild(guildId).levelConfig  = null); }
function getUserLevels(guildId)   { return guild(guildId).userLevels   ?? (guild(guildId).userLevels   = {}); }
function getGuardConfig(guildId)  {
  if (!guild(guildId).guardConfig) {
    guild(guildId).guardConfig = {
      enabled: false,
      logChannelId: null,
      channelWhitelist: [],
      roleWhitelist: [],
      botWhitelist: [],
      thresholds: { channelDelete: 3, channelCreate: 5, roleDelete: 3, roleCreate: 5 },
    };
  }
  return guild(guildId).guardConfig;
}
function getTicketConfig(guildId) { return guild(guildId).ticketConfig ?? (guild(guildId).ticketConfig = null); }
function getAutoRoleConfig(guildId) { return guild(guildId).autoRoleConfig ?? (guild(guildId).autoRoleConfig = { roleId: null, logChannelId: null }); }
function getGiveaways(guildId) { return guild(guildId).giveaways ?? (guild(guildId).giveaways = {}); }
function getSayConfig(guildId)  { return guild(guildId).sayConfig  ?? (guild(guildId).sayConfig  = { allowedUsers: [] }); }
function getNickConfig(guildId) {
  return guild(guildId).nickConfig ?? (guild(guildId).nickConfig = { shortcuts: [], allowedRoleId: null, logChannelId: null });
}
function getAdConfig(guildId) {
  if (!guild(guildId).adConfig) {
    guild(guildId).adConfig = {
      roleId: null, channels: [], panelChannelId: null,
      panelMessageId: null, maxPosts: 3, intervalHours: 0,
    };
  }
  return guild(guildId).adConfig;
}
function getAdPosts(guildId) { return guild(guildId).adPosts ?? (guild(guildId).adPosts = {}); }

// ══════════════════════════════════════════════════════
//  Log Config ← جديد
// ══════════════════════════════════════════════════════
function getLogConfig(guildId) {
  if (!guild(guildId).logConfig) {
    guild(guildId).logConfig = {
      rolesLogChannelId:     null,
      messagesLogChannelId:  null,
      bansLogChannelId:      null,
      mutesLogChannelId:     null,
      channelsLogChannelId:  null,
      reactionsLogChannelId: null,
      kicksLogChannelId:     null,
      joinsLogChannelId:     null,
      leavesLogChannelId:    null,
      invitesLogChannelId:   null,
    };
  }
  return guild(guildId).logConfig;
}

// ══════════════════════════════════════════════════════
//  Stealer Config ← جديد
// ══════════════════════════════════════════════════════
function getStealerConfig(guildId) {
  if (!guild(guildId).stealerConfig) {
    guild(guildId).stealerConfig = {
      emojiChannelId:   null,
      stickerChannelId: null,
      emojiCounter:     0,
      stickerCounter:   0,
    };
  }
  return guild(guildId).stealerConfig;
}

const db = loadData();

// Runtime-only (no need to persist)
const openTickets  = new Map(); // channelId → {userId, guildId, claimedBy, createdAt}
const nukeTracker  = new Map(); // "guildId:userId:type" → [timestamps]
const dmConversations = new Map(); // userId → { step, guildId, content, imageUrl }
const adIntervals     = new Map(); // guildId → intervalId

// ══════════════════════════════════════════════════════
//  Helpers
// ══════════════════════════════════════════════════════
function log(level, msg, data = {}) {
  const ts    = new Date().toISOString();
  const extra = Object.keys(data).length ? " " + JSON.stringify(data) : "";
  console[level === "error" ? "error" : "log"](`[${ts}] [${level.toUpperCase()}] ${msg}${extra}`);
}

function parseTaxAmount(str) {
  str = str.toLowerCase().trim().replace(/,/g, "");
  if (str.endsWith("m")) return parseFloat(str) * 1_000_000;
  if (str.endsWith("k")) return parseFloat(str) * 1_000;
  return parseFloat(str);
}

function parseUserIds(str, guild) {
  const ids = [];
  const mentionMatches = [...str.matchAll(/<@!?(\d+)>/g)].map(m => m[1]);
  const rawIds         = str.match(/\b\d{17,20}\b/g) ?? [];
  for (const id of [...mentionMatches, ...rawIds]) {
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

function isOwner(interaction) {
  return interaction.user.id === interaction.guild?.ownerId;
}

function getUserLevel(guildId, userId) {
  const levels = getUserLevels(guildId);
  if (!levels[userId]) levels[userId] = { level: 0, messageCount: 0 };
  return levels[userId];
}

function calculateLevel(messageCount, thresholds) {
  if (!thresholds || thresholds.length === 0) return 0;
  let level = 0;
  for (const t of thresholds) { if (messageCount >= t.messages) level = t.level; }
  return level;
}

async function sendLog(guild, logChannelId, embed) {
  if (!logChannelId) return;
  const ch = guild.channels.cache.get(logChannelId);
  if (ch) await ch.send({ embeds: [embed] }).catch(() => null);
}

// ══════════════════════════════════════════════════════
//  Slash Commands
// ══════════════════════════════════════════════════════
const slashCommands = [

  // ── Tax ──
  new SlashCommandBuilder()
    .setName("tax")
    .setDescription("احسب ضريبة ديسكورد")
    .addStringOption(o => o.setName("amount").setDescription("المبلغ — مثال: 3m أو 500k").setRequired(true)),

  // ── Auto Reply ──
  new SlashCommandBuilder()
    .setName("auto-reply")
    .setDescription("إدارة الردود التلقائية")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand(s => s.setName("add").setDescription("أضف رد تلقائي")
      .addStringOption(o => o.setName("trigger").setDescription("الكلمة").setRequired(true))
      .addStringOption(o => o.setName("response").setDescription("الرد").setRequired(true))
      .addBooleanOption(o => o.setName("exact").setDescription("مطابقة كاملة؟"))
      .addRoleOption(o => o.setName("role").setDescription("قيّد لرول معين")))
    .addSubcommand(s => s.setName("help").setDescription("عرض الردود"))
    .addSubcommand(s => s.setName("remove").setDescription("احذف رد")
      .addIntegerOption(o => o.setName("index").setDescription("الرقم من القائمة").setRequired(true).setMinValue(1))),

  // ── Band ──
  new SlashCommandBuilder()
    .setName("band")
    .setDescription("إدارة اختصارات الباند")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addSubcommand(s => s.setName("add").setDescription("أضف اختصار")
      .addStringOption(o => o.setName("word").setDescription("الكلمة").setRequired(true))
      .addRoleOption(o => o.setName("role").setDescription("الرول المسموح له"))
      .addChannelOption(o => o.setName("log").setDescription("قناة اللوق")))
    .addSubcommand(s => s.setName("remove").setDescription("احذف اختصار")
      .addStringOption(o => o.setName("word").setDescription("الكلمة").setRequired(true)))
    .addSubcommand(s => s.setName("help").setDescription("عرض الاختصارات")),

  // ── Kick Shortcuts ──
  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("إدارة اختصارات الطرد")
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addSubcommand(s => s.setName("add").setDescription("أضف اختصار طرد")
      .addStringOption(o => o.setName("word").setDescription("الكلمة").setRequired(true))
      .addRoleOption(o => o.setName("role").setDescription("الرول المسموح له"))
      .addChannelOption(o => o.setName("log").setDescription("قناة اللوق")))
    .addSubcommand(s => s.setName("remove").setDescription("احذف اختصار")
      .addStringOption(o => o.setName("word").setDescription("الكلمة").setRequired(true)))
    .addSubcommand(s => s.setName("help").setDescription("عرض الاختصارات")),

  // ── Warn ──
  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("إدارة نظام التحذيرات")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand(s => s.setName("add").setDescription("أضف اختصار تحذير")
      .addStringOption(o => o.setName("word").setDescription("الكلمة — مثال: تحذير").setRequired(true))
      .addChannelOption(o => o.setName("log").setDescription("قناة اللوق")))
    .addSubcommand(s => s.setName("remove").setDescription("احذف اختصار")
      .addStringOption(o => o.setName("word").setDescription("الكلمة").setRequired(true)))
    .addSubcommand(s => s.setName("help").setDescription("عرض الاختصارات"))
    .addSubcommand(s => s.setName("history").setDescription("سجل تحذيرات عضو")
      .addUserOption(o => o.setName("user").setDescription("العضو").setRequired(true)))
    .addSubcommand(s => s.setName("clear").setDescription("مسح تحذيرات عضو")
      .addUserOption(o => o.setName("user").setDescription("العضو").setRequired(true))),

  // ── Level Setup ──
  new SlashCommandBuilder()
    .setName("level-setup")
    .setDescription("إعداد نظام المستويات")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o => o.setName("channel").setDescription("قناة الإعلانات").setRequired(true))
    .addStringOption(o => o.setName("message").setDescription("رسالة الترقي — {user} و {level}"))
    .addStringOption(o => o.setName("thresholds").setDescription("مثال: 10:1,50:2,100:3")),

  // ── Guard ──
  new SlashCommandBuilder()
    .setName("guard")
    .setDescription("⚙️ إعداد الحارس — صاحب السيرفر فقط")
    .addSubcommand(s => s.setName("setup").setDescription("إعداد الحارس وتحديد حدود الأحداث")
      .addChannelOption(o => o.setName("log").setDescription("قناة اللوق").setRequired(true))
      .addIntegerOption(o => o.setName("channel-delete").setDescription("حد حذف القنوات قبل الطرد (افتراضي: 3)").setMinValue(1))
      .addIntegerOption(o => o.setName("channel-create").setDescription("حد إنشاء القنوات قبل الطرد (افتراضي: 5)").setMinValue(1))
      .addIntegerOption(o => o.setName("role-delete").setDescription("حد حذف الرتب قبل الطرد (افتراضي: 3)").setMinValue(1))
      .addIntegerOption(o => o.setName("role-create").setDescription("حد إنشاء الرتب قبل الطرد (افتراضي: 5)").setMinValue(1)))
    .addSubcommand(s => s.setName("enable").setDescription("تفعيل الحارس"))
    .addSubcommand(s => s.setName("disable").setDescription("تعطيل الحارس"))
    .addSubcommand(s => s.setName("status").setDescription("عرض إعدادات الحارس الحالية")),

  // ── Whitelist ──
  new SlashCommandBuilder()
    .setName("whitelist")
    .setDescription("⚙️ إدارة الوايت ليست — صاحب السيرفر فقط")
    .addSubcommand(s => s.setName("add-channel").setDescription("أضف مستخدمين لوايت ليست القنوات")
      .addStringOption(o => o.setName("users").setDescription("منشن أو ID مفصولة بمسافة").setRequired(true)))
    .addSubcommand(s => s.setName("add-role").setDescription("أضف مستخدمين لوايت ليست الرتب")
      .addStringOption(o => o.setName("users").setDescription("منشن أو ID مفصولة بمسافة").setRequired(true)))
    .addSubcommand(s => s.setName("add-bot").setDescription("أضف بوتات لوايت ليست البوتات")
      .addStringOption(o => o.setName("bots").setDescription("منشن أو ID مفصولة بمسافة").setRequired(true)))
    .addSubcommand(s => s.setName("remove").setDescription("احذف من الوايت ليست")
      .addStringOption(o => o.setName("users").setDescription("منشن أو ID مفصولة بمسافة").setRequired(true)))
    .addSubcommand(s => s.setName("help").setDescription("عرض الوايت ليست — مرئي للجميع")),

  // ── Ticket Setup ──
  new SlashCommandBuilder()
    .setName("ticket-setup")
    .setDescription("إعداد نظام التذاكر")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addRoleOption(o => o.setName("staff-role").setDescription("رول الستاف").setRequired(true))
    .addChannelOption(o => o.setName("category").setDescription("الكاتيقوري"))
    .addChannelOption(o => o.setName("log").setDescription("قناة اللوق"))
    .addStringOption(o => o.setName("message").setDescription("رسالة الترحيب — {user}"))
    .addStringOption(o => o.setName("color").setDescription("لون hex — مثال: #5865f2")),

  // ── Ticket Panel ──
  new SlashCommandBuilder()
    .setName("ticket-panel")
    .setDescription("أرسل بانل فتح التذاكر")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption(o => o.setName("channel").setDescription("القناة").setRequired(true))
    .addStringOption(o => o.setName("title").setDescription("عنوان البانل"))
    .addStringOption(o => o.setName("description").setDescription("وصف البانل")),

  // ── Send Embed ──
  new SlashCommandBuilder()
    .setName("send-embed")
    .setDescription("أرسل Embed مخصص")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addChannelOption(o => o.setName("channel").setDescription("القناة").setRequired(true))
    .addStringOption(o => o.setName("title").setDescription("العنوان").setRequired(true))
    .addStringOption(o => o.setName("description").setDescription("الوصف").setRequired(true))
    .addStringOption(o => o.setName("color").setDescription("اللون hex — مثال: #2ecc71")),

  // ── Emoji Stealer ← جديد ──
  new SlashCommandBuilder()
    .setName("emoji-stealer")
    .setDescription("حدد قناة — أي إيموجي يُرسل فيها يُضاف للسيرفر تلقائياً")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuildExpressions)
    .addChannelOption(o => o.setName("channel").setDescription("القناة").setRequired(true)),

  // ── Sticker Stealer ← جديد ──
  new SlashCommandBuilder()
    .setName("sticker-stealer")
    .setDescription("حدد قناة — أي ستيكر يُرسل فيها يُضاف للسيرفر تلقائياً")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuildExpressions)
    .addChannelOption(o => o.setName("channel").setDescription("القناة").setRequired(true)),

  // ── Role Icon ──
  new SlashCommandBuilder()
    .setName("role-icon")
    .setDescription("حدد أيقونة إيموجي لرتبة معينة")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addRoleOption(o => o.setName("role").setDescription("الرتبة").setRequired(true))
    .addStringOption(o => o.setName("emoji").setDescription("الإيموجي — مثال: 🔥 أو <:name:id>").setRequired(true)),

  // ── Set Log ← جديد ──
  new SlashCommandBuilder()
    .setName("set-log")
    .setDescription("إعداد قنوات اللوقات")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(s => s.setName("roles")
      .setDescription("لوق الرتب")
      .addChannelOption(o => o.setName("channel").setDescription("القناة").setRequired(true)))
    .addSubcommand(s => s.setName("messages")
      .setDescription("لوق الرسائل")
      .addChannelOption(o => o.setName("channel").setDescription("القناة").setRequired(true)))
    .addSubcommand(s => s.setName("bans")
      .setDescription("لوق الباند")
      .addChannelOption(o => o.setName("channel").setDescription("القناة").setRequired(true)))
    .addSubcommand(s => s.setName("mutes")
      .setDescription("لوق الميوت / تايم اوت")
      .addChannelOption(o => o.setName("channel").setDescription("القناة").setRequired(true)))
    .addSubcommand(s => s.setName("channels")
      .setDescription("لوق الرومات")
      .addChannelOption(o => o.setName("channel").setDescription("القناة").setRequired(true)))
    .addSubcommand(s => s.setName("reactions")
      .setDescription("لوق الرياكشن")
      .addChannelOption(o => o.setName("channel").setDescription("القناة").setRequired(true)))
    .addSubcommand(s => s.setName("kicks")
      .setDescription("لوق الطرد")
      .addChannelOption(o => o.setName("channel").setDescription("القناة").setRequired(true)))
    .addSubcommand(s => s.setName("joins")
      .setDescription("لوق الدخول")
      .addChannelOption(o => o.setName("channel").setDescription("القناة").setRequired(true)))
    .addSubcommand(s => s.setName("leaves")
      .setDescription("لوق الخروج")
      .addChannelOption(o => o.setName("channel").setDescription("القناة").setRequired(true)))
    .addSubcommand(s => s.setName("invites")
      .setDescription("لوق الإنفايت")
      .addChannelOption(o => o.setName("channel").setDescription("القناة").setRequired(true))),


  // ── Auto Role ──
  new SlashCommandBuilder()
    .setName("auto-role")
    .setDescription("إعداد الرول التلقائي عند الدخول")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand(s => s.setName("set").setDescription("حدد الرول التلقائي")
      .addRoleOption(o => o.setName("role").setDescription("الرول").setRequired(true))
      .addChannelOption(o => o.setName("log").setDescription("قناة لوق الدخول (اختياري)")))
    .addSubcommand(s => s.setName("disable").setDescription("إيقاف الرول التلقائي"))
    .addSubcommand(s => s.setName("status").setDescription("عرض الإعدادات الحالية")),


  // ── Say ──
  new SlashCommandBuilder()
    .setName("say")
    .setDescription("البوت يتكلم — لمالك السيرفر والمستخدمين المصرح لهم")
    .addSubcommand(s => s.setName("send").setDescription("اجعل البوت يرسل رسالة")
      .addStringOption(o => o.setName("text").setDescription("الرسالة").setRequired(true))
      .addChannelOption(o => o.setName("channel").setDescription("القناة (اتركها للقناة الحالية)")))
    .addSubcommand(s => s.setName("allow").setDescription("أضف مستخدم مصرح له — مالك فقط")
      .addUserOption(o => o.setName("user").setDescription("العضو").setRequired(true)))
    .addSubcommand(s => s.setName("deny").setDescription("احذف مستخدم من القائمة — مالك فقط")
      .addUserOption(o => o.setName("user").setDescription("العضو").setRequired(true)))
    .addSubcommand(s => s.setName("list").setDescription("عرض المستخدمين المصرح لهم")),

  // ── Say Spam ──
  new SlashCommandBuilder()
    .setName("say-spam")
    .setDescription("أرسل رسالة عدة مرات متتالية — مالك السيرفر فقط")
    .addStringOption(o => o.setName("text").setDescription("الرسالة").setRequired(true))
    .addIntegerOption(o => o.setName("times").setDescription("عدد المرات (1–200)").setRequired(true).setMinValue(1).setMaxValue(200))
    .addChannelOption(o => o.setName("channel").setDescription("القناة (اتركها للقناة الحالية)")),

  // ── Ad Setup ──
  new SlashCommandBuilder()
    .setName("ad-setup")
    .setDescription("إعداد نظام التبادل التلقائي")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addRoleOption(o => o.setName("role").setDescription("الرتبة المطلوبة للنشر").setRequired(true))
    .addChannelOption(o => o.setName("panel-channel").setDescription("قناة البانل").setRequired(true))
    .addChannelOption(o => o.setName("channel1").setDescription("قناة نشر #1").setRequired(true))
    .addChannelOption(o => o.setName("channel2").setDescription("قناة نشر #2 (اختياري)"))
    .addChannelOption(o => o.setName("channel3").setDescription("قناة نشر #3 (اختياري)"))
    .addIntegerOption(o => o.setName("max-posts").setDescription("أقصى عدد منشورات لكل شخص (افتراضي: 3)").setMinValue(1).setMaxValue(10))
    .addIntegerOption(o => o.setName("interval").setDescription("كم ساعة يعيد البانل إرسال نفسه (0 = معطل)").setMinValue(0).setMaxValue(168)),

  // ── Ad Panel ──
  new SlashCommandBuilder()
    .setName("ad-panel")
    .setDescription("أرسل بانل التبادل التلقائي يدوياً")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  // ── Nickname Shortcuts ──
  new SlashCommandBuilder()
    .setName("set-nickname-word")
    .setDescription("إدارة اختصارات النك نايم")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
    .addSubcommand(s => s.setName("add").setDescription("أضف اختصار نك نايم")
      .addStringOption(o => o.setName("word").setDescription("الكلمة المشغِّلة").setRequired(true))
      .addRoleOption(o => o.setName("role").setDescription("الرول المسموح له باستخدامه"))
      .addChannelOption(o => o.setName("log").setDescription("قناة لوق تغييرات النك نايم")))
    .addSubcommand(s => s.setName("remove").setDescription("احذف اختصار")
      .addStringOption(o => o.setName("word").setDescription("الكلمة").setRequired(true)))
    .addSubcommand(s => s.setName("list").setDescription("عرض اختصارات النك نايم")),

  // ── Come ──
  new SlashCommandBuilder()
    .setName("come")
    .setDescription("استدعِ شخصاً عبر رسالة خاصة")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addUserOption(o => o.setName("user").setDescription("الشخص المراد استدعاؤه").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("سبب الاستدعاء").setRequired(true))
    .addChannelOption(o => o.setName("channel").setDescription("الروم (اتركه للروم الحالي)")),

  // ── List ──
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("عرض جميع أوامر البوت مع الشرح"),

  // ── Giveaway ──
  new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("إدارة القرعة")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName("start").setDescription("ابدأ قرعة جديدة")
      .addStringOption(o  => o.setName("prize").setDescription("الجائزة — مثال: نيترو، رتبة VIP").setRequired(true))
      .addStringOption(o  => o.setName("duration").setDescription("المدة — مثال: 1h، 30m، 2d").setRequired(true))
      .addIntegerOption(o => o.setName("winners").setDescription("عدد الفائزين").setRequired(true).setMinValue(1).setMaxValue(20))
      .addChannelOption(o => o.setName("channel").setDescription("القناة (اتركها للقناة الحالية)")))
    .addSubcommand(s => s.setName("end").setDescription("أنهِ قرعة قبل وقتها")
      .addStringOption(o => o.setName("message-id").setDescription("ID رسالة القرعة").setRequired(true)))
    .addSubcommand(s => s.setName("reroll").setDescription("أعد السحب على فائز جديد")
      .addStringOption(o => o.setName("message-id").setDescription("ID رسالة القرعة").setRequired(true))),

].map(c => c.toJSON());

// ══════════════════════════════════════════════════════
//  Client
// ══════════════════════════════════════════════════════
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessageReactions, // ← جديد للوق الرياكشن
    GatewayIntentBits.GuildInvites,          // ← جديد للوق الإنفايت
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageReactions,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.GuildMember],
});

// ══════════════════════════════════════════════════════
//  Ready
// ══════════════════════════════════════════════════════
client.once("ready", async (c) => {
  log("info", `Bot online as ${c.user.tag}`);

  client.user.setPresence({
    activities: [{ name: "by 𝓐𝓥𝓔𝓨𝓡𝓞💫", type: ActivityType.Playing }],
    status: "online",
  });

  const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(c.user.id), { body: slashCommands });
    log("info", "Slash commands registered globally");
  } catch (err) {
    log("error", "Failed to register slash commands", { err: err.message });
  }
});

// ══════════════════════════════════════════════════════
//  Interactions
// ══════════════════════════════════════════════════════
client.on("interactionCreate", async (interaction) => {
  try {

    // ─── Slash Commands ───────────────────────────────
    if (interaction.isChatInputCommand()) {
      const name    = interaction.commandName;
      const guildId = interaction.guildId;
      if (!guildId) return;

      // /tax
      if (name === "tax") {
        const raw = parseTaxAmount(interaction.options.getString("amount", true));
        if (isNaN(raw) || raw <= 0)
          return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle("❌ مبلغ غير صالح").setDescription("مثال: `3m` أو `500k` أو `1500000`")], ephemeral: true });
        const withTax  = Math.ceil(raw / (1 - TAX_RATE));
        const taxAmt   = withTax - Math.ceil(raw);
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x2ecc71).setTitle("🧾 حساب ضريبة ديسكورد")
          .addFields(
            { name: "💰 المبلغ المطلوب استلامه", value: `\`${Math.ceil(raw).toLocaleString("en-US")}\``, inline: true },
            { name: "📤 المبلغ اللي تطلبه",      value: `\`${withTax.toLocaleString("en-US")}\``,        inline: true },
            { name: "📊 قيمة الضريبة",            value: `\`${taxAmt.toLocaleString("en-US")}\``,        inline: true },
            { name: "📉 نسبة الضريبة",            value: `\`${(TAX_RATE*100).toFixed(0)}%\``,            inline: true },
          ).setFooter({ text: `طلب من ${interaction.user.tag}` }).setTimestamp()] });
      }

      // /auto-reply
      if (name === "auto-reply") {
        const sub  = interaction.options.getSubcommand();
        const list = getAutoReplies(guildId);
        if (sub === "add") {
          const trigger  = interaction.options.getString("trigger", true).toLowerCase().trim();
          const response = interaction.options.getString("response", true);
          const exact    = interaction.options.getBoolean("exact") ?? true;
          const role     = interaction.options.getRole("role");
          list.push({ trigger, response, exact, roleId: role?.id ?? null });
          saveData();
          return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x2ecc71).setTitle("✅ تمت الإضافة").setDescription(`رد على **${trigger}** أُضيف.`)], ephemeral: true });
        }
        if (sub === "list") {
          if (!list.length) return interaction.reply({ content: "❌ لا توجد ردود.", ephemeral: true });
          return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x3498db).setTitle("📋 الردود التلقائية")
            .setDescription(list.map((e,i) => `**${i+1}.** \`${e.trigger}\` → ${e.response}${e.exact?" (كامل)":""}${e.roleId?` (<@&${e.roleId}>)`:""}`).join("\n"))], ephemeral: true });
        }
        if (sub === "remove") {
          const idx = interaction.options.getInteger("index", true) - 1;
          if (idx < 0 || idx >= list.length) return interaction.reply({ content: "❌ رقم غير صحيح.", ephemeral: true });
          const removed = list.splice(idx, 1)[0];
          saveData();
          return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle("🗑️ تم الحذف").setDescription(`حُذف الرد على \`${removed.trigger}\`.`)], ephemeral: true });
        }
        return;
      }

      // /band
      if (name === "band") {
        const sub = interaction.options.getSubcommand();
        const cfg = getBandConfig(guildId);
        if (sub === "add") {
          const word = interaction.options.getString("word", true).toLowerCase().trim();
          if (!cfg.shortcuts.find(s => s.word === word)) cfg.shortcuts.push({ word });
          const role = interaction.options.getRole("role");
          const logCh = interaction.options.getChannel("log");
          if (role)  cfg.allowedRoleId  = role.id;
          if (logCh) cfg.logChannelId = logCh.id;
          saveData();
          return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x2ecc71).setTitle("✅ تمت الإضافة").setDescription(`اختصار باند \`${word}\` أُضيف.`)], ephemeral: true });
        }
        if (sub === "remove") {
          const word = interaction.options.getString("word", true).toLowerCase().trim();
          cfg.shortcuts = cfg.shortcuts.filter(s => s.word !== word);
          saveData();
          return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle("🗑️ تم الحذف").setDescription(`اختصار \`${word}\` حُذف.`)], ephemeral: true });
        }
        if (sub === "list") {
          if (!cfg.shortcuts.length) return interaction.reply({ content: "❌ لا توجد اختصارات.", ephemeral: true });
          return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x3498db).setTitle("📋 اختصارات الباند").setDescription(cfg.shortcuts.map(s => `\`${s.word}\``).join(", "))], ephemeral: true });
        }
        return;
      }

      // /kick
      if (name === "kick") {
        const sub = interaction.options.getSubcommand();
        const cfg = getKickConfig(guildId);
        if (sub === "add") {
          const word = interaction.options.getString("word", true).toLowerCase().trim();
          if (!cfg.shortcuts.find(s => s.word === word)) cfg.shortcuts.push({ word });
          const role  = interaction.options.getRole("role");
          const logCh = interaction.options.getChannel("log");
          if (role)  cfg.allowedRoleId = role.id;
          if (logCh) cfg.logChannelId  = logCh.id;
          saveData();
          return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x2ecc71).setTitle("✅ تمت الإضافة").setDescription(`اختصار طرد \`${word}\` أُضيف.`)], ephemeral: true });
        }
        if (sub === "remove") {
          const word = interaction.options.getString("word", true).toLowerCase().trim();
          cfg.shortcuts = cfg.shortcuts.filter(s => s.word !== word);
          saveData();
          return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle("🗑️ تم الحذف")], ephemeral: true });
        }
        if (sub === "list") {
          if (!cfg.shortcuts.length) return interaction.reply({ content: "❌ لا توجد اختصارات.", ephemeral: true });
          return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x3498db).setTitle("📋 اختصارات الطرد").setDescription(cfg.shortcuts.map(s => `\`${s.word}\``).join(", "))], ephemeral: true });
        }
        return;
      }

      // /warn
      if (name === "warn") {
        const sub = interaction.options.getSubcommand();
        const cfg = getWarnConfig(guildId);
        if (sub === "add") {
          const word  = interaction.options.getString("word", true).toLowerCase().trim();
          const logCh = interaction.options.getChannel("log");
          if (!cfg.shortcuts.find(s => s.word === word)) cfg.shortcuts.push({ word });
          if (logCh) cfg.logChannelId = logCh.id;
          saveData();
          return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x2ecc71).setTitle("✅ تمت الإضافة").setDescription(`اختصار تحذير \`${word}\` أُضيف.`)], ephemeral: true });
        }
        if (sub === "remove") {
          const word = interaction.options.getString("word", true).toLowerCase().trim();
          cfg.shortcuts = cfg.shortcuts.filter(s => s.word !== word);
          saveData();
          return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle("🗑️ تم الحذف")], ephemeral: true });
        }
        if (sub === "list") {
          if (!cfg.shortcuts.length) return interaction.reply({ content: "❌ لا توجد اختصارات.", ephemeral: true });
          return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x3498db).setTitle("📋 اختصارات التحذير").setDescription(cfg.shortcuts.map(s => `\`${s.word}\``).join(", "))], ephemeral: true });
        }
        if (sub === "history") {
          const user     = interaction.options.getUser("user", true);
          const warnings = getWarnings(guildId);
          const list     = warnings[user.id] ?? [];
          if (!list.length) return interaction.reply({ content: `✅ لا يوجد تحذيرات على <@${user.id}>.`, ephemeral: true });
          return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xe67e22).setTitle(`⚠️ تحذيرات ${user.tag}`)
            .setDescription(list.map((w,i) => `**${i+1}.** ${w.reason} — <t:${Math.floor(w.time/1000)}:R> — بواسطة <@${w.by}>`).join("\n"))
            .setThumbnail(user.displayAvatarURL())], ephemeral: true });
        }
        if (sub === "clear") {
          const user = interaction.options.getUser("user", true);
          getWarnings(guildId)[user.id] = [];
          saveData();
          return interaction.reply({ content: `✅ تم مسح تحذيرات <@${user.id}>.`, ephemeral: true });
        }
        return;
      }

      // /level-setup
      if (name === "level-setup") {
        const channel    = interaction.options.getChannel("channel", true);
        const message    = interaction.options.getString("message") ?? "🎉 مبروك {user}! وصلت للمستوى {level}";
        const thresholds = (interaction.options.getString("thresholds") ?? "10:1,50:2,150:3,300:4,500:5")
          .split(",").map(t => { const [m,l] = t.split(":").map(Number); return { messages:m, level:l }; }).filter(t => !isNaN(t.messages));
        guild(guildId).levelConfig = { announcementChannelId: channel.id, thresholds, levelUpMessage: message };
        saveData();
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x2ecc71).setTitle("✅ تم إعداد المستويات")
          .addFields(
            { name: "📢 القناة", value: `<#${channel.id}>`, inline: true },
            { name: "📊 المستويات", value: thresholds.map(t => `${t.messages} رسالة → مستوى ${t.level}`).join("\n") },
          )], ephemeral: true });
      }

      // /guard — صاحب السيرفر فقط
      if (name === "guard") {
        if (!isOwner(interaction)) return interaction.reply({ content: "❌ هذا الأمر لصاحب السيرفر فقط.", ephemeral: true });
        const sub = interaction.options.getSubcommand();
        const cfg = getGuardConfig(guildId);

        if (sub === "setup") {
          const logCh = interaction.options.getChannel("log", true);
          cfg.logChannelId = logCh.id;
          cfg.thresholds.channelDelete = interaction.options.getInteger("channel-delete") ?? cfg.thresholds.channelDelete;
          cfg.thresholds.channelCreate = interaction.options.getInteger("channel-create") ?? cfg.thresholds.channelCreate;
          cfg.thresholds.roleDelete    = interaction.options.getInteger("role-delete")    ?? cfg.thresholds.roleDelete;
          cfg.thresholds.roleCreate    = interaction.options.getInteger("role-create")    ?? cfg.thresholds.roleCreate;
          saveData();
          return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x2ecc71).setTitle("⚙️ إعدادات الحارس")
            .addFields(
              { name: "📋 قناة اللوق",        value: `<#${logCh.id}>`,                          inline: true  },
              { name: "🗑️ حذف قناة",          value: `${cfg.thresholds.channelDelete} أحداث`,   inline: true  },
              { name: "➕ إنشاء قناة",          value: `${cfg.thresholds.channelCreate} أحداث`,  inline: true  },
              { name: "🗑️ حذف رتبة",          value: `${cfg.thresholds.roleDelete} أحداث`,      inline: true  },
              { name: "➕ إنشاء رتبة",          value: `${cfg.thresholds.roleCreate} أحداث`,     inline: true  },
              { name: "🤖 إضافة بوت",          value: "طرد فوري دائماً",                         inline: true  },
            )], ephemeral: true });
        }
        if (sub === "enable")  { cfg.enabled = true;  saveData(); return interaction.reply({ content: "✅ الحارس مفعّل.",  ephemeral: true }); }
        if (sub === "disable") { cfg.enabled = false; saveData(); return interaction.reply({ content: "🔴 الحارس معطّل.", ephemeral: true }); }
        if (sub === "status")  {
          return interaction.reply({ embeds: [new EmbedBuilder().setColor(cfg.enabled ? 0x2ecc71 : 0xe74c3c)
            .setTitle(`🛡️ الحارس — ${cfg.enabled ? "مفعّل ✅" : "معطّل 🔴"}`)
            .addFields(
              { name: "📋 قناة اللوق",   value: cfg.logChannelId ? `<#${cfg.logChannelId}>` : "غير محدد", inline: true },
              { name: "🗑️ حذف قناة",    value: `${cfg.thresholds.channelDelete}`,  inline: true },
              { name: "➕ إنشاء قناة",   value: `${cfg.thresholds.channelCreate}`, inline: true },
              { name: "🗑️ حذف رتبة",    value: `${cfg.thresholds.roleDelete}`,    inline: true },
              { name: "➕ إنشاء رتبة",   value: `${cfg.thresholds.roleCreate}`,   inline: true },
              { name: "📌 وايت ليست قنوات", value: cfg.channelWhitelist.length ? cfg.channelWhitelist.map(id=>`<@${id}>`).join(" ") : "فارغ", inline: false },
              { name: "📌 وايت ليست رتب",   value: cfg.roleWhitelist.length    ? cfg.roleWhitelist.map(id=>`<@${id}>`).join(" ")    : "فارغ", inline: false },
              { name: "📌 وايت ليست بوتات", value: cfg.botWhitelist.length     ? cfg.botWhitelist.map(id=>`<@${id}>`).join(" ")     : "فارغ", inline: false },
            )], ephemeral: true });
        }
        return;
      }

      // /whitelist — صاحب السيرفر فقط
      if (name === "whitelist") {
        if (!isOwner(interaction)) return interaction.reply({ content: "❌ هذا الأمر لصاحب السيرفر فقط.", ephemeral: true });
        const sub = interaction.options.getSubcommand();
        const cfg = getGuardConfig(guildId);

        if (sub === "add-channel" || sub === "add-role" || sub === "add-bot") {
          const inputKey  = sub === "add-bot" ? "bots" : "users";
          const inputStr  = interaction.options.getString(inputKey, true);
          const ids       = parseUserIds(inputStr);
          const listKey   = sub === "add-channel" ? "channelWhitelist" : sub === "add-role" ? "roleWhitelist" : "botWhitelist";
          const added     = [];
          for (const id of ids) { if (!cfg[listKey].includes(id)) { cfg[listKey].push(id); added.push(id); } }
          saveData();
          const typeLabel = sub === "add-channel" ? "وايت ليست القنوات" : sub === "add-role" ? "وايت ليست الرتب" : "وايت ليست البوتات";
          return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x2ecc71).setTitle(`✅ تمت الإضافة — ${typeLabel}`)
            .setDescription(added.length ? added.map(id => `<@${id}>`).join(" ") + " تمت إضافتهم." : "لم يُضف أحد جديد.")], ephemeral: true });
        }

        if (sub === "remove") {
          const ids = parseUserIds(interaction.options.getString("users", true));
          for (const id of ids) {
            cfg.channelWhitelist = cfg.channelWhitelist.filter(x => x !== id);
            cfg.roleWhitelist    = cfg.roleWhitelist.filter(x => x !== id);
            cfg.botWhitelist     = cfg.botWhitelist.filter(x => x !== id);
          }
          saveData();
          return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle("🗑️ تم الحذف من الوايت ليست")
            .setDescription(ids.map(id => `<@${id}>`).join(" "))], ephemeral: true });
        }

        if (sub === "list") {
          const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("📋 الوايت ليست").setTimestamp()
            .addFields(
              { name: "🔧 وايت ليست القنوات\n(يقدرون يضيفون ويحذفون قنوات)", value: cfg.channelWhitelist.length ? cfg.channelWhitelist.map(id=>`<@${id}>`).join("\n") : "فارغ", inline: true },
              { name: "🎭 وايت ليست الرتب\n(يقدرون يضيفون ويحذفون رتب)",     value: cfg.roleWhitelist.length    ? cfg.roleWhitelist.map(id=>`<@${id}>`).join("\n")    : "فارغ", inline: true },
              { name: "🤖 وايت ليست البوتات\n(بوتات مسموح لها بالدخول)",      value: cfg.botWhitelist.length     ? cfg.botWhitelist.map(id=>`<@${id}>`).join("\n")     : "فارغ", inline: true },
            );
          return interaction.reply({ embeds: [embed] }); // مرئي للجميع
        }
        return;
      }

      // /ticket-setup
      if (name === "ticket-setup") {
        const staffRole = interaction.options.getRole("staff-role", true);
        const category  = interaction.options.getChannel("category");
        const logCh     = interaction.options.getChannel("log");
        const message   = interaction.options.getString("message") ?? "مرحباً {user}! سيتم الرد عليك قريباً.";
        const colorStr  = interaction.options.getString("color") ?? "#5865f2";
        guild(guildId).ticketConfig = {
          staffRoleId: staffRole.id, categoryId: category?.id ?? null,
          logChannelId: logCh?.id ?? null, openMessage: message,
          color: parseInt(colorStr.replace("#",""),16) || 0x5865f2,
        };
        saveData();
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x2ecc71).setTitle("✅ تم إعداد التذاكر")
          .addFields(
            { name: "👮 رول الستاف", value: `<@&${staffRole.id}>`,                   inline: true },
            { name: "📁 الكاتيقوري", value: category ? `<#${category.id}>` : "لا يوجد", inline: true },
            { name: "📋 قناة اللوق", value: logCh    ? `<#${logCh.id}>`    : "لا يوجد", inline: true },
          )], ephemeral: true });
      }

      // /ticket-panel
      if (name === "ticket-panel") {
        const channel = interaction.options.getChannel("channel", true);
        const title   = interaction.options.getString("title")       ?? "🎫 فتح تذكرة";
        const desc    = interaction.options.getString("description") ?? "اضغط على الزر بالأسفل لفتح تذكرة دعم.";
        const cfg     = getTicketConfig(guildId);
        try {
          await channel.send({
            embeds: [new EmbedBuilder().setColor(cfg?.color ?? 0x5865f2).setTitle(title).setDescription(desc)],
            components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("open_ticket").setLabel("📩 افتح تذكرة").setStyle(ButtonStyle.Primary))],
          });
          return interaction.reply({ content: `✅ تم إرسال البانل في <#${channel.id}>`, ephemeral: true });
        } catch { return interaction.reply({ content: "❌ فشل الإرسال. تأكد من صلاحيات البوت.", ephemeral: true }); }
      }

      // /send-embed
      if (name === "send-embed") {
        const channel = interaction.options.getChannel("channel", true);
        const color   = parseInt((interaction.options.getString("color") ?? "#3498db").replace("#",""),16) || 0x3498db;
        try {
          await channel.send({ embeds: [new EmbedBuilder().setColor(color).setTitle(interaction.options.getString("title",true)).setDescription(interaction.options.getString("description",true)).setTimestamp()] });
          return interaction.reply({ content: "✅ تم الإرسال.", ephemeral: true });
        } catch { return interaction.reply({ content: "❌ فشل الإرسال.", ephemeral: true }); }
      }

      // /emoji-stealer ← جديد
      if (name === "emoji-stealer") {
        const ch  = interaction.options.getChannel("channel", true);
        getStealerConfig(guildId).emojiChannelId = ch.id;
        saveData();
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x2ecc71)
          .setTitle("✅ تم إعداد Emoji Stealer")
          .setDescription(`أي إيموجي يُرسل في <#${ch.id}> سيُضاف للسيرفر تلقائياً باسم \`by_tux_N\``)
          .setTimestamp()], ephemeral: true });
      }

      // /sticker-stealer ← جديد
      if (name === "sticker-stealer") {
        const ch  = interaction.options.getChannel("channel", true);
        getStealerConfig(guildId).stickerChannelId = ch.id;
        saveData();
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x2ecc71)
          .setTitle("✅ تم إعداد Sticker Stealer")
          .setDescription(`أي ستيكر يُرسل في <#${ch.id}> سيُضاف للسيرفر تلقائياً باسم \`by_tux_N\``)
          .setTimestamp()], ephemeral: true });
      }

      // /role-icon
      if (name === "role-icon") {
        const role      = interaction.options.getRole("role", true);
        const emojiRaw  = interaction.options.getString("emoji", true).trim();

        // استخراج الإيموجي: إيموجي يونيكود أو إيموجي مخصص <:name:id> أو <a:name:id>
        const customMatch = emojiRaw.match(/^<(a?):([\w]+):(\d+)>$/);

        async function fetchImageBuffer(url) {
          return new Promise((resolve, reject) => {
            https.get(url, (res) => {
              if (res.statusCode === 301 || res.statusCode === 302) {
                return fetchImageBuffer(res.headers.location).then(resolve).catch(reject);
              }
              const chunks = [];
              res.on("data", c => chunks.push(c));
              res.on("end", () => resolve(Buffer.concat(chunks)));
              res.on("error", reject);
            }).on("error", reject);
          });
        }

        try {
          let iconBuffer;
          if (customMatch) {
            // إيموجي مخصص — نجيبه من CDN ديسكورد
            const isAnimated = customMatch[1] === "a";
            const emojiId    = customMatch[3];
            const ext        = isAnimated ? "gif" : "png";
            const url        = `https://cdn.discordapp.com/emojis/${emojiId}.${ext}?size=64`;
            iconBuffer       = await fetchImageBuffer(url);
          } else {
            // إيموجي يونيكود — نجيبه من Twemoji (PNG بخلفية شفافة)
            const codePoints = [...emojiRaw].map(c => c.codePointAt(0).toString(16)).join("-");
            const url        = `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${codePoints}.png`;
            iconBuffer       = await fetchImageBuffer(url);
          }
          await role.setIcon(iconBuffer);
          return interaction.reply({ embeds: [new EmbedBuilder()
            .setColor(0x2ecc71)
            .setTitle("✅ تم تغيير أيقونة الرتبة")
            .addFields(
              { name: "🏷️ الرتبة",   value: `<@&${role.id}> (${role.name})`, inline: true },
              { name: "🎨 الأيقونة", value: emojiRaw,                            inline: true },
            )
            .setFooter({ text: `بواسطة ${interaction.user.tag}` })
            .setTimestamp()
          ], ephemeral: true });
        } catch (err) {
          const msg = err.code === 50013
            ? "❌ البوت ليس لديه صلاحية تعديل هذه الرتبة."
            : err.code === 50035
            ? "❌ إيموجي غير صالح أو السيرفر لا يدعم أيقونات الرتب (يحتاج بوست مستوى 2)."
            : `❌ فشل تغيير الأيقونة: ${err.message}`;
          return interaction.reply({ content: msg, ephemeral: true });
        }
      }

      // /set-log ← جديد
      if (name === "set-log") {
        const sub    = interaction.options.getSubcommand();
        const ch     = interaction.options.getChannel("channel", true);
        const cfg    = getLogConfig(guildId);
        const keyMap = {
          roles:     "rolesLogChannelId",
          messages:  "messagesLogChannelId",
          bans:      "bansLogChannelId",
          mutes:     "mutesLogChannelId",
          channels:  "channelsLogChannelId",
          reactions: "reactionsLogChannelId",
          kicks:     "kicksLogChannelId",
          joins:     "joinsLogChannelId",
          leaves:    "leavesLogChannelId",
          invites:   "invitesLogChannelId",
        };
        const labelMap = {
          roles:     "لوق الرتب",
          messages:  "لوق الرسائل",
          bans:      "لوق الباند",
          mutes:     "لوق الميوت/تايم اوت",
          channels:  "لوق الرومات",
          reactions: "لوق الرياكشن",
          kicks:     "لوق الطرد",
          joins:     "لوق الدخول",
          leaves:    "لوق الخروج",
          invites:   "لوق الإنفايت",
        };
        cfg[keyMap[sub]] = ch.id;
        saveData();
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x2ecc71)
          .setTitle(`✅ تم إعداد ${labelMap[sub]}`)
          .setDescription(`سيتم إرسال ${labelMap[sub]} في <#${ch.id}>`)
          .setTimestamp()], ephemeral: true });
      }

      // /auto-role
      if (name === "auto-role") {
        const sub = interaction.options.getSubcommand();
        const cfg = getAutoRoleConfig(guildId);

        if (sub === "set") {
          const role  = interaction.options.getRole("role", true);
          const logCh = interaction.options.getChannel("log");
          cfg.roleId       = role.id;
          if (logCh) cfg.logChannelId = logCh.id;
          saveData();
          return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x2ecc71)
            .setTitle("✅ تم إعداد الرول التلقائي")
            .addFields(
              { name: "🎭 الرول",       value: `<@&${role.id}>`, inline: true },
              { name: "📋 قناة اللوق", value: logCh ? `<#${logCh.id}>` : "لا يوجد", inline: true },
            ).setFooter({ text: "أي شخص يدخل السيرفر سيحصل على هذا الرول تلقائياً" })
            .setTimestamp()], ephemeral: true });
        }

        if (sub === "disable") {
          cfg.roleId = null;
          saveData();
          return interaction.reply({ content: "🔴 تم إيقاف الرول التلقائي.", ephemeral: true });
        }

        if (sub === "status") {
          return interaction.reply({ embeds: [new EmbedBuilder()
            .setColor(cfg.roleId ? 0x2ecc71 : 0xe74c3c)
            .setTitle(`🤖 الرول التلقائي — ${cfg.roleId ? "مفعّل ✅" : "معطّل 🔴"}`)
            .addFields(
              { name: "🎭 الرول",       value: cfg.roleId      ? `<@&${cfg.roleId}>`      : "لا يوجد", inline: true },
              { name: "📋 قناة اللوق", value: cfg.logChannelId ? `<#${cfg.logChannelId}>` : "لا يوجد", inline: true },
            ).setTimestamp()], ephemeral: true });
        }
        return;
      }

      // /list
      if (name === "help") {
        const categories = [
          { id: "list_tax",     label: "💰 الضريبة",        emoji: "💰" },
          { id: "list_reply",   label: "💬 الردود التلقائية", emoji: "💬" },
          { id: "list_mod",     label: "🔨 الإدارة",         emoji: "🔨" },
          { id: "list_level",   label: "📊 المستويات",        emoji: "📊" },
          { id: "list_guard",   label: "🛡️ الحارس",          emoji: "🛡️" },
          { id: "list_ticket",  label: "🎫 التذاكر",          emoji: "🎫" },
          { id: "list_emoji",   label: "😀 الإيموجي/ستيكر",  emoji: "😀" },
          { id: "list_log",     label: "📋 اللوقات",          emoji: "📋" },
          { id: "list_role",    label: "🎨 الرتب",            emoji: "🎨" },
          { id: "list_giveaway",label: "🎉 القرعة",           emoji: "🎉" },
          { id: "list_say",     label: "📢 say / say-spam",   emoji: "📢" },
        ];
        const rows = [];
        for (let i = 0; i < categories.length; i += 5) {
          rows.push(new ActionRowBuilder().addComponents(
            categories.slice(i, i + 5).map(c =>
              new ButtonBuilder().setCustomId(c.id).setLabel(c.label).setStyle(ButtonStyle.Secondary)
            )
          ));
        }
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("📜 قائمة الأوامر")
            .setDescription("اضغط على أي فئة لرؤية أوامرها وشرحها")
            .setFooter({ text: `طلب من ${interaction.user.tag}` }).setTimestamp()],
          components: rows,
        });
      }

      // /giveaway
      if (name === "giveaway") {
        const sub = interaction.options.getSubcommand();

        if (sub === "start") {
          const prize    = interaction.options.getString("prize", true);
          const duration = interaction.options.getString("duration", true);
          const winners  = interaction.options.getInteger("winners", true);
          const ch       = interaction.options.getChannel("channel") ?? interaction.channel;

          // تحليل المدة
          const durationMs = (() => {
            const match = duration.match(/^(\d+)(s|m|h|d)$/i);
            if (!match) return null;
            const n = parseInt(match[1]);
            const u = match[2].toLowerCase();
            return u === "s" ? n*1000 : u === "m" ? n*60000 : u === "h" ? n*3600000 : n*86400000;
          })();
          if (!durationMs || durationMs < 10000)
            return interaction.reply({ content: "❌ مدة غير صالحة — مثال: `30m`، `2h`، `1d`", ephemeral: true });

          const endsAt = Date.now() + durationMs;
          const endsTs = Math.floor(endsAt / 1000);

          const embed = new EmbedBuilder()
            .setColor(0xf1c40f)
            .setTitle(`🎉 قرعة — ${prize}`)
            .setDescription([
              `> اضغط على 🎉 تحت الرسالة للمشاركة!`,
              ``,
              `🏆 **الجائزة:** ${prize}`,
              `👥 **عدد الفائزين:** ${winners}`,
              `⏰ **تنتهي:** <t:${endsTs}:R> (<t:${endsTs}:F>)`,
              `🎟️ **بدأها:** <@${interaction.user.id}>`,
            ].join("\n"))
            .setFooter({ text: `انتهت القرعة` })
            .setTimestamp(endsAt);

          await interaction.reply({ content: `✅ تم نشر القرعة في <#${ch.id}>`, ephemeral: true });

          let giveawayMsg;
          try { giveawayMsg = await ch.send({ embeds: [embed] }); }
          catch { return; }
          await giveawayMsg.react("🎉").catch(()=>null);

          // حفظ القرعة
          const giveaways = getGiveaways(guildId);
          giveaways[giveawayMsg.id] = {
            prize, winners, endsAt, channelId: ch.id, hostId: interaction.user.id, ended: false,
          };
          saveData();

          // تايمر الإنهاء التلقائي
          setTimeout(() => endGiveaway(interaction.guild, giveawayMsg.id), durationMs);
          return;
        }

        if (sub === "end") {
          const msgId = interaction.options.getString("message-id", true);
          await interaction.deferReply({ ephemeral: true });
          const result = await endGiveaway(interaction.guild, msgId);
          return interaction.editReply({ content: result });
        }

        if (sub === "reroll") {
          const msgId = interaction.options.getString("message-id", true);
          await interaction.deferReply({ ephemeral: true });
          const result = await rerollGiveaway(interaction.guild, msgId);
          return interaction.editReply({ content: result });
        }
        return;
      }

      // /set-nickname-word
      if (name === "set-nickname-word") {
        const sub = interaction.options.getSubcommand();
        const cfg = getNickConfig(guildId);
        if (sub === "add") {
          const word  = interaction.options.getString("word", true).toLowerCase().trim();
          const role  = interaction.options.getRole("role");
          const logCh = interaction.options.getChannel("log");
          if (!cfg.shortcuts.find(s => s.word === word)) cfg.shortcuts.push({ word });
          if (role)  cfg.allowedRoleId  = role.id;
          if (logCh) cfg.logChannelId   = logCh.id;
          saveData();
          return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x2ecc71)
            .setTitle("✅ تمت الإضافة")
            .addFields(
              { name: "🔤 الاختصار",    value: `\`${word}\``,                                                     inline: true },
              { name: "🎭 الرول",        value: role  ? `<@&${role.id}>` : "الكل",                                inline: true },
              { name: "📋 قناة اللوق",  value: logCh ? `<#${logCh.id}>` : "غير محددة",                          inline: true },
              { name: "📖 الاستخدام",   value: `\`${word} @منشن الاسم الجديد\``,                                  inline: false },
            )], ephemeral: true });
        }
        if (sub === "remove") {
          const word = interaction.options.getString("word", true).toLowerCase().trim();
          cfg.shortcuts = cfg.shortcuts.filter(s => s.word !== word);
          saveData();
          return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle("🗑️ تم الحذف").setDescription(`اختصار \`${word}\` حُذف.`)], ephemeral: true });
        }
        if (sub === "list") {
          if (!cfg.shortcuts.length) return interaction.reply({ content: "❌ لا توجد اختصارات.", ephemeral: true });
          return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x3498db).setTitle("📋 اختصارات النك نايم")
            .setDescription(cfg.shortcuts.map(s => `\`${s.word}\``).join(", "))], ephemeral: true });
        }
        return;
      }

      // /come
      if (name === "come") {
        const target  = interaction.options.getUser("user", true);
        const reason  = interaction.options.getString("reason", true);
        const channel = interaction.options.getChannel("channel") ?? interaction.channel;
        await interaction.deferReply({ ephemeral: true });
        const sent = await sendComeMessage({ target, callerTag: interaction.user.tag, callerId: interaction.user.id, reason, channelId: channel?.id ?? interaction.channelId, guildName: interaction.guild?.name ?? "السيرفر" });
        return interaction.editReply({ content: sent ? `✅ تم إرسال رسالة الاستدعاء لـ <@${target.id}>.` : "❌ لم أستطع إرسال رسالة خاصة للشخص." });
      }

      // /ad-setup
      if (name === "ad-setup") {
        const cfg          = getAdConfig(guildId);
        cfg.roleId         = interaction.options.getRole("role", true).id;
        cfg.panelChannelId = interaction.options.getChannel("panel-channel", true).id;
        cfg.maxPosts       = interaction.options.getInteger("max-posts") ?? 3;
        cfg.intervalHours  = interaction.options.getInteger("interval") ?? 0;
        cfg.channels       = [
          interaction.options.getChannel("channel1", true).id,
          interaction.options.getChannel("channel2")?.id,
          interaction.options.getChannel("channel3")?.id,
        ].filter(Boolean);
        saveData();

        // تشغيل الإنترفال
        await setupAdInterval(interaction.guild, guildId);

        return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x2ecc71)
          .setTitle("✅ تم إعداد نظام التبادل التلقائي")
          .addFields(
            { name: "🎭 الرتبة المطلوبة",  value: `<@&${cfg.roleId}>`,                                             inline: true },
            { name: "📢 قناة البانل",       value: `<#${cfg.panelChannelId}>`,                                     inline: true },
            { name: "📋 قنوات النشر",       value: cfg.channels.map(id => `<#${id}>`).join("\n"),                   inline: false },
            { name: "📊 الحد الأقصى",       value: `${cfg.maxPosts} منشورات لكل شخص`,                               inline: true },
            { name: "🔄 إعادة الإرسال",     value: cfg.intervalHours > 0 ? `كل ${cfg.intervalHours} ساعة` : "معطل", inline: true },
          ).setFooter({ text: "استخدم /ad-panel لإرسال البانل الآن" })
          .setTimestamp()], ephemeral: true });
      }

      // /ad-panel
      if (name === "ad-panel") {
        const cfg = getAdConfig(guildId);
        if (!cfg.panelChannelId || !cfg.channels.length)
          return interaction.reply({ content: "❌ أعدّ النظام أولاً بـ `/ad-setup`.", ephemeral: true });
        await interaction.deferReply({ ephemeral: true });
        await sendAdPanel(interaction.guild, guildId);
        return interaction.editReply({ content: "✅ تم إرسال البانل." });
      }

      // /say
      if (name === "say") {
        const sub       = interaction.options.getSubcommand();
        const sayCfg    = getSayConfig(guildId);
        const ownerOnly = isOwner(interaction);
        const allowed   = ownerOnly || sayCfg.allowedUsers.includes(interaction.user.id);

        if (sub === "allow" || sub === "deny") {
          if (!ownerOnly)
            return interaction.reply({ content: "❌ هذا الأمر لمالك السيرفر فقط.", ephemeral: true });
          const user = interaction.options.getUser("user", true);
          if (sub === "allow") {
            if (!sayCfg.allowedUsers.includes(user.id)) sayCfg.allowedUsers.push(user.id);
            saveData();
            return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x2ecc71)
              .setTitle("✅ تمت الإضافة").setDescription(`<@${user.id}> أصبح مصرحاً له باستخدام /say`)], ephemeral: true });
          } else {
            sayCfg.allowedUsers = sayCfg.allowedUsers.filter(id => id !== user.id);
            saveData();
            return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xe74c3c)
              .setTitle("🗑️ تم الحذف").setDescription(`<@${user.id}> لم يعد مصرحاً له.`)], ephemeral: true });
          }
        }

        if (sub === "list") {
          const list = sayCfg.allowedUsers;
          return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2)
            .setTitle("📋 المستخدمون المصرح لهم بـ /say")
            .setDescription(list.length ? list.map(id => `<@${id}>`).join("\n") : "لا يوجد أحد مضاف بعد.")
            .setFooter({ text: "مالك السيرفر مصرح له دائماً" })], ephemeral: true });
        }

        if (sub === "send") {
          if (!allowed)
            return interaction.reply({ content: "❌ ليس لديك صلاحية استخدام هذا الأمر.", ephemeral: true });
          const text = interaction.options.getString("text", true);
          const ch   = interaction.options.getChannel("channel") ?? interaction.channel;
          try {
            await ch.send(text);
            return interaction.reply({ content: `✅ تم الإرسال في <#${ch.id}>`, ephemeral: true });
          } catch {
            return interaction.reply({ content: "❌ فشل الإرسال — تأكد من صلاحيات البوت.", ephemeral: true });
          }
        }
        return;
      }

      // /say-spam
      if (name === "say-spam") {
        if (!isOwner(interaction))
          return interaction.reply({ content: "❌ هذا الأمر لمالك السيرفر فقط.", ephemeral: true });

        const text  = interaction.options.getString("text", true);
        const times = interaction.options.getInteger("times", true);
        const ch    = interaction.options.getChannel("channel") ?? interaction.channel;

        await interaction.reply({ content: `⏳ جاري الإرسال ${times} مرة...`, ephemeral: true });

        let sent = 0;
        for (let i = 0; i < times; i++) {
          try { await ch.send(text); sent++; } catch { break; }
        }
        return interaction.editReply({ content: `✅ تم إرسال الرسالة **${sent}** مرة في <#${ch.id}>` });
      }
    }

    // ─── Buttons ──────────────────────────────────────
    if (interaction.isButton()) {
      const id = interaction.customId;
      if (id === "open_ticket")          { await handleOpenTicket(interaction);   return; }
      if (id === "close_ticket")         { await handleCloseTicket(interaction);  return; }
      if (id === "confirm_close_ticket") { await handleConfirmClose(interaction); return; }
      if (id === "cancel_close_ticket")  { await handleCancelClose(interaction);  return; }
      if (id === "claim_ticket")         { await handleClaimTicket(interaction);  return; }

      // ─── /list category buttons ───
      const listInfo = {
        list_tax: {
          title: "💰 أوامر الضريبة",
          fields: [
            { name: "`/tax [amount]`",  value: "يحسب ضريبة ديسكورد 5% — مثال: `/tax 3m`" },
            { name: "`+tax [amount]`",  value: "نفس الأمر بالبريفكس — مثال: `+tax 500k`" },
          ],
        },
        list_reply: {
          title: "💬 أوامر الردود التلقائية",
          fields: [
            { name: "`/auto-reply add`",    value: "تضيف كلمة trigger ورد تلقائي لها" },
            { name: "`/auto-reply list`",   value: "تعرض جميع الردود المضافة" },
            { name: "`/auto-reply remove`", value: "تحذف رد بالرقم من القائمة" },
          ],
        },
        list_mod: {
          title: "🔨 أوامر الإدارة",
          fields: [
            { name: "`/band add/remove/list`", value: "إدارة اختصارات الباند — تكتب الكلمة تطلع قائمة تختار منها" },
            { name: "`/kick add/remove/list`", value: "إدارة اختصارات الطرد" },
            { name: "`/warn add/remove/list`", value: "إدارة اختصارات التحذير" },
            { name: "`/warn history @user`",   value: "عرض سجل تحذيرات عضو" },
            { name: "`/warn clear @user`",     value: "مسح جميع تحذيرات عضو" },
          ],
        },
        list_level: {
          title: "📊 أوامر المستويات",
          fields: [
            { name: "`/level-setup`", value: "تحدد قناة الإعلانات والمستويات — مثال thresholds: `10:1,50:2,100:3`" },
          ],
        },
        list_guard: {
          title: "🛡️ أوامر الحارس",
          fields: [
            { name: "`/guard setup`",   value: "تعد قناة اللوق وحدود الأحداث قبل الباند" },
            { name: "`/guard enable`",  value: "تفعيل الحارس" },
            { name: "`/guard disable`", value: "تعطيل الحارس" },
            { name: "`/guard status`",  value: "عرض الإعدادات الحالية" },
            { name: "`/whitelist add-channel/add-role/add-bot`", value: "إضافة للقائمة البيضاء" },
            { name: "`/whitelist remove`", value: "حذف من القائمة البيضاء" },
            { name: "`/whitelist list`",   value: "عرض القائمة البيضاء" },
          ],
        },
        list_ticket: {
          title: "🎫 أوامر التذاكر",
          fields: [
            { name: "`/ticket-setup`", value: "تعد النظام — رول الستاف، الكاتيقوري، قناة اللوق، رسالة الترحيب" },
            { name: "`/ticket-panel`", value: "ترسل بانل بزر 'افتح تذكرة' في أي قناة" },
          ],
        },
        list_emoji: {
          title: "😀 أوامر الإيموجي والستيكر",
          fields: [
            { name: "`/emoji-stealer`",   value: "تحدد قناة — أي إيموجي يُرسل فيها يُضاف للسيرفر تلقائياً" },
            { name: "`/sticker-stealer`", value: "تحدد قناة — أي ستيكر يُرسل فيها يُضاف للسيرفر تلقائياً" },
          ],
        },
        list_log: {
          title: "📋 أوامر اللوقات",
          fields: [
            { name: "`/set-log roles`",     value: "قناة لوق الرتب (إنشاء، حذف، تعديل، منح، سحب)" },
            { name: "`/set-log messages`",  value: "قناة لوق الرسائل (حذف، تعديل)" },
            { name: "`/set-log bans`",      value: "قناة لوق الباند" },
            { name: "`/set-log mutes`",     value: "قناة لوق التايم اوت" },
            { name: "`/set-log channels`",  value: "قناة لوق القنوات (إنشاء، حذف)" },
            { name: "`/set-log reactions`", value: "قناة لوق الرياكشن" },
            { name: "`/set-log kicks`",     value: "قناة لوق الطرد" },
            { name: "`/set-log joins`",     value: "قناة لوق الدخول" },
            { name: "`/set-log leaves`",    value: "قناة لوق الخروج" },
            { name: "`/set-log invites`",   value: "قناة لوق الإنفايت" },
          ],
        },
        list_role: {
          title: "🎨 أوامر الرتب",
          fields: [
            { name: "`/role-icon @role emoji`", value: "تغيير أيقونة رتبة بإيموجي (يونيكود أو مخصص) — يحتاج بوست مستوى 2" },
            { name: "`/auto-role set @role`",   value: "أي شخص يدخل السيرفر يجيه هذا الرول تلقائياً" },
            { name: "`/auto-role disable`",     value: "إيقاف الرول التلقائي" },
            { name: "`/auto-role status`",      value: "عرض إعدادات الرول التلقائي" },
          ],
        },
        list_say: {
          title: "📢 أوامر Say",
          fields: [
            { name: "`/say send [text] [#channel]`", value: "البوت يرسل الرسالة في القناة المحددة — للمالك والمصرح لهم" },
            { name: "`/say allow @user`",             value: "تضيف مستخدم للقائمة المصرح لهم — مالك فقط" },
            { name: "`/say deny @user`",              value: "تحذف مستخدم من القائمة — مالك فقط" },
            { name: "`/say list`",                    value: "تعرض المستخدمين المصرح لهم" },
            { name: "`/say-spam [text] [times]`",     value: "البوت يرسل الرسالة عدة مرات بسرعة (1–200) — مالك فقط" },
          ],
        },
        list_giveaway: {
          title: "🎉 أوامر القرعة",
          fields: [
            { name: "`/giveaway start`", value: "تبدأ قرعة — تحدد الجائزة، المدة (30m/2h/1d)، عدد الفائزين، والقناة" },
            { name: "`/giveaway end`",   value: "تنهي القرعة قبل وقتها وتُعلن الفائز فوراً" },
            { name: "`/giveaway reroll`","value": "تعيد السحب على فائز جديد من نفس القرعة" },
          ],
        },
      };
      if (id.startsWith("list_") && listInfo[id]) {
        const info = listInfo[id];
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(info.title)
            .addFields(info.fields).setTimestamp()],
          ephemeral: true,
        });
      }
    }

    // ─── Select Menus ─────────────────────────────────
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith("band_select:"))  { await handleActionSelect(interaction, "ban");  return; }
      if (interaction.customId.startsWith("kick_select:"))  { await handleActionSelect(interaction, "kick"); return; }
      if (interaction.customId.startsWith("warn_select:"))  { await handleActionSelect(interaction, "warn"); return; }

      // ─── بانل التبادل التلقائي ───
      if (interaction.customId === "ad_panel_menu") {
        const val     = interaction.values[0];
        const guildId = interaction.guildId;
        const cfg     = getAdConfig(guildId);
        const posts   = getAdPosts(guildId);
        const userPosts = (posts[interaction.user.id] ?? []).filter(p => p.active);

        if (val === "ad_explain") {
          return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2)
            .setTitle("📖 شرح نظام التبادل التلقائي")
            .setDescription([
              "**كيف يعمل النظام؟**",
              "اختر **إنشاء منشور** من القائمة وسيراسلك البوت بالخاص",
              "اكتب محتوى منشورك (نص + صورة اختيارية) ثم اختر القناة",
              "سيُنشر الإعلان تلقائياً باسمك",
              "",
              "**القيود:**",
              `• الحد الأقصى: **${cfg.maxPosts}** منشورات نشطة`,
              "• يمكن النشر في قناة واحدة فقط في كل مرة",
              `• يجب أن تمتلك رتبة <@&${cfg.roleId ?? "محددة"}>`,
            ].join("\n"))
            .setTimestamp()], ephemeral: true });
        }

        if (val === "ad_limits") {
          return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x9b59b6)
            .setTitle("📊 حدود النشر")
            .addFields(
              { name: "✅ منشوراتك النشطة",  value: `${userPosts.length} / ${cfg.maxPosts}`,      inline: true },
              { name: "📋 القنوات المتاحة",   value: cfg.channels.map(id => `<#${id}>`).join("\n"), inline: true },
            ).setTimestamp()], ephemeral: true });
        }

        if (val === "ad_my_posts") {
          if (!userPosts.length)
            return interaction.reply({ content: "📭 ليس لديك منشورات نشطة.", ephemeral: true });
          return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x3498db)
            .setTitle("📋 منشوراتك النشطة")
            .setDescription(userPosts.map((p, i) =>
              `**${i+1}.** <#${p.channelId}> — <t:${Math.floor(p.createdAt/1000)}:R>`
            ).join("\n"))
            .setTimestamp()], ephemeral: true });
        }

        if (val === "ad_refresh") {
          await sendAdPanel(interaction.guild, guildId);
          return interaction.reply({ content: "🔄 تم تحديث البانل.", ephemeral: true });
        }

        if (val === "ad_create") {
          // فحص الرتبة
          if (cfg.roleId && !interaction.member?.roles.cache.has(cfg.roleId))
            return interaction.reply({ content: `❌ تحتاج رتبة <@&${cfg.roleId}> للنشر.`, ephemeral: true });
          // فحص الحد
          if (userPosts.length >= cfg.maxPosts)
            return interaction.reply({ content: `❌ وصلت للحد الأقصى (${cfg.maxPosts} منشورات).`, ephemeral: true });
          // فحص قيد قناة واحدة
          await interaction.reply({ content: "📨 راجع رسائلك الخاصة — أرسلت لك البوت!", ephemeral: true });
          // DM المستخدم
          try {
            const dmCh = await interaction.user.createDM();
            await dmCh.send({ embeds: [new EmbedBuilder().setColor(0x5865f2)
              .setTitle("✍️ اكتب محتوى منشورك")
              .setDescription([
                "أرسل الآن **نص منشورك** (يمكنك إرفاق صورة معه أيضاً)",
                "",
                "> 💡 مثال: مطلوب كردت — للتواصل معي بالخاص",
                "",
                "لإلغاء العملية اكتب: `إلغاء`",
              ].join("\n"))
              .setTimestamp()] });
            dmConversations.set(interaction.user.id, {
              step: "awaiting_content",
              guildId,
              content: null,
              imageUrl: null,
              member: { tag: interaction.user.tag, id: interaction.user.id, avatar: interaction.user.displayAvatarURL() },
            });
          } catch {
            return interaction.followUp({ content: "❌ لم أستطع إرسال رسالة خاصة — تأكد أن رسائلك الخاصة مفتوحة.", ephemeral: true });
          }
          return;
        }
      }

      // ─── اختيار قناة النشر في DM ───
      if (interaction.customId === "ad_channel_select") {
        const conv = dmConversations.get(interaction.user.id);
        if (!conv || conv.step !== "awaiting_channel") return;
        const channelId = interaction.values[0];
        await interaction.deferUpdate();
        await publishAdPost(interaction.user, conv, channelId);
      }
    }

  } catch (err) {
    log("error", "Interaction error", { err: err.message });
    try {
      const payload = { content: "❌ حدث خطأ غير متوقع.", ephemeral: true };
      if (interaction.isRepliable()) {
        if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
        else await interaction.reply(payload);
      }
    } catch {}
  }
});

// ══════════════════════════════════════════════════════
//  Message Handler
// ══════════════════════════════════════════════════════
client.on("messageCreate", async (message) => {
  // ─── DM conversation handler (التبادل التلقائي) ───
  if (!message.author.bot && !message.guildId) {
    const conv = dmConversations.get(message.author.id);
    if (conv && conv.step === "awaiting_content") {
      if (message.content.trim() === "إلغاء") {
        dmConversations.delete(message.author.id);
        return message.reply("❌ تم إلغاء العملية.").catch(()=>null);
      }
      conv.content  = message.content || null;
      conv.imageUrl = message.attachments.first()?.url ?? null;

      const cfg = getAdConfig(conv.guildId);
      if (cfg.channels.length === 1) {
        // قناة وحيدة — انشر مباشرة
        await publishAdPost(message.author, conv, cfg.channels[0]);
        await message.reply("✅ تم نشر منشورك!").catch(()=>null);
      } else {
        // أكثر من قناة — اطلب الاختيار
        conv.step = "awaiting_channel";
        dmConversations.set(message.author.id, conv);
        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("ad_channel_select")
            .setPlaceholder("اختر القناة")
            .addOptions(cfg.channels.map(id => ({
              label: `#${id}`,
              value: id,
              description: `انشر في قناة ${id}`,
            })))
        );
        await message.reply({ content: "📋 اختر القناة التي تريد النشر فيها:", components: [row] }).catch(()=>null);
      }
      return;
    }
    return;
  }

  if (message.author.bot || !message.guildId) return;
  await Promise.all([
    handleTaxMessage(message),
    handleAutoReplies(message),
    handleBandShortcuts(message),
    handleKickShortcuts(message),
    handleWarnShortcuts(message),
    handleNickShortcuts(message),
    handleComeMessage(message),
    handleLevelSystem(message),
    handleGuardMessage(message),
    handleEmojiStealer(message),
    handleStickerStealer(message),
  ]);
});

// ══════════════════════════════════════════════════════
//  Tax (prefix)
// ══════════════════════════════════════════════════════
async function handleTaxMessage(message) {
  if (!message.content.startsWith(PREFIX)) return;
  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  if (args.shift()?.toLowerCase() !== "tax") return;
  if (!args[0]) return message.reply({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle("❌ استخدام خاطئ").setDescription("مثال: `+tax 3m`")] }).catch(()=>null);
  const raw = parseTaxAmount(args[0]);
  if (isNaN(raw) || raw <= 0) return message.reply({ content: "❌ مبلغ غير صالح." }).catch(()=>null);
  const withTax = Math.ceil(raw / (1 - TAX_RATE));
  const taxAmt  = withTax - Math.ceil(raw);
  await message.reply({ embeds: [new EmbedBuilder().setColor(0x2ecc71).setTitle("🧾 حساب ضريبة ديسكورد")
    .addFields(
      { name: "💰 المطلوب استلامه", value: `\`${Math.ceil(raw).toLocaleString("en-US")}\``, inline: true },
      { name: "📤 تطلبه",           value: `\`${withTax.toLocaleString("en-US")}\``,         inline: true },
      { name: "📊 الضريبة",         value: `\`${taxAmt.toLocaleString("en-US")}\``,          inline: true },
    ).setFooter({ text: `طلب من ${message.author.tag}` }).setTimestamp()] }).catch(()=>null);
}

// ══════════════════════════════════════════════════════
//  Auto Replies
// ══════════════════════════════════════════════════════
async function handleAutoReplies(message) {
  const list    = getAutoReplies(message.guildId);
  const content = message.content.toLowerCase().trim();
  for (const entry of list) {
    // المطابقة دايماً كاملة — الرسالة لازم تكون نفس الـtrigger بالضبط
    const matches = content === entry.trigger;
    if (!matches) continue;
    if (entry.roleId && !message.member?.roles.cache.has(entry.roleId)) continue;
    await message.reply({ content: entry.response.replace("{user}", `<@${message.author.id}>`) }).catch(()=>null);
    break;
  }
}

// ══════════════════════════════════════════════════════
//  Nickname Shortcuts
// ══════════════════════════════════════════════════════
async function handleNickShortcuts(message) {
  if (!message.guild) return;
  const cfg = getNickConfig(message.guildId);
  if (!cfg.shortcuts.length) return;
  if (cfg.allowedRoleId && !message.member?.roles.cache.has(cfg.allowedRoleId)) return;

  const content = message.content.trim();
  const parts   = content.split(/\s+/);
  if (parts.length < 3) return;
  const firstWord = parts[0].toLowerCase();
  const shortcut  = cfg.shortcuts.find(s => s.word === firstWord);
  if (!shortcut) return;

  const mentionMatch = content.match(/<@!?(\d+)>/);
  if (!mentionMatch) return;
  const targetId     = mentionMatch[1];
  const mentionIndex = parts.findIndex(p => /<@!?\d+>/.test(p));
  const newNick      = parts.slice(mentionIndex + 1).join(" ").trim();
  if (!newNick) return message.reply({ content: "❌ حدد الاسم الجديد بعد المنشن.", embeds: [] }).catch(()=>null);

  let targetMember;
  try { targetMember = await message.guild.members.fetch(targetId); }
  catch { return message.reply("❌ لم يتم العثور على الشخص.").catch(()=>null); }

  const botHighest    = message.guild.members.me?.roles.highest.position ?? 0;
  const targetHighest = targetMember.roles.highest.position;
  if (botHighest <= targetHighest)
    return message.reply("❌ رتبة الشخص أعلى من رتبتي — لا أستطيع تعديل نكه.").catch(()=>null);

  try {
    const oldNick = targetMember.nickname ?? targetMember.user.username;
    await targetMember.setNickname(newNick, `بواسطة: ${message.author.tag}`);

    const successEmbed = new EmbedBuilder().setColor(0x2ecc71)
      .setTitle("✏️ تم تغيير النك نايم")
      .addFields(
        { name: "👤 الشخص",      value: `<@${targetId}>`, inline: true },
        { name: "📝 الاسم الجديد", value: newNick,          inline: true },
      );
    await message.reply({ embeds: [successEmbed] }).catch(()=>null);

    // ─── اللوق ───
    if (cfg.logChannelId) {
      const logCh = message.guild.channels.cache.get(cfg.logChannelId);
      if (logCh) {
        await logCh.send({ embeds: [new EmbedBuilder().setColor(0x3498db)
          .setTitle("📋 سجل تغيير النك نايم")
          .setThumbnail(targetMember.user.displayAvatarURL())
          .addFields(
            { name: "👤 الشخص",        value: `<@${targetId}> (${targetMember.user.tag})`, inline: false },
            { name: "📝 الاسم القديم",   value: oldNick,                                    inline: true  },
            { name: "✏️ الاسم الجديد",  value: newNick,                                    inline: true  },
            { name: "👮 بواسطة",        value: `<@${message.author.id}>`,                  inline: false },
          )
          .setTimestamp()] }).catch(()=>null);
      }
    }
  } catch {
    await message.reply("❌ فشل تغيير النك — تأكد من صلاحيات البوت.").catch(()=>null);
  }
}

// ══════════════════════════════════════════════════════
//  Come — استدعاء شخص عبر DM
// ══════════════════════════════════════════════════════
async function sendComeMessage({ target, callerTag, callerId, reason, channelId, guildName }) {
  try {
    const dm = await target.createDM();
    await dm.send({ embeds: [new EmbedBuilder().setColor(0xe67e22)
      .setTitle("📣 تم استدعاؤك!")
      .setDescription([
        `تم استدعاؤك من قِبَل **${callerTag}**`,
        "",
        `**📌 السبب:** ${reason}`,
        `**🏠 السيرفر:** ${guildName}`,
        channelId ? `**🔊 الروم:** <#${channelId}>` : "",
      ].filter(Boolean).join("\n"))
      .setTimestamp()] });
    return true;
  } catch { return false; }
}

async function handleComeMessage(message) {
  if (!message.guild) return;
  const content = message.content.trim();
  if (!content.toLowerCase().startsWith("+come")) return;

  const parts        = content.split(/\s+/);
  const mentionMatch = content.match(/<@!?(\d+)>/);
  if (!mentionMatch) return message.reply("❌ حدد الشخص: `+come @منشن السبب`").catch(()=>null);

  const targetId     = mentionMatch[1];
  const mentionIndex = parts.findIndex(p => /<@!?\d+>/.test(p));
  const reason       = parts.slice(mentionIndex + 1).join(" ").trim() || "لا يوجد سبب";

  let target;
  try { target = await message.client.users.fetch(targetId); }
  catch { return message.reply("❌ لم يتم العثور على الشخص.").catch(()=>null); }

  const sent = await sendComeMessage({
    target,
    callerTag:   message.author.tag,
    callerId:    message.author.id,
    reason,
    channelId:   message.channelId,
    guildName:   message.guild.name,
  });
  await message.reply(sent
    ? `✅ تم إرسال رسالة الاستدعاء لـ <@${targetId}>.`
    : "❌ لم أستطع إرسال رسالة خاصة — الشخص أغلق الـ DM."
  ).catch(()=>null);
}

// ══════════════════════════════════════════════════════
//  Band Shortcuts
// ══════════════════════════════════════════════════════
const BAN_REASONS  = ["سب اهل", "نصب", "تخريب سيرفر"];
const KICK_REASONS = ["سب", "تخريب سيرفر", "نصب"];
const WARN_REASONS = ["تشويه سمعة", "سب", "تكبير خط"];

async function handleBandShortcuts(message) {
  if (!message.guild) return;
  const cfg = getBandConfig(message.guildId);
  if (!cfg.shortcuts.length) return;
  if (cfg.allowedRoleId && !message.member?.roles.cache.has(cfg.allowedRoleId)) return;
  await handleShortcut(message, cfg, "ban", BAN_REASONS);
}

async function handleKickShortcuts(message) {
  if (!message.guild) return;
  const cfg = getKickConfig(message.guildId);
  if (!cfg.shortcuts.length) return;
  if (cfg.allowedRoleId && !message.member?.roles.cache.has(cfg.allowedRoleId)) return;
  await handleShortcut(message, cfg, "kick", KICK_REASONS);
}

async function handleWarnShortcuts(message) {
  if (!message.guild) return;
  const cfg = getWarnConfig(message.guildId);
  if (!cfg.shortcuts.length) return;
  await handleShortcut(message, cfg, "warn", WARN_REASONS);
}

async function handleShortcut(message, cfg, action, reasons) {
  const content = message.content.trim();
  const parts   = content.split(/\s+/);
  if (parts.length < 2) return;
  const firstWord = parts[0].toLowerCase();
  const shortcut  = cfg.shortcuts.find(s => s.word === firstWord);
  if (!shortcut) return;

  const mentionMatch = content.match(/<@!?(\d+)>/);
  if (!mentionMatch) return;
  const targetId     = mentionMatch[1];
  const mentionIndex = parts.findIndex(p => /<@!?\d+>/.test(p));
  const reason       = parts.slice(mentionIndex + 1).join(" ").trim();

  if (!reason) {
    const prefix  = action === "ban" ? "band_select" : action === "kick" ? "kick_select" : "warn_select";
    const menu    = new StringSelectMenuBuilder()
      .setCustomId(`${prefix}:${targetId}:${shortcut.word}:${message.author.id}`)
      .setPlaceholder(action === "warn" ? "اختر سبب التحذير" : action === "kick" ? "اختر سبب الطرد" : "اختر سبب الباند")
      .addOptions(reasons.map((r, i) => ({ label: r, value: String(i), emoji: ["⚠️","💸","🔨"][i] ?? "⚠️" })));
    await message.reply({
      embeds: [new EmbedBuilder().setColor(0xe67e22).setTitle(action === "warn" ? "⚠️ اختر سبب التحذير" : action === "kick" ? "⚠️ اختر سبب الطرد" : "⚠️ اختر سبب الباند")
        .setDescription(`اخترت ${action === "warn" ? "تحذير" : action === "kick" ? "طرد" : "باند"} <@${targetId}> — اختر السبب:`)],
      components: [new ActionRowBuilder().addComponents(menu)],
    }).catch(()=>null);
    return;
  }

  await executeAction({ guild: message.guild, targetId, executorId: message.author.id, executorTag: message.author.tag, reason, shortcutWord: shortcut.word, channelId: message.channelId, logChannelId: cfg.logChannelId, replyFn: opts => message.reply(opts), action });
}

async function handleActionSelect(interaction, action) {
  if (!interaction.guild) return;
  const parts             = interaction.customId.split(":");
  const targetId          = parts[1];
  const shortcutWord      = parts[2];
  const originalExecutorId = parts[3];
  if (interaction.user.id !== originalExecutorId)
    return interaction.reply({ content: "❌ فقط من أصدر الأمر يمكنه الاختيار.", ephemeral: true });

  const reasonsList = action === "ban" ? BAN_REASONS : action === "kick" ? KICK_REASONS : WARN_REASONS;
  const reason      = reasonsList[parseInt(interaction.values[0])] ?? reasonsList[0];
  const cfgKey      = action === "ban" ? getBandConfig : action === "kick" ? getKickConfig : getWarnConfig;
  const cfg         = cfgKey(interaction.guildId);
  await interaction.update({ components: [] });
  await executeAction({ guild: interaction.guild, targetId, executorId: interaction.user.id, executorTag: interaction.user.tag, reason, shortcutWord, channelId: interaction.channelId, logChannelId: cfg?.logChannelId, replyFn: opts => interaction.channel?.send(opts), action });
}

async function executeAction({ guild, targetId, executorId, executorTag, reason, shortcutWord, channelId, logChannelId, replyFn, action }) {
  let targetMember;
  try { targetMember = await guild.members.fetch(targetId); }
  catch { await replyFn({ content: "❌ لم يتم العثور على المستخدم." }); return; }

  if (action !== "warn") {
    // ─── صانع البوت محصّن تماماً ───
    if (targetId === OWNER_ID) {
      await replyFn({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle("🛡️ محصّن").setDescription("هذا الشخص محصّن من الباند والطرد.")] });
      return;
    }

    const botHighest      = guild.members.me?.roles.highest.position ?? 0;
    const targetHighest   = targetMember.roles.highest.position;
    const executorMember  = await guild.members.fetch(executorId).catch(() => null);
    const executorHighest = executorMember?.roles.highest.position ?? 0;

    // ─── البوت لا يقدر يباند شخص رتبته أعلى من رتبته ───
    if (botHighest <= targetHighest) {
      await replyFn({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle(`❌ لا أستطيع ${action === "ban" ? "باند" : "طرد"} هذا الشخص`).setDescription("رتبة الشخص أعلى من رتبتي.")] });
      return;
    }

    // ─── المنفذ لا يقدر يباند شخص رتبته أعلى أو مساوية لرتبته ───
    if (executorHighest <= targetHighest) {
      await replyFn({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle("❌ لا يمكنك ذلك").setDescription("لا تستطيع باند/طرد شخص رتبته أعلى من رتبتك أو مساوية لها.")] });
      return;
    }

    try {
      if (action === "ban")  await targetMember.ban({ reason: `${reason} | بواسطة: ${executorTag}` });
      if (action === "kick") await targetMember.kick(`${reason} | بواسطة: ${executorTag}`);
    } catch (err) {
      log("error", `${action} failed`, { err: err.message });
      await replyFn({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle(`❌ فشل ال${action === "ban" ? "باند" : "طرد"}`).setDescription("تأكد من صلاحيات البوت.")] });
      return;
    }
  }

  const actionEmoji = action === "ban" ? "🔨" : action === "kick" ? "👢" : "⚠️";
  const actionLabel = action === "ban" ? "الباند" : action === "kick" ? "الطرد" : "التحذير";

  if (action === "warn") {
    const warnings = getWarnings(guild.id);
    if (!warnings[targetId]) warnings[targetId] = [];
    warnings[targetId].push({ reason, by: executorId, time: Date.now() });
    saveData();
  }

  await replyFn({ embeds: [new EmbedBuilder().setColor(action === "warn" ? 0xe67e22 : 0xe74c3c)
    .setTitle(`${actionEmoji} تم تنفيذ ${actionLabel}`)
    .setDescription(`تم ${actionLabel} <@${targetId}> بنجاح.\n**السبب:** ${reason}`)] }).catch(()=>null);

  if (logChannelId) {
    const logCh = guild.channels.cache.get(logChannelId);
    if (logCh) {
      await logCh.send({ embeds: [new EmbedBuilder().setColor(action === "warn" ? 0xe67e22 : 0xe74c3c)
        .setTitle(`${actionEmoji} سجل ${actionLabel}`)
        .addFields(
          { name: "👤 المستهدف",  value: `<@${targetId}> (${targetMember.user.tag})`, inline: true },
          { name: "👮 المُنفِّذ", value: `<@${executorId}> (${executorTag})`,          inline: true },
          { name: "📝 السبب",     value: reason,                                        inline: false },
          { name: "⚡ الاختصار",  value: `\`${shortcutWord}\``,                         inline: true },
          { name: "📍 القناة",    value: `<#${channelId}>`,                             inline: true },
          { name: "📅 الوقت",     value: `<t:${Math.floor(Date.now()/1000)}:F>`,        inline: false },
        ).setThumbnail(targetMember.user.displayAvatarURL()).setTimestamp()] }).catch(()=>null);
    }
  }
}

// ══════════════════════════════════════════════════════
//  Level System
// ══════════════════════════════════════════════════════
async function handleLevelSystem(message) {
  const cfg = getLevelConfig(message.guildId);
  if (!cfg?.announcementChannelId) return;
  const userLevel = getUserLevel(message.guildId, message.author.id);
  userLevel.messageCount++;
  const newLevel  = calculateLevel(userLevel.messageCount, cfg.thresholds);
  if (newLevel > userLevel.level) {
    userLevel.level = newLevel;
    saveData();
    const ch = message.guild?.channels.cache.get(cfg.announcementChannelId);
    if (ch) await ch.send({ content: cfg.levelUpMessage.replace("{user}", `<@${message.author.id}>`).replace("{level}", String(newLevel)) }).catch(()=>null);
  } else { saveData(); }
}

// ══════════════════════════════════════════════════════
//  Guard — Message Protection
// ══════════════════════════════════════════════════════
const INVITE_REGEX = /(discord\.gg|discord\.com\/invite|discordapp\.com\/invite)\/\S+/i;

async function handleGuardMessage(message) {
  const cfg = getGuardConfig(message.guildId);
  if (!cfg?.enabled) return;
  const member = message.member;
  if (!member) return;
  const roleIds = member.roles.cache.map(r => r.id);
  // وايت ليست القنوات تشمل حماية المراسلة أيضاً
  if (cfg.channelWhitelist.includes(message.author.id)) return;
  if (roleIds.some(r => cfg.channelWhitelist.includes(r))) return;

  if (INVITE_REGEX.test(message.content)) {
    await message.delete().catch(()=>null);
    const m = await message.channel.send({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle("🚫 رابط دعوة محذوف").setDescription(`<@${message.author.id}> لا يُسمح بنشر روابط الدعوة.`)] }).catch(()=>null);
    if (m) setTimeout(() => m.delete().catch(()=>null), 5000);
    await sendLog(message.guild, cfg.logChannelId, new EmbedBuilder().setColor(0xe74c3c).setTitle("🚫 Guard — حذف رابط دعوة")
      .addFields({ name: "👤 المستخدم", value: `<@${message.author.id}> (${message.author.tag})`, inline: true }, { name: "📅 الوقت", value: `<t:${Math.floor(Date.now()/1000)}:F>` }).setTimestamp());
    return;
  }

  const mentions = message.mentions.users.size + message.mentions.roles.size;
  if (mentions >= 5) {
    await message.delete().catch(()=>null);
    try { await member.timeout(10 * 60 * 1000, "Mass mention — Guard"); } catch {}
    await sendLog(message.guild, cfg.logChannelId, new EmbedBuilder().setColor(0xe67e22).setTitle("⚠️ Guard — Mass Mention")
      .addFields({ name: "👤 المستخدم", value: `<@${message.author.id}> (${message.author.tag})`, inline: true }, { name: "📢 تاقات", value: String(mentions), inline: true }).setTimestamp());
  }
}

// ══════════════════════════════════════════════════════
//  Guard — Nuke Tracker
// ══════════════════════════════════════════════════════
async function handleGuardNuke(g, executorId, eventType, targetName) {
  const cfg = getGuardConfig(g.id);
  if (!cfg?.enabled) return;
  if (executorId === g.members.me?.id || executorId === g.ownerId) return;

  const member = await g.members.fetch(executorId).catch(()=>null);
  if (!member) return;

  // فحص الوايت ليست المناسب
  const roleIds   = member.roles.cache.map(r => r.id);
  const isChannel = eventType === "channelDelete" || eventType === "channelCreate";
  const whitelist = isChannel ? cfg.channelWhitelist : cfg.roleWhitelist;
  if (whitelist.includes(executorId) || roleIds.some(r => whitelist.includes(r))) return;

  const thresholdKey = eventType === "channelDelete" ? "channelDelete" : eventType === "channelCreate" ? "channelCreate" : eventType === "roleDelete" ? "roleDelete" : "roleCreate";
  const threshold    = cfg.thresholds[thresholdKey] ?? 3;

  const key  = `${g.id}:${executorId}:${thresholdKey}`;
  const now  = Date.now();
  const times = (nukeTracker.get(key) ?? []).filter(t => now - t < 10_000);
  times.push(now);
  nukeTracker.set(key, times);

  if (times.length < threshold) return;
  nukeTracker.delete(key);

  try { await member.ban({ reason: "Guard Anti-Nuke: نشاط مشبوه" }); } catch {}

  await sendLog(g, cfg.logChannelId, new EmbedBuilder().setColor(0xe74c3c).setTitle("🚨 Guard Anti-Nuke — تم باند مستخدم")
    .setDescription(`تم باند **${member.user.tag}** بسبب ${times.length} أحداث في 10 ثواني.`)
    .addFields(
      { name: "👤 المستخدم", value: `<@${executorId}> (${member.user.tag})`, inline: true },
      { name: "🔖 النوع",    value: eventType,  inline: true },
      { name: "🎯 الهدف",   value: targetName,  inline: true },
      { name: "📅 الوقت",   value: `<t:${Math.floor(now/1000)}:F>` },
    ).setTimestamp());
}

// ══════════════════════════════════════════════════════
//  Guard — Anti-Bot
// ══════════════════════════════════════════════════════
client.on("guildMemberAdd", async (member) => {
  if (!member.user.bot) return;
  if (member.id === member.guild.members.me?.id) return;
  const cfg = getGuardConfig(member.guild.id);
  if (!cfg?.enabled) return;
  if (member.id === member.guild.ownerId) return;
  if (cfg.botWhitelist.includes(member.id)) return;

  try { await member.kick("Anti-Bot: بوت غير مصرح"); } catch (err) { log("error", "Anti-bot kick failed", { err: err.message }); return; }

  await sendLog(member.guild, cfg.logChannelId, new EmbedBuilder().setColor(0xe74c3c).setTitle("🤖 Anti-Bot — تم طرد بوت")
    .setDescription(`تم طرد **${member.user.tag}** لأنه غير موجود في الوايت ليست.`)
    .addFields(
      { name: "🤖 البوت", value: `<@${member.id}> (${member.user.tag})`, inline: true },
      { name: "🆔 ID",    value: member.id,                               inline: true },
      { name: "📅 الوقت", value: `<t:${Math.floor(Date.now()/1000)}:F>` },
    ).setThumbnail(member.user.displayAvatarURL()).setTimestamp());
});

// ══════════════════════════════════════════════════════
//  Guard — Audit Events
// ══════════════════════════════════════════════════════
const delay = ms => new Promise(r => setTimeout(r, ms));

async function fetchAuditExecutor(g, type) {
  await delay(1200);
  const logs  = await g.fetchAuditLogs({ type, limit: 1 });
  const entry = logs.entries.first();
  if (!entry) return null;
  if (Date.now() - entry.createdTimestamp > 8000) return null;
  if (!entry.executor) return null;
  return entry.executor.id;
}

client.on("channelDelete", async (channel) => {
  if (!("guild" in channel) || !channel.guild) return;
  const cfg = getGuardConfig(channel.guild.id);
  if (!cfg?.enabled) return;
  try {
    const executorId = await fetchAuditExecutor(channel.guild, 12);
    if (executorId) await handleGuardNuke(channel.guild, executorId, "channelDelete", channel.name);
  } catch (err) { log("error", "Guard channelDelete audit failed", { err: err.message }); }
});

client.on("channelCreate", async (channel) => {
  if (!("guild" in channel) || !channel.guild) return;
  const cfg = getGuardConfig(channel.guild.id);
  if (!cfg?.enabled) return;
  try {
    const executorId = await fetchAuditExecutor(channel.guild, 10);
    if (executorId) await handleGuardNuke(channel.guild, executorId, "channelCreate", channel.name);
  } catch (err) { log("error", "Guard channelCreate audit failed", { err: err.message }); }
});

client.on("roleDelete", async (role) => {
  if (!role.guild) return;
  const cfg = getGuardConfig(role.guild.id);
  if (!cfg?.enabled) return;
  try {
    const executorId = await fetchAuditExecutor(role.guild, 32);
    if (executorId) await handleGuardNuke(role.guild, executorId, "roleDelete", role.name);
  } catch (err) { log("error", "Guard roleDelete audit failed", { err: err.message }); }
});

client.on("roleCreate", async (role) => {
  if (!role.guild) return;
  const cfg = getGuardConfig(role.guild.id);
  if (!cfg?.enabled) return;
  try {
    const executorId = await fetchAuditExecutor(role.guild, 30);
    if (executorId) await handleGuardNuke(role.guild, executorId, "roleCreate", role.name);
  } catch (err) { log("error", "Guard roleCreate audit failed", { err: err.message }); }
});

// ══════════════════════════════════════════════════════
//  Ticket Handlers
// ══════════════════════════════════════════════════════
async function handleOpenTicket(interaction) {
  const guildId = interaction.guildId;
  const g       = interaction.guild;
  if (!guildId || !g) return;
  const cfg = getTicketConfig(guildId);
  if (!cfg) return interaction.reply({ content: "❌ لم يتم إعداد التذاكر. استخدم `/ticket-setup`.", ephemeral: true });

  const existing = [...openTickets.entries()].find(([, t]) => t.guildId === guildId && t.userId === interaction.user.id);
  if (existing) return interaction.reply({ content: `❌ عندك تذكرة مفتوحة: <#${existing[0]}>`, ephemeral: true });

  await interaction.deferReply({ ephemeral: true });

  const permissionOverwrites = [
    { id: g.roles.everyone,        deny:  [PermissionsBitField.Flags.ViewChannel] },
    { id: interaction.user.id,     allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
    { id: g.members.me.id,         allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageChannels] },
  ];
  if (cfg.staffRoleId) permissionOverwrites.push({ id: cfg.staffRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] });

  let ch;
  try {
    ch = await g.channels.create({ name: `ticket-${interaction.user.username.replace(/[^a-z0-9]/gi,"").toLowerCase().slice(0,20) || "user"}`, type: ChannelType.GuildText, parent: cfg.categoryId ?? null, permissionOverwrites });
  } catch (err) { log("error", "Ticket create failed", { err: err.message }); return interaction.editReply({ content: "❌ فشل إنشاء قناة التذكرة." }); }

  openTickets.set(ch.id, { userId: interaction.user.id, guildId, claimedBy: null, createdAt: Date.now() });

  await ch.send({
    content: cfg.staffRoleId ? `<@&${cfg.staffRoleId}>` : undefined,
    embeds: [new EmbedBuilder().setColor(cfg.color).setTitle("🎫 تذكرة جديدة")
      .setDescription(cfg.openMessage.replace("{user}", `<@${interaction.user.id}>`))
      .addFields({ name: "👤 صاحب التذكرة", value: `<@${interaction.user.id}>`, inline: true }).setTimestamp()],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("close_ticket").setLabel("🔒 إغلاق").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("claim_ticket").setLabel("✋ استلام").setStyle(ButtonStyle.Secondary),
    )],
  });

  await interaction.editReply({ content: `✅ تم فتح تذكرتك: ${ch}` });
  await sendLog(g, cfg.logChannelId, new EmbedBuilder().setColor(0x2ecc71).setTitle("📋 تذكرة مفتوحة")
    .addFields({ name: "👤 المستخدم", value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true }, { name: "📌 القناة", value: `<#${ch.id}>`, inline: true }).setTimestamp());
}

async function handleCloseTicket(interaction) {
  const ticket = openTickets.get(interaction.channelId);
  if (!ticket) return interaction.reply({ content: "❌ هذه القناة ليست تذكرة.", ephemeral: true });
  const cfg     = getTicketConfig(interaction.guildId);
  const isStaff = cfg?.staffRoleId && interaction.member?.roles.cache.has(cfg.staffRoleId);
  if (!isStaff && ticket.userId !== interaction.user.id && !interaction.member?.permissions.has(PermissionsBitField.Flags.ManageChannels))
    return interaction.reply({ content: "❌ ليس لديك صلاحية الإغلاق.", ephemeral: true });
  await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xe67e22).setTitle("⚠️ تأكيد إغلاق التذكرة").setDescription("هل أنت متأكد؟")],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("confirm_close_ticket").setLabel("✅ تأكيد").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("cancel_close_ticket").setLabel("❌ إلغاء").setStyle(ButtonStyle.Secondary),
    )] });
}

async function handleConfirmClose(interaction) {
  const ticket = openTickets.get(interaction.channelId);
  if (!ticket) return interaction.reply({ content: "❌ هذه القناة ليست تذكرة.", ephemeral: true });
  await interaction.update({ components: [] });
  const cfg = getTicketConfig(interaction.guildId);
  await sendLog(interaction.guild, cfg?.logChannelId, new EmbedBuilder().setColor(0xe74c3c).setTitle("🔒 تذكرة مغلقة")
    .addFields({ name: "👤 صاحب التذكرة", value: `<@${ticket.userId}>`, inline: true }, { name: "👮 أغلقها", value: `<@${interaction.user.id}>`, inline: true }, { name: "⏱️ المدة", value: `${Math.floor((Date.now()-ticket.createdAt)/60000)} دقيقة`, inline: true }).setTimestamp());
  openTickets.delete(interaction.channelId);
  await interaction.channel?.send({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle("🔒 التذكرة مغلقة").setDescription("سيتم حذف هذه القناة خلال 5 ثواني.")] }).catch(()=>null);
  setTimeout(() => interaction.channel?.delete().catch(()=>null), 5000);
}

async function handleCancelClose(interaction) {
  await interaction.update({ embeds: [new EmbedBuilder().setColor(0x2ecc71).setTitle("✅ تم الإلغاء")], components: [] });
}

async function handleClaimTicket(interaction) {
  const ticket = openTickets.get(interaction.channelId);
  if (!ticket) return interaction.reply({ content: "❌ هذه القناة ليست تذكرة.", ephemeral: true });
  const cfg = getTicketConfig(interaction.guildId);
  if (cfg?.staffRoleId && !interaction.member?.roles.cache.has(cfg.staffRoleId) && !interaction.member?.permissions.has(PermissionsBitField.Flags.ManageChannels))
    return interaction.reply({ content: "❌ فقط الستاف يقدر يستلم.", ephemeral: true });
  if (ticket.claimedBy) return interaction.reply({ content: `❌ مستلمة من <@${ticket.claimedBy}>.`, ephemeral: true });
  ticket.claimedBy = interaction.user.id;
  await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x3498db).setTitle("✋ تم الاستلام").setDescription(`<@${interaction.user.id}> استلم هذه التذكرة.`)] });
}

// ══════════════════════════════════════════════════════
//  LOG 1 — لوق الرتب ← جديد
// ══════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════
//  LOG — لوق تغيير أشكال الرتب (اسم / لون / أيقونة)
// ══════════════════════════════════════════════════════
client.on("roleUpdate", async (oldRole, newRole) => {
  if (!newRole.guild) return;
  const cfg = getLogConfig(newRole.guild.id);
  if (!cfg.rolesLogChannelId) return;

  const changes = [];
  if (oldRole.name  !== newRole.name)  changes.push({ name: "📛 الاسم",    value: `\`${oldRole.name}\` ← \`${newRole.name}\`` });
  if (oldRole.color !== newRole.color) changes.push({ name: "🎨 اللون",    value: `\`#${oldRole.color.toString(16).padStart(6,"0")}\` ← \`#${newRole.color.toString(16).padStart(6,"0")}\`` });
  if (oldRole.icon  !== newRole.icon)  changes.push({ name: "🖼️ الأيقونة", value: newRole.icon ? `تم التغيير` : "تم الحذف" });
  if (!changes.length) return;

  try {
    await delay(1000);
    const logs  = await newRole.guild.fetchAuditLogs({ type: 31, limit: 1 });
    const entry = logs.entries.first();
    const executor = (entry && Date.now() - entry.createdTimestamp < 8000) ? entry.executor : null;
    const embed = new EmbedBuilder()
      .setColor(0xf39c12).setTitle("✏️ رتبة عُدّلت")
      .addFields(
        { name: "🏷️ الرتبة",  value: `<@&${newRole.id}> (${newRole.name})`,               inline: true },
        { name: "👤 بواسطة",  value: executor ? `<@${executor.id}>` : "غير معروف",          inline: true },
        ...changes,
        { name: "📅 الوقت",   value: `<t:${Math.floor(Date.now()/1000)}:F>`,               inline: false },
      ).setTimestamp();
    if (newRole.iconURL()) embed.setThumbnail(newRole.iconURL());
    await sendLog(newRole.guild, cfg.rolesLogChannelId, embed);
  } catch (err) { log("error", "roleUpdate log failed", { err: err.message }); }
});

client.on("roleCreate", async (role) => {
  if (!role.guild) return;
  const cfg = getLogConfig(role.guild.id);
  if (!cfg.rolesLogChannelId) return;
  try {
    await delay(1000);
    const logs  = await role.guild.fetchAuditLogs({ type: 30, limit: 1 });
    const entry = logs.entries.first();
    const executor = (entry && Date.now() - entry.createdTimestamp < 8000) ? entry.executor : null;
    await sendLog(role.guild, cfg.rolesLogChannelId, new EmbedBuilder()
      .setColor(0x2ecc71).setTitle("🏷️ رتبة جديدة أُنشئت")
      .addFields(
        { name: "📛 اسم الرتبة", value: role.name,                                          inline: true },
        { name: "👤 بواسطة",     value: executor ? `<@${executor.id}>` : "غير معروف",       inline: true },
        { name: "📅 الوقت",      value: `<t:${Math.floor(Date.now()/1000)}:F>`,              inline: false },
      ).setTimestamp());
  } catch (err) { log("error", "roleCreate log failed", { err: err.message }); }
});

client.on("roleDelete", async (role) => {
  if (!role.guild) return;
  const cfg = getLogConfig(role.guild.id);
  if (!cfg.rolesLogChannelId) return;
  try {
    await delay(1000);
    const logs  = await role.guild.fetchAuditLogs({ type: 32, limit: 1 });
    const entry = logs.entries.first();
    const executor = (entry && Date.now() - entry.createdTimestamp < 8000) ? entry.executor : null;
    await sendLog(role.guild, cfg.rolesLogChannelId, new EmbedBuilder()
      .setColor(0xe74c3c).setTitle("🗑️ رتبة حُذفت")
      .addFields(
        { name: "📛 اسم الرتبة", value: role.name,                                          inline: true },
        { name: "👤 بواسطة",     value: executor ? `<@${executor.id}>` : "غير معروف",       inline: true },
        { name: "📅 الوقت",      value: `<t:${Math.floor(Date.now()/1000)}:F>`,              inline: false },
      ).setTimestamp());
  } catch (err) { log("error", "roleDelete log failed", { err: err.message }); }
});

client.on("guildMemberUpdate", async (oldMember, newMember) => {
  if (!newMember.guild) return;
  const logCfg = getLogConfig(newMember.guild.id);

  // ─── إعطاء / سحب رتبة ───
  if (logCfg.rolesLogChannelId) {
    const added   = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
    const removed = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));
    if (added.size > 0 || removed.size > 0) {
      try {
        await delay(1000);
        const logs  = await newMember.guild.fetchAuditLogs({ type: 25, limit: 1 });
        const entry = logs.entries.first();
        const executor = (entry && Date.now() - entry.createdTimestamp < 8000) ? entry.executor : null;
        for (const role of added.values()) {
          await sendLog(newMember.guild, logCfg.rolesLogChannelId, new EmbedBuilder()
            .setColor(0x3498db).setTitle("🎭 رتبة أُضيفت لعضو")
            .addFields(
              { name: "👤 العضو",   value: `<@${newMember.id}>`,                              inline: true },
              { name: "👮 بواسطة", value: executor ? `<@${executor.id}>` : "غير معروف",       inline: true },
              { name: "🏷️ الرتبة", value: `<@&${role.id}> (${role.name})`,                   inline: false },
              { name: "📅 الوقت",  value: `<t:${Math.floor(Date.now()/1000)}:F>`,             inline: false },
            ).setThumbnail(newMember.user.displayAvatarURL()).setTimestamp());
        }
        for (const role of removed.values()) {
          await sendLog(newMember.guild, logCfg.rolesLogChannelId, new EmbedBuilder()
            .setColor(0xe67e22).setTitle("🎭 رتبة سُحبت من عضو")
            .addFields(
              { name: "👤 العضو",   value: `<@${newMember.id}>`,                              inline: true },
              { name: "👮 بواسطة", value: executor ? `<@${executor.id}>` : "غير معروف",       inline: true },
              { name: "🏷️ الرتبة", value: `<@&${role.id}> (${role.name})`,                   inline: false },
              { name: "📅 الوقت",  value: `<t:${Math.floor(Date.now()/1000)}:F>`,             inline: false },
            ).setThumbnail(newMember.user.displayAvatarURL()).setTimestamp());
        }
      } catch (err) { log("error", "role assign log failed", { err: err.message }); }
    }
  }

  // ─── لوق الميوت / تايم اوت ───
  if (logCfg.mutesLogChannelId) {
    const wasTimeout = oldMember.communicationDisabledUntil;
    const isTimeout  = newMember.communicationDisabledUntil;
    if (!wasTimeout && isTimeout) {
      try {
        await delay(1000);
        const logs  = await newMember.guild.fetchAuditLogs({ type: 24, limit: 1 });
        const entry = logs.entries.first();
        const executor   = (entry && Date.now() - entry.createdTimestamp < 8000) ? entry.executor : null;
        const untilTs    = Math.floor(new Date(isTimeout).getTime() / 1000);
        const durationSec = Math.round((new Date(isTimeout).getTime() - Date.now()) / 1000);
        const durationStr = durationSec < 60 ? `${durationSec} ثانية`
          : durationSec < 3600 ? `${Math.round(durationSec/60)} دقيقة`
          : durationSec < 86400 ? `${Math.round(durationSec/3600)} ساعة`
          : `${Math.round(durationSec/86400)} يوم`;
        await sendLog(newMember.guild, logCfg.mutesLogChannelId, new EmbedBuilder()
          .setColor(0xe67e22).setTitle("🔇 تايم اوت")
          .addFields(
            { name: "👤 العضو",   value: `<@${newMember.id}>`,                               inline: true },
            { name: "👮 بواسطة", value: executor ? `<@${executor.id}>` : "غير معروف",        inline: true },
            { name: "⏱️ المدة",   value: durationStr,                                         inline: true },
            { name: "🔚 ينتهي",   value: `<t:${untilTs}:F>`,                                  inline: false },
            { name: "📅 الوقت",   value: `<t:${Math.floor(Date.now()/1000)}:F>`,              inline: false },
          ).setThumbnail(newMember.user.displayAvatarURL()).setTimestamp());
      } catch (err) { log("error", "timeout log failed", { err: err.message }); }
    }
  }
});

// ══════════════════════════════════════════════════════
//  LOG 2 — لوق الرسائل ← جديد
// ══════════════════════════════════════════════════════
client.on("messageDelete", async (message) => {
  if (!message.guild || message.author?.bot) return;
  const cfg = getLogConfig(message.guild.id);
  if (!cfg.messagesLogChannelId) return;
  const content = message.content || "*[رسالة بدون نص / مرفق]*";
  await sendLog(message.guild, cfg.messagesLogChannelId, new EmbedBuilder()
    .setColor(0xe74c3c).setTitle("🗑️ رسالة حُذفت")
    .addFields(
      { name: "👤 صاحب الرسالة", value: message.author ? `<@${message.author.id}>` : "غير معروف", inline: true },
      { name: "📍 القناة",        value: `<#${message.channelId}>`,                                 inline: true },
      { name: "📝 المحتوى",       value: content.slice(0, 1000),                                    inline: false },
      { name: "📅 الوقت",         value: `<t:${Math.floor(Date.now()/1000)}:F>`,                    inline: false },
    ).setTimestamp());
});

client.on("messageUpdate", async (oldMessage, newMessage) => {
  if (!newMessage.guild || newMessage.author?.bot) return;
  if (oldMessage.content === newMessage.content) return;
  const cfg = getLogConfig(newMessage.guild.id);
  if (!cfg.messagesLogChannelId) return;
  await sendLog(newMessage.guild, cfg.messagesLogChannelId, new EmbedBuilder()
    .setColor(0x3498db).setTitle("✏️ رسالة عُدّلت")
    .addFields(
      { name: "👤 صاحب الرسالة", value: `<@${newMessage.author.id}>`,                              inline: true },
      { name: "📍 القناة",        value: `<#${newMessage.channelId}>`,                               inline: true },
      { name: "📝 قبل",           value: (oldMessage.content || "*[فارغ]*").slice(0, 500),           inline: false },
      { name: "✅ بعد",           value: (newMessage.content || "*[فارغ]*").slice(0, 500),           inline: false },
      { name: "📅 الوقت",         value: `<t:${Math.floor(Date.now()/1000)}:F>`,                     inline: false },
    ).setTimestamp());
});

// ══════════════════════════════════════════════════════
//  LOG 3 — لوق الباند ← جديد
// ══════════════════════════════════════════════════════
client.on("guildBanAdd", async (ban) => {
  const cfg = getLogConfig(ban.guild.id);
  if (!cfg.bansLogChannelId) return;
  try {
    await delay(1000);
    const logs  = await ban.guild.fetchAuditLogs({ type: 22, limit: 1 });
    const entry = logs.entries.first();
    const executor = (entry && Date.now() - entry.createdTimestamp < 8000) ? entry.executor : null;
    const reason   = ban.reason || entry?.reason || "بدون سبب";
    await sendLog(ban.guild, cfg.bansLogChannelId, new EmbedBuilder()
      .setColor(0xe74c3c).setTitle("🔨 باند")
      .addFields(
        { name: "👤 المبان",  value: `<@${ban.user.id}> (${ban.user.tag})`,                  inline: true },
        { name: "👮 بواسطة", value: executor ? `<@${executor.id}>` : "غير معروف",             inline: true },
        { name: "📝 السبب",   value: reason,                                                   inline: false },
        { name: "📅 الوقت",   value: `<t:${Math.floor(Date.now()/1000)}:F>`,                  inline: false },
      ).setThumbnail(ban.user.displayAvatarURL()).setTimestamp());
  } catch (err) { log("error", "banAdd log failed", { err: err.message }); }
});

// ══════════════════════════════════════════════════════
//  LOG 5 — لوق الرومات ← جديد
// ══════════════════════════════════════════════════════
client.on("channelCreate", async (channel) => {
  if (!("guild" in channel) || !channel.guild) return;
  const cfg = getLogConfig(channel.guild.id);
  if (!cfg.channelsLogChannelId) return;
  try {
    await delay(1000);
    const logs  = await channel.guild.fetchAuditLogs({ type: 10, limit: 1 });
    const entry = logs.entries.first();
    const executor = (entry && Date.now() - entry.createdTimestamp < 8000) ? entry.executor : null;
    await sendLog(channel.guild, cfg.channelsLogChannelId, new EmbedBuilder()
      .setColor(0x2ecc71).setTitle("➕ قناة جديدة أُنشئت")
      .addFields(
        { name: "📌 اسم القناة", value: channel.name,                                        inline: true },
        { name: "👤 بواسطة",     value: executor ? `<@${executor.id}>` : "غير معروف",        inline: true },
        { name: "📅 الوقت",      value: `<t:${Math.floor(Date.now()/1000)}:F>`,               inline: false },
      ).setTimestamp());
  } catch (err) { log("error", "channelCreate log failed", { err: err.message }); }
});

client.on("channelDelete", async (channel) => {
  if (!("guild" in channel) || !channel.guild) return;
  const cfg = getLogConfig(channel.guild.id);
  if (!cfg.channelsLogChannelId) return;
  try {
    await delay(1000);
    const logs  = await channel.guild.fetchAuditLogs({ type: 12, limit: 1 });
    const entry = logs.entries.first();
    const executor = (entry && Date.now() - entry.createdTimestamp < 8000) ? entry.executor : null;
    await sendLog(channel.guild, cfg.channelsLogChannelId, new EmbedBuilder()
      .setColor(0xe74c3c).setTitle("🗑️ قناة حُذفت")
      .addFields(
        { name: "📌 اسم القناة", value: channel.name,                                        inline: true },
        { name: "👤 بواسطة",     value: executor ? `<@${executor.id}>` : "غير معروف",        inline: true },
        { name: "📅 الوقت",      value: `<t:${Math.floor(Date.now()/1000)}:F>`,               inline: false },
      ).setTimestamp());
  } catch (err) { log("error", "channelDelete log failed", { err: err.message }); }
});

// ══════════════════════════════════════════════════════
//  LOG 6 — لوق الرياكشن ← جديد
// ══════════════════════════════════════════════════════
client.on("messageReactionAdd", async (reaction, user) => {
  if (user.bot) return;
  if (!reaction.message.guild) return;
  const cfg = getLogConfig(reaction.message.guild.id);
  if (!cfg.reactionsLogChannelId) return;
  try {
    if (reaction.partial) await reaction.fetch().catch(()=>null);
    if (reaction.message.partial) await reaction.message.fetch().catch(()=>null);
    const emoji      = reaction.emoji.id ? `<:${reaction.emoji.name}:${reaction.emoji.id}>` : reaction.emoji.name;
    const msgContent = (reaction.message.content || "*[بدون نص]*").slice(0, 200);
    await sendLog(reaction.message.guild, cfg.reactionsLogChannelId, new EmbedBuilder()
      .setColor(0xf1c40f).setTitle("😀 رياكشن جديد")
      .addFields(
        { name: "👤 المستخدم", value: `<@${user.id}>`,                                        inline: true },
        { name: "😀 الرياكشن", value: emoji,                                                   inline: true },
        { name: "📍 القناة",   value: `<#${reaction.message.channelId}>`,                      inline: true },
        { name: "💬 الرسالة",  value: msgContent,                                              inline: false },
        { name: "📅 الوقت",    value: `<t:${Math.floor(Date.now()/1000)}:F>`,                  inline: false },
      ).setTimestamp());
  } catch (err) { log("error", "reaction log failed", { err: err.message }); }
});

// ══════════════════════════════════════════════════════
//  LOG 8 — لوق الدخول + Auto Role
// ══════════════════════════════════════════════════════
client.on("guildMemberAdd", async (member) => {
  if (member.user.bot) return;

  // ─── Auto Role ───────────────────────────────────────
  const autoRoleCfg = getAutoRoleConfig(member.guild.id);
  if (autoRoleCfg.roleId) {
    try {
      await member.roles.add(autoRoleCfg.roleId);
      if (autoRoleCfg.logChannelId) {
        const role = member.guild.roles.cache.get(autoRoleCfg.roleId);
        await sendLog(member.guild, autoRoleCfg.logChannelId, new EmbedBuilder()
          .setColor(0x3498db).setTitle("🤖 رول تلقائي أُعطي")
          .addFields(
            { name: "👤 العضو",  value: `<@${member.id}> (${member.user.tag})`, inline: true },
            { name: "🎭 الرول",  value: role ? `<@&${role.id}>` : autoRoleCfg.roleId,          inline: true },
            { name: "📅 الوقت", value: `<t:${Math.floor(Date.now()/1000)}:F>`,                  inline: false },
          ).setThumbnail(member.user.displayAvatarURL()).setTimestamp());
      }
    } catch (err) { log("error", "Auto role assign failed", { err: err.message }); }
  }

  // ─── لوق الدخول ──────────────────────────────────────
  const logCfg = getLogConfig(member.guild.id);
  if (!logCfg.joinsLogChannelId) return;
  await sendLog(member.guild, logCfg.joinsLogChannelId, new EmbedBuilder()
    .setColor(0x2ecc71).setTitle("✅ عضو دخل السيرفر")
    .addFields(
      { name: "👤 العضو",  value: `<@${member.id}> (${member.user.tag})`, inline: true },
      { name: "📅 الوقت", value: `<t:${Math.floor(Date.now()/1000)}:F>`,  inline: false },
    ).setThumbnail(member.user.displayAvatarURL()).setTimestamp());
});

// ══════════════════════════════════════════════════════
//  LOG 7 + 9 — لوق الطرد + لوق الخروج ← جديد
// ══════════════════════════════════════════════════════
client.on("guildMemberRemove", async (member) => {
  if (member.user.bot) return;
  const cfg = getLogConfig(member.guild.id);
  try {
    await delay(1000);
    const logs  = await member.guild.fetchAuditLogs({ type: 20, limit: 1 });
    const entry = logs.entries.first();
    const isKick = entry && entry.target?.id === member.id && Date.now() - entry.createdTimestamp < 8000;

    if (isKick && cfg.kicksLogChannelId) {
      const reason = entry.reason || "بدون سبب";
      await sendLog(member.guild, cfg.kicksLogChannelId, new EmbedBuilder()
        .setColor(0xe74c3c).setTitle("👢 طرد")
        .addFields(
          { name: "👤 المطرود",  value: `<@${member.id}> (${member.user.tag})`,               inline: true },
          { name: "👮 الطارد",   value: entry.executor ? `<@${entry.executor.id}>` : "غير معروف", inline: true },
          { name: "📝 السبب",    value: reason,                                                 inline: false },
          { name: "📅 الوقت",    value: `<t:${Math.floor(Date.now()/1000)}:F>`,                inline: false },
        ).setThumbnail(member.user.displayAvatarURL()).setTimestamp());
      return;
    }
  } catch (err) { log("error", "kick log failed", { err: err.message }); }

  if (cfg.leavesLogChannelId) {
    await sendLog(member.guild, cfg.leavesLogChannelId, new EmbedBuilder()
      .setColor(0x95a5a6).setTitle("🚪 عضو غادر السيرفر")
      .addFields(
        { name: "👤 العضو",  value: `<@${member.id}> (${member.user.tag})`,                   inline: true },
        { name: "📅 الوقت", value: `<t:${Math.floor(Date.now()/1000)}:F>`,                     inline: false },
      ).setThumbnail(member.user.displayAvatarURL()).setTimestamp());
  }
});

// ══════════════════════════════════════════════════════
//  LOG 10 — لوق الإنفايت ← جديد
// ══════════════════════════════════════════════════════
client.on("inviteCreate", async (invite) => {
  if (!invite.guild) return;
  const cfg = getLogConfig(invite.guild.id);
  if (!cfg.invitesLogChannelId) return;
  await sendLog(invite.guild, cfg.invitesLogChannelId, new EmbedBuilder()
    .setColor(0x9b59b6).setTitle("📨 إنفايت جديد أُنشئ")
    .addFields(
      { name: "👤 المُنشئ",     value: invite.inviter ? `<@${invite.inviter.id}>` : "غير معروف",  inline: true },
      { name: "🔗 الرابط",       value: `https://discord.gg/${invite.code}`,                        inline: true },
      { name: "📍 القناة",       value: invite.channel ? `<#${invite.channel.id}>` : "غير معروف",  inline: true },
      { name: "⏱️ المدة",        value: invite.maxAge ? `${invite.maxAge / 3600} ساعة` : "دائم",   inline: true },
      { name: "👥 الاستخدامات",  value: invite.maxUses ? `${invite.maxUses} مرة` : "بلا حد",       inline: true },
      { name: "📅 الوقت",        value: `<t:${Math.floor(Date.now()/1000)}:F>`,                     inline: false },
    ).setTimestamp());
});

// ══════════════════════════════════════════════════════
//  Emoji Stealer Handler ← جديد
// ══════════════════════════════════════════════════════
async function handleEmojiStealer(message) {
  if (!message.guild || !message.guildId) return;
  const cfg = getStealerConfig(message.guildId);
  if (!cfg.emojiChannelId || message.channelId !== cfg.emojiChannelId) return;

  const emojiMatches = [...message.content.matchAll(/<(a?):(\w+):(\d+)>/g)];
  if (!emojiMatches.length) return;

  for (const match of emojiMatches) {
    const animated = match[1] === "a";
    const emojiId  = match[3];
    // تجاهل الإيموجي اللي موجود فعلاً في السيرفر
    if (message.guild.emojis.cache.has(emojiId)) continue;
    const url  = `https://cdn.discordapp.com/emojis/${emojiId}.${animated ? "gif" : "png"}?size=128`;
    cfg.emojiCounter++;
    const name = `by_tux_${cfg.emojiCounter}`;
    try {
      const added = await message.guild.emojis.create({ attachment: url, name });
      saveData();
      await message.reply({ embeds: [new EmbedBuilder()
        .setColor(0x2ecc71)
        .setDescription(`تم إضافة هذا الإيموجي باسم \`${added.name}\` <:${added.name}:${added.id}>`)
        .setTimestamp()] }).catch(()=>null);
    } catch (err) {
      cfg.emojiCounter--;
      log("error", "emoji steal failed", { err: err.message });
    }
  }
}

// ══════════════════════════════════════════════════════
//  Sticker Stealer Handler ← جديد
// ══════════════════════════════════════════════════════

// تحميل الملف كـ Buffer من URL
function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "DiscordBot" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadBuffer(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end",  () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

async function handleStickerStealer(message) {
  if (!message.guild || !message.guildId) return;
  const cfg = getStealerConfig(message.guildId);
  if (!cfg.stickerChannelId || message.channelId !== cfg.stickerChannelId) return;
  if (!message.stickers.size) return;

  for (const partialSticker of message.stickers.values()) {
    // جيب بيانات الستيكر الكاملة
    let sticker;
    try { sticker = await partialSticker.fetch(); }
    catch { sticker = partialSticker; }

    // Lottie (format=3) = JSON متحرك — مستحيل رفعه لسيرفر ثاني
    if (sticker.format === 3) {
      await message.reply({ embeds: [new EmbedBuilder().setColor(0xe74c3c)
        .setDescription("❌ ستيكرات Lottie المتحركة لا يمكن نقلها لسيرفر آخر.")] }).catch(()=>null);
      continue;
    }

    // حدد الامتداد الصحيح
    const ext = (sticker.format === 2 || sticker.format === 4) ? "gif" : "png";
    const url = `https://media.discordapp.net/stickers/${sticker.id}.${ext}`;

    cfg.stickerCounter++;
    const name = `by_tux_${cfg.stickerCounter}`;
    try {
      const buffer = await downloadBuffer(url);
      await message.guild.stickers.create({
        file: buffer,
        name,
        description: "by tux",
        tags: "✨",
      });
      saveData();
      await message.reply({ embeds: [new EmbedBuilder()
        .setColor(0x2ecc71)
        .setDescription(`تم إضافة هذا الستيكر باسم \`${name}\``)
        .setTimestamp()] }).catch(()=>null);
    } catch (err) {
      cfg.stickerCounter--;
      log("error", "sticker steal failed", { err: err.message });
      await message.reply({ embeds: [new EmbedBuilder().setColor(0xe74c3c)
        .setDescription(`❌ فشل إضافة الستيكر: ${err.message}`)] }).catch(()=>null);
    }
  }
}

// ══════════════════════════════════════════════════════
//  Login
// ══════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════
//  Giveaway Functions
// ══════════════════════════════════════════════════════
async function endGiveaway(g, msgId) {
  const giveaways = getGiveaways(g.id);
  const gw = giveaways[msgId];
  if (!gw) return "❌ لم أجد هذه القرعة.";
  if (gw.ended) return "❌ هذه القرعة انتهت مسبقاً.";

  const ch = g.channels.cache.get(gw.channelId);
  if (!ch) return "❌ لم أجد القناة.";

  let msg;
  try { msg = await ch.messages.fetch(msgId); }
  catch { return "❌ لم أجد رسالة القرعة."; }

  const reaction = msg.reactions.cache.get("🎉");
  if (!reaction) return "❌ لا يوجد مشاركون.";

  const users = (await reaction.users.fetch()).filter(u => !u.bot);
  gw.ended = true;
  saveData();

  if (users.size === 0) {
    const embed = EmbedBuilder.from(msg.embeds[0]).setColor(0xe74c3c)
      .setTitle(`🎉 قرعة منتهية — ${gw.prize}`)
      .setDescription(`> لم يشارك أحد 😢

🏆 **الجائزة:** ${gw.prize}`)
      .setFooter({ text: "انتهت القرعة" }).setTimestamp();
    await msg.edit({ embeds: [embed] }).catch(()=>null);
    await ch.send({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle(`🎉 انتهت القرعة — ${gw.prize}`).setDescription("لم يشارك أحد.")] });
    return "✅ انتهت القرعة — لا يوجد مشاركون.";
  }

  const shuffled = users.toJSON().sort(() => Math.random() - 0.5);
  const winners  = shuffled.slice(0, gw.winners);
  const winMentions = winners.map(u => `<@${u.id}>`).join(", ");

  const embed = EmbedBuilder.from(msg.embeds[0]).setColor(0x2ecc71)
    .setTitle(`🎉 قرعة منتهية — ${gw.prize}`)
    .setDescription([
      `> 🎊 القرعة انتهت — تهانينا للفائزين!`,
      ``,
      `🏆 **الجائزة:** ${gw.prize}`,
      `🥇 **الفائزون:** ${winMentions}`,
      `🎟️ **بدأها:** <@${gw.hostId}>`,
    ].join("\n"))
    .setFooter({ text: "انتهت القرعة" }).setTimestamp();
  await msg.edit({ embeds: [embed] }).catch(()=>null);

  await ch.send({ embeds: [new EmbedBuilder().setColor(0xf1c40f)
    .setTitle(`🎉 فائزو القرعة — ${gw.prize}`)
    .setDescription(`مبروك ${winMentions}! 🎊\n\nتواصلوا مع <@${gw.hostId}> لاستلام الجائزة.`)
    .setTimestamp()] });

  gw.winnerIds = winners.map(u => u.id);
  saveData();
  return `✅ تم الإعلان عن الفائزين: ${winMentions}`;
}

async function rerollGiveaway(g, msgId) {
  const giveaways = getGiveaways(g.id);
  const gw = giveaways[msgId];
  if (!gw) return "❌ لم أجد هذه القرعة.";

  const ch = g.channels.cache.get(gw.channelId);
  if (!ch) return "❌ لم أجد القناة.";

  let msg;
  try { msg = await ch.messages.fetch(msgId); }
  catch { return "❌ لم أجد رسالة القرعة."; }

  const reaction = msg.reactions.cache.get("🎉");
  if (!reaction) return "❌ لا يوجد مشاركون.";

  const prevWinners = gw.winnerIds ?? [];
  const users = (await reaction.users.fetch()).filter(u => !u.bot && !prevWinners.includes(u.id));

  if (users.size === 0)
    return "❌ لا يوجد مشاركون جدد للإعادة.";

  const shuffled = users.toJSON().sort(() => Math.random() - 0.5);
  const winners  = shuffled.slice(0, gw.winners);
  const winMentions = winners.map(u => `<@${u.id}>`).join(", ");

  await ch.send({ embeds: [new EmbedBuilder().setColor(0x9b59b6)
    .setTitle(`🔄 إعادة سحب — ${gw.prize}`)
    .setDescription(`مبروك ${winMentions}! 🎊\n\nتواصلوا مع <@${gw.hostId}> لاستلام الجائزة.`)
    .setTimestamp()] });

  gw.winnerIds = [...prevWinners, ...winners.map(u => u.id)];
  saveData();
  return `✅ تم إعادة السحب: ${winMentions}`;
}

// استعادة تايمرات القرعات عند تشغيل البوت
client.once("ready", async () => {
  for (const [gId, gData] of Object.entries(db.guilds)) {
    const giveaways = gData.giveaways ?? {};
    for (const [msgId, gw] of Object.entries(giveaways)) {
      if (gw.ended) continue;
      const remaining = gw.endsAt - Date.now();
      if (remaining <= 0) {
        const g = client.guilds.cache.get(gId);
        if (g) setTimeout(() => endGiveaway(g, msgId), 2000);
      } else {
        const g = client.guilds.cache.get(gId);
        if (g) setTimeout(() => endGiveaway(g, msgId), remaining);
      }
    }
  }
});

// ══════════════════════════════════════════════════════
//  Ad System Functions
// ══════════════════════════════════════════════════════
async function sendAdPanel(g, guildId) {
  const cfg = getAdConfig(guildId);
  if (!cfg.panelChannelId) return;
  const ch = g.channels.cache.get(cfg.panelChannelId);
  if (!ch) return;

  // احذف البانل القديم إن وجد
  if (cfg.panelMessageId) {
    const old = await ch.messages.fetch(cfg.panelMessageId).catch(() => null);
    if (old) await old.delete().catch(() => null);
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("📢 نظام المنشورات التلقائي")
    .setDescription("لنشر منشوراتك أو التعرف على منشوراتك أو معرفة الحدود اضغط السيلكت مينيو بالأسفل")
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("ad_panel_menu")
      .setPlaceholder("شرح ▾")
      .addOptions([
        { label: "إنشاء منشور",      value: "ad_create",   emoji: "📝" },
        { label: "منشوراتك الخاصة", value: "ad_my_posts",  emoji: "📋" },
        { label: "حدود النشر",       value: "ad_limits",   emoji: "📊" },
        { label: "شرح",              value: "ad_explain",  emoji: "📖" },
        { label: "Refresh",          value: "ad_refresh",  emoji: "🔄" },
      ])
  );

  const msg = await ch.send({ embeds: [embed], components: [row] }).catch(() => null);
  if (msg) {
    cfg.panelMessageId = msg.id;
    saveData();
  }
}

async function publishAdPost(user, conv, channelId) {
  const g = client.guilds.cache.get(conv.guildId);
  if (!g) return;
  const ch = g.channels.cache.get(channelId);
  if (!ch) return;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
    .setDescription(conv.content || "‎")
    .addFields({ name: "للتواصل", value: `<@${user.id}> • **${user.username}**`, inline: false })
    .setTimestamp();
  if (conv.imageUrl) embed.setImage(conv.imageUrl);

  const msg = await ch.send({ embeds: [embed] }).catch(() => null);
  if (!msg) return;

  // تسجيل المنشور
  const posts = getAdPosts(conv.guildId);
  if (!posts[user.id]) posts[user.id] = [];
  posts[user.id].push({ channelId, messageId: msg.id, createdAt: Date.now(), active: true });
  saveData();
  dmConversations.delete(user.id);
}

async function setupAdInterval(g, guildId) {
  // إيقاف الإنترفال القديم
  if (adIntervals.has(guildId)) {
    clearInterval(adIntervals.get(guildId));
    adIntervals.delete(guildId);
  }
  const cfg = getAdConfig(guildId);
  if (cfg.intervalHours > 0) {
    const ms = cfg.intervalHours * 3600000;
    const id = setInterval(() => sendAdPanel(g, guildId), ms);
    adIntervals.set(guildId, id);
  }
  // إرسال البانل فوراً
  await sendAdPanel(g, guildId);
}

// استعادة الإنترفالات عند تشغيل البوت
client.once("ready", async () => {
  for (const [gId, gData] of Object.entries(db.guilds)) {
    const cfg = gData.adConfig;
    if (!cfg?.panelChannelId || !cfg.channels?.length) continue;
    const g = client.guilds.cache.get(gId);
    if (!g) continue;
    if (cfg.intervalHours > 0) {
      const ms = cfg.intervalHours * 3600000;
      const id = setInterval(() => sendAdPanel(g, gId), ms);
      adIntervals.set(gId, id);
    }
  }
});

// ══════════════════════════════════════════════════════
//  Keep-Alive HTTP Server (Render requirement)
// ══════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Bot is running ✅");
}).listen(PORT, () => {
  console.log(`[Keep-Alive] HTTP server listening on port ${PORT}`);
});

client.login(BOT_TOKEN);
