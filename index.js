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

//CONFIG IN THE SERVER.
const config = {

  token: process.env.DISCORD_TOKEN,
  panelChannelId: process.env.PANEL_CHANNEL_ID,
  logChannelId: process.env.LOG_CHANNEL_ID,
  adminRoleId: process.env.ADMIN_ROLE_ID

}


const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
  partials: ['CHANNEL']
});

function saveReport(report) {
  const data = JSON.parse(fs.readFileSync('./reports.json'));
  data.push(report);
  fs.writeFileSync('./reports.json', JSON.stringify(data, null, 2));
}

function canSubmitReport(userID){

  const data = JSON.parse(fs.readFileSync('./reports.json'));
  const now = Date.now();
  const cooldown = 24*60*60*1000;
  const lastReport = data
    .filter(r => r.reporter.id === userID)
    .sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp))[0];

  if (!lastReport) return true;

  return now - new Date(lastReport.timestamp).getTime() > cooldown;

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
    content: 
      'Pulsa el botón para enviar una **petición de ban**.\n' +
      '⏳ Máximo **1 petición cada 24h**.\n' +
      '🔒 Tu identidad solo será visible para admins.',
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

    if (!canSubmitReport(interaction.user.id)){

      return interaction.reply({
        content: '⏳ Ya has enviado una petición de ban en las últimas **24 horas**.',
        ephemeral: true
      });

    }

    const report = {
      id: Date.now(),
      target: interaction.fields.getTextInputValue('target'),
      reason: interaction.fields.getTextInputValue('reason'),
      proof: interaction.fields.getTextInputValue('proof') || 'No aportadas',
      reporter: {
        id: interaction.user.id,
        tag: interaction.user.tag
      },
      status: 'En votacion...',
      votes: {
        approve: [],
        reject: []
      },
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
        { name: 'Estado', value: 'En votacion \n👍 0 | 👎 0'}
      )
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
       new ButtonBuilder()
        .setCustomId(`vote_yes_${report.id}`)
        .setLabel('👍 A favor')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`vote_no_${report.id}`)
        .setLabel('👎 En contra')
        .setStyle(ButtonStyle.Danger)
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

  if (
    interaction.isButton() &&
    (interaction.customId.startsWith('vote_yes_') || interaction.customId.startsWith('vote_no_'))
  ) {
    if (!interaction.member.roles.cache.has(config.adminRoleId)) {
      return interaction.reply({
        content: '❌ Solo admins pueden votar.',
        ephemeral: true
      });
    }

    const reportId = interaction.customId.split('_')[2];
    const data = JSON.parse(fs.readFileSync('./reports.json'));
    const report = data.find(r => r.id == reportId);

    if (!report) {
      return interaction.reply({ content: 'Reporte no encontrado.', ephemeral: true });
    }

    // 🔄 Quitar voto previo
    report.votes.approve = report.votes.approve.filter(id => id !== interaction.user.id);
    report.votes.reject = report.votes.reject.filter(id => id !== interaction.user.id);

    // ➕ Añadir voto
    if (interaction.customId.startsWith('vote_yes')) {
      report.votes.approve.push(interaction.user.id);
    } else {
      report.votes.reject.push(interaction.user.id);
    }

    // 👥 Contar admins y mayoría
    const adminRole = interaction.guild.roles.cache.get(config.adminRoleId);
    const totalAdmins = adminRole.members.size;
    const majority = Math.ceil(totalAdmins / 2);

    // 🏁 Decisión final
    if (report.votes.approve.length >= majority) {
      report.status = 'Aprobado por votación';
    }
    if (report.votes.reject.length >= majority) {
      report.status = 'Rechazado por votación';
    }

    fs.writeFileSync('./reports.json', JSON.stringify(data, null, 2));

    const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
      .spliceFields(4, 1, {
        name: 'Estado',
        value:
          `${report.status}\n` +
          `👍 ${report.votes.approve.length} | 👎 ${report.votes.reject.length}`
      });

    await interaction.update({
      embeds: [updatedEmbed],
      components:
        report.status.includes('Aprobado') || report.status.includes('Rechazado')
          ? []
          : interaction.message.components
    });

    // 📩 Avisar al denunciante al finalizar
    if (report.status !== 'En votación') {
      try {
        const user = await client.users.fetch(report.reporter.id);
        await user.send(`📢 Tu petición de ban fue **${report.status}**.`);
      } catch {}
    }
  }
});

client.login(config.token);
 