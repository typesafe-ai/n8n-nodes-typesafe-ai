# TypeSafe AI node — specification

Normative specification for the `TypeSafe AI` n8n community node. Every
requirement is stated so that an implementation can be checked against it.

- **MUST** / **MUST NOT** — required; a violation is a defect.
- **SHOULD** — strong default; deviation needs a recorded reason.
- **MAY** — permitted.

This document specifies *what the node does* for the person using it. It does
not name internal parameters, files or functions; those belong to the
implementation.

Names shown in code formatting are the TypeSafe API's own, reproduced from
<https://docs.typesafe.ai/api>, or keys of the node's output.

---

## 1. Scope

A single node exposing two operations:

| Operation | Purpose |
| --- | --- |
| Evaluate | Evaluate one state against one or more typed questions. One main output. |
| Route | Evaluate one state against a single Choice, Noul or Score question and send the item to the matching output. Dynamic outputs. |

---

## 2. Package

| Field | Value |
| --- | --- |
| `name` | `@typesafe-ai/n8n-nodes-typesafe-ai` |
| `license` | `MIT` |
| `author.name` | `TypeSafe AI` |
| `author.email` | `support@typesafe.ai` |
| `repository.type` | `git` |
| `repository.url` | `git+https://github.com/typesafe-ai/n8n-nodes-typesafe-ai.git` |
| `homepage` | `https://github.com/typesafe-ai/n8n-nodes-typesafe-ai#readme` |
| `bugs.url` | `https://github.com/typesafe-ai/n8n-nodes-typesafe-ai/issues` |
| `keywords` | MUST include `n8n-community-node-package` |
| `files` | `["dist"]` |

Requirements:

1. `dependencies` MUST be absent or `{}`.
2. `peerDependencies` MUST be exactly `{ "n8n-workflow": "*" }`.
3. The package MUST ship no third-party runtime code. Modules on n8n's import
   allowlist — `zod`, `p-limit`, `lodash`, `moment`, `luxon` — MUST NOT be used
   either.
4. There MUST be no `preinstall` or `postinstall` script.
5. The `n8n` section MUST register the node and the credential from their built
   locations, and MUST NOT retain the scaffold's example entries.
6. `n8n.strict` MUST be `true`.
7. The package MUST be published from GitHub Actions with an npm provenance
   statement.
8. The repository MUST be public, `repository.url` MUST resolve to it, and the
   npm publisher MUST match the repository owner.

Dev dependencies are exempt from rules 1–3.

---

## 3. Credential

Identified as `typeSafeAiApi` and displayed as **TypeSafe AI API**.
Documentation link: `https://docs.typesafe.ai/`. It MUST
carry the node's light and dark icons.

### 3.1 Fields

| Label | Visible | Required | Default | Purpose |
| --- | --- | --- | --- | --- |
| API Key | yes, masked | yes | — | Bearer token for the API |
| Base URL | no | no | `https://api.typesafe.ai` | Host the node calls |

1. The API key MUST be stored and displayed as a password field.
2. The base URL MUST be present in the credential schema but hidden from the
   credential UI, so n8n Connect can set it without exposing a free-text host
   box to every user.
3. No secret may be hardcoded anywhere in the package.

### 3.2 Behaviour

1. Every request MUST authenticate with the header
   `Authorization: Bearer <api key>`.
2. The effective host is the base URL when it holds a non-blank value,
   otherwise the default above. Surrounding whitespace and trailing slashes
   MUST be ignored.
3. The credential MUST offer a test that issues `GET {host}/v1/models` and
   reports success or failure to the user.

---

## 4. Node identity

| Property | Value |
| --- | --- |
| Display name | `TypeSafe AI` |
| Identifier | `typeSafeAi` |
| Group | `transform` |
| Version | `1` |
| Description | `Ask TypeSafe typed questions and get calibrated probabilities` |
| Default instance name | `TypeSafe AI` |
| Subtitle | The selected operation |
| Inputs | One main input |
| Outputs | Per §8.3 |
| Credential | The credential in §3, required |

