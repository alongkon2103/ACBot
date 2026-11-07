import {
  ActionRowBuilder as Row, AttachmentBuilder, ButtonBuilder as Button, ButtonStyle as Style,
  ChannelSelectMenuBuilder, RoleSelectMenuBuilder, ChannelType, EmbedBuilder,
  FileUploadBuilder, LabelBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  MessageFlags, PermissionFlagsBits as P, SlashCommandBuilder,
} from 'discord.js';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DATA_DIR, ASSET_DIR } from './data-paths.js';
import { settings, save } from './store.js';
import { ensureConsole } from './console.js';
import { topics, ticketPanelButtons, ticketMenu, responseEditor, websiteEditor, topicPayload } from './ticket-content.js';
import { handleSentEdit, rememberMessage } from './sent-editor.js';
const ephemeral = MessageFlags.Ephemeral;
const titles = { welcome: 'Welcome • ต้อนรับสมาชิก', goodbye: 'Goodbye • อำลาสมาชิก', ticket: 'Ticket • ติดต่อทีมงาน', announce: 'ประกาศ • AC Entertainment' };
const types = { join: ['🌟', 'สมัครเข้าสังกัด'], help: ['🛠️', 'แจ้งปัญหา'], work: ['🤝', 'ติดต่องาน'] };
const locks = new Set();
const publishing = new Set();
const pending = new Map();
const btn = (id, label, style = Style.Secondary) => new Button().setCustomId(id).setLabel(label).setStyle(style);
const row = (...items) => new Row().addComponents(items);
const admin = i => i.memberPermissions?.has(P.ManageGuild) || i.member?.roles?.cache?.some(r => r.name === 'Admin');
const support = i => admin(i) || settings(i.guildId).ticket.supportRoles.some(id => i.member?.roles?.cache?.has(id));
const actionId = (kind, action, userId) => `cfg:${kind}:${action}:${userId}`;
export const commands = [
  new SlashCommandBuilder().setName('ping').setDescription('ตรวจสอบสถานะบอท'),
  new SlashCommandBuilder().setName('bothelp').setDescription('คู่มือระบบ AC Bot'),
  ...Object.entries({ welcomeconfig: 'welcome', goodbyeconfig: 'goodbye', ticketconfig: 'ticket', announce: 'announce' }).map(([name, kind]) =>
    new SlashCommandBuilder().setName(name).setDescription(`ตั้งค่า ${titles[kind]} พร้อมอัปโหลดรูป`)),
];
function replace(text, member) {
  const values = { user: `<@${member.id}>`, username: member.user.username, server: member.guild.name, count: String(member.guild.memberCount) };
  return String(text).replace(/\{(user|username|server|count)\}/g, (_, key) => values[key]);
}
export async function messagePayload(config, member, kind) {
  const embed = new EmbedBuilder().setTitle(replace(config.title, member).slice(0, 256))
    .setDescription(replace(config.body, member).slice(0, 4096)).setColor(config.color)
    .setFooter({ text: 'AC Entertainment • ' + (kind === 'welcome' ? 'Welcome aboard' : kind === 'goodbye' ? 'See you again' : 'Community & Support') }).setTimestamp();
  const files = [];
  for (const type of ['banner', 'logo']) {
    if (config[type]) {
      const attachment = new AttachmentBuilder(await readFile(join(ASSET_DIR, config[type])), { name: `${type}.${config[type].split('.').pop()}` });
      files.push(attachment);
      if (type === 'banner') embed.setImage(`attachment://${attachment.name}`);
      else embed.setThumbnail(`attachment://${attachment.name}`);
    } else if (config[`${type}Url`]) {
      if (type === 'banner') embed.setImage(config.bannerUrl);
      else embed.setThumbnail(config.logoUrl);
    }
  }
  if (!config.logo && ['welcome', 'goodbye'].includes(kind)) embed.setThumbnail(member.user.displayAvatarURL());
  return { embeds: [embed], files, allowedMentions: { parse: [] } };
}
async function dashboard(i, kind) {
  const c = settings(i.guildId)[kind];
  const embed = new EmbedBuilder().setTitle(`⚙️ ${titles[kind]}`).setColor(c.color)
    .setDescription('ตั้งค่าผ่านเมนูด้านล่าง • ข้อความและรูปจะบันทึกอัตโนมัติ\nแท็กข้อความ: `{user}` `{username}` `{server}` `{count}`\nรูปที่ไม่เลือกใหม่จะคงรูปเดิมไว้')
    .addFields({ name: 'ห้องปลายทาง', value: c.channelId ? `<#${c.channelId}>` : 'ยังไม่ได้เลือก', inline: true },
      { name: 'สถานะ', value: kind === 'announce' ? 'ฉบับร่าง — ส่งเมื่อกดยืนยัน' : c.enabled ? '🟢 เปิดใช้งาน' : '⚫ ปิดใช้งาน', inline: true });
  if (kind === 'ticket') embed.addFields({ name: 'ทีมดูแลตั๋ว', value: c.supportRoles.length ? c.supportRoles.map(id => `<@&${id}>`).join(' ') : 'เลือกยศทีมงานก่อนเปิดใช้งาน' });
  if (['welcome', 'goodbye'].includes(kind) && !i.client.membersEnabled) embed.addFields({ name: '⚠️ ยังรับเหตุการณ์สมาชิกไม่ได้', value: 'เปิด Server Members Intent ใน Developer Portal → Bot แล้วรีสตาร์ตบอท' });
  const id = action => actionId(kind, action, i.user.id);
  const components = [row(new ChannelSelectMenuBuilder().setCustomId(id('channel')).setPlaceholder('เลือกห้องสำหรับส่งข้อความ').setChannelTypes(ChannelType.GuildText)),
    row(btn(id('edit'), '✏️ ข้อความและรูป', Style.Primary), btn(id('preview'), '👁 ดูตัวอย่าง'), btn(id('clear'), '🖼 ล้างรูป'), ...(kind === 'ticket' ? [btn(id('questions'), 'ข้อความตอบกลับ'), btn(id('website'), 'เว็บไซต์สังกัด')] : []))];
  if (kind === 'ticket') components.push(row(new RoleSelectMenuBuilder().setCustomId(id('roles')).setPlaceholder('เลือกยศที่ดูแล Ticket (ไม่เลือก AC)').setMinValues(1).setMaxValues(5)));
  components.push(row(...(kind === 'announce' ? [] : [btn(id('toggle'), c.enabled ? 'ปิดระบบ' : 'เปิดระบบ', c.enabled ? Style.Danger : Style.Success)]),
    ...(kind === 'ticket' || kind === 'announce' ? [btn(id('confirm'), kind === 'ticket' ? '📨 ส่งแผงเปิดตั๋ว' : '📢 เตรียมส่งประกาศ', Style.Primary)] : [])));
  if (['ticket', 'announce'].includes(kind)) components.push(row(btn(id('s_list'), 'แก้ไขข้อความเดิม'), btn(id('s_link'), 'เลือกจากลิงก์')));
  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}
