const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  InteractionType
} = require('discord.js');

const fs = require('fs');
const config = require('./config.json');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
  partials: ['CHANNEL']
});

function saveReport(report) {
  const data = JSON.parse(fs.readFileSync('./reports.json'));
  data.push(report);
  fs.writeFileSync('./reports.json', JSON.stringify(data, null, 2));
}

client.once('ready', async () => {
  console.log(`🟢 Conectado como ${client.user.tag}`);

  const channel = await client.channels.fetch(config.panelChannelId);
  if (!channel) return;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ban_request')
      .setLabel('🚨 Solicitar Ban')
      .setStyle(ButtonStyle.Danger)
  );

  await channel.send({
    content: 'Pulsa el botón para enviar una **petición de ban**.\nTu identidad solo será visible para admins.',
    components: [row]
  });
});

client.on('interactionCreate', async interaction => {

  // BOTÓN
  if (interaction.isButton() && interaction.customId === 'ban_request') {
    const modal = new ModalBuilder()
      .setCustomId('ban_modal')
      .setTitle('Petición de Ban');

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('target')
          .setLabel('Usuario denunciado')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('Motivo')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('proof')
          .setLabel('Pruebas (links)')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
      )
    );

    return interaction.showModal(modal);
  }

  // ENVÍO DEL MODAL
  if (interaction.type === InteractionType.ModalSubmit && interaction.customId === 'ban_modal') {
    const report = {
      id: Date.now(),
      target: interaction.fields.getTextInputValue('target'),
      reason: interaction.fields.getTextInputValue('reason'),
      proof: interaction.fields.getTextInputValue('proof') || 'No aportadas',
      reporter: {
        id: interaction.user.id,
        tag: interaction.user.tag
      },
      status: 'Pendiente',
      timestamp: new Date().toISOString()
    };

    saveReport(report);

    const embed = new EmbedBuilder()
      .setTitle('📛 Nueva petición de ban')
      .setColor(0xff0000)
      .addFields(
        { name: 'Usuario denunciado', value: report.target },
        { name: 'Motivo', value: report.reason },
        { name: 'Pruebas', value: report.proof },
        { name: 'Reportado por', value: `${report.reporter.tag} (${report.reporter.id})` },
        { name: 'Estado', value: report.status }
      )
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`approve_${report.id}`)
        .setLabel('✅ Aprobar')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`reject_${report.id}`)
        .setLabel('❌ Rechazar')
        .setStyle(ButtonStyle.Secondary)
    );

    const logChannel = await client.channels.fetch(config.logChannelId);
    await logChannel.send({ embeds: [embed], components: [row] });

    await interaction.reply({
      content: '✅ Tu petición fue enviada correctamente.',
      ephemeral: true
    });

    try {
      await interaction.user.send('📨 Tu petición de ban ha sido recibida y está en revisión.');
    } catch {}
  }

  // BOTONES ADMIN
  if (
    interaction.isButton() &&
    (interaction.customId.startsWith('approve_') || interaction.customId.startsWith('reject_'))
  ) {

    if (!interaction.member.roles.cache.has(config.adminRoleId))
      return interaction.reply({ content: '❌ No tienes permisos.', ephemeral: true });

    const id = interaction.customId.split('_')[1];
    const data = JSON.parse(fs.readFileSync('./reports.json'));
    const report = data.find(r => r.id == id);

    if (!report)
      return interaction.reply({ content: 'Reporte no encontrado.', ephemeral: true });

    report.status = interaction.customId.startsWith('approve')
      ? 'Aprobado'
      : 'Rechazado';

    fs.writeFileSync('./reports.json', JSON.stringify(data, null, 2));

    const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
      .spliceFields(4, 1, { name: 'Estado', value: report.status });

    await interaction.update({
      embeds: [updatedEmbed],
      components: []
    });

    try {
      const user = await client.users.fetch(report.reporter.id);
      await user.send(`📢 Tu petición de ban fue **${report.status}**.`);
    } catch {}
  }
});

client.login(config.token);
 