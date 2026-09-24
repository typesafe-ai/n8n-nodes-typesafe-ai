# Changelog

All notable changes to this package are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.1.0

### Added

- **TypeSafe AI node** with two operations. **Evaluate** asks one or more typed
  questions about a piece of state and returns the answers on a single output.
  **Route** asks a single choice question and sends the item to the output
  matching the answer, with one output per configured route.
- **Three question types.** Noul returns the probability of yes, Choice picks
  one of your options, and Score rates the state against your own ordered
  levels. Each answer carries a calibrated confidence, except Noul, for which
  the API returns none.
- **Questions from fields or raw JSON.** Build them with the fields in the node,
  or supply the questions map as written when you generate options from data.
- **Three state formats.** Send plain text, a JSON object or array, or the
  incoming item itself. Every question in a run sees the same state.
- **Confidence-gated routing.** Route items answered below a configurable
  threshold to a separate `Fallback` output, or send every item to its
  chosen route regardless of confidence.
- **Yes/no routing.** Route can also ask a single yes/no question and split on
  the probability of yes, with a threshold for each outcome. Leaving a gap
  between the two adds an `Uncertain` output for the answers in between, so the
  model can decline to commit instead of guessing.
- **Model selection** from a searchable list fetched from the API, or by
  entering a version such as `jev-1.13.0` directly to keep answers stable.
- **Simplify Output** reduces each answer to a value, with the level and
  confidence where the question type has them. Turn it off for the API's
  response unchanged, including token usage. It applies to both operations: a
  routed item carries the same answer shape under `route`, plus the flag naming
  the decision.
- **Input fields are preserved** by default, with binary data carried through.
  The node's own fields are written over them, so an incoming `answers`, `route`
  or `model` field is replaced.
- **TypeSafe AI API credential** with a masked API key, a hidden base URL for
  n8n Connect, and a test that verifies the key against the API.
- Usable as an AI Agent tool.

