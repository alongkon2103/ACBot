import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder } from 'discord.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR } from './data-paths.js';
import { settings, save } from './store.js';
const updating = new Set();
export function consolePayload(guild, client) {
  const c = settings(guild.id);
  const status = key => `${c[key].enabled ? 'เปิด' : 'ปิด'}${['welcome', 'goodbye'].includes(key) && !client.membersEnabled ? ' (รอเปิด Intent)' : ''}`;
  const active = guild.channels.cache.filter(ch => ch.topic?.startsWith('ac-ticket:') && ch.topic.endsWith(':open')).size;
  const embed = new EmbedBuilder().setColor('#72767D').setTitle('AC Control Panel')
    .setDescription('เลือกเมนูด้านล่างเพื่อตั้งค่าระบบ')
    .addFields(
      { name: 'สถานะ', value: `ออนไลน์ · ${client.ws.ping >= 0 ? Math.round(client.ws.ping) + ' ms' : 'กำลังเชื่อมต่อ'}`, inline: true },
      { name: 'สมาชิก', value: `${guild.memberCount.toLocaleString('en-US')} คน`, inline: true },
      { name: 'Ticket', value: `${status('ticket')} · **${active}** ตั๋ว`, inline: true },
      { name: 'ข้อความอัตโนมัติ', value: `Welcome: ${status('welcome')}  ·  Goodbye: ${status('goodbye')}` },
    ).setFooter({ text: 'อัปเดตทุก 1 นาที' }).setTimestamp();
  const button = (id, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(`console:${id}`).setLabel(label).setStyle(style);
  return { embeds: [embed], allowedMentions: { parse: [] }, components: [
    new ActionRowBuilder().addComponents(button('welcome', 'Welcome'), button('goodbye', 'Goodbye'), button('ticket', 'Ticket'), button('announce', 'ประกาศ')),
    new ActionRowBuilder().addComponents(button('questions', 'ข้อความ Ticket'), button('help', 'วิธีใช้งาน'), button('refresh', 'รีเฟรช')),
  ] };
}
export async function ensureConsole(guild, client) {
  if (updating.has(guild.id)) return;
  updating.add(guild.id);
  try {
    const c = settings(guild.id);
    c.console ??= {};
    if (!c.console.channelId) {
      const structure = JSON.parse(await readFile(join(DATA_DIR, 'server-setup.json'), 'utf8'));
      c.console.channelId = structure.channels['AC • DEVELOPMENT/💻・ห้องพัฒนา'];
    }
    const channel = await guild.channels.fetch(c.console.channelId);
    if (channel?.type !== ChannelType.GuildText) throw Error('Control console destination is unavailable');
    const payload = consolePayload(guild, client);
    if (c.console.messageId) {
      try {
        await channel.messages.edit(c.console.messageId, payload);
        return;
      } catch (e) { if (e.code !== 10008) throw e; }
    }
    const message = await channel.send(payload);
    c.console.messageId = message.id; save();
    await message.pin().catch(e => console.error(`Console pin failed: ${e.message}`));
    console.log(`Control console ready: ${message.url}`);
  } finally { updating.delete(guild.id); }
}
