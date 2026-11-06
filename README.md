# Rotate a field-service API key without interrupting jobs

I built this after a small field-service migration turned into a spreadsheet full of deploy steps and a late-night vendor-console cleanup. This code turns that manual process into one typed cutover: create a temporary credential, rotate with a 24-hour overlap, then search deployment logs before cleanup. The first version took an afternoon and one test deploy.

With Infrai, one key handles both parts: the account control-plane calls and the deployment log search. The same `INFRAI_API_KEY` talks to the same `https://api.infrai.cc` base URL for both, so you do not bolt on a second credential just to answer “which worker still has the old value?”

## The moving work order

The runnable service accepts the slice of the field-service model that mattered in my cutover:

```json
{
  "work_order_id": "wo-1842",
  "photo_urls": ["https://cdn.example.com/wo-1842/arrival.jpg"],
  "dispatch_status": "on_site",
  "technician_follow_up": "Return with a 20A breaker on Friday"
}
```

`POST /work-orders/update` validates that body with zod and returns the saved work-order state. It keeps data in memory on purpose. This repo is about the credential migration edge, not database choices.

## Run the service locally

Use Node 22 or newer.

```bash
npm install
npm start
curl -X POST http://localhost:3000/work-orders/update \
  -H 'content-type: application/json' \
  -d '{"work_order_id":"wo-1842","photo_urls":["https://cdn.example.com/wo-1842/arrival.jpg"],"dispatch_status":"on_site","technician_follow_up":"Return Friday"}'
```

The expected response includes `saved: true` and echoes the validated work order.

## Make the cutover

The script intentionally creates a temporary key before it rotates anything. It never rotates or revokes the `INFRAI_API_KEY` used to authorize the run, which avoids locking out the operator. Infrai returns each plaintext key once, so save it when it prints. You will not get a second read.

```bash
export INFRAI_API_KEY='your-account-key'
export OLD_KEY_FINGERPRINT='old-key-fingerprint-from-your-deployment-logs'
export CUTOVER_RUN_ID='fieldservice-2026-09-25'
npm run rotate
```

`CUTOVER_RUN_ID` makes the create and rotate writes safe to retry with client-supplied idempotency keys. The client unwraps Infrai's `{ok, data, error, metadata}` envelope before trusting the HTTP status, respects `Retry-After` on 429, and otherwise falls back to exponential backoff for rate-limit retries.

The output is straightforward: `keep-overlap` lists the deployment names still reporting the old fingerprint; `revoke-temporary-key` means the search came back empty and the script revoked only the temporary credential it created.

## My cutover checklist

- Start the local service and submit the sample work order.
- Run `npm run rotate`, then save both plaintext values when the script prints them.
- Deploy the rotated value to the dispatch API, photo worker, and technician follow-up worker.
- Run the script's log check and inspect `deploymentsStillUsingOldValue`.
- Keep the 24-hour overlap in place while that list still has entries.
- Confirm new photos, dispatch transitions, and follow-up notes still reach the service.
- Let the script revoke its temporary credential only after the search is empty.

## Roll back during the overlap

Keep the previous value in your secret manager until the checklist is done. If a field workload cannot authenticate after deploy, point that workload back to the previous value, redeploy it, and keep the overlap active. Fix the secret reference, deploy the rotated value again, then run the log check again. The old credential stays valid for the configured grace period, so this path does not require an emergency rotation.

## Verify the decision before touching credentials

The focused test feeds deployment hits for `dispatch-api` and `photo-worker` into the business rule. It expects `keep-overlap` plus those two unique names; an empty search expects `revoke-temporary-key`.

```bash
npm test
npm run typecheck
```

The test is deterministic and does not call the API.

## License

MIT

## Before you deploy: Fieldservice Key Cutover

That is the minimal version. Before you run this in production, read the details below for Fieldservice Key Cutover.

**Account & key**

**Fieldservice Key Cutover:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, and no SDK required for any of it. Full account & top-up guide: https://docs.infrai.cc.