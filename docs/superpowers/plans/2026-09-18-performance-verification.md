# Performance verification

## Baseline diagnosis (read-only real MongoDB)

- Indexed September gift query:37,723 rows,74ms server execution,37,723 keys/docs examined, `timeStamp_1` IXSCAN.
- Old projection payload:24,228,096 BSON bytes; unnecessary full `user` objects14,148,256 bytes.
- Transfer sample:1,000 rows649,833 JSON bytes in6,686ms. Actual old server full build approximately4minutes.

## Preaggregation validation

- Mongo facet fed the same5,000 latest real gifts to a minimally projected raw branch and the new compact bucket branch. All six calculations (daily/yesterday/monthly × individual/group) exactly matched the old reference.1,478 buckets;20.37seconds including transfer of the raw reference sample.
- Whole month:37,759 gifts →11,117 buckets,3,646,553 JSON bytes,37.511seconds. Byte comparison to old BSON is approximate across encodings; both materially reflect removal of large unused fields and repeated records.
- Active-session replacement query:166 gifts →65 buckets,21,595 JSON bytes,320ms. This is one measured active session, not a guaranteed latency for every session.
- All37,779 current-month gift costs were Mongo integers in the type check.
- Optional zlib wire compression was tested read-only using the supported Node driver option. The actual server advertised no compatible compression, and measured runtime stayed37.488seconds; it was not adopted as a claimed optimization. Reference:[MongoDB network compression](https://www.mongodb.com/docs/drivers/node/current/connect/connection-options/network-compression/).

## Frontend regression evidence

- Red/green tests cover automatic cache-first endpoint selection, real computation time rather than fetch time, manual/automatic precedence and preventing four-minute TV wake refresh from interrupting an in-flight request.
- Initial client wave:7 browser regression cases passed; scoped review requested per-column metadata/source enum/transport status refinements before final handoff.

## Integrated live verification

- Local live server restarted at port57022 with TLS validation enabled. Warm current API returned in6ms; a new1920x1080 browser rendered real rows in939ms with no page errors or vertical overflow.
- First observed current request joined the startup build and waited22.237seconds; this is not an isolated cold-start benchmark.
- Forced full refresh completed HTTP200 in62.009seconds including dependency loading and any queued automatic work. Fresh computation raced ongoing source writes and correctly returned stale:true rather than claiming no newer events exist.
- After another server restart, the exact-context durable snapshot returned HTTP200 in41ms with its original computation time and source:snapshot, stale:true while revalidation ran.
- August history returned HTTP200 in240ms, aggregationVersion2. Browser started with5visible columns, key6 opened the sixth with40real historical idol rows, and key6 hid it again. No vertical overflow.
- Full npm test:61passed,0failed, including10browser cases. Syntax checks passed for server, aggregation, performance, app, core and keep-awake; git diff --check passed.
- Independent backend review found no confirmed actionable issue across aggregation, cache identity, journal/stream recovery, forced ordering and archive migration. Independent client scoped review passed commit7206019 with all prior findings resolved.

No remote production deployment. Cold/full refresh remains network-dependent; the main perceived improvement is immediate cached display plus safe background and affected-session updates. Source gift/profile/session records were not edited for diagnostics.
