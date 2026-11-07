// Explicit live smoke test: creates a private test ticket, verifies it, then removes it.
import { Client, Events, GatewayIntentBits, PermissionFlagsBits as P } from 'discord.js';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { handle, messagePayload } from '../src/features.js';
import { settings, save } from '../src/store.js';
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const ready = once(client, Events.ClientReady);
await client.login(process.env.DISCORD_TOKEN);
await ready;
let channel;
const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
const c = settings(guild.id);
try {
  await guild.roles.fetch();
  const owner = await guild.members.fetch(guild.ownerId);
  // No notifications: replace the send method on the newly-created test channel.
  const create = guild.channels.create.bind(guild.channels);
  guild.channels.create = async spec => {
    channel = await create(spec);
    const send = channel.send.bind(channel);
    channel.send = p => send({ ...p, allowedMentions: { parse: [] } });
    return channel;
  };
  const i = { guildId: guild.id, guild, client, user: owner.user, member: owner,
    memberPermissions: owner.permissions, isChatInputCommand: () => false,
    customId: 'ticket:open:help', deferReply: async () => {}, editReply: async () => {} };
  let modalId;
  await handle({ ...i, showModal: async modal => { modalId = modal.toJSON().custom_id; } });
  if (modalId) await handle({ ...i, customId: modalId, fields: { getTextInputValue: () => 'Smoke test — temporary' } });
  assert.ok(channel, 'Test owner already has an active ticket; no test channel created');
  const live = await channel.fetch();
  assert.equal(live.permissionsFor(guild.roles.everyone).has(P.ViewChannel), false);
  const ac = guild.roles.cache.find(r => r.name === 'AC');
  assert.equal(live.permissionsFor(ac).has(P.ViewChannel), false);
  for (const id of c.ticket.supportRoles) assert.equal(live.permissionsFor(id).has(P.ViewChannel), true);
  console.log('Live ticket created; visitor and AC hidden; support visible.');
  const preview = await messagePayload(c.welcome, owner, 'welcome');
  const sent = await channel.send(preview);
  assert.equal(sent.embeds.length, 1);
  await handle({ ...i, channelId: channel.id, channel, customId: `ticket:finish:${owner.id}`, deferUpdate: async () => {} });
  await assert.rejects(guild.channels.fetch(channel.id, { force: true }), e => e.code === 10003);
  assert.equal(c.ticket.tickets[channel.id].status, 'deleted');
  console.log('Live welcome embed sent; closing deleted the test ticket successfully.');
  delete c.ticket.tickets[channel.id]; save(); channel = null;
} finally {
  if (channel) {
    await channel.delete('Remove temporary bot smoke-test ticket').catch(e => { if (e.code !== 10003) throw e; });
    delete c.ticket.tickets[channel.id]; save();
    console.log('Temporary test channel removed.');
  }
  client.destroy();
}
