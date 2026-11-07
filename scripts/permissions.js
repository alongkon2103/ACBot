import { REST, Routes, PermissionFlagsBits as P } from 'discord.js';
import { readFile, writeFile } from 'node:fs/promises';

const state = JSON.parse(await readFile('data/server-setup.json', 'utf8'));
const guildId = process.env.DISCORD_GUILD_ID;
if (state.guildId !== guildId) throw new Error('Wrong server');
const rest = new REST().setToken(process.env.DISCORD_TOKEN);
const reason = 'AC agency: public, signed members and staff channel permissions';
const bits = names => names.reduce((v, n) => v | P[n], 0n).toString();
const [roles, channels, bot] = await Promise.all([
  rest.get(Routes.guildRoles(guildId)), rest.get(Routes.guildChannels(guildId)), rest.get(Routes.user()),
]);
await writeFile(`data/permissions-before-${Date.now()}.json`, JSON.stringify({ roles, channels }, null, 2));
const normal = ['ReadMessageHistory', 'SendMessages', 'EmbedLinks', 'AttachFiles', 'AddReactions', 'Connect', 'Speak', 'Stream', 'UseVAD', 'UseApplicationCommands', 'ChangeNickname', 'UseExternalEmojis'];
// No ViewChannel at the server level for visitors: public rooms opt in explicitly.
await rest.patch(Routes.guildRole(guildId, guildId), { body: { permissions: bits(normal) }, reason });
const rules = [];
const legacy = new Set(['1564194942082093096', '1564194942082093097', '1564194942082093098', '1564194942082093099']);
for (const channel of channels) {
  const key = Object.entries(state.channels).find(([, id]) => id === channel.id)?.[0];
  if (!key && !legacy.has(channel.id)) continue;
  const group = key?.split('/')[0] ?? 'LEGACY';
  const sharedGroup = ['AC • INFORMATION', 'AC • COMMUNITY', 'AC • CONTACT'].includes(group);
  const publicRoom = [
    state.channels['AC • INFORMATION/👋・ยินดีต้อนรับ'],
    state.channels['AC • INFORMATION/📖・เกี่ยวกับสังกัด'],
    state.channels['AC • CONTACT/📨・ติดต่อทีมงาน'],
  ].includes(channel.id);
  const audience = group === 'AC • MEMBERS' ? ['AC', 'Dev', 'Admin', 'CEO']
    : group === 'AC • DEVELOPMENT' ? ['Dev', 'Admin', 'CEO']
    : sharedGroup ? ['AC', 'Dev', 'Admin', 'CEO'] : ['Admin', 'CEO'];
  const readonly = group === 'AC • INFORMATION' || channel.id === state.channels['AC • CONTACT/📨・ติดต่อทีมงาน'];
  const memberPosts = channel.name.includes('ผลงานและไลฟ์');
  const posting = ['SendMessages', 'SendMessagesInThreads', 'CreatePublicThreads', 'CreatePrivateThreads', 'AddReactions'];
  const talk = ['ViewChannel', 'ReadMessageHistory', 'Connect', 'Speak', 'Stream', 'UseVAD', 'UseApplicationCommands'];
  const overwrites = [{ id: guildId, type: 0,
    allow: bits(publicRoom ? [...talk, ...(readonly || memberPosts ? [] : posting)] : []),
    deny: bits(['MentionEveryone', ...(!publicRoom ? ['ViewChannel', 'Connect', 'SendMessages', 'SendMessagesInThreads'] : []), ...(readonly || memberPosts ? posting : [])]),
  }, { id: bot.id, type: 1, allow: bits([...talk, ...posting, 'ManageChannels', 'ManageMessages']), deny: '0' }];
  for (const name of audience) {
    const canPost = !readonly || ['Admin', 'CEO'].includes(name);
    overwrites.push({ id: state.roles[name], type: 0,
      allow: bits([...talk, ...(canPost ? posting : []), ...(name === 'Admin' ? ['ManageMessages', 'ManageThreads', 'MoveMembers', 'MuteMembers', 'DeafenMembers'] : [])]), deny: '0' });
  }
  await rest.patch(Routes.channel(channel.id), { body: { permission_overwrites: overwrites }, reason });
  rules.push({ id: channel.id, publicRoom, audience, readonly, memberPosts });
  console.log(`Permissions updated: ${channel.name}`);
}

const [liveRoles, liveChannels] = await Promise.all([rest.get(Routes.guildRoles(guildId)), rest.get(Routes.guildChannels(guildId))]);
function permissions(channel, names) {
  const ids = names.map(n => state.roles[n]);
  let value = liveRoles.filter(r => r.id === guildId || ids.includes(r.id)).reduce((v, r) => v | BigInt(r.permissions), 0n);
  if (value & P.Administrator) return ~0n;
  const everyone = channel.permission_overwrites.find(o => o.id === guildId);
  if (everyone) value = (value & ~BigInt(everyone.deny)) | BigInt(everyone.allow);
  let deny = 0n, allow = 0n;
  for (const o of channel.permission_overwrites.filter(o => ids.includes(o.id))) { deny |= BigInt(o.deny); allow |= BigInt(o.allow); }
  return (value & ~deny) | allow;
}
let checks = 0;
for (const rule of rules) {
  const c = liveChannels.find(c => c.id === rule.id);
  // Include combinations so AC+Dev cannot accidentally unlock administration rooms.
  for (const names of [[], ['AC'], ['Dev'], ['Admin'], ['CEO'], ['AC', 'Dev']]) {
    const p = permissions(c, names);
    const visible = rule.publicRoom || names.some(n => rule.audience.includes(n));
    if (Boolean(p & P.ViewChannel) !== visible) throw new Error(`Visibility mismatch: ${c.name} ${names}`);
    if (c.type === 2 && Boolean(p & P.Connect) !== visible) throw new Error(`Voice mismatch: ${c.name} ${names}`);
    if (visible && c.type === 0) {
      const writable = rule.readonly ? names.some(n => ['CEO', 'Admin'].includes(n)) : rule.memberPosts ? names.length > 0 : true;
      for (const bit of [P.SendMessages, P.SendMessagesInThreads]) if (Boolean(p & bit) !== writable) throw new Error(`Posting mismatch: ${c.name} ${names}`);
    }
    checks++;
  }
}
console.log(`Verified ${rules.length} channels/categories and ${checks} role scenarios. Member role assignments unchanged.`);
const visitorRooms = liveChannels.filter(c => c.type !== 4 && (permissions(c, []) & P.ViewChannel));
const expectedVisitorIds = [state.channels['AC • INFORMATION/👋・ยินดีต้อนรับ'], state.channels['AC • INFORMATION/📖・เกี่ยวกับสังกัด'], state.channels['AC • CONTACT/📨・ติดต่อทีมงาน']];
if (visitorRooms.length !== expectedVisitorIds.length || visitorRooms.some(c => !expectedVisitorIds.includes(c.id))) {
  throw new Error(`Unexpected visitor rooms: ${visitorRooms.map(c => c.name).join(', ')}`);
}
console.log(`Visitors can see exactly: ${visitorRooms.map(c => c.name).join(', ')}`);
