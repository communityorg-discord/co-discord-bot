// COMMAND_PERMISSION_FALLBACK: everyone
// Reusable text snippets — save common responses (helpdesk replies,
// FAQs, boilerplate) and recall them later with /snippet use name:X.
// Personal scope by default; superusers can save/edit shared snippets
// visible to everyone.
import {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
} from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { db } from '../utils/botDb.js';
import { isSuperuser } from '../utils/permissions.js';
import { E } from '../lib/emoji.js';

export const data = new SlashCommandBuilder()
  .setName('snippet')
  .setDescription('Save and reuse text snippets')
  .addSubcommand(s => s.setName('save').setDescription('Save a new snippet (opens modal)')
    .addStringOption(o => o.setName('name').setDescription('Name (lowercase, no spaces)').setRequired(true).setMinLength(2).setMaxLength(40))
    .addBooleanOption(o => o.setName('shared').setDescription('Save as a shared snippet (superuser only)')))
  .addSubcommand(s => s.setName('use').setDescription('Post a snippet in this channel')
    .addStringOption(o => o.setName('name').setDescription('Snippet name').setRequired(true).setAutocomplete(true))
    .addBooleanOption(o => o.setName('public').setDescription('Post visibly (default: ephemeral)')))
  .addSubcommand(s => s.setName('list').setDescription('List your snippets + shared ones'))
  .addSubcommand(s => s.setName('delete').setDescription('Delete one of your snippets')
    .addStringOption(o => o.setName('name').setDescription('Snippet name').setRequired(true).setAutocomplete(true)));

function findSnippet(ownerId, name) {
  // Prefer personal snippet; fall back to shared
  const lc = name.toLowerCase();
  const personal = db.prepare('SELECT * FROM snippets WHERE owner_id = ? AND lower(name) = ?').get(ownerId, lc);
  if (personal) return { ...personal, scope: 'personal' };
  const shared = db.prepare('SELECT * FROM snippets WHERE owner_id IS NULL AND lower(name) = ?').get(lc);
  if (shared) return { ...shared, scope: 'shared' };
  return null;
}

