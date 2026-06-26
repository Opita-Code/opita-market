# Skill Registry — opita-market

Generated: 2026-06-26
Project: opita-market
Mode: hybrid (openspec + dark-mem)
Source: scan of `~/.config/opencode/skills/`

This is an INDEX, not a generated summary. Subagents receive exact paths and read the full SKILL.md source of truth.
Excluded from scan: `sdd-*`, `_shared`, `skill-registry`.

## Available skills (32 total)

| Skill | Path | Trigger description (first 200 chars) |
| --- | --- | --- |
| agents-sdk | `~/.config/opencode/skills/agents-sdk/SKILL.md` | Build AI agents on Cloudflare Workers using the Agents SDK. Load when creating stateful agents, durable workflows, real-time WebSocket apps, scheduled tasks, MCP servers, chat applications, voice agents |
| bootstrap-deploy | `~/.config/opencode/skills/bootstrap-deploy/SKILL.md` | Trigger: deploy, desplegar, bootstrap, lanzar, publish, subir a prod. Manual 3-step AWS Lambda deploy flow for sociedad-opita (bootstrap.sh + cloudformation + lambda_deploy.py) |
| branch-pr | `~/.config/opencode/skills/branch-pr/SKILL.md` | Create dark-carder pull requests with issue-first checks. Trigger: creating, opening, or preparing PRs for review. |
| carding-checker | `~/.config/opencode/skills/carding-checker/SKILL.md` | Adversarial card-probe framework for fraud-prevention systems. Orchestrates multi-stage auth probes against operator-supplied gateway endpoints, classifies responses via 19-status canonical taxonomy, writes per-probe + per-run entries to engagement memory. Trigger: /carding-checker command or card-probe requests. |
| carding-luhn | `~/.config/opencode/skills/carding-luhn/SKILL.md` | Generate Luhn-compliant 16-digit card numbers from a 6-8 digit BIN prefix. Trigger: card generation requests, /carding-luhn command. |
| chained-pr | `~/.config/opencode/skills/chained-pr/SKILL.md` | Trigger: PRs over 400 lines, stacked PRs, review slices. Split oversized changes into chained PRs that protect review focus. |
| cloudflare | `~/.config/opencode/skills/cloudflare/SKILL.md` | Comprehensive Cloudflare platform skill covering Workers, Pages, storage (KV, D1, R2), AI (Workers AI, Vectorize, Agents SDK), feature flags (Flagship), networking (Tunnel, Spectrum), security (WAF, DDoS), and infrastructure-as-code (Terraform, Pulumi). Use for any Cloudflare development task. |
| cloudflare-email-service | `~/.config/opencode/skills/cloudflare-email-service/SKILL.md` | Send and receive transactional emails with Cloudflare Email Service (Email Sending + Email Routing). Use when building email sending (Workers binding or REST API), email routing, Agents SDK email handling, or integrating email into any app. |
| cloudflare-one | `~/.config/opencode/skills/cloudflare-one/SKILL.md` | Guides Cloudflare One Zero Trust and SASE work across Access, Gateway, WARP, Tunnel, Cloudflare WAN, DLP, CASB, device posture, and identity. |
| cloudflare-one-migrations | `~/.config/opencode/skills/cloudflare-one-migrations/SKILL.md` | Plans migrations from Zscaler ZIA/ZPA, Palo Alto, legacy VPN, SWG, or SASE stacks to Cloudflare One. |
| cloudflare-pages-deploy | `~/.config/opencode/skills/cloudflare-pages-deploy/SKILL.md` | Trigger: deploy web, deploy landing, deploy front, desplegar web, subir a sociedad.opitacode.com, deploy v0.X.0. |
| cognitive-doc-design | `~/.config/opencode/skills/cognitive-doc-design/SKILL.md` | Design docs that reduce cognitive load. Trigger: writing guides, READMEs, RFCs, onboarding, architecture, or review-facing docs. |
| comment-writer | `~/.config/opencode/skills/comment-writer/SKILL.md` | Write warm, direct collaboration comments. Trigger: PR feedback, issue replies, reviews, Slack messages, or GitHub comments. |
| dark-mem-tools | `~/.config/opencode/skills/dark-mem-tools/SKILL.md` | Full catalog of dark-mem v2 MCP tools (58 tools). Load when operator task needs a dark-mem operation not in standard tool list. |
| dark-pentester-free-tools | `~/.config/opencode/skills/dark-pentester-free-tools/SKILL.md` | Free, open-source, or always-free-tier alternatives for proxy, VPS, vuln lab, IoT/ICS testbed, and OSINT tooling in pentest engagements. |
| docker-pentest | `~/.config/opencode/skills/docker-pentest/SKILL.md` | Docker-based pentest environment for full scripting freedom. Use the dark-fuzzer-op container (Kali Linux with sqlmap, nmap, hydra, mysql, python3, curl, all pre-installed) to bypass PowerShell limitations on Windows. |
| durable-objects | `~/.config/opencode/skills/durable-objects/SKILL.md` | Create and review Cloudflare Durable Objects. Use when building stateful coordination (chat rooms, multiplayer games, booking systems), implementing RPC methods, SQLite storage, alarms, WebSockets. |
| go-testing | `~/.config/opencode/skills/go-testing/SKILL.md` | Trigger: Go tests, go test coverage, Bubbletea teatest, golden files. Apply focused Go testing patterns. |
| issue-creation | `~/.config/opencode/skills/issue-creation/SKILL.md` | Create dark-carder issues with issue-first checks. Trigger: creating GitHub issues, bug reports, or feature requests. |
| judgment-day | `~/.config/opencode/skills/judgment-day/SKILL.md` | Trigger: judgment day, dual review, adversarial review, juzgar. Run blind dual review, fix confirmed issues, then re-judge. |
| opencode-feature-lifecycle | `~/.config/opencode/skills/opencode-feature-lifecycle/SKILL.md` | Mandatory checklist before shipping a new opencode feature — agent .md file, slash command, plugin, MCP server, skill, or entire dark-* domain. |
| sandbox-sdk | `~/.config/opencode/skills/sandbox-sdk/SKILL.md` | Build sandboxed applications for secure code execution. Use when building AI code execution, code interpreters, CI/CD systems, interactive dev environments, or executing untrusted code. |
| secret-vault | `~/.config/opencode/skills/secret-vault/SKILL.md` | Trigger: save token, store api key, vault set/get. Persistent DPAPI-encrypted vault for API tokens and CLI credentials. |
| skill-creator | `~/.config/opencode/skills/skill-creator/SKILL.md` | Trigger: new skills, agent instructions, documenting AI usage patterns. Create LLM-first skills with valid frontmatter. |
| skill-improver | `~/.config/opencode/skills/skill-improver/SKILL.md` | Trigger: improve skills, audit skills, refactor skills, skill quality. Audit and upgrade existing LLM-first skills. |
| snowball-stack | `~/.config/opencode/skills/snowball-stack/SKILL.md` | Start, stop, restart, or check status of the local snowball + FOW stack. |
| turnstile-spin | `~/.config/opencode/skills/turnstile-spin/SKILL.md` | Set up Cloudflare Turnstile end-to-end in a project. |
| viral-content-craft | `~/.config/opencode/skills/viral-content-craft/SKILL.md` | Trigger: viral post, hook, engaging copy, LinkedIn post, tweet, TikTok script, reel, thread, carousel. |
| web-perf | `~/.config/opencode/skills/web-perf/SKILL.md` | Analyzes web performance using Chrome DevTools MCP. Measures Core Web Vitals (LCP, INP, CLS) and supplementary metrics. |
| work-unit-commits | `~/.config/opencode/skills/work-unit-commits/SKILL.md` | Plan commits as reviewable work units. Trigger: implementation, commit splitting, chained PRs. |
| workers-best-practices | `~/.config/opencode/skills/workers-best-practices/SKILL.md` | Reviews and authors Cloudflare Workers code against production best practices. |
| wrangler | `~/.config/opencode/skills/wrangler/SKILL.md` | Cloudflare Workers CLI for deploying, developing, and managing Workers, KV, R2, D1, Vectorize, Hyperdrive, Workers AI, Containers, Queues, Workflows, Pipelines, and Secrets Store. |

## Recommended skills for opita-market (priority)

| Phase | Skills |
| --- | --- |
| **Architecture/design** | cognitive-doc-design, workers-best-practices, cloudflare |
| **AI integration** | agents-sdk (for MCP server), wrangler (Cloudflare Workers AI as MiniMax fallback) |
| **Deploy** | bootstrap-deploy (reuses sociedad-opita pattern), cloudflare-pages-deploy |
| **Secrets** | secret-vault (DPAPI-encrypted, never paste MiniMax keys in plain text) |
| **Memory/context** | dark-mem-tools (full catalog) |
| **Quality/QA** | judgment-day (adversarial review before launch) |
| **Compliance** | Habeas Data (Ley 1581) NOT in skills catalog — manual legal review required |

## Scan rules applied

- Source: `~/.config/opencode/skills/*/SKILL.md`
- Excluded: `sdd-*`, `_shared`, `skill-registry`
- Deduplication: by skill name (project-level wins over user-level — no project skills found)
- Frontmatter only — full SKILL.md content read by subagents on demand
