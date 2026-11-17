// Stub of next/headers for plain-node action tests. The cart validation and
// idempotency paths return BEFORE getUserSession touches cookies(); if a
// test ever reaches this, it fails loudly instead of silently passing.
export async function cookies() {
  throw new Error("cookies() is unavailable outside a request scope (test stub)");
}
export async function headers() {
  throw new Error("headers() is unavailable outside a request scope (test stub)");
}
