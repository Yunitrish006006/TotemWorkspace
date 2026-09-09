import path from 'node:path';
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

export function boundedRuntimeContext(prompt, plan, knowledge = loadKnowledge()) {
  return buildContextPack(prompt, { audience: 'primary', maxTokens: 4000, knowledge,
    orchestrationPlan: plan }).rendered;
}
