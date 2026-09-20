export function taskIntent(query) {
  const text = String(query ?? '');
  const behavioral = /protocol|\bapi\b|security|privacy|authorization|persist|network|schema|migration|\b(delete|implement|implementation|source|code|release|publish|deploy)\b|協議|權限|持久化|遷移|刪除|實作|程式|發布/i.test(text);
  const documentationOnly = /typo|spelling|錯字|拼字/i.test(text) && /readme|docs?\b|markdown|文件|說明/i.test(text) && !behavioral;
  const readOnly = /^(where\b|list\b|show\b|find\b|read\b|explain\b|locate\b|列出|尋找|查看|說明|查詢)/i.test(text.trim())
    && !/\b(change|modify|fix|implement|delete|publish|update|write)\b|修改|修復|刪除|發布|更新/i.test(text);
  return { documentationOnly, readOnly };
}