1. The node MUST ship separate light and dark SVG icons.
2. The node MUST be usable as an AI Agent tool.

### 4.1 Discovery metadata

The node's codex file MUST declare:

| Key | Value |
| --- | --- |
| `node` | `@typesafe-ai/n8n-nodes-typesafe-ai.typeSafeAi` |
| `categories` | `["Development", "Utility"]` |
| `resources.primaryDocumentation` | `https://docs.typesafe.ai` |
| `resources.credentialDocumentation` | `https://docs.typesafe.ai/introduction/quickstart` |
| `alias` | see below |

`node` MUST be the package name followed by the node identifier.

`categories` MUST NOT include `AI`. That value opts a node into n8n's AI
sub-node system, which hides anything not declared as an AI root node from both
the node panel and search. This node is an ordinary transform node.

`alias` MUST be populated; it drives n8n Connect discoverability:
`typesafe`, `jev`, `classify`, `classification`, `route`, `routing`, `triage`,
`guardrail`, `moderation`, `score`, `rank`, `extract`, `system one`,
`probability`, `confidence`.

---

## 5. Parameters

Fields are identified by the label the user sees.

1. A field MUST be shown only for the operations listed against it. Nothing
   except **Operation** is unconditionally visible.
2. Fields within a list entry are displayed in the order the entry declares
   them. That order MUST read as the user fills the entry in: first the field
   that decides what the rest of the entry looks like, then the field
   identifying the entry, then the field describing it, then anything
   optional.
3. Two fields meaning the same thing in different lists MUST carry the same
   label and occupy the same position in both.

### 5.1 Operation

Required. Default **Evaluate**.

| Label | Behaviour |
| --- | --- |
| Evaluate | Evaluate the state against System One questions and output answers. |
| Route | Evaluate the state against a System One question and send the item to the matching output. |

The operation MUST NOT be settable by expression, so an AI Agent cannot change
it at runtime.

**Route** MUST NOT be offered when the node is used as an AI Agent tool. A tool
hands its result straight back to the agent, so Route's outputs would connect
to nothing and every item would reach the agent alike. Only **Evaluate** is
offered there.

### 5.2 Model

Required, both operations. Default `jev-latest`.

The user MUST be able to either:

1. **Pick from a list** of the models their account can use, fetched live from
   the API, searchable, each entry showing the model's description and release
   date; or
2. **Enter an ID directly**, for example `jev-1.13.0`.

A directly entered ID MUST be accepted even when it does not appear in the
list, because the API accepts versioned IDs it does not advertise.

Help text MUST tell the user that aliases such as `jev-latest` move with new
releases and that pinning a version keeps answers stable.

### 5.3 State

**State Format** — required, both operations, default **Text**.

| Label | What is sent as the state |
| --- | --- |
| Text | The content of the **State** field. |
| JSON | The parsed content of the **State** field, as an object or array. |
| Input Item | The incoming item's JSON, unchanged. |

**State** — shown for Text. Required, multi-line. If an expression resolves it
to an object, that object MUST be sent as structured state rather than
stringified. A blank value is an error.

**State** — shown for JSON. Required, JSON editor, defaulting to a minimal
object. The value MUST parse to an object or array.

Both state fields carry the same label. Only one is ever visible, so the user
always sees a single field called **State**.

Help text MUST state that every question sees the same state.

### 5.4 Questions — Evaluate only

**Questions Format** — required, default **Using Fields Below**.

| Label | Behaviour |
| --- | --- |
| Using Fields Below | Build the questions from the list below. |
| Using Raw JSON | Take the questions map as written, supporting structured instructions and criteria. |

**Questions** — shown for Using Fields Below. A reorderable list, one entry per
question, each entry titled by its **ID**. Each entry has:

