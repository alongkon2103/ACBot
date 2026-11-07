import { Client, Events, GatewayIntentBits, ChannelType, EmbedBuilder, AttachmentBuilder, PermissionFlagsBits as P } from 'discord.js';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { handle } from '../src/features.js';
import { ticketPanelButtons } from '../src/ticket-content.js';
import { settings, save } from '../src/store.js';
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const ready = once(client, Events.ClientReady);
await client.login(process.env.DISCORD_TOKEN); await ready;
let room; const ids = [];
const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
try {
  room = await guild.channels.create({ name: 'private-editor-test', type: ChannelType.GuildText,
    permissionOverwrites: [{ id: guild.id, deny: [P.ViewChannel] }, { id: client.user.id, allow: [P.ViewChannel, P.SendMessages, P.AttachFiles, P.EmbedLinks] }] });
  for (const kind of ['ticket', 'announce']) {
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
    const original = await room.send({ embeds: [new EmbedBuilder().setTitle('Editor test').setDescription('Before edit').setImage('attachment://banner.png')],
      files: [new AttachmentBuilder(image, { name: 'banner.png' })], components: kind === 'ticket' ? ticketPanelButtons() : [] });
    ids.push(original.id);
    const originalMedia = await fetch(original.embeds[0].image.url, { signal: AbortSignal.timeout(15000) });
    console.log('Original image fetch status:', originalMedia.status);
    await originalMedia.arrayBuffer();
    const base = { guildId: guild.id, guild, client, member: guild.members.me, user: client.user,
      memberPermissions: guild.members.me.permissions, isChatInputCommand: () => false,
      deferReply: async () => {}, deferUpdate: async () => {}, editReply: async () => {} };
    let nonce;
    await handle({ ...base, customId: `cfg:${kind}:s_pick:${client.user.id}`, values: [`${room.id}/${original.id}`], editReply: async p => { nonce = p.components[0].toJSON().components[0].custom_id.split(':')[4]; } });
    const cmd = action => `cfg:${kind}:${action}:${client.user.id}:${nonce}`;
    await handle({ ...base, customId: cmd('s_save'), fields: { getTextInputValue: k => ({ title: 'Editor test updated', body: 'After edit', color: '#72767D' })[k], getUploadedFiles: () => null } });
    await handle({ ...base, customId: cmd('s_preview') });
    await handle({ ...base, customId: cmd('s_apply') });
    const edited = await room.messages.fetch({ message: original.id, force: true });
    assert.equal(edited.embeds[0].description, 'After edit');
    assert.equal(edited.embeds[0].image.url.split('?')[0], original.embeds[0].image.url.split('?')[0]);
    const media = await fetch(edited.embeds[0].image.url, { signal: AbortSignal.timeout(15000) });
    console.log('Edited image fetch status:', media.status);
    assert.equal(media.status, originalMedia.status);
    await media.arrayBuffer();
    assert.equal(edited.components.length, kind === 'ticket' ? 1 : 0);
    console.log(`Live ${kind}: same message updated; image and buttons preserved.`);
  }
} finally {
  if (room) await room.delete('Remove temporary editor test');
  for (const id of ids) delete settings(guild.id).sentMessages?.[id];
  save(); client.destroy();
}
