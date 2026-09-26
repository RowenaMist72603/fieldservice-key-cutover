import assert from "node:assert/strict";
import test from "node:test";
import { decideCutover } from "../src/cutover_decision.ts";

test("keeps the overlap while any deployment reports the old key fingerprint", () => {
  assert.deepEqual(
    decideCutover([
      { deployment: "dispatch-api" },
      { deployment: "photo-worker" },
      { deployment: "dispatch-api" },
    ]),
    {
      action: "keep-overlap",
      deploymentsStillUsingOldValue: ["dispatch-api", "photo-worker"],
    },
  );
});

test("allows cleanup after the log search returns no old-key deployments", () => {
  assert.deepEqual(decideCutover([]), {
    action: "revoke-temporary-key",
    deploymentsStillUsingOldValue: [],
  });
});
