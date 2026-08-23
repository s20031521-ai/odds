import assert from "node:assert/strict";
import test from "node:test";

import { createOpportunityRepository } from "./opportunity-repository.mjs";

test("backtest query does not load full observation input payloads into API memory", async () => {
  let sql = "";
  const repository = createOpportunityRepository({
    async query(statement) {
      sql = statement;
      return { rows: [] };
    },
  });

  await repository.listForBacktest();

  assert.doesNotMatch(sql, /['"]inputs['"]\s*,\s*observation\.inputs/u);
  assert.doesNotMatch(sql, /\bobservation\.inputs\b/u);
});
