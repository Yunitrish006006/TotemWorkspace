// Compact transport only: never remove constraints, findings or unique evidence.
// Full mode preserves legacy response fields for diagnostic consumers.
export function compactToolValue(value) {
  if (Array.isArray(value)) return value.map(compactToolValue);
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "rendered" && typeof child === "string" && "routing" in value && "codeResults" in value) continue;
    if (key === "executionWaves" && JSON.stringify(child) === JSON.stringify(value.waves)) continue;
    result[key] = compactToolValue(child);
  }
  return result;
}

export function toolOutput(value, detail = "compact") {
  if (!["compact", "full"].includes(detail)) throw new Error("response_detail must be compact or full");
  const result = detail === "full" ? value : compactToolValue(value);
  return { value: result, text: JSON.stringify(result, null, detail === "full" ? 2 : undefined) };
}
