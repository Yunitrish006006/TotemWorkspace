const GOAL_COMMAND_ERRORS = Object.freeze({
  GOAL_FEATURE_DISABLED: '原生 Goal 指令目前已停用。',
  GOAL_API_NOT_READY: '原生 Goal 指令尚未完成接線，沒有執行任何操作。',
  GOAL_ALREADY_EXISTS: '這個 thread 已有原生 Goal。請先查看狀態或清除它。',
  GOAL_ALREADY_ACTIVE: '這個 native Goal 仍在執行，尚未由此操作恢復。',
  GOAL_NOT_FOUND: '這個 thread 沒有原生 Goal。',
  GOAL_NOT_RESUMABLE: '這個原生 Goal 目前不能恢復。',
  GOAL_BUDGET_CHANGE_REQUIRED: '請先提高預算，再恢復這個 Goal。',
  GOAL_BUDGET_NOT_ABOVE_USAGE: '新預算必須高於 Goal 已使用 tokens；目前沒有變更 native 狀態。',
  GOAL_USAGE_UNKNOWN: '無法確認 Goal 已使用 tokens；請重新查詢狀態，目前沒有變更。',
  GOAL_MUST_BE_PAUSED: '請先暫停 Goal，才能清除它。',
  GOAL_REVISION_CONFLICT: 'Goal 狀態已改變，請重新查詢後再操作。',
  GOAL_CONTROL_EXPIRED: '這個 Goal 控制按鈕已過期；請使用最新活動卡重新操作。',
  GOAL_TURN_CONFLICT: 'Goal 回合已改變；請使用最新活動卡重新操作。',
  GOAL_OBJECTIVE_CONFLICT: '恢復操作的目標與 native Goal 不相符。',
  GOAL_SUPERVISOR_REQUIRED: '目前 Bot 沒有控制這個 active Goal 的 supervisor，native 狀態未變更。若來源工作已停止，請從歷史清單選取該 thread、確認交接，再使用 /codex goal resume；Bot 會 fork 到新 thread 後接續。若來源仍在執行，請先停止來源。',
  GOAL_BUDGET_SUPERVISOR_REQUIRED: '預算變更需要受控的 Goal runtime，沒有變更 native 狀態。',
  GOAL_PENDING_SELECTION: '目前選取的來源尚未 fork，仍是唯讀狀態、尚無執行對話；沒有 fork，也沒有修改來源 Goal。',
  GOAL_PENDING_FORK_REQUIRED: '這個來源需要先完成安全 fork 與 Goal preparation；目前沒有建立執行 thread。',
  GOAL_HANDOFF_REQUIRED: '先在歷史預覽確認來源工作已停止，再重新執行 Goal start。',
  GOAL_STATE_INVALID: '無法確認 native Goal 狀態；請重新查詢或進入恢復流程。',
  GOAL_STATE_MISSING: 'native Goal 狀態目前無法讀取；操作結果未確認。',
  GOAL_READBACK_MISMATCH: 'Codex 未確認 Goal 變更已生效；操作結果未確認。',
  GOAL_RPC_TIMEOUT: 'Codex 未及時確認 Goal 操作；請查詢狀態後再決定下一步。',
  GOAL_RECOVERY_REQUIRED: 'Goal 需要人工恢復確認；一般訊息和 /codex run 不會自動恢復它。若來源工作已停止，請從歷史清單選取該 thread、確認交接，再使用 /codex goal resume；Bot 會 fork 到新 thread 後接續。',
  GOAL_THREAD_POLICY_MISMATCH: 'Goal 執行設定未通過安全確認；沒有啟動。',
  GOAL_FRAME_INVALID: 'Codex 連線資料無效；Goal 執行已停止，需要恢復確認。'
});

/** Maps runtime codes to bounded user-facing text without exposing raw RPC details. */
export function formatGoalCommandError(error) {
  return GOAL_COMMAND_ERRORS[error?.code] ?? '原生 Goal 操作失敗，狀態尚未確認。請重新查詢後再操作。';
}

export const GOAL_COMMAND_ACTIONS = Object.freeze(['start', 'status', 'pause', 'resume', 'budget', 'clear']);