export function editor(i, kind) {
  const c = settings(i.guildId)[kind];
  const input = (id, label, value, max, style) => new LabelBuilder().setLabel(label).setTextInputComponent(new TextInputBuilder().setCustomId(id).setStyle(style).setMaxLength(max).setRequired(true).setValue(value));
  const upload = (id, label) => new LabelBuilder().setLabel(label).setDescription('PNG / JPG / GIF / WebP ไม่เกิน 8 MB • เว้นไว้เพื่อใช้รูปเดิม').setFileUploadComponent(new FileUploadBuilder().setCustomId(id).setMinValues(0).setMaxValues(1).setRequired(false));
  return new ModalBuilder().setCustomId(actionId(kind, 'save', i.user.id)).setTitle(titles[kind]).addLabelComponents(
    input('title', 'หัวข้อ', c.title, 200, TextInputStyle.Short),
    input('body', 'ข้อความ', c.body, 3500, TextInputStyle.Paragraph),
    input('color', 'สี HEX เช่น #5865F2', c.color, 7, TextInputStyle.Short), upload('banner', 'รูปแบนเนอร์ใหญ่'), upload('logo', 'รูปโลโก้ / รูปมุมขวา'));
}
async function storeUpload(attachment) {
  const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
  const ext = extensions[attachment.contentType];
  if (!ext || attachment.size > 8 * 1024 * 1024) throw Error('รูปต้องเป็น PNG, JPG, GIF หรือ WebP ขนาดไม่เกิน 8 MB');
  const url = new URL(attachment.url);
  if (url.protocol !== 'https:' || !['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname)) throw Error('ใช้ไฟล์ที่อัปโหลดผ่าน Discord เท่านั้น');
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'error' });
  if (!response.ok) throw Error('ดาวน์โหลดรูปไม่สำเร็จ กรุณาลองอัปโหลดใหม่');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > 8 * 1024 * 1024) throw Error('รูปใหญ่เกิน 8 MB'); chunks.push(chunk); }
  const name = `${randomUUID()}.${ext}`;
  await writeFile(join(ASSET_DIR, name), Buffer.concat(chunks));
  return name;
}
async function target(i, c) {
  if (!c.channelId) throw Error('กรุณาเลือกห้องปลายทางก่อน');
  const channel = await i.guild.channels.fetch(c.channelId);
  if (channel?.type !== ChannelType.GuildText) throw Error('ห้องปลายทางไม่พร้อมใช้งาน กรุณาเลือกห้องใหม่');
  if (!channel.permissionsFor(i.guild.members.me)?.has([P.ViewChannel, P.SendMessages, P.EmbedLinks, P.AttachFiles])) throw Error('บอทต้องมีสิทธิ์ดูห้อง ส่งข้อความ ฝังลิงก์ และแนบไฟล์ในห้องปลายทาง');
  return channel;
}
async function category(i) {
  const c = settings(i.guildId).ticket;
  if (c.categoryId) { const found = await i.guild.channels.fetch(c.categoryId).catch(() => null); if (found?.type === ChannelType.GuildCategory) return found; }
  const created = await i.guild.channels.create({ name: 'AC • PRIVATE TICKETS', type: ChannelType.GuildCategory, permissionOverwrites: ticketPermissions(i, c) });
  c.categoryId = created.id; save(); return created;
}
function ticketPermissions(i, c, owner) {
  const access = [P.ViewChannel, P.ReadMessageHistory, P.SendMessages, P.AttachFiles, P.EmbedLinks];
  return [{ id: i.guildId, deny: [P.ViewChannel, P.SendMessages, P.CreatePublicThreads, P.CreatePrivateThreads, P.MentionEveryone] },
    { id: i.client.user.id, allow: [...access, P.ManageChannels] },
    ...c.supportRoles.map(id => ({ id, allow: access })), ...(owner ? [{ id: owner, allow: access }] : [])];
}
async function ticketOpen(i, type, answers = []) {
  const c = settings(i.guildId).ticket;
  if (!c.enabled) throw Error('ระบบ Ticket ปิดอยู่ชั่วคราว');
  if (!types[type] || !c.supportRoles.length) throw Error('ยังไม่ได้ตั้งค่าทีมดูแลตั๋ว');
  if (locks.has(i.user.id)) throw Error('กำลังเปิดตั๋วของคุณ กรุณารอสักครู่');
  locks.add(i.user.id);
  try {
    await i.deferReply({ flags: ephemeral });
    const channels = await i.guild.channels.fetch();
    const existing = channels.find(ch => ch?.topic === `ac-ticket:${i.user.id}:open`);
    if (existing) return i.editReply({ content: `คุณมีตั๋วที่เปิดอยู่แล้ว: ${existing}` });
    const parent = await category(i);
    const ch = await i.guild.channels.create({ name: `ticket-${type}-${i.user.id.slice(-6)}`, type: ChannelType.GuildText,
      parent: parent.id, topic: `ac-ticket:${i.user.id}:open`, permissionOverwrites: ticketPermissions(i, c, i.user.id) });
    c.tickets[ch.id] = { owner: i.user.id, type, status: 'open', openedAt: new Date().toISOString() }; save();
    await ch.send({ content: `<@${i.user.id}> ${c.supportRoles.map(id => `<@&${id}>`).join(' ')}`,
      allowedMentions: { users: [i.user.id], roles: c.supportRoles },
      embeds: [new EmbedBuilder().setColor('#5865F2').setTitle('AC Entertainment').setDescription('เลือกหัวข้อที่ต้องการติดต่อด้านล่าง แล้วพิมพ์ข้อมูลตอบกลับในห้องนี้ได้เลยครับ\nห้องนี้เห็นเฉพาะคุณและทีมดูแล').addFields(answers).setTimestamp()],
      components: ticketMenu(i.user.id) });
    await i.editReply({ content: `🎫 เปิดตั๋วเรียบร้อย: ${ch}` });
  } finally { locks.delete(i.user.id); }
}
async function ticketClose(i, action) {
  const c = settings(i.guildId).ticket;
  const t = c.tickets[i.channelId];
  if (!t || t.status !== 'open') throw Error('ตั๋วนี้ปิดแล้วหรือไม่พบข้อมูล');
  if (t.owner !== i.user.id && !support(i)) throw Error('เฉพาะเจ้าของตั๋วหรือทีมดูแลเท่านั้นที่ปิดตั๋วได้');
  if (action === 'close') return i.reply({ content: 'ยืนยันปิดตั๋วและลบห้องนี้ถาวร? ข้อความและรูปในห้องจะถูกลบไปด้วย', flags: ephemeral,
    components: [row(btn(`ticket:finish:${t.owner}`, 'ยืนยันปิดตั๋ว', Style.Danger))] });
  if (action !== 'finish') return;
  if (locks.has(i.channelId)) throw Error('กำลังปิดตั๋ว กรุณารอสักครู่');
  locks.add(i.channelId);
  try {
    await i.deferUpdate();
    await i.editReply({ content: '🗑️ กำลังปิดตั๋วและลบห้อง…', components: [] });
    await i.channel.delete(`Ticket closed by ${i.user.id}`);
    t.status = 'deleted'; t.closedAt = new Date().toISOString(); save();
  } finally { locks.delete(i.channelId); }
}
export async function handle(i) {
  if (!i.guildId || i.guildId !== process.env.DISCORD_GUILD_ID) return;
  if (i.customId?.startsWith('console:')) {
    const action = i.customId.split(':')[1];
    if (action === 'help') return i.reply({ flags: ephemeral, embeds: [new EmbedBuilder().setColor('#5865F2').setTitle('📖 วิธีใช้ Control Console')
      .setDescription('**Welcome / Goodbye**\nเลือกห้อง → แก้ข้อความและอัปโหลดรูป → ดูตัวอย่าง → เปิดระบบ\n\n**Ticket**\nเลือกห้องและทีมดูแล → เปิดระบบ → ส่งแผงสมัครเข้าสังกัด\nกดสมัครเพื่อเปิดห้องทันที แล้วเลือกหัวข้อภายในห้อง\nแก้ข้อความตอบกลับและลิงก์เว็บไซต์ได้จากเมนู Ticket\n\n**ประกาศ**\nเลือกห้อง → เขียนข้อความ/ใส่รูป → ดูตัวอย่าง → ยืนยันส่ง\n\nเมนูตั้งค่าเห็นเฉพาะคุณ ค่าจะบันทึกไว้หลังรีสตาร์ต\nกดยืนยันปิด Ticket แล้วจะลบห้องทันที')] });
    if (action === 'refresh') {
      await i.deferReply({ flags: ephemeral });
      await ensureConsole(i.guild, i.client);
      return i.editReply({ content: '✅ อัปเดต dashboard แล้ว' });
    }
    if (!admin(i)) throw Error('เมนูตั้งค่าสำหรับ Admin หรือผู้มีสิทธิ์ Manage Server เท่านั้น');
    if (action === 'questions') return i.showModal(responseEditor(i, settings(i.guildId).ticket));
    if (!['welcome', 'goodbye', 'ticket', 'announce'].includes(action)) throw Error('ไม่พบเมนูนี้');
    return i.reply({ ...(await dashboard(i, action)), flags: ephemeral });
  }
  if (i.isChatInputCommand()) {
    if (i.commandName === 'ping') return i.reply({ content: `🏓 Pong! ${Math.round(i.client.ws.ping)} ms`, flags: ephemeral });
    if (i.commandName === 'bothelp') return i.reply({ flags: ephemeral, embeds: [new EmbedBuilder().setColor('#5865F2').setTitle('✨ AC Bot • คู่มือใช้งาน').setDescription('**สำหรับทีมงาน**\n`/welcomeconfig` — ข้อความต้อนรับ\n`/goodbyeconfig` — ข้อความอำลา\n`/ticketconfig` — ตั้งค่าและส่งแผงเปิดตั๋ว\n`/announce` — เขียนและส่งประกาศ\n\nเลือกห้อง → แก้ข้อความและอัปโหลดรูป → ดูตัวอย่าง → เปิดระบบหรือยืนยันส่ง\n\n**สำหรับทุกคน**\nกดปุ่มบนแผง Ticket เพื่อเปิดห้องส่วนตัว\n`/ping` — ตรวจสถานะบอท\n\nผู้ตั้งค่าต้องมียศ Admin หรือสิทธิ์ Manage Server')] });
    if (!admin(i)) throw Error('เมนูตั้งค่าสำหรับ Admin หรือผู้มีสิทธิ์ Manage Server เท่านั้น');
    const kind = { welcomeconfig: 'welcome', goodbyeconfig: 'goodbye', ticketconfig: 'ticket', announce: 'announce' }[i.commandName];
    if (kind) return i.reply({ ...(await dashboard(i, kind)), flags: ephemeral });
  }
  if (i.customId?.startsWith('ticket:')) {
    const [, action, type, nonce] = i.customId.split(':');
    if (action === 'open') return ticketOpen(i, 'join');
    if (action === 'submit') throw Error('ไม่ต้องกรอกแบบฟอร์มแล้ว กรุณากดสมัครเข้าสังกัดใหม่');
    if (action === 'topic') {
      const ticket = settings(i.guildId).ticket.tickets[i.channelId];
      if (!ticket || ticket.status !== 'open' || (ticket.owner !== i.user.id && !support(i))) throw Error('เลือกหัวข้อได้เฉพาะเจ้าของตั๋วและทีมดูแลในห้องตั๋วที่เปิดอยู่');
      const payload = topicPayload(settings(i.guildId).ticket, type, i.user.id);
      i.detachedResponse = true;
      await i.deferUpdate();
      // Send a regular channel message; acknowledge the button without replying to its message.
      for (let offset = 0; offset < payload.content.length; offset += 2000) {
        await i.channel.send({ ...payload, content: payload.content.slice(offset, offset + 2000) });
      }
      return;
    }
    return ticketClose(i, action);
  }
  if (!i.customId?.startsWith('cfg:')) return;
  const [, kind, action, owner, nonce] = i.customId.split(':');
  if (!titles[kind] || !admin(i) || owner !== i.user.id) throw Error('กรุณาเปิดเมนูตั้งค่าของคุณเองด้วย slash command');
  const c = settings(i.guildId)[kind];
  if (['ticket', 'announce'].includes(kind) && await handleSentEdit(i, kind, action, nonce, { messagePayload, storeUpload })) return;
  if (kind === 'ticket' && action === 'questions') return i.showModal(responseEditor(i, c));
  if (kind === 'ticket' && action === 'website') return i.showModal(websiteEditor(i, c));
  if (kind === 'ticket' && action === 'savewebsite') {
    const value = i.fields.getTextInputValue('website').trim();
    if (value) {
      let url; try { url = new URL(value); } catch { throw Error('ใส่ลิงก์เว็บไซต์ที่ถูกต้อง เช่น https://example.com'); }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('ใช้ลิงก์เว็บไซต์ http หรือ https เท่านั้น');
    }
    c.website = value; save();
    return i.reply({ content: 'บันทึกเว็บไซต์แล้ว', flags: ephemeral });
  }
  if (kind === 'ticket' && action === 'saveresponses') {
    const next = {};
    for (const key of Object.keys(topics).filter(k => k !== 'info')) {
      const text = i.fields.getTextInputValue(key).trim();
      if (!text || text.length > 2000) throw Error('ข้อความต้องยาว 1–2000 ตัวอักษร');
      next[key] = text;
    }
    c.responses = next; save();
    return i.reply({ content: 'บันทึกข้อความตอบกลับแล้ว', flags: ephemeral });
  }
  if (action === 'edit') return i.showModal(editor(i, kind));
  if (action === 'save') {
    await i.deferReply({ flags: ephemeral });
    const color = i.fields.getTextInputValue('color').trim();
    if (!/^#[\da-f]{6}$/i.test(color)) throw Error('ใส่สี HEX 6 หลัก เช่น #5865F2');
    const updates = { title: i.fields.getTextInputValue('title').trim(), body: i.fields.getTextInputValue('body').trim(), color };
    if (!updates.title || !updates.body) throw Error('หัวข้อและข้อความต้องไม่ว่าง');
    for (const type of ['banner', 'logo']) { const file = i.fields.getUploadedFiles(type)?.first(); if (file) updates[type] = await storeUpload(file); }
    Object.assign(c, updates); save();
    return i.editReply({ content: '✅ บันทึกข้อความและรูปแล้ว', ...(await dashboard(i, kind)) });
  }
  if (action === 'preview') { await i.deferReply({ flags: ephemeral }); return i.editReply(await messagePayload(c, i.member, kind)); }
  if (action === 'confirm') {
    await i.deferReply({ flags: ephemeral });
    await target(i, c);
    for (const [key, value] of pending) if (value.expires < Date.now()) pending.delete(key);
    const key = randomUUID();
    pending.set(key, { config: structuredClone(c), expires: Date.now() + 600000 });
    return i.editReply({ ...(await messagePayload(c, i.member, kind)), content: `ส่ง${kind === 'ticket' ? 'แผง Ticket' : 'ประกาศ'}ไปยัง <#${c.channelId}> หรือไม่? (ยืนยันภายใน 10 นาที)`,
      components: [row(btn(`${actionId(kind, 'publish', i.user.id)}:${key}`, 'ยืนยันส่ง', Style.Success))] });
  }
  if (action === 'publish') {
    const lock = `${i.guildId}:${kind}`;
    if (publishing.has(lock)) throw Error('กำลังส่ง กรุณารอสักครู่');
    publishing.add(lock);
    try {
      await i.deferUpdate();
      const draft = pending.get(nonce);
      if (!draft || draft.expires < Date.now()) throw Error('รายการนี้ส่งแล้วหรือหมดอายุ กรุณาเปิดเมนูและยืนยันใหม่');
      const ch = await target(i, draft.config);
      if (kind === 'ticket' && (!c.enabled || !c.supportRoles.length)) throw Error('เลือกทีมดูแลและเปิดระบบ Ticket ก่อน');
      const payload = await messagePayload(draft.config, i.member, kind);
      if (kind === 'ticket') payload.components = ticketPanelButtons();
      const sent = await ch.send(payload);
      rememberMessage(i.guildId, kind, sent, draft.config);
      pending.delete(nonce);
      if (kind === 'ticket') { c.panelMessageId = sent.id; save(); }
      return i.editReply({ content: `✅ ส่งเรียบร้อย: ${sent.url}`, components: [] });
    } finally { publishing.delete(lock); }
  }
  await i.deferUpdate();
  if (action === 'channel') { const next = { ...c, channelId: i.values[0] }; await target(i, next); c.channelId = next.channelId; }
  if (action === 'roles') {
    const selected = await i.guild.roles.fetch();
    if (i.values.some(id => id === i.guildId || selected.get(id)?.name === 'AC' || selected.get(id)?.managed)) throw Error('เลือกเฉพาะยศทีมดูแล เช่น Admin หรือ Dev ห้ามเลือก AC, everyone หรือยศบอท');
    if (Object.values(c.tickets).some(t => t.status === 'open')) throw Error('ปิด Ticket ที่เปิดอยู่ก่อนเปลี่ยนทีมดูแล เพื่อให้สิทธิ์ห้องตรงกัน');
    c.supportRoles = i.values;
  }
  if (action === 'clear') { delete c.banner; delete c.logo; }
  if (action === 'toggle') {
    if (!c.enabled) {
      await target(i, c);
      if (kind === 'ticket') { if (!c.supportRoles.length) throw Error('เลือกยศทีมดูแลก่อน'); await category(i); }
      else if (!i.client.membersEnabled) throw Error('เปิด Server Members Intent ใน Developer Portal → Bot แล้วรีสตาร์ตบอทก่อน');
    }
    c.enabled = !c.enabled;
  }
  save();
  return i.editReply(await dashboard(i, kind));
}
export async function memberEvent(member, kind) {
  if (member.guild.id !== process.env.DISCORD_GUILD_ID) return;
  const c = settings(member.guild.id)[kind];
  if (!c.enabled || !c.channelId) return;
  const channel = await member.guild.channels.fetch(c.channelId);
  if (!channel?.isTextBased()) throw Error('Welcome/Goodbye destination unavailable');
  await channel.send(await messagePayload(c, member, kind));
}
export async function syncTicketPanels(guild, client) {
  const c = settings(guild.id).ticket;
  if (c.menuVersion === 2) return;
  c.title = 'สมัครเข้าสังกัด AC Entertainment';
  c.body = 'สนใจเข้าร่วมสังกัดหรือติดต่อทีมงาน กดปุ่มสมัครเข้าสังกัดเพื่อเปิดห้องส่วนตัวได้เลยครับ';
  const i = { guild, guildId: guild.id, client, member: guild.members.me };
  const channel = await target(i, c);
  const messages = await channel.messages.fetch({ limit: 100 });
  const panels = messages.filter(m => m.author.id === client.user.id && m.components.some(r => r.components.some(b => b.customId?.startsWith('ticket:open:'))));
  const payload = { ...(await messagePayload(c, guild.members.me, 'ticket')), components: ticketPanelButtons(), attachments: [] };
  for (const message of panels.values()) await message.edit(payload);
  if (panels.size) c.panelMessageId = panels.first().id;
  if (!panels.size) { const message = await channel.send(payload); c.panelMessageId = message.id; }
  for (const [id, ticket] of Object.entries(c.tickets)) {
    if (ticket.status !== 'open') continue;
    const room = await guild.channels.fetch(id).catch(e => { if (e.code === 10003) return null; throw e; });
    if (!room) { ticket.status = 'deleted'; continue; }
    const history = await room.messages.fetch({ limit: 100 });
    const menus = history.filter(m => m.author.id === client.user.id && m.components.some(r => r.components.some(b => b.customId?.startsWith('ticket:close:'))));
    for (const menu of menus.values()) await menu.edit({ components: ticketMenu(ticket.owner) });
    if (!menus.size) await room.send({ content: 'เลือกหัวข้อที่ต้องการติดต่อ แล้วพิมพ์ข้อมูลในห้องนี้ได้เลยครับ', components: ticketMenu(ticket.owner), allowedMentions: { parse: [] } });
  }
  c.menuVersion = 2; save();
  console.log(`Ticket panels updated: ${panels.size}; single entry button and six private topics ready.`);
}
export async function initialize(guild, client) {
  const c = settings(guild.id);
  if (c.initialized) return;
  const structure = JSON.parse(await readFile(join(DATA_DIR, 'server-setup.json'), 'utf8'));
  c.welcome.channelId ??= structure.channels['AC • INFORMATION/👋・ยินดีต้อนรับ'];
  c.goodbye.channelId ??= c.welcome.channelId;
  c.announce.channelId ??= structure.channels['AC • INFORMATION/📢・ประกาศ'];
  c.ticket.channelId ??= structure.channels['AC • CONTACT/📨・ติดต่อทีมงาน'];
  if (!c.ticket.supportRoles.length) c.ticket.supportRoles = [structure.roles.Admin];
  c.welcome.enabled = client.membersEnabled;
  c.goodbye.enabled = client.membersEnabled;
  const i = { guildId: guild.id, guild, client, member: guild.members.me, user: client.user };
  await category(i);
  const channel = await target(i, c.ticket);
  if (!c.ticket.panelMessageId) {
    const payload = await messagePayload(c.ticket, i.member, 'ticket');
    payload.components = ticketPanelButtons();
    const panel = await channel.send(payload);
    c.ticket.panelMessageId = panel.id;
    console.log(`Ticket panel ready: ${panel.url}`);
  }
  c.ticket.enabled = true;
  c.initialized = true;
  save();
}