export async function execute(interaction) {
  const perm = await canUseCommand('snippet', interaction);
  if (!perm.allowed) {
    return interaction.reply({ content: `${E.cross} ${perm.reason}`, ephemeral: true });
  }
  const sub = interaction.options.getSubcommand();

  if (sub === 'save') {
    const name = interaction.options.getString('name').trim().toLowerCase();
    const shared = interaction.options.getBoolean('shared') || false;
    if (shared && !isSuperuser(interaction.user.id)) {
      return interaction.reply({ content: `${E.cross} Only superusers can save shared snippets.`, ephemeral: true });
    }
    if (!/^[a-z0-9._-]+$/.test(name)) {
      return interaction.reply({ content: `${E.cross} Name must be lowercase letters/numbers/\`-\`/\`_\`/\`.\``, ephemeral: true });
    }
    const ownerId = shared ? null : interaction.user.id;
    const existing = ownerId
      ? db.prepare('SELECT id, content FROM snippets WHERE owner_id = ? AND name = ?').get(ownerId, name)
      : db.prepare('SELECT id, content FROM snippets WHERE owner_id IS NULL AND name = ?').get(name);

    const modal = new ModalBuilder()
      .setCustomId(`snippet_save:${shared ? 'shared' : 'personal'}:${name}`)
      .setTitle(`${existing ? 'Edit' : 'Save'} snippet "${name}"`);
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('content').setLabel('Snippet content (markdown OK · 1900 max)')
          .setStyle(TextInputStyle.Paragraph).setMaxLength(1900).setRequired(true)
          .setValue(existing?.content || ''),
      ),
    );
    await interaction.showModal(modal);
    return;
  }

  if (sub === 'use') {
    const name = interaction.options.getString('name').trim().toLowerCase();
    const isPublic = interaction.options.getBoolean('public') || false;
    const sn = findSnippet(interaction.user.id, name);
    if (!sn) {
      return interaction.reply({ content: `${E.cross} No snippet named \`${name}\` (yours or shared).`, ephemeral: true });
    }
    db.prepare('UPDATE snippets SET use_count = use_count + 1 WHERE id = ?').run(sn.id);
    await interaction.reply({
      content: sn.content,
      ephemeral: !isPublic,
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (sub === 'list') {
    const personal = db.prepare('SELECT name, use_count FROM snippets WHERE owner_id = ? ORDER BY name').all(interaction.user.id);
    const shared = db.prepare('SELECT name, use_count FROM snippets WHERE owner_id IS NULL ORDER BY name').all();
    const embed = new EmbedBuilder()
      .setTitle('Snippets')
      .setColor(0x6366f1)
      .addFields(
        {
          name: `Yours (${personal.length})`,
          value: personal.length ? personal.map(s => `\`${s.name}\` · used ${s.use_count}×`).join('\n').slice(0, 1024) : '_None — use `/snippet save` to add._',
          inline: false,
        },
        {
          name: `Shared (${shared.length})`,
          value: shared.length ? shared.map(s => `\`${s.name}\` · used ${s.use_count}×`).join('\n').slice(0, 1024) : '_None._',
          inline: false,
        },
      )
      .setFooter({ text: 'Use /snippet use name:<x> to post · personal beats shared on name conflict' });
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (sub === 'delete') {
    const name = interaction.options.getString('name').trim().toLowerCase();
    const r = db.prepare('DELETE FROM snippets WHERE owner_id = ? AND name = ?').run(interaction.user.id, name);
    if (r.changes > 0) {
      return interaction.reply({ content: `Deleted \`${name}\`.`, ephemeral: true });
    }
    // Maybe it's a shared one and the user is a superuser
    if (isSuperuser(interaction.user.id)) {
      const r2 = db.prepare('DELETE FROM snippets WHERE owner_id IS NULL AND name = ?').run(name);
      if (r2.changes > 0) {
        return interaction.reply({ content: `Deleted shared \`${name}\`.`, ephemeral: true });
      }
    }
    return interaction.reply({ content: `${E.cross} No snippet of yours named \`${name}\`.`, ephemeral: true });
  }
}

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused();
  const q = focused.toLowerCase();
  const matches = db.prepare(`
    SELECT name, owner_id FROM snippets
    WHERE (owner_id = ? OR owner_id IS NULL) AND lower(name) LIKE ?
    ORDER BY (owner_id IS NULL) ASC, use_count DESC, name ASC
    LIMIT 25
  `).all(interaction.user.id, `%${q}%`);
  await interaction.respond(matches.map(m => ({
    name: `${m.name}${m.owner_id == null ? ' (shared)' : ''}`,
    value: m.name,
  })));
}

export async function handleModalSubmit(interaction) {
  if (!interaction.customId.startsWith('snippet_save:')) return false;
  const [, scope, name] = interaction.customId.split(':');
  const content = interaction.fields.getTextInputValue('content');
  const ownerId = scope === 'shared' ? null : interaction.user.id;

  // UPSERT — update if exists, insert otherwise
  const existing = ownerId
    ? db.prepare('SELECT id FROM snippets WHERE owner_id = ? AND name = ?').get(ownerId, name)
    : db.prepare('SELECT id FROM snippets WHERE owner_id IS NULL AND name = ?').get(name);

  if (existing) {
    db.prepare('UPDATE snippets SET content = ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\', \'now\') WHERE id = ?')
      .run(content, existing.id);
    await interaction.reply({ content: `Updated ${scope === 'shared' ? 'shared ' : ''}snippet \`${name}\`.`, ephemeral: true });
  } else {
    db.prepare('INSERT INTO snippets (owner_id, name, content) VALUES (?, ?, ?)').run(ownerId, name, content);
    await interaction.reply({ content: `${E.check} Saved ${scope === 'shared' ? 'shared ' : ''}snippet \`${name}\`. Use it with \`/snippet use name:${name}\`.`, ephemeral: true });
  }
  return true;
}
