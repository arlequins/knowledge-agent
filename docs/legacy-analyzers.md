# Legacy analyzer extension

The template does not ship a universal parser. `@arlequins/agent-core` exposes
`LegacyAnalyzerPort` and `createLegacyAnalyzerRegistry` so a derived repository
can add Java/Spring, Ruby/Rails, C#/ASP.NET, or another parser independently.

Each analyzer must provide a stable `id`, supported languages, a `supports`
probe, and an `analyze` function. The registry orders analyzers by id,
rejects duplicates, fails closed when no parser supports a file, and bounds
untrusted output (100 symbols/routes/models, 50 fields, 20 diagnostics).
Results include project type, symbols, routes, data models, confidence, and
source provenance. Store the source URI and commit in the derived adapter so
answers can cite an exact revision.

The registry treats analyzers as untrusted adapters. It snapshots each
registration, rejects duplicate canonical IDs and language mismatches, and
binds result provenance to the caller-provided source URI. Invalid timestamps
and identity changes fail closed before output can enter retrieval or citations.
Java, Ruby, and C# have built-in filename detection. Additional normalized
language IDs such as `cobol` work through an explicit input `language` and a
matching adapter registration, without changing the core package.

Keep parsers out of the browser and run them in a bounded worker. Do not put
raw source or personal data in public evaluation fixtures. A parser result is
evidence to retrieve and review; it is not an instruction to execute code.

See the [Japanese](legacy-analyzers.ja.md) and [Korean](legacy-analyzers.ko.md)
versions for localized onboarding.
