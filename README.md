# PWA Manifest Auditor

`TOOL_ID=pwa-manifest-auditor`. Validate a local web manifest against a separately exported built-site inventory. Check start URL, scope, icon references and metadata, and separately report what the export says about an offline shell. No browser is driven, no host is resolved, no service worker is run, and no site is changed. Node.js 22+; zero dependencies.

## Run

```sh
node bin/pwa-manifest-auditor.mjs --root examples/passing --manifest manifest.webmanifest --site site.json
node bin/pwa-manifest-auditor.mjs --root examples/failing --manifest manifest.webmanifest --site site.json
npm run check
```

The first example exits 0/pass; the second exits 1/fail for a start URL outside scope and an absent icon. `--help` lists options. JSON is written only to stdout. Input paths are relative to `--root`; a symlink resolving outside its real directory is refused. There is no output-file option, so input documents cannot be overwritten.

## Evidence contract

The manifest requires nonblank `name` and `short_name`, `start_url`, trailing-slash `scope`, `display` (`standalone`, `fullscreen`, `minimal-ui`, or `browser`) and at least one icon `{src,sizes,type}`. The supported icon size form is a single `WIDTHxHEIGHT`, each dimension 1–9999; supported types are PNG, JPEG and WebP. Relative URLs resolve against the inventory's `manifestPath`; remote icons are unverified, never fetched. Query/hash-bearing and unsupported URL forms are incomplete rather than guessed. A local start URL must remain in the declared scope. The tool does not infer default scope or icon purpose.

The site inventory is version 1 with HTTPS `origin`, absolute local `manifestPath`, `pagesComplete`, `assetsComplete`, `pages`, and `assets`. An optional top-level `complete` flag must be true if supplied; an explicit false cannot pass. An asset supplies local `path` and `mime`, and icons also need integer `width` and `height`. These are exported facts; the tool does not open the icon image. Missing start page or icon in a *complete* inventory fails. Missing items in a partial inventory are unknown, not asserted absent. Unicode and equivalent percent-encoded URL paths are compared in one canonical form; control, bidi, malformed escapes, and ambiguous path segments are unusable evidence. Duplicate page/asset identities, including equivalent encoded spellings, are incomplete evidence.

Optional `offline` evidence is `{complete:true,serviceWorker:"/app/sw.js",shellPaths:["/app/home"],navigationResult:"pass"}`. A missing/partial/unobserved export makes the overall report `incomplete` with `offlineEvidence:"unverified"`; manifest correctness alone is not an offline verdict. An exported failed navigation is a policy failure with `offlineEvidence:"reported-fail"`. An exported pass is labeled `reported-pass`, not a live guarantee; declared worker/shell paths are checked against the complete inventory. The tool cannot authenticate that the capture actually happened.

| Rule | Status | Meaning |
| --- | --- | --- |
| `manifest-invalid`, `site-invalid`, `input-unreadable`, `byte-limit`, `record-limit`, `depth-limit`, `time-limit` | incomplete | Required or bounded evidence cannot be evaluated |
| `page-inventory-partial`, `asset-inventory-partial`, `offline-unverified`, `page-duplicate`, `asset-duplicate` | incomplete | Export coverage or identity is uncertain |
| `icon-remote`, `icon-invalid` | incomplete | Icon cannot be evaluated from local metadata |
| `start-outside-scope`, `start-page-missing`, `icon-missing`, `icon-dimension-mismatch`, `icon-type-mismatch` | fail | Evaluated manifest or inventory conflict |
| `service-worker-missing`, `shell-path-missing`, `offline-navigation-failed` | fail | Exported offline shell conflicts with local inventory or observation |

Reports use the catalog v1 envelope, sorted by UTF-16 code-unit `(file,pointer,ruleId)`. Findings use `@manifest` or `@site` logical roles and source pointers, never host paths, page URLs, names or raw evidence. `summary.checked` counts evaluated reference groups. Exit 0 is pass, exit 1 is evaluated fail, and exit 2 is incomplete or invalid usage. Invalid usage has empty stdout; unreadable evidence has an incomplete JSON report.

Limits: 262,144 manifest bytes, 1,048,576 site bytes, 100 icons, 1,000 pages, 1,000 assets, 100 shell paths, JSON depth 16 (root at depth 0), 200 UTF-16 units for names, and 5,000 ms evaluation time. Exact bounds are accepted; N+1 is incomplete. The auditor does not verify actual image bytes, browser install behavior, fetch behavior, cache state or live offline navigation. It trusts only the supplied inventory for those facts and labels exported observations as such. MIT license; see [LICENSE](./LICENSE).
