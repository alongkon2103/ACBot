import { ActionRowBuilder as Row, ButtonBuilder, ButtonStyle, EmbedBuilder, FileUploadBuilder, LabelBuilder, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, MessageFlags } from 'discord.js';
import { randomUUID } from 'node:crypto';
import { settings, save } from './store.js';
const sessions = new Map();
const busy = new Set();
const button = (id, title) => new ButtonBuilder().setCustomId(id).setLabel(title).setStyle(ButtonStyle.Secondary);
const row = (...items) => new Row().addComponents(items);
const id = (kind, action, owner, nonce) => `cfg:${kind}:${action}:${owner}${nonce ? ':' + nonce : ''}`;
export function rememberMessage(guildId, kind, message, config) {
  const c = settings(guildId);
  c.sentMessages ??= {};
  const presentation = Object.fromEntries(['title', 'body', 'color', 'banner', 'logo', 'bannerUrl', 'logoUrl'].filter(k => config[k] !== undefined).map(k => [k, config[k]]));
  c.sentMessages[message.id] = { kind, messageId: message.id, channelId: message.channelId, title: config.title, config: presentation, updatedAt: new Date().toISOString() };
  save();
}
async function resolveMessage(i, kind, channelId, messageId) {
  const channel = await i.guild.channels.fetch(channelId);
  if (!channel?.isTextBased()) throw Error('ไม่พบห้องข้อความเดิม');
  const message = await channel.messages.fetch(messageId);
  if (message.author.id !== i.client.user.id || message.webhookId) throw Error('แก้ได้เฉพาะข้อความที่บอทนี้ส่งเอง');
  const isPanel = message.components.some(r => r.components.some(b => b.customId?.startsWith('ticket:open:')));
  if (kind === 'ticket' && !isPanel) throw Error('ข้อความนี้ไม่ใช่แผงเปิด Ticket');
  if (kind === 'announce' && (message.components.length || !message.embeds.length || /Welcome aboard|See you again/.test(message.embeds[0]?.footer?.text ?? ''))) throw Error('เลือกข้อความประกาศของบอทเท่านั้น');
  return message;
}
function view(i, kind, nonce, session) {
  const action = name => id(kind, name, i.user.id, nonce);
  return { content: `กำลังแก้ไข [ข้อความเดิม](https://discord.com/channels/${i.guildId}/${session.channelId}/${session.messageId})\nบันทึกฉบับแก้ไขก่อน แล้วกดดูตัวอย่างและยืนยันอัปเดต`,
    embeds: [new EmbedBuilder().setColor('#72767D').setTitle(session.config.title)],
    components: [row(button(action('s_edit'), 'ข้อความและรูป'), button(action('s_clear'), 'ล้างรูป'), button(action('s_preview'), 'ดูตัวอย่างและยืนยัน'), button(action('s_cancel'), 'ยกเลิก'))], allowedMentions: { parse: [] } };
}
function modal(i, kind, nonce, config) {
  const text = (key, label, value, max, style) => new LabelBuilder().setLabel(label).setTextInputComponent(new TextInputBuilder().setCustomId(key).setStyle(style).setValue(value).setRequired(true).setMaxLength(max));
  const upload = (key, title) => new LabelBuilder().setLabel(title).setDescription('ไม่เลือกไฟล์ = เก็บรูปเดิม • PNG/JPG/GIF/WebP ไม่เกิน 8 MB').setFileUploadComponent(new FileUploadBuilder().setCustomId(key).setRequired(false).setMinValues(0).setMaxValues(1));
  return new ModalBuilder().setCustomId(id(kind, 's_save', i.user.id, nonce)).setTitle('แก้ไขข้อความเดิม').addLabelComponents(
    text('title', 'หัวข้อ', config.title, 256, TextInputStyle.Short), text('body', 'ข้อความ', config.body, 4000, TextInputStyle.Paragraph),
    text('color', 'สี HEX เช่น #72767D', config.color, 7, TextInputStyle.Short), upload('banner', 'รูปแบนเนอร์'), upload('logo', 'โลโก้'));
}
async function load(i, kind, channelId, messageId) {
  const message = await resolveMessage(i, kind, channelId, messageId);
  const embed = message.embeds[0];
  if (!embed?.title || !embed?.description) throw Error('ข้อความนี้ไม่มีหัวข้อหรือเนื้อหาที่แก้ไขได้');
  // Load the current live text, rather than a possibly stale global draft.
  const config = { title: embed.title, body: embed.description, color: '#' + (embed.color ?? 0x72767d).toString(16).padStart(6, '0') };
  for (const type of ['banner', 'logo']) {
    const url = type === 'banner' ? embed.image?.url : embed.thumbnail?.url;
    if (url) config[`${type}Url`] = url;
  }
  for (const [key, value] of sessions) if (value.expires < Date.now()) sessions.delete(key);
  const nonce = randomUUID();
  const session = { guildId: i.guildId, owner: i.user.id, kind, channelId, messageId, config, originalTimestamp: message.editedTimestamp ?? null,
    expires: Date.now() + 1800000 };
  sessions.set(nonce, session);
  await i.editReply(view(i, kind, nonce, session));
}
export async function handleSentEdit(i, kind, action, nonce, { messagePayload, storeUpload }) {
  if (!action.startsWith('s_')) return false;
  const c = settings(i.guildId);
  if (action === 's_list') {
    const records = Object.values(c.sentMessages ?? {}).filter(r => r.kind === kind).reverse().slice(0, 25);
    if (kind === 'ticket' && c.ticket.panelMessageId && !records.some(r => r.messageId === c.ticket.panelMessageId)) records.unshift({ kind, messageId: c.ticket.panelMessageId, channelId: c.ticket.channelId, title: 'แผง Ticket ปัจจุบัน' });
    if (!records.length) { await i.reply({ content: 'ยังไม่มีประวัติที่บันทึกไว้ ใช้ปุ่ม “เลือกจากลิงก์” สำหรับข้อความเก่าได้ครับ', flags: MessageFlags.Ephemeral }); return true; }
    await i.reply({ content: 'เลือกข้อความที่ต้องการแก้ไข (สูงสุด 25 รายการล่าสุด)', flags: MessageFlags.Ephemeral,
      components: [row(new StringSelectMenuBuilder().setCustomId(id(kind, 's_pick', i.user.id)).setPlaceholder('เลือกข้อความเดิม').addOptions(records.slice(0, 25).map(r => ({ label: r.title.slice(0, 100), description: `ข้อความ ${r.messageId}`, value: `${r.channelId}/${r.messageId}` }))))] });
    return true;
  }
  if (action === 's_link') {
    await i.showModal(new ModalBuilder().setCustomId(id(kind, 's_load', i.user.id)).setTitle('เลือกข้อความจากลิงก์').addLabelComponents(
      new LabelBuilder().setLabel('ลิงก์ข้อความ Discord').setDescription('คลิกขวาที่ข้อความเดิม → Copy Message Link').setTextInputComponent(new TextInputBuilder().setCustomId('link').setStyle(TextInputStyle.Short).setMaxLength(300).setRequired(true))));
    return true;
  }
  if (action === 's_load' || action === 's_pick') {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    let channelId, messageId;
    if (action === 's_pick') {
      const parts = i.values[0]?.match(/^(\d+)\/(\d+)$/);
      if (!parts) throw Error('กรุณาเลือกข้อความใหม่');
      [, channelId, messageId] = parts;
    } else {
      const link = i.fields.getTextInputValue('link').trim();
      const parts = link.match(/^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)\/?$/);
      if (!parts || parts[1] !== i.guildId) throw Error('ใช้ลิงก์ข้อความในเซิร์ฟเวอร์นี้เท่านั้น');
      [, , channelId, messageId] = parts;
    }
    await load(i, kind, channelId, messageId); return true;
  }
  const session = sessions.get(nonce);
  if (!session || session.expires < Date.now() || session.owner !== i.user.id || session.guildId !== i.guildId || session.kind !== kind) throw Error('หน้าต่างแก้ไขหมดอายุ กรุณาเลือกข้อความเดิมใหม่');
  if (action === 's_edit') { await i.showModal(modal(i, kind, nonce, session.config)); return true; }
  if (action === 's_cancel') { sessions.delete(nonce); await i.update({ content: 'ยกเลิกแล้ว ข้อความเดิมไม่ได้เปลี่ยน', embeds: [], components: [] }); return true; }
  if (action === 's_save') {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const config = { ...session.config, title: i.fields.getTextInputValue('title').trim(), body: i.fields.getTextInputValue('body').trim(), color: i.fields.getTextInputValue('color').trim() };
    if (!config.title || !config.body || !/^#[\da-f]{6}$/i.test(config.color)) throw Error('ใส่หัวข้อ ข้อความ และสี HEX 6 หลักให้ถูกต้อง');
    for (const type of ['banner', 'logo']) { const file = i.fields.getUploadedFiles(type)?.first(); if (file) { config[type] = await storeUpload(file); delete config[`${type}Url`]; } }
    session.config = config;
    delete session.confirmedConfig;
    await i.editReply(view(i, kind, nonce, session)); return true;
  }
  if (action === 's_clear') {
    for (const key of ['banner', 'logo', 'bannerUrl', 'logoUrl']) delete session.config[key];
    delete session.confirmedConfig;
    await i.update(view(i, kind, nonce, session)); return true;
  }
  if (action === 's_preview') {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    session.confirmedConfig = structuredClone(session.config);
    await i.editReply({ ...(await messagePayload(session.confirmedConfig, i.member, kind)), content: 'ตัวอย่างฉบับแก้ไข — กดยืนยันเพื่อแทนที่ข้อความเดิม',
      components: [row(button(id(kind, 's_apply', i.user.id, nonce), 'ยืนยันอัปเดตข้อความเดิม'))] }); return true;
  }
  if (action === 's_apply') {
    const lock = `${i.guildId}:${session.messageId}`;
    if (busy.has(lock)) throw Error('กำลังอัปเดตข้อความนี้ กรุณารอสักครู่');
    busy.add(lock);
    try {
      await i.deferUpdate();
      if (!session.confirmedConfig) throw Error('ดูตัวอย่างฉบับล่าสุดก่อนยืนยัน');
      const message = await resolveMessage(i, kind, session.channelId, session.messageId);
      if ((message.editedTimestamp ?? null) !== session.originalTimestamp) throw Error('ข้อความนี้มีผู้อื่นแก้ไขแล้ว กรุณาเลือกข้อความใหม่เพื่อโหลดฉบับล่าสุด');
      const config = session.confirmedConfig;
      const payload = await messagePayload(config, i.member, kind);
      const urls = [config.bannerUrl, config.logoUrl].filter(Boolean).map(url => url.split('?')[0]);
      payload.attachments = [...message.attachments.values()].filter(a => urls.includes(a.url.split('?')[0]) || urls.includes(`attachment://${a.name}`)).map(a => ({ id: a.id }));
      // Discord can omit embed-only uploads from the attachment collection.
      // Omitting the field preserves those files while their image URLs are still in use.
      if (urls.length && !message.attachments.size) delete payload.attachments;
      // Preserve non-image content and the working Ticket buttons on the original message.
      if (kind === 'ticket') payload.components = message.components;
      const updated = await message.edit(payload);
      rememberMessage(i.guildId, kind, updated, config);
      save(); sessions.delete(nonce);
      await i.editReply({ content: `อัปเดตข้อความเดิมแล้ว: ${updated.url}`, embeds: [], components: [], attachments: [] });
      return true;
    } finally { busy.delete(lock); }
  }
  throw Error('ไม่พบเมนูแก้ไขนี้');
}
