export function taskIntent(query) {
  const text = String(query ?? '');
  const usageSubject = /(?:\b(?:input\s+tokens?|cached\s+tokens?|output\s+tokens?|(?:token|runtime|session|context)\s+usage|(?:current|remaining|used)\s+tokens?|tokens?\s+(?:used|remaining)|quota|context\s+(?:size|limit))\b|input過多|額度|(?:token|上下文|工作階段).{0,8}(?:用量|消耗)|(?:用量|消耗).{0,8}(?:token|上下文|工作階段))/i;
  const statusSubject = /(?:\b(?:(?:runtime|session|service)\s+(?:status|progress)|(?:status|progress)\s+(?:of\s+)?(?:runtime|session|service)|restart\s+(?:the\s+)?service)\b|(?:重啟|重启|重新啟動|重新启动).{0,8}服務|dc服務|discord服務|開發(?:進度|狀態|到哪(?:裡|裏|了)?)|(?:目前|現在).{0,8}狀態)/i;
  const liveRuntimeSubject = /\b(?:(?:runtime|session).{0,32}(?:status|health|usage|state|current|live)|(?:status|health|usage|state|current|live).{0,32}(?:runtime|session))\b|工作階段.{0,16}(?:狀態|用量)|(?:狀態|用量).{0,16}工作階段/i;
  const operationalAction = /(?:\b(?:show|check|inspect|report|restart|status)\b|看一下|看看|查看|檢查|检查|回報|重啟|重启|重新啟動|重新启动|現在.*到哪|目前.*到哪)/i;
  const behavioral = /protocol|\bapi\b|security|privacy|authorization|persist|network|schema|migration|\b(?:behavior|bug|counter|overflow|regression|parser|handling|calculations?|configuration|validation|validator|class|function|method|module|delete|implement|implementation|source|code|release|publish|deploy)\b|協議|權限|持久化|遷移|刪除|實作|程式|模組|發布/i.test(text);
  const documentationOnly = /typo|spelling|錯字|拼字/i.test(text) && /readme|docs?\b|markdown|文件|說明/i.test(text) && !behavioral;
  const inspection = /^(?:please\s+|can you\s+|could you\s+|幫我|請|先)?(?:where\b|list\b|show\b|find\b|read\b|explain\b|locate\b|review\b|assess\b|inspect\b|列出|尋找|查看|檢視|看看|說明|查詢|評估)/i.test(text.trim());
  const explicitNoEdits = /without (?:any )?edits|do not (?:edit|modify)|no (?:code )?changes|不要(?:修改|改動)|不(?:要)?修改檔案/i.test(text);
  const mutationText = text
    .replace(/(?:能不能|是否可以)(?:再)?(?:更新|修改)/g, '')
    .replace(/開發(?:進度|狀態|到哪(?:裡|裏|了)?)/g, '');
  const mutation = /\b(change|modify|fix|implement|delete|publish|update|write|add|create|deploy)\b|修改|修復|修正|刪除|發布|更新|新增|加入|實作|開發|撰寫|套用/i.test(mutationText);
  const operational = (usageSubject.test(text) || statusSubject.test(text) || liveRuntimeSubject.test(text))
    && operationalAction.test(text) && !behavioral && !mutation;
  const readOnly = operational || explicitNoEdits || (inspection && !mutation);
  return { documentationOnly, readOnly, operational };
}
