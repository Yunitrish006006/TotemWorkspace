/** Bounded App Server input contract shared by managed presentation adapters. */
export function userInputFromRequest(message) {
  if (message.method !== 'item/tool/requestUserInput' && message.method !== 'tool/requestUserInput') return null;
  const params = message.params;
  if (!params || !Array.isArray(params.questions) || params.questions.length < 1 || params.questions.length > 3)
    throw new Error('Invalid user-input questions');
  const ids = new Set();
  const questions = params.questions.map(question => {
    if (typeof question.id !== 'string' || !question.id || question.id.length > 128 || ids.has(question.id)
        || typeof question.question !== 'string' || question.question.length > 2000
        || typeof question.header !== 'string' || question.header.length > 128)
      throw new Error('Invalid user-input question');
    ids.add(question.id);
    const options = question.options ?? [];
    if (!Array.isArray(options) || options.length > 10 || options.some(option =>
      typeof option.label !== 'string' || option.label.length > 300
      || typeof option.description !== 'string' || option.description.length > 1000))
      throw new Error('Invalid user-input options');
    return { id: question.id, header: question.header, question: question.question,
      isSecret: question.isSecret === true, isOther: question.isOther === true, options };
  });
  return { kind: 'user-input', requestId: String(message.id), threadId: params.threadId,
    turnId: params.turnId, questions, isBlocking: params.isBlocking !== false };
}

export function userInputResponse(request, answers) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw new Error('Answers are required');
  const ids = request.questions.map(question => question.id);
  if (Object.keys(answers).some(id => !ids.includes(id)) || ids.some(id => !Object.hasOwn(answers, id)))
    throw new Error('Answers do not match pending questions');
  const result = Object.create(null);
  for (const id of ids) {
    const values = answers[id]?.answers;
    if (!Array.isArray(values) || values.length > 10 || values.some(value => typeof value !== 'string' || value.length > 4000))
      throw new Error('Invalid answer');
    result[id] = { answers: [...values] };
  }
  return { answers: result };
}
