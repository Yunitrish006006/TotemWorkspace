export function taskIntent(query) {
  const text = String(query ?? '');
  const behavioral = /protocol|\bapi\b|security|privacy|authorization|persist|network|schema|migration|\b(delete|implement|implementation|source|code|release|publish|deploy)\b|協議|權限|持久化|遷移|刪除|實作|程式|發布/i.test(text);
  const documentationOnly = /typo|spelling|錯字|拼字/i.test(text) && /readme|docs?\b|markdown|文件|說明/i.test(text) && !behavioral;
  const inspection = /^(?:please\s+|can you\s+|could you\s+|幫我|請|先)?(?:where\b|list\b|show\b|find\b|read\b|explain\b|locate\b|review\b|assess\b|inspect\b|列出|尋找|查看|檢視|看看|說明|查詢|評估)/i.test(text.trim());
  const explicitNoEdits = /without (?:any )?edits|do not (?:edit|modify)|no (?:code )?changes|不要(?:修改|改動)|不(?:要)?修改檔案/i.test(text);
  const mutationText = text
    .replace(/(?:能不能|是否可以)(?:再)?(?:更新|修改)/g, '')
    .replace(/開發(?:進度|狀態)/g, '');
  const mutation = /\b(change|modify|fix|implement|delete|publish|update|write|add|create|deploy)\b|修改|修復|修正|刪除|發布|更新|新增|加入|實作|開發|撰寫|套用/i.test(mutationText);
  const readOnly = explicitNoEdits || (inspection && !mutation);
  return { documentationOnly, readOnly };
}
