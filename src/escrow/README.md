portable core copied verbatim from tc-linkai src/escrow @ ad7e330; keep byte-identical, vector tests must pass

App policy lives in config.ts, checkpoint.ts and controller.ts. The adapter uses the existing singleton mist wrapper. Only the active shared room has a controller. Existing bounded wire logs define v1 recovery coverage; unsupported legacy manifests and attachments exceeding the budgets are reported as omissions.

Checkpoint policy: signed wires in the five existing replay buckets, encrypted structured bodies (256 KiB), thumbnails (1 MiB), and media/files (2 MiB plaintext, plus the cipher envelope) are admitted with a 20 MiB raw-body budget and 30 MiB checkpoint limit. Original storage names and bytes are preserved; legacy structured manifests with unknown names are omitted. Restore validates the entire checkpoint and all signatures before adding blobs, checks every returned CID, and awaits the existing history receivers in timestamp/log order. A CID mismatch is an app-level omission diagnostic, never a rewritten signed CID.

Auto/Custom/Off settings are signed, retained, replayed in misc, and ordered by revision, DID and original wire ID. Custom and Off are carried in invites as bootstrap hints, superseded by verified shared settings. Escrow discovery uses shared extra-room leases on the existing node; exact-room peer handlers isolate provider connections from application greetings and presence.

Each active-room controller fetches before writing, listens for late providers, debounces for 5 seconds with a 30-second maximum, unions checkpoints on CAS conflicts with at most three PUT attempts, and retries failures with backoff. Watermarks are isolated by effective endpoint and advance only after the portable client's matching ACK. Pagehide and room switches flush best effort. There is no startup gate when no provider exists.

Verification (run local binaries directly, never npm run build/dev):
- node node_modules/typescript/bin/tsc -b
- node node_modules/eslint/bin/eslint.js .
- node node_modules/vitest/vitest.mjs run
- node node_modules/vite/bin/vite.js build
- node scripts/escrow-smoke.mjs (Windows Chrome default path, or CHROME_PATH; creates an isolated profile and screenshot under ignored node_modules/.tmp/escrow-smoke, stops recorded process PIDs)

Real-mistl interoperability, daemon restart durability and multi-browser E2E belong to the orchestrator. V1 recovers the bounded replayable signed history, not evidence already evicted from the existing logs. No separate journal or background DM controllers are added. Attachments omitted by size/budget, unavailable bodies and unknown legacy storage names remain visible in the panel.

Revision-2 retention policy (orchestrator override of the unlimited wire union): the parser and writer share a 20,000-wire limit per bucket. Unions retain the newest wires by timestamp, then ID (full-record canonical order breaks remaining ties), while always pinning the escrow-config winner by (rev, fromId, id). Optional `droppedWires` per-bucket counters persist trimming diagnostics, shown in all panel locales and counted as saved-with-omissions. Merge takes the maximum prior counter per bucket to avoid doubling shared ancestry, then adds records removed from the new union; these count pruning events, not globally distinct lost records. Older checkpoints without this field remain valid and older parsers ignore it. No schema, mistl protocol, or portable-core changes are required.

After wire retention or any blob removal, admitted references are recomputed from remaining bodies, and thumbnails without an admitted parent are omitted. Shared thumbnails survive while any admitted parent remains. Every PUT attempt parses the exact final fitted plaintext with parseCheckpoint; failure leaves the daemon head and ACK watermark untouched, reports the parser reason, and keeps the save dirty for retry.

Revision-3 application fixes: signed reaction toggles converge by (timestamp, id) per (targetId, fromId, emoji). The existing local reaction key reads legacy target-to-reactions indexes and writes a versioned record containing reactions plus compact stamps atomically. Removal stamps survive post trimming; unstamped legacy calls cannot overwrite stamped state. These stamps are application persistence, not a separate evidence journal or checkpoint/wire format change. Ordinary app joins (active rooms, background DMs, invite sends) retain one page-session lease per room in the same refcount as escrow handles, preserving the existing stay-joined-until-reload policy. Permanent review reproductions are in replayOwnership.test.ts, with ordering and ownership edge cases in reactionOrdering.test.ts and mistTransport.test.ts.