| Label | Required | Shown when | Meaning |
| --- | --- | --- | --- |
| Question Type | yes | always | Choice, Noul (Yes/No) or Score. Default Noul. |
| ID | yes | always | The key the answer is returned under. Not sent to the model. |
| Instructions | yes | always | The question itself. |
| Choice Options | yes | Choice | The list of options to choose between. See below. |
| Levels | yes | Score | The ordered list of levels. See below. |
| True Means | no | Noul | What a yes (value near 1) means. |
| False Means | no | Noul | What a no (value near 0) means. |

**Choice Options** is a reorderable list nested inside the question, with an
*Add Option* button. Each entry is titled by its **Name**. Each entry
has:

| Label | Required | Meaning |
| --- | --- | --- |
| Name | yes | The option, sent to the API and returned as the answer. |
| Description | no | A description of that option, used as its rubric. |

**Levels** is a reorderable list nested inside the question, with an
*Add Level* button. Each entry is titled by its position and its **Level**
text, as in `Level 3: Frustrated`, keeping the position even while the text is
blank so that the order stays readable as the list is filled in. Each entry
has:

| Label | Required | Meaning |
| --- | --- | --- |
| Level | yes | What this level describes. |

Both lists MUST start with two empty entries, matching their minimum, so the
user sees the shape a usable question needs rather than having to discover it.

Ordering differs between the two: a Score's level order is meaningful and runs
from lowest to highest, whereas a Choice's option order carries no meaning and
is presentational only.

Counts are bounded: two to 255 options, two to ten levels, and at least one
question. Where the editor can enforce a bound it MUST, reporting it as a
problem with the node before the workflow runs. It cannot do so for a list
nested inside another list, which is the case for **Choice Options** and
**Levels**.
Every bound MUST therefore be checked at run time as well, which is in any
case the only check that applies to **Using Raw JSON**.

Hand-authoring does not scale to large option sets. **Using Raw JSON** remains the
way to supply options generated from data.

No confidence control may be offered for a Noul question; the API returns no
confidence for one.

**Questions** — shown for Using Raw JSON. Required, JSON editor, defaulting to
a single worked example. It carries the same label as the list above; only one
is ever visible.

### 5.5 Routes — Route only

A route is decided by one question, of any of the three types.

| Label | Required | Default | Shown when | Meaning |
| --- | --- | --- | --- | --- |
| Question Type | yes | Choice | always | Choice, Noul (Yes/No) or Score. |
| Instructions | yes | — | always | What the model should decide. |
| Routes | yes | — | Choice | A reorderable list of two to 255 routes; each entry becomes an output. |
| Confidence Handling | no | Always Route | Choice | See §8.3. |
| Confidence Threshold | no | `0.5` | Choice, and a Fallback output enabled | Range 0–1. |
| True Means | no | — | Noul | What a yes (value near 1) means. Also labels the output. |
| False Means | no | — | Noul | What a no (value near 0) means. Also labels the output. |
| True Probability Threshold | no | `0.5` | Noul | At or above this, the item is a yes. Range 0–1. |
| False Probability Threshold | no | `0.5` | Noul | At or below this, the item is a no. Range 0–1. |
| Levels | yes | two empty entries | Score | A reorderable list of two to ten levels, lowest first; each entry becomes an output. |

Confidence Handling and Confidence Threshold are offered only for a Choice,
because the API returns no confidence for a Noul. The Noul equivalent is the
gap between the two thresholds, per §8.3. A Score sends every item to the level
nearest its score, per §8.3.

The **True Probability Threshold** MUST NOT be below the **False Probability
Threshold**. The two would then overlap, leaving an answer between them
belonging to both outcomes; that MUST be reported as a configuration problem
per §7.

Each **Routes** entry is titled by its **Name**:

| Label | Required | Meaning |
| --- | --- | --- |
| Name | yes | Sent to the API as the Choice option, and used as the output's label. |
| Description | no | The criteria for choosing this option. |

