const LINE_MARKETS = new Set(["大細波", "角球", "亞洲讓球"]);

export function classifySnapshot(value) {
  if (!value || typeof value !== "object") return invalid("invalid-snapshot");
  if (!nonEmpty(value.matchId)) return invalid("missing-match-id");
  if (!nonEmpty(value.market)) return invalid("missing-market");
  if (!nonEmpty(value.prediction) || isPlaceholder(value.prediction)) return invalid("invalid-prediction");
  if (!nonEmpty(value.savedAt)) return invalid("missing-saved-at");
  if (!nonEmpty(value.modelVersion) || value.modelVersion === "legacy-v0") return { status: "legacy", reason: "legacy-model" };
  if (!nonEmpty(value.commenceTime)) return invalid("missing-commence-time");

  const savedAt = Date.parse(value.savedAt);
  const commenceTime = Date.parse(value.commenceTime);
  if (!Number.isFinite(savedAt)) return invalid("invalid-saved-at");
  if (!Number.isFinite(commenceTime)) return invalid("invalid-commence-time");
  if (savedAt >= commenceTime) return invalid("post-kickoff");
  if (!Number.isFinite(value.odds) || value.odds <= 1) return invalid("invalid-odds");
  if (!Number.isFinite(value.chance) || value.chance < 0 || value.chance > 1) return invalid("invalid-chance");
  if (value.edge !== undefined && !Number.isFinite(value.edge)) return invalid("invalid-edge");

  if (LINE_MARKETS.has(value.market)) {
    if (!Number.isFinite(value.line)) return invalid("missing-line");
    if (Math.abs(value.line * 4 - Math.round(value.line * 4)) > 1e-9) return invalid("invalid-line");
  }

  return { status: "valid-current", reason: null };
}

export function summarizeSnapshotQuality(values) {
  const summary = { raw: values.length, validCurrent: 0, legacy: 0, invalid: 0, invalidReasons: {} };
  for (const value of values) {
    const classification = classifySnapshot(value);
    if (classification.status === "valid-current") summary.validCurrent += 1;
    else if (classification.status === "legacy") summary.legacy += 1;
    else {
      summary.invalid += 1;
      const reason = classification.reason ?? "invalid-snapshot";
      summary.invalidReasons[reason] = (summary.invalidReasons[reason] ?? 0) + 1;
    }
  }
  return summary;
}

function invalid(reason) {
  return { status: "invalid", reason };
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlaceholder(value) {
  const normalized = value.trim().toLowerCase();
  return normalized.includes("唔買") || normalized.includes("沒有賽前 snapshot") || normalized.includes("no pre-match snapshot");
}
