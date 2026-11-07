import { Client, Events, GatewayIntentBits, MessageFlags, REST, Routes, ApplicationFlagsBitField } from 'discord.js';
import { commands, handle, memberEvent, initialize, syncTicketPanels } from './features.js';
import { ensureConsole } from './console.js';
const { DISCORD_TOKEN: token, DISCORD_CLIENT_ID: clientId, DISCORD_GUILD_ID: guildId } = process.env;
if (!token || !clientId || !guildId) { console.error('Missing configuration in .env'); process.exit(1); }
const rest = new REST().setToken(token);
const app = await rest.get(Routes.currentApplication());
const flags = new ApplicationFlagsBitField(app.flags);
const membersEnabled = flags.has('GatewayGuildMembers') || flags.has('GatewayGuildMembersLimited');
const client = new Client({ intents: [GatewayIntentBits.Guilds, ...(membersEnabled ? [GatewayIntentBits.GuildMembers] : [])] });
client.membersEnabled = membersEnabled;
client.once(Events.ClientReady, async ready => {
  try {
    if (ready.user.id !== clientId) throw Error('Token does not match client ID');
    const guild = await ready.guilds.fetch(guildId);
    for (const command of commands) await guild.commands.create(command.toJSON());
    await initialize(guild, ready);
    await syncTicketPanels(guild, ready);
    await ensureConsole(guild, ready);
    setInterval(() => ensureConsole(guild, ready).catch(e => console.error(`Console update failed: ${e.message}`)), 60000).unref();
    console.log(`Online as ${ready.user.tag}; ${guild.name}; ${commands.length} commands ready; member events: ${membersEnabled ? 'enabled' : 'DISABLED - enable Server Members Intent in Developer Portal and restart'}`);
    if (process.send) process.send('ready');
  } catch (e) { console.error(`Startup failed: ${e.message}`); client.destroy(); process.exitCode = 1; }
});
client.on(Events.InteractionCreate, async i => {
  try { await handle(i); }
  catch (e) {
    console.error(`Interaction failed (${i.commandName ?? i.customId}): ${e.message}`);
    const content = `⚠️ ${e.code ? 'Discord ไม่อนุญาตให้ทำรายการนี้ กรุณาตรวจสิทธิ์บอทและห้องที่เลือก' : e.message}`;
    try {
      if (i.detachedResponse && i.deferred) await i.followUp({ content, flags: MessageFlags.Ephemeral });
      else if (i.deferred && !i.replied) await i.editReply({ content, components: [], embeds: [] });
      else if (i.replied) await i.followUp({ content, flags: MessageFlags.Ephemeral });
      else await i.reply({ content, flags: MessageFlags.Ephemeral });
    } catch (replyError) { console.error(`Error reply failed: ${replyError.message}`); }
  }
});
for (const [event, kind] of [[Events.GuildMemberAdd, 'welcome'], [Events.GuildMemberRemove, 'goodbye']]) {
  client.on(event, m => memberEvent(m, kind).catch(e => console.error(`${kind} failed: ${e.message}`)));
}
client.on(Events.Error, e => console.error(`Discord error: ${e.message}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { client.destroy(); process.exit(0); });
client.login(token).catch(() => { console.error('Discord login failed; check token/network'); client.destroy(); process.exitCode = 1; });