Each **Levels** entry is titled and filled in exactly as a Score question's
levels in §5.4.

A route's **Name**, a level's **Level**, the **Question Type**, both meanings
and both thresholds MUST NOT be settable by expression. Between them they decide how many outputs
the node has and what each is called, and that is resolved in the editor before
the workflow runs.

A route is a Choice option, so by §5 rule 3 its fields carry the same labels as
an option's.

### 5.6 Options

A collection, shown for both operations unless noted.

| Label | Type | Default | Meaning |
| --- | --- | --- | --- |
| Include Other Input Fields | boolean | `true` | Keep the incoming item's fields alongside the result. |
| Simplify Output | boolean | `true` | Keep each answer's value and confidence instead of returning the full response. Applies to both operations. |
| Timeout | number, min 1000 | `5000` | Time in ms to wait for the server to send response headers (and start the response body) before aborting the request |

There MUST NOT be an option for renaming the output field. See §8.4.

---

## 6. Request

One request per input item, to `POST {host}/v1/systemone`, carrying exactly
`state`, `model` and `questions`.

### 6.1 Questions for Evaluate

Each configured question becomes one entry in the `questions` map, keyed by its
**ID**, carrying its type and `instructions` plus:

| Question Type | `criteria` sent |
| --- | --- |
| Choice | A map of option to description, with `null` where no description was given. |
| Score | An ordered array of level descriptions, lowest first. |
| Noul | An object with the given `true` and/or `false` meanings. Omitted entirely when both are blank. |

**Choice options** are sent in the order listed, each **Name** mapped to its
**Description** text, or to `null` where that is blank.

**Score levels** are sent as an array of the **Level** values, in the order
listed, lowest first.

### 6.2 Question for Route

Exactly one question, of the selected **Question Type**, under a fixed ID the
node chooses and the user never sees. Its `instructions` are the
**Instructions** field.

For a Choice, its `criteria` map each route's **Name** to its **Description**
text, or `null` when blank. For a Noul, its `criteria` carry the given **True
Means** and **False Means**, and are omitted entirely when both are blank —
exactly as for a Noul question in §6.1. For a Score, its `criteria` are the
**Levels**, sent exactly as for a Score question in §6.1.

---

## 7. Validation

Configuration problems MUST be reported against the item that caused them,
before or instead of calling the API.

---

## 8. Output

### 8.1 Evaluate, simplified (default)

One output item per input item:

```json
{
  "answers": {
    "is_urgent":   { "noul": 0.95 },
    "department":  { "choice": "billing", "confidence": 0.81 },
    "frustration": { "score": 1.05, "confidence": 0.92 }
  },
  "model": "jev-1.13.0"
}
```

| Question Type | Keys under each answer |
| --- | --- |
| Noul | `noul` — the probability of yes (0–1) |
| Choice | `choice` — the chosen option; `confidence` |
| Score | `score` — the position along the levels; `confidence` |

1. The container MUST be named `answers` and keyed by question ID.
2. Each answer MUST be a nested object, not a set of sibling keys distinguished
   by suffix. A question may legitimately be named after another question's
   attribute, and nesting makes that impossible to collide.
3. `model` MUST be the versioned ID the API reports, not the requested alias.
4. Each key MUST carry the API's own name and value. Simplifying keeps the
   answer's value and `confidence` and leaves out `type`, `probabilities` and
   `legend`; it MUST NOT rename, derive or add a key.

### 8.2 Evaluate, raw (Simplify Output off)

```json
{ "answers": { }, "model": "jev-1.13.0", "usage": { "input_tokens": 296, "output_tokens": 20 } }
```

`answers` MUST be the API's map unchanged. Token `usage` MUST appear only here.

### 8.3 Route

`route` MUST be the answer to the route question exactly as §8.1 or §8.2 would
present it for the current **Simplify Output** setting. Token `usage` appears
under the same rule as §8.2, only when **Simplify Output** is off.

