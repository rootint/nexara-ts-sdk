/**
 * Balance and itemized usage.
 *
 * Both are scoped to the *account*, not to the key you authenticate with: the
 * history covers every key the account owns, including deleted ones.
 */

import { Nexara } from "nexara-sdk";

const client = new Nexara({ apiKey: "mock-key" });

const { balance, rate_per_min, currency } = await client.billing.balance();
console.log(`balance: ${balance} ${currency} (${rate_per_min} ${currency}/min)`);

// A rough runway, on plain transcription only — profanity_filter, roles and
// prompt each add a surcharge that rate_per_min does not include.
console.log(`~${Math.floor(balance / rate_per_min)} minutes left at that rate`);

// One page, newest first. Pagination is keyset, not offset: pass the previous
// page's next_cursor to walk backwards in time.
const page = await client.billing.usage({ limit: 3 });
for (const item of page.items) {
  // cost is null for rows written before per-request costs were recorded —
  // "unknown", not "free".
  const cost = item.cost === null ? "  n/a" : `${item.cost.toFixed(2)} ${page.currency}`;
  console.log(`${item.timestamp}  ${item.task.padEnd(10)} ${cost}  via ${item.api_key.name}`);
}
console.log(`has_more=${page.has_more} next_cursor=${page.next_cursor}`);

// iterUsage() does the paging for you. History is unbounded, so bound it.
let total = 0;
for await (const item of client.billing.iterUsage({ maxItems: 100 })) {
  total += item.cost ?? 0;
}
console.log(`last 100 calls cost ${total.toFixed(2)} ${page.currency}`);
