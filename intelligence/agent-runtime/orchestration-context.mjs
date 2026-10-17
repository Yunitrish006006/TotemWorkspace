import path from 'node:path';
import crypto from 'node:crypto';
import { buildContextPack } from '../context-pack.mjs';
import { loadKnowledge, defaultReposRoot } from '../workspace-knowledge.mjs';

/** Resolve sandbox roots only from graph-owned modules, never from model text. */
export function constrainedWriteRoots(plan, knowledge = loadKnowledge()) {
  const scopes = plan?.writeScope;
  if (!Array.isArray(scopes)) throw new Error('Execution plan has no authoritative write scope');
  const roots = scopes.map(scope => {
    if (scope.moduleId === 'totem-workspace') return path.resolve(knowledge.root);
    const module = knowledge.modules.find(entry => entry.id === scope.moduleId);
    if (!module?.repoName) throw new Error(`Unknown write-scope module: ${scope.moduleId}`);
    return path.resolve(defaultReposRoot(knowledge.root), module.repoName);
  });
  return [...new Set(roots)];
}

/** workspaceWrite may implicitly include cwd: keep it inside an authorized root. */
export function executionWorkspace(workspace, roots, readOnly = false) {
  if (readOnly) return path.resolve(workspace);
  if (!Array.isArray(roots) || !roots.length) throw new Error('Writable execution requires an authorized root');
  return path.resolve(roots[0]);
}

export function constrainReadOnlyPlan(plan) {
  const waves = (plan?.waves ?? []).map(wave => Object.freeze({ ...wave, writeAllowed: false,
    maxConcurrentWrites: 0 }));
  return Object.freeze({ ...plan, writeScope: Object.freeze([]), waves: Object.freeze(waves),
    executionWaves: Object.freeze(waves), execution: Object.freeze({ ...(plan?.execution ?? {}),
      maxConcurrentWrites: 0 }) });
}

export function boundedRuntimeContext(prompt, plan, knowledge = loadKnowledge()) {
  return buildContextPack(prompt, { audience: 'primary', maxTokens: 4000, knowledge,
    orchestrationPlan: plan }).rendered;
}

/**
 * A resumed thread already contains its initial context pack, while thread/resume
 * refreshes the authoritative execution constraints in developer instructions.
 * Keep follow-up evidence intentionally tiny and fetch detailed evidence again only
 * when it is missing, stale, or contradicted.
 */
const referenceId = value => typeof value === 'string' && /^[a-z0-9._:-]{1,120}$/i.test(value.trim())
  ? value.trim()
  : null;
const gitReference = value => typeof value === 'string' && /^[a-z0-9][a-z0-9._/@+-]{0,199}$/i.test(value.trim())
  ? value.trim()
  : null;
const repositoryRelativePath = value => {
  if (typeof value !== 'string' || value.length > 512 || /[\0\r\n]/.test(value)) return null;
  const normalized = value.replaceAll('\\', '/').trim();
  const directory = normalized.endsWith('/');
  const candidate = directory ? normalized.slice(0, -1) : normalized;
  if (!candidate || path.posix.isAbsolute(candidate) || /^[a-z]:\//i.test(candidate)
      || candidate.split('/').some(part => !part || part === '.' || part === '..')
      || !/^[a-z0-9._@+(){}\[\] /-]+$/i.test(candidate)) return null;
  return directory ? `${candidate}/` : candidate;
};
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

