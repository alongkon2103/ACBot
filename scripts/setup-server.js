import { REST, Routes, PermissionFlagsBits as P, ChannelType as T } from 'discord.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const guildId = process.env.DISCORD_GUILD_ID;
if (!process.env.DISCORD_TOKEN || !guildId) throw new Error('Missing .env configuration');
const rest = new REST().setToken(process.env.DISCORD_TOKEN);
const reason = 'AC Entertainment: configure agency channels and roles';
const bits = (names) => names.reduce((value, name) => value | P[name], 0n).toString();
const base = ['ViewChannel', 'ReadMessageHistory', 'SendMessages', 'EmbedLinks', 'AttachFiles', 'AddReactions', 'Connect', 'Speak', 'Stream', 'UseVAD', 'UseApplicationCommands'];
const roleSpecs = [
  { name: 'AC', color: 0x3498db, permissions: bits(base) },
  { name: 'Dev', color: 0x2ecc71, permissions: bits(base) },
  { name: 'Admin', color: 0xe67e22, permissions: bits([...base, 'ManageChannels', 'ManageMessages', 'ManageThreads', 'ManageNicknames', 'KickMembers', 'BanMembers', 'ModerateMembers', 'MoveMembers', 'MuteMembers', 'DeafenMembers', 'ViewAuditLog']) },
  { name: 'CEO', color: 0xf1c40f, permissions: bits(['Administrator']) },
];
await mkdir('data', { recursive: true });
const [existingRoles, existingChannels, me] = await Promise.all([
  rest.get(Routes.guildRoles(guildId)), rest.get(Routes.guildChannels(guildId)), rest.get(Routes.user()),
]);
const member = await rest.get(Routes.guildMember(guildId, me.id));
const guild = await rest.get(Routes.guild(guildId));
const currentPermissions = existingRoles.filter(r => r.id === guildId || member.roles.includes(r.id))
  .reduce((v, r) => v | BigInt(r.permissions), 0n);
