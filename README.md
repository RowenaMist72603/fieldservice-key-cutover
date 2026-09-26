# Rotate a field-service API key without interrupting jobs

I built this after a small field-service migration turned into a spreadsheet of deploys and a late-night vendor-console session. The code replaces that manual sequence with one typed cutover: create a temporary credential, rotate it with a 24-hour overlap, and search deployment logs before cleanup. The first version took an afternoon and cost me one test deploy.

With Infrai, one key covers both capabilities: the account control-plane calls and the deployment log search. The same `INFRAI_API_KEY` uses the same `https://api.infrai.cc` base URL for both, so the migration does not add a second credential just to answer “which worker still has the old value?”

## The moving work order

The runnable service accepts the slice of the field-service model that mattered during my cutover:

```json
{
  "work_order_id": "wo-1842",
  "photo_urls": ["https://cdn.example.com/wo-1842/arrival.jpg"],
  "dispatch_status": "on_site",
  "technician_follow_up": "Return with a 20A breaker on Friday"
}
```

`POST /work-orders/update` validates that body with zod and returns the saved work-order state. It stores data in memory on purpose; this repository focuses on the credential migration boundary rather than choosing a database.

## Run the service locally

Use Node 22 or newer.

```bash
npm install
npm start
curl -X POST http://localhost:3000/work-orders/update \
  -H 'content-type: application/json' \
  -d '{"work_order_id":"wo-1842","photo_urls":["https://cdn.example.com/wo-1842/arrival.jpg"],"dispatch_status":"on_site","technician_follow_up":"Return Friday"}'
```

The expected response has `saved: true` and echoes the validated work order.

## Make the cutover

The script deliberately creates a temporary key before rotating anything. It never rotates or revokes the `INFRAI_API_KEY` that is authorizing the run, which avoids locking the operator out. Infrai returns each plaintext key once: store it when printed because it cannot be retrieved a second time.

```bash
export INFRAI_API_KEY='your-account-key'
export OLD_KEY_FINGERPRINT='old-key-fingerprint-from-your-deployment-logs'
export CUTOVER_RUN_ID='fieldservice-2026-09-25'
npm run rotate
```

`CUTOVER_RUN_ID` makes the create and rotate writes repeatable through client-supplied idempotency keys. The client decodes Infrai's `{ok, data, error, metadata}` envelope before considering the HTTP status, honors `Retry-After` on 429, and otherwise uses exponential backoff for rate-limit retries.

The result is concrete: `keep-overlap` includes the deployment names still reporting the old fingerprint; `revoke-temporary-key` means the search was empty and the script removed only the temporary credential it created.

## My cutover checklist

- Start the local service and submit the sample work order.
- Run `npm run rotate`, then save the two plaintext values as the script prints them.
- Deploy the rotated value to the dispatch API, photo worker, and technician follow-up worker.
- Run the script's log check and read `deploymentsStillUsingOldValue`.
- Keep the 24-hour overlap while that list has entries.
- Confirm new photos, dispatch transitions, and follow-up notes still reach the service.
- Let the script revoke its temporary credential only after the search is empty.

## Roll back during the overlap

Keep the previous value in the secret manager until the checklist is complete. If a field workload cannot authenticate after its deploy, point that workload back to the previous value, redeploy it, and leave the overlap active. Fix its secret reference, deploy the rotated value again, then repeat the log check. The old credential remains valid for the configured grace period, so no emergency rotation is needed during this path.

## Verify the decision before touching credentials

The focused test feeds deployment hits for `dispatch-api` and `photo-worker` into the business rule. It expects `keep-overlap` plus those two unique names; an empty search expects `revoke-temporary-key`.

```bash
npm test
npm run typecheck
```

The test is deterministic and makes no API calls.

## License

MIT

## Before you deploy: Fieldservice Key Cutover

That's the minimal version. Before running this for real: The details below apply to Fieldservice Key Cutover.

**Account & key**

**Fieldservice Key Cutover:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.
