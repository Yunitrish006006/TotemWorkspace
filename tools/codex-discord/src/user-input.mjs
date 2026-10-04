import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';

export function userInputCard(request) {
  if (request.questions.some(question => question.isSecret))
    throw new Error('Secret input requires a native private input surface');
  const text = request.questions.map((question, index) => [
    `${index + 1}. ${question.question}`,
    ...question.options.map((option, n) => `   ${n + 1}) ${option.label} — ${option.description}`)
  ].join('\n')).join('\n\n');
  // Never truncate a question that may describe an app action requiring consent.
  if (text.length > 1500) throw new Error('Questions exceed Discord card capacity');
  return text;
}

export function userInputComponents(token) {
  return [new ActionRowBuilder().addComponents(new ButtonBuilder()
    .setCustomId(`codex:input:${token}`).setLabel('回答問題').setStyle(ButtonStyle.Primary))];
}

export function userInputModal(token, request) {
  userInputCard(request);
  return new ModalBuilder().setCustomId(`codex:answers:${token}`).setTitle('Codex 問題')
    .addComponents(...request.questions.map((question, index) => new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId(`q${index}`).setLabel((question.header || `問題 ${index + 1}`).slice(0, 45))
        .setStyle(TextInputStyle.Paragraph).setMaxLength(4000).setRequired(false)
        .setPlaceholder(question.options.length ? (question.isOther ? '輸入選項編號、完整選項或自訂答案；可留空略過' : '輸入選項編號或完整選項；可留空略過') : '輸入答案；可留空略過')
    )));
}

export function answersFromModal(request, fields) {
  const answers = Object.create(null);
  request.questions.forEach((question, index) => {
    let value = fields.getTextInputValue(`q${index}`).trim();
    if (value && question.options.length) {
      const option = /^\d+$/.test(value) ? question.options[Number(value) - 1]
        : question.options.find(option => option.label === value);
      if (option) value = option.label;
      else if (!question.isOther) throw new Error(`問題 ${index + 1} 請輸入有效選項`);
    }
    answers[question.id] = { answers: value ? [value] : [] };
  });
  return answers;
}

export function ownsUserInput(request, interaction, allowed) {
  return allowed && request?.kind === 'user-input' && request.userId === interaction.user?.id
    && request.channelId === interaction.channelId;
}

// Each request owns a separate card: overlapping asynchronous questions stay reachable.
export async function presentUserInput({ input, key, userId, channelId, status, register, forget }) {
  const content = userInputCard(input);
  let card, resolved = false;
  const progress = { resolveApproval: async () => { resolved = true; if (card) await card.edit({ components: [] }); } };
  const token = register({ approval: input, key, userId, channelId, progress });
  try {
    card = await status.reply({ content, components: userInputComponents(token), allowedMentions: { parse: [] } });
    if (resolved) await card.edit({ components: [] });
  } catch (error) {
    forget(token);
    throw error;
  }
}
