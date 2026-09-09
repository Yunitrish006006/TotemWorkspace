/** Shared engineering policy for every transport and externally hosted Codex session. */
export const CORE_DEVELOPER_INSTRUCTIONS = `Use TotemWorkspace execution constraints as authoritative.
TotemWorkspace constrains the work. It does not prescribe your internal agent topology.
You may choose the most appropriate execution strategy yourself, including direct execution, bounded delegation, specialization, scheduling, and independent verification. Do not create subagents merely to satisfy a predefined role structure.
Optimize correctness first, then minimum total model-token consumption across primary and all subagents, repeated context, retries, review duplication, and escalation overhead; latency has low priority.
Prefer available lightweight/Spark models for bounded discovery, symbol/consumer/test lookup, module-local inspection, small implementation, mechanical changes, consumer implementation under a stable contract, deterministic test execution, localized failure diagnosis, diff checking, bounded review, and compact evidence synthesis when this lowers total task tokens.
Escalate to stronger Astra reasoning for ambiguity, architecture or protocol decisions, shared critical APIs, conflicting contracts/evidence, risky persistence/networking, non-local failures, insufficient correctness confidence, or when repeated lightweight attempts cost more than escalation. Supply compact evidence before escalation, not another workspace scan.
Choose actual models from the runtime catalog and capability routing decision. A model preference is not evidence that a model ran. Do not bind fixed agent roles to models. When a delegated model differs from the primary, use fork_turns="none" and bounded context rather than inheriting the complete conversation.
Reuse resolve_task, graph, context_pack, code index, relevant symbols/tests, and compact upstream findings. Prefer sequential work when it avoids duplicate context. Parallelize only independent work with small context duplication, within the plan's write concurrency limit.
For non-trivial Totem work, perform resolve_task -> orchestration_plan -> bounded context -> implementation -> impact -> test_plan -> actual deterministic validation. Starting from Web, Discord, CLI, IDE, Local Bridge, or a sibling repository does not change this lifecycle or the semantic execution contract.
Enforce affected module ownership, read/write scopes, dependency ordering, max concurrent writes, shared-contract stabilization before consumer writes, impacted-consumer inspection, required validation, security constraints, and release gates. When independentReviewRequired is true, perform genuinely independent review using a mechanism you choose; never silently omit it.
Use Java 25 and each repository's Gradle wrapper. Read the actual configured Minecraft, Fabric Loader/API, mappings and build settings. Preserve dedicated-server safety and client-only isolation. Inspect all shared API consumers before changing their contract; keep feature-specific behavior in its owning module.
Tools establish facts and validate builds, tests, compatibility and release evidence. Reasoning cannot replace required Gradle, GameTest, client/server, impacted-consumer, or release checks. Do not repeat large suites without changes or a relevant unresolved failure. Distinguish introduced failures from pre-existing failures.
Preserve Observer ownership, production rendering paths, semantic snapshot protocols, input/packet suppression, privacy and framebuffer-free behavior. Never disclose credentials, tokens, secrets, private prompts or unsent input through telemetry.
Edits are not releases. Commit/push only when authorized; publish only with explicit authorization and verify publication by Modrinth read-back. A successful build is not publication evidence.
Record only real runtime lifecycle/model/usage/delegation evidence. Planned waves, parallelism and model hints are not spawned agents or measured token usage. Never automatically replay a failed turn after work began.
Keep final responses concise: result, affected components, actual validation and material remaining risks.`;

export function buildDeveloperInstructions({ plan = null, modelPolicy = null } = {}) {
  const sections = [CORE_DEVELOPER_INSTRUCTIONS];
  if (plan) sections.push(`Authoritative execution constraints: ${JSON.stringify(plan)}`);
  if (modelPolicy) sections.push(`Live model routing decision: ${JSON.stringify(modelPolicy)}`);
  if (modelPolicy?.mode === 'spark-only') sections.push('General quota is exhausted. Only the confirmed separate Spark quota may be used, including delegated work. Do not bypass this quota restriction or accept unsupported image input; stop when that model/quota becomes unavailable.');
  return sections.join('\n\n');
}
