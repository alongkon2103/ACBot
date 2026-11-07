import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PermissionFlagsBits as P, ChannelType, Collection, EmbedBuilder } from 'discord.js';
const work = mkdtempSync(join(tmpdir(), 'ac-bot-test-'));
process.chdir(work);
process.env.DISCORD_GUILD_ID = 'guild';
const { handle, editor, messagePayload } = await import('../src/features.js');
const { settings, save } = await import('../src/store.js');
const { consolePayload, ensureConsole } = await import('../src/console.js');
const { ticketPanelButtons, ticketMenu, topics } = await import('../src/ticket-content.js');
const { initializeData } = await import('../src/data-paths.js');
const c = settings('guild');
const member = { id: 'visitor', user: { username: 'Guest', displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' }, guild: { name: 'AC Test', memberCount: 42 } };
function interaction(overrides = {}) {
  return { guildId: 'guild', user: { id: 'visitor' }, member, client: { user: { id: 'bot' }, membersEnabled: true },
    memberPermissions: { has: () => false }, isChatInputCommand: () => false,
    ...overrides };
}
test('all modals serialize with two native optional uploads', () => {
  for (const kind of ['welcome', 'goodbye', 'ticket', 'announce']) {
    const modal = editor(interaction(), kind).toJSON();
    assert.equal(modal.components.length, 5);
    assert.equal(modal.components[3].component.type, 19);
    assert.equal(modal.components[4].component.required, false);
  }
});
test('visitor cannot configure or impersonate an admin dashboard', async () => {
  await assert.rejects(handle(interaction({ isChatInputCommand: () => true, commandName: 'welcomeconfig' })), /Admin/);
  await assert.rejects(handle(interaction({ customId: 'cfg:welcome:edit:visitor' })), /slash command/);
});
test('admin dashboard validates all Discord components', async () => {
  for (const name of ['welcomeconfig', 'goodbyeconfig', 'ticketconfig', 'announce']) {
    await handle(interaction({ isChatInputCommand: () => true, commandName: name,
      memberPermissions: { has: () => true }, reply: async payload => {
        payload.embeds.forEach(e => e.toJSON());
        payload.components.forEach(r => r.toJSON());
        assert.equal(payload.flags, 64);
      } }));
  }
});
test('welcome replaces placeholders, bounds embed size and blocks mass mentions', async () => {
  const p = await messagePayload({ ...c.welcome, title: '{server}', body: '{user} {username} {count} @everyone' }, member, 'welcome');
  const embed = p.embeds[0].toJSON();
  assert.equal(embed.title, 'AC Test');
  assert.match(embed.description, /<@visitor> Guest 42/);
  assert.deepEqual(p.allowedMentions, { parse: [] });
});
test('ticket is private and one active ticket per visitor', async () => {
  Object.assign(c.ticket, { enabled: true, supportRoles: ['staff'], categoryId: 'category' });
  c.ticket.questions.join = [];
  let body, opened = false, messages = 0;
  const channel = { id: 'ticket1', send: async p => { p.embeds.forEach(e => e.toJSON()); p.components?.forEach(r => r.toJSON()); messages++; } };
  const guild = { channels: {
    fetch: async id => id ? { id, type: ChannelType.GuildCategory } : new Collection(opened ? [['ticket1', { topic: 'ac-ticket:visitor:open', toString: () => '<#ticket1>' }]] : []),
    create: async spec => { body = spec; opened = true; return channel; },
  } };
  const i = interaction({ guild, customId: 'ticket:open:join', deferReply: async () => {}, editReply: async () => {} });
  await handle(i);
  const everyone = body.permissionOverwrites.find(o => o.id === 'guild');
  assert.ok(everyone.deny.includes(P.ViewChannel));
  assert.deepEqual(body.permissionOverwrites.map(o => o.id).sort(), ['bot', 'guild', 'staff', 'visitor']);
  assert.equal(c.ticket.tickets.ticket1.owner, 'visitor');
  await handle(i);
  assert.equal(messages, 1);
});
test('outsider cannot close another member ticket', async () => {
  await assert.rejects(handle(interaction({ user: { id: 'outsider' }, channelId: 'ticket1', customId: 'ticket:close:visitor' })), /เจ้าของตั๋ว/);
});
test('closing deletes the channel and records success only after deletion', async () => {
  let deleted = false;
  await handle(interaction({ channelId: 'ticket1', customId: 'ticket:finish:visitor', deferUpdate: async () => {}, editReply: async () => {},
    channel: { delete: async () => { deleted = true; } } }));
  assert.equal(deleted, true);
  assert.equal(c.ticket.tickets.ticket1.status, 'deleted');
});
test('failed deletion leaves ticket open and retryable', async () => {
  c.ticket.tickets.failure = { owner: 'visitor', status: 'open' };
  await assert.rejects(handle(interaction({ channelId: 'failure', customId: 'ticket:finish:visitor', deferUpdate: async () => {}, editReply: async () => {},
    channel: { delete: async () => { throw Error('Missing Permissions'); } } })), /Missing Permissions/);
  assert.equal(c.ticket.tickets.failure.status, 'open');
});
test('announcement confirmation snapshots draft and is single-use', async () => {
  let confirmation, sent, count = 0;
  const destination = { type: ChannelType.GuildText, permissionsFor: () => ({ has: () => true }), send: async p => { sent = p; count++; return { id: '123', channelId: '456', url: 'https://discord.com/channels/guild/channel/message' }; } };
  const common = { memberPermissions: { has: () => true }, guild: { channels: { fetch: async () => destination }, members: { me: {} } } };
  c.announce.channelId = 'channel'; c.announce.body = 'Original';
  await handle(interaction({ ...common, customId: 'cfg:announce:confirm:visitor', deferReply: async () => {}, editReply: async p => { confirmation = p; } }));
  const id = confirmation.components[0].toJSON().components[0].custom_id;
  c.announce.body = 'Changed';
  const publish = interaction({ ...common, customId: id, deferUpdate: async () => {}, editReply: async () => {} });
  await handle(publish);
  assert.equal(sent.embeds[0].toJSON().description, 'Original');
  await assert.rejects(handle(publish), /หมดอายุ/);
  assert.equal(count, 1);
});
test('configuration and ticket state persist to disk', () => {
  save();
  const data = JSON.parse(readFileSync('data/bot.json', 'utf8'));
  assert.equal(data.guilds.guild.ticket.tickets.ticket1.status, 'deleted');
  assert.equal(data.guilds.guild.announce.channelId, 'channel');
});
test('console routes buttons to private settings and protects admin controls', async () => {
  await assert.rejects(handle(interaction({ customId: 'console:ticket' })), /Admin/);
  await assert.rejects(handle(interaction({ customId: 'console:questions' })), /Admin/);
  for (const action of ['welcome', 'goodbye', 'ticket', 'announce']) {
    await handle(interaction({ customId: `console:${action}`, memberPermissions: { has: () => true }, reply: async p => {
      assert.equal(p.flags, 64);
      assert.ok(p.embeds[0].toJSON().title.includes('⚙️'));
      p.components.forEach(r => r.toJSON());
    } }));
  }
  await handle(interaction({ customId: 'console:questions', memberPermissions: { has: () => true }, showModal: async m => {
    assert.equal(m.toJSON().components.length, 5);
  } }));
});
test('console counts actual active channels and edits existing message after restart', async () => {
  let sent = 0, edited = 0, pinned = 0;
  c.console = { channelId: 'console-channel' };
  const guild = { id: 'guild', memberCount: 42, channels: {
    cache: new Collection([['open', { topic: 'ac-ticket:1:open' }], ['closed', { topic: 'ac-ticket:2:closed' }]]),
    fetch: async () => ({ type: ChannelType.GuildText,
      messages: { edit: async () => { edited++; } },
      send: async p => { sent++; p.embeds[0].toJSON(); return { id: 'console-message', url: 'console-test', pin: async () => { pinned++; } }; },
    }),
  } };
  const client = { uptime: 3660000, ws: { ping: 50 }, membersEnabled: true };
  const payload = consolePayload(guild, client);
  assert.match(payload.embeds[0].toJSON().fields.find(f => f.name === 'Ticket').value, /\*\*1\*\*/);
  payload.components.forEach(r => r.toJSON());
  await ensureConsole(guild, client);
  await ensureConsole(guild, client);
  assert.equal(sent, 1); assert.equal(edited, 1); assert.equal(pinned, 1);
  assert.equal(c.console.messageId, 'console-message');
});
test('entry has only one button and private menu has six topics plus close', () => {
  const buttons = ticketPanelButtons().flatMap(r => r.toJSON().components);
  assert.equal(buttons.length, 1); assert.equal(buttons[0].label, 'สมัครเข้าสังกัด');
  const menu = ticketMenu('visitor').flatMap(r => r.toJSON().components);
  assert.equal(menu.length, 7);
  assert.deepEqual(menu.slice(0, 6).map(b => b.label), Object.values(topics).map(t => t[0]));
});
test('topic messages are plain standalone messages mentioning only the button user', async () => {
  c.ticket.tickets.topics = { owner: 'visitor', status: 'open' };
  for (const [key, [title, body]] of Object.entries(topics).filter(([key]) => key !== 'info')) {
    await handle(interaction({ channelId: 'topics', customId: `ticket:topic:${key}`, deferUpdate: async () => {}, channel: { send: async p => {
      assert.equal(p.content, `<@visitor> ${body}`);
      assert.equal(p.embeds, undefined);
      assert.equal(p.reply, undefined);
      assert.deepEqual(p.allowedMentions, { parse: [], users: ['visitor'] });
    } } }));
  }
  await assert.rejects(handle(interaction({ channelId: 'topics', user: { id: 'outsider' }, customId: 'ticket:topic:join' })), /เจ้าของตั๋ว/);
  await handle(interaction({ channelId: 'topics', customId: 'ticket:topic:info', deferUpdate: async () => {}, channel: { send: async p => { assert.match(p.content, /^<@visitor>/); assert.match(p.content, /ยังไม่ได้ตั้งค่า/); } } }));
  c.ticket.website = 'https://example.com/ac';
  await handle(interaction({ channelId: 'topics', customId: 'ticket:topic:info', deferUpdate: async () => {}, channel: { send: async p => { assert.ok(p.content.includes(c.ticket.website)); assert.equal(p.flags, 4); } } }));
});
test('ticket text and website settings work without slash commands', async () => {
  const common = { memberPermissions: { has: () => true } };
  await handle(interaction({ ...common, customId: 'cfg:ticket:questions:visitor', showModal: async m => { assert.equal(m.toJSON().components.length, 5); } }));
  await handle(interaction({ ...common, customId: 'cfg:ticket:website:visitor', showModal: async m => { assert.equal(m.toJSON().components[0].component.style, 1); } }));
  await assert.rejects(handle(interaction({ ...common, customId: 'cfg:ticket:savewebsite:visitor', fields: { getTextInputValue: () => 'javascript:alert(1)' } })), /http/);
});
function editFixture(kind = 'announce') {
  let edits = 0;
  const message = { id: '20', channelId: '10', author: { id: 'bot' }, content: '', editedTimestamp: null,
    url: 'https://discord.com/channels/guild/10/20', attachments: new Collection([['30', { id: '30', url: 'https://cdn.discordapp.com/attachments/10/30/banner.png?signature=a' }]]),
    embeds: [new EmbedBuilder().setTitle('Original title').setDescription('Original body').setColor('#72767D').setImage('https://cdn.discordapp.com/attachments/10/30/banner.png?signature=a').toJSON()],
    components: kind === 'ticket' ? [{ components: [{ customId: 'ticket:open:join' }] }] : [],
    edit: async p => { edits++; message.lastPayload = p; message.editedTimestamp = edits; return message; } };
  const channel = { isTextBased: () => true, messages: { fetch: async () => message }, send: async () => { throw Error('Must edit, not send'); } };
  const base = { memberPermissions: { has: () => true }, guild: { channels: { fetch: async () => channel } },
    deferReply: async () => {}, deferUpdate: async () => {}, editReply: async () => {} };
  const call = (action, extra = {}) => handle(interaction({ ...base, customId: `cfg:${kind}:${action}:visitor`, ...extra }));
  async function load() {
    let payload;
    await call('s_pick', { values: ['10/20'], editReply: async p => { payload = p; } });
    return payload.components[0].toJSON().components[0].custom_id.split(':')[4];
  }
  const sessionCall = (action, nonce, extra = {}) => call(action, { customId: `cfg:${kind}:${action}:visitor:${nonce}`, ...extra });
  return { message, call, load, sessionCall, edits: () => edits };
}
test('editing an old message preserves media and edits in place only after confirmation', async () => {
  const f = editFixture(); const nonce = await f.load();
  await f.sessionCall('s_edit', nonce, { showModal: async m => { assert.equal(m.toJSON().components.length, 5); } });
  await f.sessionCall('s_save', nonce, { fields: { getTextInputValue: k => ({ title: 'Updated title', body: 'Updated body', color: '#123456' })[k], getUploadedFiles: () => null } });
  assert.equal(f.edits(), 0);
  await f.sessionCall('s_preview', nonce, { editReply: async p => { assert.equal(p.embeds[0].toJSON().description, 'Updated body'); } });
  await f.sessionCall('s_apply', nonce);
  assert.equal(f.edits(), 1);
  assert.equal(f.message.lastPayload.embeds[0].toJSON().description, 'Updated body');
  assert.deepEqual(f.message.lastPayload.attachments, [{ id: '30' }]);
  assert.equal(settings('guild').sentMessages['20'].config.body, 'Updated body');
  await assert.rejects(f.sessionCall('s_apply', nonce), /หมดอายุ/);
});
test('ticket edits keep opening buttons and can remove old pictures', async () => {
  const f = editFixture('ticket'); const nonce = await f.load();
  await f.sessionCall('s_clear', nonce, { update: async () => {} });
  await f.sessionCall('s_preview', nonce);
  await f.sessionCall('s_apply', nonce);
  assert.deepEqual(f.message.lastPayload.components, f.message.components);
  assert.deepEqual(f.message.lastPayload.attachments, []);
  assert.equal(f.message.lastPayload.embeds[0].toJSON().image, undefined);
});
test('foreign authors and concurrent changes cannot be overwritten', async () => {
  const foreign = editFixture(); foreign.message.author.id = 'someone-else';
  await assert.rejects(foreign.load(), /บอทนี้ส่งเอง/);
  const f = editFixture(); const nonce = await f.load();
  await f.sessionCall('s_preview', nonce);
  f.message.editedTimestamp = 999;
  await assert.rejects(f.sessionCall('s_apply', nonce), /ผู้อื่นแก้ไขแล้ว/);
  assert.equal(f.edits(), 0);
});
test('deployment seeds settings and images once without overwriting runtime changes', () => {
  const seed = join(work, 'seed'); const runtime = join(work, 'runtime');
  mkdirSync(join(seed, 'assets'), { recursive: true });
  writeFileSync(join(seed, 'bot.json'), '{"version":1}');
  writeFileSync(join(seed, 'server-setup.json'), '{"guildId":"guild"}');
  writeFileSync(join(seed, 'assets', 'image.png'), 'seed-image');
  initializeData(runtime, seed);
  assert.equal(readFileSync(join(runtime, 'bot.json'), 'utf8'), '{"version":1}');
  assert.equal(readFileSync(join(runtime, 'assets', 'image.png'), 'utf8'), 'seed-image');
  writeFileSync(join(runtime, 'bot.json'), '{"version":2}');
  writeFileSync(join(runtime, 'assets', 'image.png'), 'new-image');
  initializeData(runtime, seed);
  assert.equal(readFileSync(join(runtime, 'bot.json'), 'utf8'), '{"version":2}');
  assert.equal(readFileSync(join(runtime, 'assets', 'image.png'), 'utf8'), 'new-image');
});
