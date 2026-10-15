# Claude for Open Source readiness

Last verified: 2026-10-07

Official program page: <https://claude.com/contact-sales/claude-for-oss>

## Honest status

ProjectMind is technically ready to demonstrate, but it is **not yet eligible by a verified published threshold**. Do not submit an application that implies otherwise.

The official page currently lists these routes:

| Route | Published threshold | ProjectMind status |
| --- | ---: | --- |
| Maintainer / library author | 500 dependent repos, 100 dependent packages, or 200,000 combined monthly registry downloads | Not met or verified |
| Core contributor | Listed committer or maintainer on a recognized foundation or language project | Not met or verified |
| Active contributor | 100 merged PRs into repos the applicant does not own in the last 12 months | Not met or verified |
| Community builder | One repo with 20 unique external contributors with merged PRs in the last 12 months | Not met; external contribution target remains open |
| Critical infrastructure | Maintained repo with OpenSSF criticality score of 0.4 or above | Not met or verified |

Anthropic also says maintainers of quietly depended-on ecosystem projects may apply even when they do not neatly fit. That is discretionary language, not a threshold ProjectMind should claim to satisfy today.

## Application assets already complete

- Public repository: <https://github.com/callabens/ProjectMind>
- Product site and online read-only MCP: <https://projectmind-tau.vercel.app/>
- npm development preview: `@callabens/projectmind@next`
- Final 21-second trust-gate demo recording; public GitHub attachment pending
- Deterministic `NOT_VERIFIED → VERIFIED → NOT_VERIFIED` runner
- CI across Node 22/24, macOS and Windows
- Self-verification contract and historical ProofPack artifact
- Independent released-package pilot against `broofa/airjs`
- Claude Web custom connector pilot
- Apache-2.0 license, contribution guide, issue templates and security policy

These make the project understandable and reviewable. They do not replace eligibility evidence.

## Evidence to collect before applying

1. Select one realistic eligibility route. The community-builder route is the most directly connected to the current roadmap.
2. Accept useful contributions from genuine external contributors; never split work or manufacture PRs to inflate counts.
3. Publish stable releases and record registry download data from the registry source.
4. Record dependents, contributors and download metrics with dated source links.
5. Re-check the official program page on the application date because thresholds can change.

## Draft application narrative

Use this only after one eligibility route is supported by current evidence.

> ProjectMind is an Apache-2.0, local-first verification layer for AI coding agents. It addresses a specific trust problem: an agent saying “done” is a claim, not evidence. ProjectMind binds explicit requirements to fresh checks, inspects repository state, and derives fail-closed verdicts in a deterministic core that does not require a model API.
>
> The project ships a TypeScript CLI, an MCP server, a GitHub Action, a versioned ProofPack schema, JS/TS and Python analysis, Project Constitution policies, coverage-aware requirement bindings, and provider SDK foundations. Its public demo shows the same repository move from NOT_VERIFIED to VERIFIED and back to NOT_VERIFIED after a real regression, without reusing stale evidence.
>
> Claude Code is central to the maintainer workflow and ProjectMind is designed to make agentic coding safer across Claude Code and other MCP-capable clients. Program support would be used for sustained maintenance, compatibility testing, contributor review, documentation, and real-world pilots—not to add a model dependency to the deterministic verification boundary.

Before submission, append one short paragraph containing the selected eligibility route and dated evidence. Do not insert projected metrics.

## Go / no-go rule

Apply only when all of the following are true:

- one official eligibility route is supported by dated public evidence;
- the repository, npm package, site and demo links are public and healthy;
- recent releases and maintenance activity are visible;
- the application narrative contains no projected or invented adoption claims.

Until then, status is **NO-GO: continue genuine adoption and contribution work**.
