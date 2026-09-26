import { randomUUID } from "node:crypto";
import { decideCutover, type DeploymentHit } from "./cutover_decision.ts";
import { controlPlaneFromEnvironment } from "./infrai_control_plane.ts";

function recordsFrom(search: { items?: Array<Record<string, unknown>> }): DeploymentHit[] {
  return (search.items ?? []) as DeploymentHit[];
}

async function main(): Promise<void> {
  const oldKeyFingerprint = process.env.OLD_KEY_FINGERPRINT;
  if (!oldKeyFingerprint) throw new Error("OLD_KEY_FINGERPRINT is required");

  const infrai = controlPlaneFromEnvironment();
  const runId = process.env.CUTOVER_RUN_ID ?? randomUUID();
  const temporary = await infrai.createTemporaryKey(`${runId}:create`);
  console.log("Store this temporary key now; its plaintext cannot be retrieved again:", temporary.key_secret);

  const rotated = await infrai.rotateTemporaryKey(temporary.key_id, 24, `${runId}:rotate`);
  console.log("Store the rotated key now; deploy it to the field-service workloads:", rotated.key);

  const search = await infrai.searchOldKeyUsage(oldKeyFingerprint);
  const decision = decideCutover(recordsFrom(search));

  if (decision.action === "revoke-temporary-key") {
    await infrai.revokeTemporaryKey(temporary.key_id);
  }

  console.log(JSON.stringify({ temporaryKeyId: temporary.key_id, ...decision }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