Choice, simplified and raw:

```json
{ "route": { "choice": "billing", "confidence": 0.81 }, "model": "jev-1.13.0" }
```

```json
{ "route": { "type": "choice", "choice": "billing", "confidence": 0.81,
             "probabilities": { "billing": 0.88, "technical": 0.12 } },
  "model": "jev-1.13.0",
  "usage": { "input_tokens": 296, "output_tokens": 20 } }
```

Noul, simplified and raw:

```json
{ "route": { "noul": 0.85 }, "model": "jev-1.13.0" }
```

```json
{ "route": { "type": "noul", "noul": 0.85 },
  "model": "jev-1.13.0",
  "usage": { "input_tokens": 296, "output_tokens": 20 } }
```

Which outcome an item met is told by the output it leaves from; it is not
repeated in the data.

Outputs for a **Choice**:

1. One output per configured route, in the order the routes are listed,
   labelled with the route's **Name**.
2. When **Confidence Handling** is *Route to Separate Fallback Output*, one
   further output labelled `Fallback` is appended last. An item goes
   there when its confidence is below **Confidence Threshold**.
3. When it is *Always Route*, there is no extra output and every
   item follows the chosen route.

Outputs for a **Noul**, in this order:

4. One output for a yes, labelled with **True Means** or `True` when that is
   blank. An item goes there when its value is at or above the **True
   Probability Threshold**.
5. One output for a no, labelled with **False Means** or `False` when that is
   blank. An item goes there when its value is at or below the **False
   Probability Threshold**.
6. When the thresholds leave a gap between them, one further output labelled
   `Uncertain` is appended last, and an item whose value falls in the gap goes
   there. With the thresholds equal there is no gap, no third output, and every
   item is a yes or a no.

Outputs for a **Score**:

7. One output per level, in the order the levels are listed, labelled with the
   level's text, or `Level N` (its position, from 0) while that is blank.
8. An item goes to the level nearest its score: level *i* takes scores from
   *i* − 0.5 up to, but not including, *i* + 0.5. A score exactly halfway goes
   to the higher level. A score below the lowest level or above the highest
   goes to that end.

Score, simplified:

```json
{ "route": { "score": 1.3, "confidence": 0.9 }, "model": "jev-1.13.0" }
```

9. The outputs shown in the editor MUST match those produced at runtime.

### 8.4 Common rules

1. Every output item MUST be traceable to the input item it came from.
2. With **Include Other Input Fields** on (default), the incoming item's fields are
   kept and the node's fields written over them, and binary data is carried
   through. With it off, only the node's fields are emitted and binary data is
   dropped.
3. An incoming field named `answers`, `route` or `model` is therefore
   overwritten. This MUST be documented in the README; turning **Include Input
   Fields** off is the way to avoid it.

---

## 9. Errors

### 9.1 Failures

An unsuccessful response MUST surface as an API error
carrying the HTTP status and a human-readable description taken from the
response body. A 422's field-by-field `detail` list MUST be flattened into one
readable sentence rather than shown as raw JSON. No error may be silently
discarded.

### 9.2 Oversized requests

There MUST be no pre-flight size check. A request exceeding the API's token
budget surfaces the resulting 422 as in §9.1.

### 9.3 Continue on fail

When the workflow enables it, a failing item MUST be emitted with an `error`
field, and processing MUST continue with the remaining items. It goes to the
`Fallback` output where one is enabled, so that a failure is never
mistaken for a routing decision, and to the first output otherwise. Routing by
a Noul has no Fallback, so a failing item goes to the last output there —
`Uncertain` where one exists, and the no output otherwise. Routing by a Score
has neither, so a failing item goes to the first output.
**Include Other Input Fields** applies to it as it does to any other item.
The failing item MUST carry the error itself as well as the `error` field, so
that n8n's **Continue (using error output)** setting moves it to the error
output.
Otherwise the error stops the node and identifies the item that failed.
