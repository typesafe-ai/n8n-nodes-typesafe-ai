# Changelog

All notable changes to this package are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.9.0

Initial release.

### Added

- **TypeSafe AI node**, which calls TypeSafe's System One models. It has two
  operations:
  - **Evaluate** asks one or more Choice, Score and Noul (Yes/No) questions
    about a state and adds the answers to the item.
  - **Route** asks one Choice, Noul (Yes/No) or Score question and sends the
    item to the output that matches the answer.
- **Route outputs for each question type.** A Choice question gets one output
  per route, plus an optional `Fallback` output for answers below a confidence
  threshold. A Noul question gets True and False, plus an `Uncertain` output
  when the two thresholds are set apart. A Score question gets one output per
  level, with the boundaries halfway between levels.
- **Questions built from fields or raw JSON.** The JSON uses the API's own
  question format, so an earlier node can generate it.
- **State taken from text, JSON, or the incoming item.**
- **Model selection** from the models your API key can use, or by ID.
- **Options** to trim each answer to its value and confidence, keep the
  incoming item's fields, and set the request timeout.
- **Error handling** that works with n8n's **Retry On Fail** and both **On
  Error** continue settings, including the error output.
- **TypeSafe AI API credential**, which n8n tests against the API when you save
  it.
- **AI Agent tool support.** An agent can use the node to run Evaluate.
