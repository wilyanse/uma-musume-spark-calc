# Agent dependency inventory for T19

SharpZipLib 1.4.2 (assembly ICSharpCode.SharpZipLib), MIT, copyright SharpZipLib Contributors.
Exact package SHA-256: fe0895aa2930a2b1b65caa9f37db8bca35125ebdf9cc1b99d855f6afc5ff5946.
Source: https://github.com/icsharpcode/SharpZipLib/tree/33f64eb0f28cdd2b084cb822fcc224c7c5aba553
Licence copy: SharpZipLib-1.4.2-LICENSE.txt, verbatim from upstream v1.4.2 LICENSE.txt.
Package: https://api.nuget.org/v3-flatcontainer/sharpziplib/1.4.2/sharpziplib.1.4.2.nupkg

T19 must deliver the copyright/permission text to recipients alongside all other bundled component notices.
This inventory does NOT modify publishing or make the current EXE legally ready for distribution.
No agent-v release until T19. No licence key, account, build target or native asset is required by this package.

## T18 SQLite pins and native engine

Microsoft.Data.Sqlite / Microsoft.Data.Sqlite.Core remain 10.0.3 (MIT).
The added exact reference SQLitePCLRaw.bundle_e_sqlite3 2.1.12 resolves the
provider.e_sqlite3, core and lib.e_sqlite3 packages to 2.1.12 on both targets.
Nuspecs identify these four packages as Apache-2.0, copyright
`Copyright 2014-2024 SourceGear, LLC`. Native SQLite itself is public domain,
not relicensed Apache-2.0; the native package metadata is Apache-2.0.
No key, paid service or custom initialization is needed.

Actual NuGet package SHA-256 (https://api.nuget.org/v3-flatcontainer/):
- sqlitepclraw.bundle_e_sqlite3.2.1.12.nupkg: a9a06e6b5a313f6ef3675f91997d012adeffe8aa9e1ffd69ed46a4e685b054e1
- sqlitepclraw.provider.e_sqlite3.2.1.12.nupkg: df2b3271992e5d719186c4671e3cf4f8658097c154cbcd41494ab594c5997595
- sqlitepclraw.core.2.1.12.nupkg: af06904138ffa6dc95a599133d64d254716d6facc7543a6b3b910793dae9dca5
- sqlitepclraw.lib.e_sqlite3.2.1.12.nupkg: 4a22c02ffcf489792903cf263def9fce27739716883f965f0b5eeff1637430ac

Source reference: https://github.com/ericsink/SQLitePCL.raw/tree/ca835d21508bff43121c65081035840ac5006c4c
(v2.1.12 tag resolved through GitHub API; nuspecs specify repository but no commit).
Retained verbatim upstream LICENSE.TXT and NOTICE.TXT:
- SQLitePCLRaw-2.1.12-LICENSE.txt: cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30
- SQLitePCLRaw-2.1.12-NOTICE.txt: 485b276b3d2bfaa26df348e1e5c84df3648981e09b88531a6a53006f0705c24b

The repository-wide NOTICE includes SQLCipher/OpenSSL sections; these are
preserved verbatim, not evidence those optional components ship with e_sqlite3.
T19 must determine applicable recipient notices from the actual package graph.

Loaded engine and both inspected native assets: SQLite 3.53.3, source ID
`2026-06-26 20:14:12 d4c0e51e4aeb96955b99185ab9cde75c339e2c29c3f3f12428d364a10d782c62`.
Upstream release/source identity: https://sqlite.org/releaselog/3_53_3.html
SQLite-3.53.3-LICENSE.md is verbatim from
https://github.com/sqlite/sqlite/blob/version-3.53.3/LICENSE.md
(SHA-256 ee6af51062b30d532991face5164136ae6f84e265ecf8abe89dc69dac45ca1e7).
- runtimes/osx-arm64/native/libe_sqlite3.dylib: 09fe20a6c050912a7944b2f2f2981debe31679f7919f523c87251ae8cf0f2daa
- runtimes/win-x64/native/e_sqlite3.dll: b7385d722c83fb52142a00477a726723745916d22a555711ee89834c1111fb2e

The T18 native publish probe checks exact package bytes, PE32+ AMD64, and
embedded source identity. That is not Windows execution (H4). These files and
metadata are an inventory only; required recipient delivery remains T19 and
still blocks every agent-v release. This is not a complete runtime inventory.
