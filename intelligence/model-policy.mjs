/** Capability routing from the live catalog; no agent-role or fixed model IDs. */
export const QUOTA_MAX_AGE_MS = 5 * 60 * 1000;
export const modelId = entry => typeof entry === 'string' ? entry : entry?.model ?? entry?.id;
export function isLightweightModel(entry) {
  return entry?.capabilities?.lightweight === true || entry?.modelClass === 'lightweight'
    || /spark|mini|nano|luna|lightweight/i.test(modelId(entry) ?? '');
}
export function isStrongReasoningModel(entry) {
  return entry?.capabilities?.strongReasoning === true || /astra/i.test(modelId(entry) ?? '');
}
function quota(usage, id, now) {
  const snapshot = usage?.rateLimitsByLimitId?.[id]
    ?? (usage?.rateLimits?.limitId === id ? usage.rateLimits : null);
  const checkedAt = usage?.checkedAt;
  const timestamp = typeof checkedAt === 'number' ? checkedAt : Date.parse(checkedAt);
  const fresh = Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= QUOTA_MAX_AGE_MS;
  if (!fresh || !snapshot) return { limitId: id, status: 'unknown', reason: !fresh ? 'quota-stale-or-unknown' : 'quota-unavailable' };
  const windows = [snapshot.primary, snapshot.secondary].filter(Boolean);
  const valid = windows.filter(window => Number.isFinite(window.usedPercent) && window.usedPercent >= 0
    && window.usedPercent <= 100 && (!Number.isFinite(window.resetsAt) || window.resetsAt * 1000 > now));
  const exhausted = valid.some(window => window.usedPercent >= 100);
  const credits = snapshot.credits;
  const balance = Number(credits?.balance);
  const hasCredits = credits?.unlimited === true || credits?.hasCredits === true || (Number.isFinite(balance) && balance > 0);
  const conclusive = snapshot.spendControlReached === true || snapshot.rateLimitReachedType === 'codexRateLimits';
  const status = exhausted ? (hasCredits && !conclusive ? 'unknown' : 'exhausted') : valid.length > 0 && valid.length === windows.length ? 'available' : 'unknown';
  return { limitId: id, status, reason: `quota-${status}`, checkedAt: timestamp };
}


export function resolveModelPolicy({ plan, models, usage, requestedModel, requestedEffort,
  hasImages = false, contextTokens = 0, escalation = null, now = Date.now() } = {}) {
  const catalog = (Array.isArray(models) ? models : models?.data ?? [])
    .filter(entry => modelId(entry) && entry?.hidden !== true && entry?.available !== false);
  const quotaEvidence = { general: quota(usage, 'codex', now), spark: quota(usage, 'codex_bengalfox', now) };
  const reasons = new Set();
  const supportsInput = entry => !hasImages || entry?.inputModalities?.includes('image');
  const hasCapacity = entry => !Number.isFinite(entry?.contextWindow) || entry.contextWindow >= contextTokens;
  const quotaReady = entry => {
    const spark = /spark/i.test(modelId(entry));
    if (spark && quotaEvidence.spark.status === 'exhausted') return false;
    if (quotaEvidence.general.status === 'exhausted') return spark && quotaEvidence.spark.status === 'available';
    return true;
  };
  const usable = catalog.filter(entry => supportsInput(entry) && hasCapacity(entry) && quotaReady(entry));
  const byCost = (a, b) => (Number(a?.costPerToken ?? Infinity) - Number(b?.costPerToken ?? Infinity)) || String(modelId(a)).localeCompare(String(modelId(b)));
  const lightweight = usable.filter(isLightweightModel).sort(byCost)[0];
  const strong = usable.find(isStrongReasoningModel) ?? usable.find(entry => !isLightweightModel(entry) && entry?.isDefault)
    ?? usable.find(entry => !isLightweightModel(entry));
  const strongNeeded = Boolean(escalation) || plan?.modelHint === 'strong-reasoning-preferred'
    || plan?.contextHints?.modelPreference === 'strong-reasoning-preferred'
    || plan?.execution?.sharedContractStabilizationRequired
    || (plan?.riskConstraints ?? []).some(risk => /high-risk|persistence|networking|shared-critical|contradictory/i.test(typeof risk === 'string' ? risk : risk?.id ?? ''));
  const explicit = requestedModel ? usable.find(entry => modelId(entry) === requestedModel) : null;
  if (requestedModel && !explicit) reasons.add('requested-model-unavailable-fallback');
  if (!lightweight) reasons.add('lightweight-unavailable-fallback');
  if (quotaEvidence.general.status === 'unknown') reasons.add('general-quota-unknown');
  if (!catalog.length) reasons.add('model-catalog-unavailable');
  // Strong reasoning requirements cannot be weakened merely because only a small model has quota.
  const selected = strongNeeded ? (explicit && !isLightweightModel(explicit) ? explicit : strong)
    : explicit ?? lightweight ?? strong ?? usable[0];
  if (strongNeeded) reasons.add(escalation ? 'escalation-required' : 'strong-reasoning-required');
  if (!selected) reasons.add(strongNeeded ? 'required-reasoning-unavailable' : 'no-capable-model-available');
  const effort = (entry, preferred = 'medium') => {
    const supported = entry?.supportedReasoningEfforts?.map(value => typeof value === 'string' ? value : value.reasoningEffort);
    if (!supported?.length) return entry?.defaultReasoningEffort ?? null;
    return supported.includes(preferred) ? preferred : supported.includes(entry?.defaultReasoningEffort)
      ? entry.defaultReasoningEffort : supported.includes('medium') ? 'medium' : supported[0];
  };
  const route = wave => {
    const preference = wave.modelHint ?? 'lightweight-preferred';
    const entry = preference === 'strong-reasoning-preferred' ? strong
      : preference === 'inherit-primary' ? selected : lightweight ?? selected;
    return { id: wave.id, preference, model: entry ? modelId(entry) : null,
      effort: entry ? effort(entry) : null, contextBudget: wave.contextBudget ?? null, advisory: true };
  };
  return {
    mode: !selected ? 'blocked' : /spark/i.test(modelId(selected)) && quotaEvidence.general.status === 'exhausted'
      ? 'spark-only' : isLightweightModel(selected) ? 'lightweight-preferred' : 'strong-reasoning',
    coordinator: { model: selected ? modelId(selected) : null, effort: selected ? effort(selected, requestedEffort) : null },
    routing: (plan?.waves ?? []).map(route),
    availableModels: usable.map(entry => ({ model: modelId(entry), lightweight: isLightweightModel(entry), strongReasoning: isStrongReasoningModel(entry) })),
    optimization: { primaryGoal: 'correctness', secondaryGoal: 'minimize-total-model-tokens', latencyPriority: 'low', avoidDuplicateContext: true, preferSequentialWhenCheaper: true },
    escalation: { state: escalation ? 'required' : 'none', compactEvidenceRequired: true, automaticRetry: false },
    reasonCodes: [...reasons], quotaEvidence
  };
}
