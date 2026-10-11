# Superseded erroneous provenance evidence — T19 review B4

`sol-provenance-fidelity.log` is retained byte-for-byte as historical Sol fix1 evidence.
Its runtime/host source claims on lines8–9 and30 are WRONG. The metadata echoed there
is not evidence of the repository commit inside either exact hash-pinned nupkg.
Do not cite it as a successful nuspec observation or as current source provenance.

Both actual .NET8.0.31 runtime/host nuspecs identify
`1219a42122cf5190c7f512850557e38c422430dc`, the SAME commit as the embedded PE identity.
The previous distinct nuspec-versus-PE claim is disproved. The delivered licence bytes
and package hashes are unchanged. See changelog Review round2 and `../r2/sol-fetch-provenance.log`
for fresh download commands and actual archive/upstream observations, and
`../r2/sol-gates-completed.log` for executable hash-pinned provenance/negative checks.
