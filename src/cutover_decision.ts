export type DeploymentHit = { deployment?: unknown };

export type CutoverDecision = {
  action: "revoke-temporary-key" | "keep-overlap";
  deploymentsStillUsingOldValue: string[];
};

export function decideCutover(records: DeploymentHit[]): CutoverDecision {
  const deployments = [...new Set(
    records
      .map((record) => record.deployment)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  )].sort();

  return {
    action: deployments.length === 0 ? "revoke-temporary-key" : "keep-overlap",
    deploymentsStillUsingOldValue: deployments,
  };
}