const administrator = guild.owner_id === me.id || (currentPermissions & P.Administrator) !== 0n;
if (!administrator && ![P.ManageRoles, P.ManageChannels].every(p => (currentPermissions & p) !== 0n)) {
  console.error('SETUP BLOCKED: Bot needs Manage Roles and Manage Channels, with its role above CEO/Admin/Dev/AC.');
  process.exit(1);
}
await writeFile(`data/server-before-${Date.now()}.json`, JSON.stringify({ roles: existingRoles, channels: existingChannels }, null, 2));
let state;
try { state = JSON.parse(await readFile('data/server-setup.json', 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; state = { guildId, roles: {}, channels: {} }; }
if (state.guildId !== guildId) throw new Error('Setup state belongs to another server');
const save = () => writeFile('data/server-setup.json', JSON.stringify(state, null, 2));
for (const spec of roleSpecs) {
  let role = existingRoles.find(r => r.id === state.roles[spec.name]) ?? existingRoles.find(r => r.name === spec.name && !r.managed);
  if (role) role = await rest.patch(Routes.guildRole(guildId, role.id), { body: { ...spec, hoist: true, mentionable: false }, reason });
  else role = await rest.post(Routes.guildRoles(guildId), { body: { ...spec, hoist: true, mentionable: false }, reason });
  state.roles[spec.name] = role.id;
  await save();
  console.log(`Role ready: ${spec.name}`);
}
try {
  await rest.patch(Routes.guildRoles(guildId), { body: roleSpecs.map((r, i) => ({ id: state.roles[r.name], position: i + 1 })), reason });
} catch (error) {
  if (error.code !== 50013) throw error;
  console.log('Role ordering skipped: bot role is too low. Continuing channel setup.');
}
const overwrite = (id, allow = [], deny = []) => ({ id, type: 0, allow: bits(allow), deny: bits(deny) });
const staff = ['CEO', 'Admin'];
const access = (audience = [], readonly = false, writers = staff) => {
  const rules = [overwrite(guildId,
    audience.length ? [] : ['ViewChannel', 'ReadMessageHistory', ...(readonly ? [] : ['SendMessages', 'Connect', 'Speak'])],
    [...(audience.length ? ['ViewChannel', 'Connect'] : []), ...(readonly ? ['SendMessages', 'CreatePublicThreads', 'CreatePrivateThreads', 'SendMessagesInThreads', 'AddReactions'] : []), 'MentionEveryone']),
  { id: me.id, type: 1, allow: bits([...base, 'ManageChannels', 'ManageMessages']), deny: '0' }];
  for (const name of new Set([...audience, ...staff, ...writers])) {
    rules.push(overwrite(state.roles[name], ['ViewChannel', 'ReadMessageHistory', 'Connect', 'Speak', ...(readonly && !writers.includes(name) ? [] : ['SendMessages', 'SendMessagesInThreads', 'AddReactions'])]));
  }
  return rules;
};
const sections = [
  { name: 'AC • INFORMATION', readonly: true, rooms: [
    ['👋・ยินดีต้อนรับ', 'จุดเริ่มต้นของ AC Entertainment'],
    ['📖・เกี่ยวกับสังกัด', 'ข้อมูลสังกัด แนวทาง และช่องทางอย่างเป็นทางการ'],
    ['📜・กฎและแนวทาง', 'กฎการอยู่ร่วมกันและแนวทางสำหรับสมาชิก'],
    ['📢・ประกาศ', 'ประกาศอย่างเป็นทางการจาก CEO และ Admin'],
    ['🔗・ช่องทางของ-ac', 'ลิงก์โซเชียลและช่องทางของสังกัด'],
  ] },
  { name: 'AC • COMMUNITY', rooms: [
    ['💬・พูดคุยทั่วไป', 'พื้นที่พูดคุยของชุมชน AC'],
    ['🎬・ผลงานและไลฟ์', 'แชร์ผลงาน คลิป และตารางไลฟ์ของสมาชิก'],
    ['💡・เสนอไอเดีย', 'เสนอไอเดียและกิจกรรมสำหรับสังกัด'],
    ['🎉・กิจกรรม', 'พูดคุยและร่วมกิจกรรมของชุมชน'],
    ['🔊 พูดคุย 1', null, T.GuildVoice], ['🎮 เล่นเกมด้วยกัน', null, T.GuildVoice],
  ] },
  { name: 'AC • MEMBERS', audience: ['AC', 'Dev'], rooms: [
    ['🏠・ภายในสังกัด', 'พื้นที่ภายในสำหรับสมาชิก AC และทีมงาน'],
    ['📅・ตารางงาน', 'ตารางงาน นัดหมาย และการประสานงาน'],
    ['🤝・หาเพื่อนคอลแลบ', 'วางแผนงานร่วมกันระหว่างสมาชิก'],
    ['🎙 ประชุมสมาชิก', null, T.GuildVoice],
  ] },
  { name: 'AC • CONTACT', rooms: [
    ['📨・ติดต่อทีมงาน', 'ติดต่อ Admin เพื่อสมัครเข้าสังกัดหรือแจ้งปัญหา กรุณาอย่าส่งข้อมูลส่วนตัวในห้องสาธารณะ'],
    ['🐞・แจ้งปัญหาทั่วไป', 'แจ้งข้อผิดพลาดของเกม โปรแกรม หรือเซิร์ฟเวอร์ โดยไม่โพสต์ข้อมูลลับ'],
    ['🟢 ห้องรอติดต่อ', null, T.GuildVoice],
  ] },
  { name: 'AC • STAFF', audience: ['Admin'], rooms: [
    ['🛡・ทีมงาน', 'ประสานงานภายใน CEO และ Admin'],
    ['📋・แผนงานสังกัด', 'แผนงานและการติดตามงานของทีมบริหาร'],
    ['🔒 ประชุมทีมงาน', null, T.GuildVoice],
  ] },
  { name: 'AC • DEVELOPMENT', audience: ['Dev', 'Admin'], rooms: [
    ['💻・ห้องพัฒนา', 'ประสานงานพัฒนาระบบและบอท'],
    ['🧪・ทดสอบและบั๊ก', 'รายละเอียดการทดสอบและติดตามบั๊ก'],
    ['✅・อัปเดตระบบ', 'บันทึกการอัปเดตเกม โปรแกรม และบอท', T.GuildText, true],
  ] },
];
async function ensureChannel(key, body) {
  const known = existingChannels.find(c => c.id === state.channels[key]);
  const channel = known
    ? await rest.patch(Routes.channel(known.id), { body, reason })
    : await rest.post(Routes.guildChannels(guildId), { body, reason });
  state.channels[key] = channel.id;
  await save();
  console.log(`Channel ready: ${channel.name}`);
  return channel;
}
for (const section of sections) {
  const category = await ensureChannel(section.name, { name: section.name, type: T.GuildCategory, permission_overwrites: access(section.audience, section.readonly) });
  for (const [name, topic, type = T.GuildText, readonly = section.readonly] of section.rooms) {
    await ensureChannel(`${section.name}/${name}`, {
      name, type, parent_id: category.id,
      ...(topic ? { topic, rate_limit_per_user: 3 } : {}),
      permission_overwrites: access(section.audience, readonly, section.name === 'AC • DEVELOPMENT' ? ['CEO', 'Admin', 'Dev'] : staff),
    });
  }
}
// Verify the actual API state after all mutations.
const [roles, channels] = await Promise.all([rest.get(Routes.guildRoles(guildId)), rest.get(Routes.guildChannels(guildId))]);
for (const id of Object.values(state.roles)) if (!roles.some(r => r.id === id)) throw new Error('Role verification failed');
for (const id of Object.values(state.channels)) if (!channels.some(c => c.id === id)) throw new Error('Channel verification failed');
console.log(`Verified ${Object.keys(state.roles).length} roles and ${Object.keys(state.channels).length} channels/categories. No member roles assigned.`);