function followupReferences(plan, activeWorkTask, resumeCheckpoint, repositoryState) {
  const taskRef = activeWorkTask ? {
    workId: referenceId(activeWorkTask.workId),
    taskId: referenceId(activeWorkTask.taskId)
  } : null;
  const checkpoint = resumeCheckpoint ?? activeWorkTask?.resumeCheckpoint;
  const checkpointIdentity = checkpoint ? {
    schemaVersion: checkpoint.schemaVersion ?? null,
    id: referenceId(checkpoint.id),
    sessionId: referenceId(checkpoint.sessionId),
    workId: referenceId(checkpoint.workId),
    taskId: referenceId(checkpoint.taskId),
    runtimeTaskId: referenceId(checkpoint.runtimeTaskId),
    state: referenceId(checkpoint.state),
    repository: referenceId(checkpoint.repository),
    branch: gitReference(checkpoint.branch),
    head: referenceId(checkpoint.head),
    worktreeDigest: referenceId(checkpoint.worktreeDigest),
    filesChanged: Array.isArray(checkpoint.filesChanged)
      ? checkpoint.filesChanged.map(repositoryRelativePath).filter(Boolean).slice(0, 120)
      : [],
    nextTask: referenceId(checkpoint.nextTask)
  } : null;
  const currentFiles = Array.isArray(repositoryState?.filesChanged)
    ? repositoryState.filesChanged.map(repositoryRelativePath).filter(Boolean).sort() : null;
  const recordedFiles = checkpointIdentity ? [...checkpointIdentity.filesChanged].sort() : null;
  const freshness = !checkpointIdentity || !repositoryState ? 'recorded-unverified'
    : checkpointIdentity.branch === gitReference(repositoryState.branch)
      && checkpointIdentity.head === referenceId(repositoryState.head)
      && checkpointIdentity.worktreeDigest !== null
      && checkpointIdentity.worktreeDigest === referenceId(repositoryState.worktreeDigest)
      && JSON.stringify(recordedFiles) === JSON.stringify(currentFiles) ? 'current' : 'stale';
  const planIdentity = {
    affectedModules: [...new Set((plan?.affectedModules ?? []).filter(value => typeof value === 'string'))].sort(),
    contracts: [...new Set((plan?.contracts ?? []).map(value => typeof value === 'string' ? value : value?.id).filter(Boolean))].sort(),
    readModules: [...new Set((plan?.readScope ?? []).map(scope => scope?.moduleId).filter(Boolean))].sort(),
    writeModules: [...new Set((plan?.writeScope ?? []).map(scope => scope?.moduleId).filter(Boolean))].sort()
  };
  return {
    taskRef: taskRef?.workId && taskRef?.taskId ? taskRef : null,
    checkpointRef: checkpointIdentity ? {
      id: checkpointIdentity.id
        ?? [checkpointIdentity.workId, checkpointIdentity.taskId].filter(Boolean).join(':')
        ?? null,
      sessionId: checkpointIdentity.sessionId,
      state: checkpointIdentity.state,
      ...(freshness === 'current' ? {
        branch: checkpointIdentity.branch,
        head: checkpointIdentity.head,
        filesChanged: checkpointIdentity.filesChanged
      } : {}),
      digest: digest(checkpointIdentity),
      freshness
    } : { id: null, digest: null, freshness: 'missing' },
    evidenceRef: { kind: 'orchestration-plan', digest: digest(planIdentity) }
  };
}

export function boundedFollowupContext(plan, { activeWorkTask = null, resumeCheckpoint = null,
  repositoryState = null } = {}) {
  const rawModules = Array.isArray(plan?.affectedModules)
    ? plan.affectedModules
    : [...new Set((plan?.readScope ?? []).map(scope => scope.moduleId).filter(Boolean))];
  const affectedModules = [...new Set(rawModules
    .filter(moduleId => typeof moduleId === 'string')
    .map(moduleId => moduleId.trim())
    .filter(moduleId => /^[a-z0-9._-]{1,80}$/i.test(moduleId)))]
    .slice(0, 32);
  const references = followupReferences(plan, activeWorkTask, resumeCheckpoint, repositoryState);
  return JSON.stringify({
    schemaVersion: 3,
    mode: 'followup',
    affectedModules,
    ...references,
    contextReuse: 'Reuse prior thread evidence and the current authoritative developer constraints.',
    fullEvidence: 'Call resolve_task, orchestration_plan, or context_pack only when evidence is missing, stale, or contradicted.'
  });
}
