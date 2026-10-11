# Persisted pre-T18 database

`outbox-3.49.1.db` was created before changing the dependency, using the actual
Microsoft.Data.Sqlite 10.0.3 / SQLitePCLRaw 2.1.11 engine and unchanged UploadOutbox.
Actual SQL engine: SQLite 3.49.1; source ID:
`2025-02-18 13:38:58 873d4e274b4988d260ba8354a9718324a1c26187a4ab4c1cc0227c03d0f10e70`.
Size 86016 bytes; SHA-256 c9faaa288e8a6573293b7550e9df70c39b8b545196917ee97e46115f84a24c22.

Generation: `Collect.LowConfidence()` (existing fixture parser/assembler, explicitly
SYNTHETIC whole-list Skills coverage and two uncertain readings), enqueue sealed
capture, CompleteCrop for /stats/gut, Fail for /sparks/3/sparkId with HTTP 503,
fixed clock 2026-10-03T00:00:00Z. Two pending rows remain, one saved crop key,
verified payload hash and no acknowledgement. Capture ID
01K7B33MXGVZV6TZRJZDHB99YE, fingerprint
a0fbe2ae6c6940891c087bfbfb106365a845b099564da1c3074bd310c1761d4a.
No credentials or real-user database content. This is database compatibility
input, not game completion evidence. Do not regenerate with the new engine:
that would erase the pre-upgrade-file coverage. Generator and real RED output
are retained in docs/changelog/assets/T18.
