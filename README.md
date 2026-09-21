# @typesafe-ai/n8n-nodes-typesafe-ai

This is an n8n community node. It lets you use [TypeSafe AI](https://typesafe.ai) in your n8n workflows.

TypeSafe AI answers typed questions about a piece of state — yes/no, a choice between your own options, or a score against your own rubric — and returns a calibrated probability with every answer, so you can branch on how sure the model actually is.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

[Installation](#installation)
[Operations](#operations)
[Credentials](#credentials)
[Compatibility](#compatibility)
[Usage](#usage)
[Resources](#resources)
[Version history](#version-history)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

## Operations

### Evaluate

Evaluates one state against one or more questions and returns the answers on a single output. Each question is one of three types:

| Type | Answer |
| --- | --- |
| Noul (Yes/No) | The probability of yes, between 0 and 1 |
| Choice | The option the model picked, plus a confidence |
| Score | A weighted score and the most likely level, plus a confidence |

Questions can be built with the fields in the node, or supplied as raw JSON when you generate them from data.

With **Simplify Output** on (the default) each answer is reduced to a `value`, plus `level` and `confidence` where the question type has them:

```json
{
  "answers": {
    "is_urgent":   { "value": 0.95 },
    "department":  { "value": "billing", "confidence": 0.81 },
    "frustration": { "value": 1.05, "level": "Frustrated", "confidence": 0.92 }
  },
  "model": "jev-1.13.0"
}
```

Turn it off to get the API's answers unchanged, along with token `usage`.

### Route

Evaluates one state against a single choice question and sends the item to the output matching the answer. Every route you configure becomes its own output, labelled with the route's name.

```json
{
  "route": {
    "route": "billing",
    "confidence": 0.81,
    "lowConfidence": false,
    "probabilities": { "billing": 0.88, "technical": 0.12, "sales": 0.0 }
  },
  "model": "jev-1.13.0"
}
```

**Confidence Handling** decides what happens when the model is unsure:

- *Route to Best Option* (the default) sends every item to its chosen route, however unsure the model was.
- *Route to Separate Fallback Output* appends one extra output, `Fallback`, and sends items answered below **Confidence Threshold** there instead of to the chosen route.

## Credentials

You need a TypeSafe AI account and an API key from the [console](https://console.typesafe.ai/keys). Create a **TypeSafe AI API** credential in n8n and paste the key into **API Key**. Use the credential's test button to confirm it works.

## Compatibility

Built and tested against the n8n version that `@n8n/node-cli` currently ships with (`n8n-workflow` 2.39). No known incompatibilities.

## Usage

### The state is shared by every question

All questions in one Evaluate run see the same state, so a single request can answer several things about one ticket, message or record at once. **State Format** decides where that state comes from: plain **Text**, a **JSON** object or array, or the **Input Item** itself.

### Input fields are kept, and can be overwritten

**Include Other Input Fields** is on by default, so the incoming item's fields are kept alongside the result and its binary data is carried through. The node writes its own fields over them, which means an incoming field named `answers`, `route` or `model` is **replaced**. Turn **Include Other Input Fields** off if you need to keep such a field — the node then emits only its own fields, and drops binary data.

### Pinning a model

`jev-latest` moves with every new release. Pin a version such as `jev-1.13.0` in the **Model** field to keep answers stable over time. Versioned IDs are accepted even when they do not appear in the model list.

### Errors

A failed request surfaces with its HTTP status and the API's own description. Enable **Retry On Fail** on the node to retry rate-limited or overloaded requests, and **Continue On Fail** to emit the failing item with an `error` field and carry on with the rest. In Route, a failing item goes to the `Fallback` output where one is enabled, so a failure is never mistaken for a routing decision.

## Resources

* [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
* [TypeSafe AI API reference](https://docs.typesafe.ai/api)
* [TypeSafe AI quickstart](https://docs.typesafe.ai/introduction/quickstart)

## Version history

See [CHANGELOG.md](CHANGELOG.md).
