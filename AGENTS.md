# TypeSafe AI n8n node

An n8n community node that calls TypeSafe's System One API (`POST /v1/systemone`). It has two operations, Evaluate and Route.

## Commands

- `npm run dev` starts n8n with the node loaded. Restart it after changing the node's fields, copy or icons.
- `npm test` runs the unit tests.
- `npm run lint` runs n8n's lint rules, which the node must pass for verification.
- `npm run build` compiles to `dist/`, which is all the npm package ships.

## Layout

- `nodes/TypeSafeAi/` holds the node. `descriptions.ts` has the fields and copy, `TypeSafeAi.node.ts` runs the requests and routing, `helpers.ts` builds questions and outputs, and `api.ts` makes the HTTP calls.
- `credentials/` holds the API key credential.
- `nodes/TypeSafeAi/SPEC.md` specifies the node's behaviour. Keep it in step with any change to the node.

## Rules

- Answers keep the API's own field names: `noul`, `choice`, `score`, `confidence`. Simplify only drops `type`, `probabilities` and `legend`.
- Copy follows n8n's UX guidelines: Title Case labels, sentence case descriptions, "e.g." placeholders, and parameter names in single quotes.
- The README documents the n8n side of the node and links to docs.typesafe.ai for TypeSafe concepts.

## Releasing

1. Set the version in `package.json` and `CHANGELOG.md`, and merge to `main`.
2. Push a tag with the same version, such as `0.9.0`. `.github/workflows/publish.yml` checks the tag and publishes to npm with provenance.
