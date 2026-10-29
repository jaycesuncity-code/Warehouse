# Authentication and API security

The Pages Function validates Cloudflare Access at the origin. Protect the entire Pages hostname with Access as well; neither a hidden button nor a forwarded email header is an authorization boundary.

## Required configuration

- `CF_ACCESS_TEAM_DOMAIN`: the team's `*.cloudflareaccess.com` hostname, optionally prefixed with `https://`.
- `CF_ACCESS_AUD`: this specific Access application's audience tag.
- `WAREHOUSE_EDITORS`: comma, whitespace, or semicolon separated employee email addresses.
- `WAREHOUSE_ADMINS`: the same format for administrators.
- The D1 runtime binding is literally `warehouse-db`. The database's display name is a separate setting.

Missing or invalid Access configuration returns `503`. A missing or invalid JWT returns `401`. Authenticated people outside both role lists receive the viewer role. The verified email is normalized to lowercase; client-provided role or email headers do not grant permissions. The API continues enforcing permissions even if a client bypasses the UI.

## Verification

The verifier accepts RS256 application JWTs from the configured issuer and audience only. It checks the signature, expiry, optional validity and issuance times, email identity, and supported protected-header parameters. It obtains matching public keys from the configured team's `/cdn-cgi/access/certs` endpoint, with no redirects and a bounded timeout. It never follows token-supplied key URLs. Public signing keys are cached for five minutes per worker isolate, concurrent fetches are coalesced, and a new key ID can refresh the cache after a short cooldown. Expired cache entries are not accepted when refresh fails.

Mutations require JSON when a body is present, apply a one-megabyte byte limit while streaming, and reject a supplied cross-origin `Origin`. The server validates route permissions before database mutations. Authenticated responses are marked `Cache-Control: no-store`, including conditional reads. Viewer audit responses omit before/after snapshots.

Domain validation also rejects malformed field types before persistence. Measurement verification and destructive force flags require actual booleans; the string `"false"` does not verify a room or force a shelf deletion. Opening zone references, shelf rows, resize anchors, and text metadata are checked explicitly. Invalid rows in a registration batch receive individual conflict results while valid rows retain their successful registrations.

Every mutation may include an `Idempotency-Key`. The server binds its persisted response to the verified actor, key, HTTP method, path/query, and exact JSON body. Reusing the same key and request returns the original response. Reusing it for a different request returns a conflict. Receipt and inventory changes commit atomically. Clients must preserve their key when retrying an uncertain request; callers omitting the header retain legacy behavior and should not blindly retry additive inventory changes.

## Local verification and deployment boundary

`src/shared/auth.test.ts` generates fresh RSA keys and signs real JWTs locally. The tests replace only the certificate HTTP response and use isolated SQLite databases with the committed migrations. They exercise authentication, all viewer mutation restrictions, editor/admin geometry permissions, HTTP validation, audit visibility, health checks, and retry behavior. No local test changes Access policy or weakens the deployed verifier.

These tests do not validate a live Access application's audience, its deployed email allowlists, the production database schema, or preview isolation. Those values must be inspected in the authorized Cloudflare environment before deployment. `/api/health` requires authentication, compiles zero-row reads of every required table and column, and checks a positive revision. A binding or set of table names alone cannot produce a healthy response. Health does not replace inspection of deployed constraints, indexes, migration history, or existing records.

References: [Cloudflare application tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/) and [Cloudflare JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).
