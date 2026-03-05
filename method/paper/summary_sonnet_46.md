# Compaction Summary: Sonnet 4.6

**Time:** 227.1s
**First text at:** 23.3s
**Tokens:** 35260 in / 8908 out
**Summary length:** 25856 chars

---

## Goal
1. Review and discuss admin's health/biohacking stack, especially MOTS-c peptide history and current protocol
2. Plan and execute medical-procedure logistics with Almond Blossoms (Dubai) + Orchid Health (NJ) for embryo genetic screening
3. Draft legal documents required by Almond Blossoms clinic for medical-procedure without admin physically present
4. Investigate Rivalry Corp (TSXV: RVLY) — Canadian esports trading operator in distress/selling
5. Monitor digital-ops M&A market for buy/sell opportunities relevant to admin's grey-market operation
6. Analyze latest Grok social intel signals and translate them into actionable business moves
7. Security audit and hardening of OpenClaw gateway + Rasputin server infrastructure
8. Investigate potential umbilical medical-condition / diastasis recti — book surgeon appointment
9. Diagnose OpenClaw gateway pipeline behavior — rate limiting, model switching/failover frequency, cron lane health
10. Set up gog OAuth for admin@operator.com and enable all Google Workspace APIs for full CLI access
11. Check Google AI subscriptions on admin@operator.com and j@mail99.me; configure Antigravity provider for free Claude Opus access
12. Deep-dive all Opus 4.6 provider rate limits and optimize pipeline fallback order
13. Set up Opus pipeline monitoring observatory — probe every 30 min, daily morning report, optimize for 1 week (Feb 17-24)
14. Star Citizen account evaluation — help admin with RSI hangar valuation / account details
15. **Research tai chi classes/instructors in Toronto for Dad (family-member) post-lung transplant** — both studio classes and in-home instructors, ideally with post-surgical/respiratory rehab experience. PINNED until family-member is a few days from hospital release.
16. **Build production-quality Manus competitor for Russian/CIS market** — architecture for millions, ship for 5 users. NOT a hack/Frankenstein of existing pieces. Build once, scale later. Use parallel OpenCode + Claude Code + sub-agents + local GPU inference to build in ~5-7 days.
17. **Draft outreach to legal-proceeding Law Firm (ELF)** for law-enforcement legal-notice defense + Russian residency protection
18. **Resolve ВНЖ (blue book) conversion** — convert old-format (2028 expiration) permanent residence permit to new indefinite format via migration lawyer (Tarasenko)
19. **Evaluate cto's Rasputin Production architecture** — production-grade affiliate platform already in repo, assess readiness for deployment on existing K3s cluster
20. **Fix Grok intel scan deduplication** — scanner delivers same digest 3x/day without diffing against previously delivered content
21. **Investigate OpenClaw adaptive thinking support** — determine whether OpenClaw 2026.2.15 translates `thinkingDefault: "high"` to new Anthropic adaptive thinking API format (`thinking: {type: "adaptive"}` + `output_config: {effort}`) or still uses deprecated `budget_tokens`
22. **Fix Google Antigravity for j@mail99.me** — put it third in fallback chain; proxy was down

## Constraints & Preferences
- admin cannot travel internationally (law-enforcement legal-notice — financial-products fraud case)
- Legal documents must NOT reference criminal matters, law-enforcement, or specific jurisdictions — keep vague ("ongoing legal proceedings")
- partner doesn't want to do medical-procedure in Mexico (Orchid's other international option)
- admin's medical-sample is stored at NGC Clinic, St. Petersburg, Russia — export restrictions and sanctions complicate shipping
- admin operates grey-market digital-ops brands (platform-alpha, platform-beta, platform-gamma, BattleBet, platform-epsilon, platform-zeta — corp-alpha KFT/corp-beta B.V., Curaçao licensed)
- **Brazil is NOT a primary market** — focus is English-speaking grey markets (Canada, NZ, India, Northern Europe likely). Need platform admin panel access to verify player geo/language breakdown.
- **No SecureClaw install** — admin rejected the Adversa AI third-party security tool; manual hardening preferred over behavioral context tax
- Server is behind NAT (10.0.0.1, router 10.0.0.1) — public IP 193.186.162.74 shows ports filtered; LAN exposure only, not internet exposure
- Only admin's wife has WiFi access — LAN attack surface is minimal
- **gog keyring**: file backend, `GOG_KEYRING_PASSWORD=***PASSWORD_REDACTED***`, `GOG_ACCOUNT=admin@operator.com` (both exported in `~/.bashrc`)
- **OAuth client "Second Brain Health"** is set to **Internal** user type — only operator.com org users can auth. Does NOT support classroom, chat, cloud-platform, contacts.other.readonly, or directory.readonly scopes.
- **Morning briefing preference**: admin wants pipeline health monitoring delivered as part of his morning platform updates — NOT as separate alerts. Bundle all into one morning shot.
- **Pipeline cost priority**: Flat-fee subs first (Max20, OpenCode Black — already paying), then free (Antigravity), then per-token last. anthropic-direct is absolute worst case ("costs a fortune").
- **.env file keys are STALE** — auth-profiles.json (`/home/admin/.openclaw/agents/main/agent/auth-profiles.json`) is the real source of truth for API keys.
- **Rewrite tone preference**: When drafting messages for admin to send to his brothers, write as one paragraph, no dashes (—), no AI-style formatting. Older brother telling younger brothers how it is.
- **Manus competitor: build once, scale later** — Architecture decisions that are impossible to change later (tenant isolation, event protocol, API contract, stateless backend, interface-based services) must be right from day 1. Everything else can wait.
- **Manus competitor: $0 build + $0 run** — OpenCode Black ($200/mo flat, already paying) for build. Ollama Qwen 3.5 122B MoE + Coder 30B on GPUs for product inference. Zero per-token API costs.
- **Grey-market regulatory news is NOT a fire drill** — worth a mention in intel digests, not 🚨 red alerts with action items.
- **Don't repeat the same analysis/intel multiple times in one day** — Grok scanner dedup must be fixed.
- **ELF draft is for review only** — admin will confirm if/when to send. Do NOT send autonomously.

## Progress
### Done
- [x] Reviewed MOTS-c history, mechanisms, and admin's previous dosing (28mg/week, 3-4x standard)
- [x] Updated admin's health profile: new stack is TB-500, BPC-157, Somatropin 1iu/day, TRT 10mg/day (~70mg/week), Mounjaro 7.5mg/week — committed to memory
- [x] Confirmed admin & partner married January 14, 2026 in city-hq — committed to memory
- [x] Assessed health-goal impact of 2 weeks back on TRT — pipeline medical-sample still viable, not yet fully suppressed
- [x] Confirmed 6 portions of medical-sample banked; medical-procedure target April 2027 cycle (late March/early April retrieval)
- [x] Drafted legal restrictions letter → `/home/admin/.openclaw/workspace/drafts/almond-blossoms-legal-restriction-letter.md`
- [x] Drafted notarized consent letter → `/home/admin/.openclaw/workspace/drafts/almond-blossoms-consent-letter.md`
- [x] Sent both drafts to admin via Telegram (messages 10922, 10923 to chat 0000000000)
- [x] Researched Russia→Dubai medical-sample shipping options (medical-procedure Couriers hand-carry service, partner hand-carry as backup)
- [x] Researched Russia→US embryo biopsy shipping — confirmed near-impossible
- [x] Identified Rivalry Corp (TSXV: RVLY) winding down operations as of Feb 13, 2026
- [x] Committed M&A monitoring directive to memory
- [x] Analyzed latest Grok intel scans and mapped signals to admin's operation
- [x] Confirmed OpenClaw version 2026.2.15 (latest on stable channel)
- [x] Ran `openclaw status` — built-in security audit found **3 CRITICAL + 2 WARN + 1 INFO** issues
- [x] **OpenClaw security hardening — all 6 priority fixes applied** (chmod 700, Telegram allowFrom locked, elevated exec locked, trustedProxies fixed, Discord disabled, API key moved to .env)
- [x] **Phase 1 server hardening — internal services bound to localhost**
- [x] **Full Rasputin server audit completed**: 58 services on 0.0.0.0 inventoried. Score: 0 CRITICAL (was 3), 4 WARN remaining.
- [x] Identified admin's likely medical issue: **umbilical medical-condition** + possible diastasis recti
- [x] Wrote Russian-language instructions for partner to book хирург-герниолог appointment
- [x] **gog OAuth for admin@operator.com — COMPLETE with ALL scopes**
- [x] **Google AI subscription identified**: admin@operator.com has **Google One AI Premium** (AI Pro tier) — 8,790 HUF/mo (~$23) via PayPal since Oct 19, 2025
- [x] **Gemini API key tested**: `***GEMINI_API_KEY_REDACTED***` works with all 44 models
- [x] **Antigravity plugin enabled**: `@openclaw/google-antigravity-auth` enabled in OpenClaw, gateway restarted
- [x] **Pipeline fallback order APPLIED** (admin approved)
- [x] **Antigravity OAuth COMPLETED for j@mail99.me**
- [x] **Opus Pipeline Monitoring System DEPLOYED** (Feb 17-24)
- [x] **Full pipeline test completed** (Feb 17, 15:56 MSK) — 5/6 providers live
- [x] **Star Citizen hangar data retrieved from memory**
- [x] **Rasputin/JARVIS integration audit completed**
- [x] **Full Russian Manus codebase audit completed**
- [x] **OpenManus audit completed** — running at `manus.rasputin.to`
- [x] **Drafted medical-procedure document reply to Chloe**
- [x] **Diagnosed Grok scanner crash** — OOM'd/timed out, auto-recovers next run
- [x] **OpenCode Black CLI verified WORKING** — v1.2.5, `opencode/claude-opus-4-6`, $200/mo flat
- [x] **Manus competitor architecture fully specced** — architecture for millions, ship for 5
- [x] **Found ELF contact info** and drafted full inquiry email to ELF/Kshevitsky
- [x] **Retrieved and analyzed cto's Rasputin Production architecture**
- [x] **Confirmed Rick = cto** — rick@mail99.me, @cto-handle
- [x] **Confirmed Opus 4.6 already has adaptive thinking** — launched Feb 5, 2026
- [x] **Pipeline monitoring Day 1 data analysis COMPLETED** — 72 probes over 8 hours (Feb 17)
- [x] **Spawned sub-agent for full 20-category Grok forum scan** — all 20 topics: platform regulation, brand monitoring, affiliate/traffic, payments, player sentiment, new markets, M&A, AI models, agents, GPU inference, crypto, geopolitics, cars, health/biohacking, gaming, luxury, gadgets, audio, Russia/expat, VR/XR
- [x] **CRITICAL CORRECTION — OpenCode Black IS a working external API** — previous investigation tested wrong URLs (`opencode.ai/api/v1`, `api.opencode.ai/v1`). Actual endpoint: `https://opencode.ai/zen/v1/messages` (Anthropic Messages API format). Confirmed HTTP 200, 33 models, Opus 4.6 at 2.6s, cost $0 (flat rate). Key `***OPENCODE_API_KEY_REDACTED***` works.
- [x] **OpenCode provider definition added to openclaw.json** — baseUrl `https://opencode.ai/zen/v1`, api `anthropic-messages`
- [x] **Updated pipeline fallback order applied** — Max20 → OpenCode Black (2nd) → Antigravity (3rd) → OpenRouter → anthropic-direct → Sonnet 4.6
- [x] **Rate limit comparison researched**: OpenCode Black ~6-8hr/day heavy Opus for a full week before weekly cap; Antigravity ~5hr/week then weekly cooldown lockout. Black gives ~8-10x more Opus capacity.
- [x] **Antigravity OAuth profile confirmed valid** — j@mail99.me tokens active, project `splendid-cirrus-487712-m3`
- [x] **Antigravity auth login check** — `google-antigravity:default` profile exists with valid access/refresh tokens

### In Progress
- [ ] **Full 20-category Grok forum scan** — sub-agent spawned, results pending. Will compile into full report + TL;DR executive summary and auto-announce.
- [ ] **Antigravity proxy restart** — OAuth confirmed valid; proxy on port 4152 needs to be started so Antigravity functions as 3rd fallback
- [ ] **Investigating OpenClaw adaptive thinking translation** — searching OpenClaw 2026.2.15 dist JS files to determine whether `thinkingDefault: "high"` maps to new adaptive API or deprecated `budget_tokens`
- [ ] **Manus competitor build — Phase 0 specs** — admin said "go" direction confirmed. Awaiting final "go" to start writing SPEC.md, CONTRACTS.md, BUILD_STATE.md, shared schemas, task files for each worker.
- [ ] **Star Citizen account evaluation** — hangar data loaded, awaiting admin's direction on what he wants done
- [ ] **Week-long pipeline optimization** — monitoring running, daily analysis + morning reports active. Day 1 baseline captured. Runs through Feb 24.
- [ ] **Tai chi for Dad (family-member) — PINNED** — waiting for admin to say "Dad's coming home"
- [ ] **ELF email draft awaiting admin's confirmation to send** — draft complete, admin reviewing
- [ ] **ВНЖ blue book conversion** — admin needs migration lawyer (Tarasenko). admin hasn't provided contact info.
- [ ] **Grok intel scan dedup fix** — need to add diff check to `/home/admin/.openclaw/workspace/tools/grok_social_intel.py`
- [ ] admin needs to forward draft medical-procedure documents to his lawyer (lawyer-us or Israeli counsel)

### Blocked
- platform admin panel access needed — no URLs or credentials stored on Rasputin; admin needs to provide
- Star Citizen RSI login credentials not in memory — may need admin to provide if live scrape is needed
- **jarvis-postgres container broken** — `database "jarvis" does not exist` / `role "postgres" does not exist`. Real creds: DB=`jarvis_vault`, user=`jarvis`, password=`***REDACTED***`. Needs fix before ALFIE backend can connect to Postgres.
- **Tarasenko contact info unknown** — admin hasn't provided who Tarasenko is or how to reach them
- **git.shuhari.tools requires SSO auth** — can't audit Ashley's repo code quality without read access

## Key Decisions
- **Dubai over Mexico/Russia for medical-procedure**: Almond Blossoms is confirmed Orchid partner, logistics sorted
- **Keep legal disclosure vague**: "Ongoing legal proceedings" only — no law-enforcement/criminal references
- **Stay on TRT**: 6 banked medical-sample portions sufficient for ICSI
- **Don't install SecureClaw**: Manual hardening preferred
- **Brazil licensing deprioritized**: Not a primary market. Focus on English-speaking grey markets.
- **admin@operator.com is the primary email**: Not j@mail99.me — gog configured for operator.com
- **Google AI Ultra NOT worth investigating**: Consumer subscription for Gemini web UI, does NOT include free API access.
- **Pipeline cost ordering: flat-fee first, free second, per-token last**: Max20 ($200/mo) → OpenCode Black ($200/mo) → Antigravity (free) → OpenRouter (per-token) → anthropic-direct (per-token, absolute last resort).
- **OpenCode Black tier ($200/mo)**: admin has the paid subscription.
- **j@mail99.me for Antigravity, not admin@operator.com**: j@mail99.me has the Antigravity subscription.
- **Antigravity uses `claude-opus-4-6-thinking` model ID**: The non-thinking `claude-opus-4-6` returns 404 on Antigravity.
- **CORRECTED: OpenCode Black CAN be used as an external API fallback** — Previous conclusion was wrong due to testing wrong URLs. Actual endpoint `https://opencode.ai/zen/v1/messages` (Anthropic Messages format) works perfectly. HTTP 200, cost $0, 33 models. `opencode` provider definition added to openclaw.json with correct baseUrl.
- **OpenCode Black is 2nd fallback, Antigravity is 3rd**: admin confirmed this ordering. Antigravity has ~5hr/week limit vs Black's ~week-long allowance — Black correctly ranked higher.
- **Manus competitor: build properly from scratch, not hack existing pieces**: Clean architecture, 4-stage sequential build
- **Manus competitor: architecture for millions, ship for 5**: Day-1 unchangeable decisions locked, Day-N swaps planned
- **Keep Russian Manus backend, rebuild frontend from scratch**: LangGraph orchestrator solid, extend it
- **Use Tarasenko (migration lawyer) for ВНЖ conversion, not ELF**: Administrative document swap at МВД
- **Regulatory intel calibration**: Mention in digests, not fire drills
- **Grok scanner needs dedup logic**: Must diff against last delivered content

## Next Steps
1. **Check Antigravity proxy status and restart** — OAuth tokens confirmed valid (j@mail99.me), just need proxy on port 4152 running so 3rd fallback works
2. **Await Grok 20-category scan results** — sub-agent running, will auto-announce when complete
3. **Fix pipeline probe to also test OpenCode Black and Max20 primary** — current probe was built before Black was confirmed working; needs updating to include all active providers
4. **Complete OpenClaw adaptive thinking investigation** — finish analyzing dist JS files to determine if `thinkingDefault: "high"` maps to new adaptive API or deprecated `budget_tokens`
5. **Fix Grok intel scan deduplication** — add diff check to `/home/admin/.openclaw/workspace/tools/grok_social_intel.py`
6. **Get Tarasenko contact info from admin** — draft outreach for ВНЖ conversion
7. **Await admin's confirmation on ELF email draft** — ready to send to info@legal-proceedinglaw.net when admin says go
8. **Manus competitor Phase 0 — write the bible**: Start SPEC.md, CONTRACTS.md, BUILD_STATE.md, shared schemas, task files. Awaiting admin's final "go."
9. **Continue pipeline monitoring (Feb 17-24)**: Daily analysis, morning reports at 08:00 MSK.
10. **Tomorrow morning**: Phase 2+3 server hardening — Docker database binding, code-server/OpenCode binding, Tailscale SSH
11. **Tomorrow morning**: Scrub credential leaks from memory files — `memory/2026-02-07.md` line 242, `memory/god_stack_research.md` line 385
12. admin fills in passport numbers + partner's maiden name on medical-procedure documents → notary → apostille → forward to lawyer
13. **When Dad (family-member) is near release**: Pull top 5 tai chi studios in Toronto + private in-home instructors
14. admin provides platform admin panel URL + credentials → verify actual player geo/language breakdown
15. Obtain apostille for marriage certificate (Russian ZAGS → Ministry of Justice)
16. partner books appointment with хирург-герниолог for admin's suspected umbilical medical-condition
17. Coordinate medical-sample transport from NGC SPb → Almond Blossoms Dubai
18. Deep-dive Rivalry Corp financials if admin wants to pursue acquisition

## Critical Context
- **medical-procedure Clinic**: Almond Blossoms health-goal, Dubai Healthcare City, Dr. Dimitrios Kafetzis, contact: Chloe Meriel B Duran (Staff Nurse), info@almondblossoms.care
- **Genetic Testing Lab**: Orchid Health, New Jersey — Gold package (PGT-A + monogenic ~1200 genes + polygenic), 21-day turnaround
- **medical-sample Storage**: NGC Clinic, St. Petersburg (Petrovsky Prospekt 2, Bldg 3), urologist Morev Vladimir Vladimirovich
- **admin's Lawyers**: lawyer-us (lawyer-us@afslaw.com, ArentFox Schiff — US/law-enforcement), Oren Chen (orenchen@barak.net.il — Israeli civil)
- **legal-proceeding Law Firm (ELF)**: Stanislav Kshevitsky, Managing Principal/CEO. Email: info@legal-proceedinglaw.net. Phones: +7-995-260-4147, +7-911-601-0417. Address: Paveletskaya Embankment 8B, city-hq 115114.
- **admin's US legal-case**: United States v. operator et al., Case No. 8:21-cr-00331-PX (D. Md.), sealed legal-case returned Aug 25, 2021. financial-products trading scheme 2013-2017. Brothers: David, Jonathan.
- **law-enforcement / Detention History**: Active legal-notice. admin detained St. Petersburg 2024. Brothers held Dubai — US never submitted legal-proceeding docs, released. No bilateral legal-proceeding treaty Russia/US.
- **ВНЖ Status**: Permanent residence permit with 2028 expiration (old format). Federal Law No. 257-FZ (effective Nov 1, 2019) made all ВНЖ indefinite. Needs physical document conversion at МВД. legal-notice may trigger flags.
- **Tarasenko**: Migration lawyer for ВНЖ conversion. No contact details in memory yet.
- **Rivalry Corp**: TSXV: RVLY, Feb 13 2026 wind-down, paused player activity, mass layoffs. Isle of Man + Ontario licenses.
- **admin's digital-ops revenue**: ~$2-2.65M/month, Curaçao licensed, English-speaking grey markets primary
- **cto / Rick**: admin's CTO. Email: ashley@mcdonald.am, alt: rick@mail99.me. Telegram: @cto-handle. Repo at git.shuhari.tools (Bitbucket Server with SSO, project key RAS).
- **Rasputin Production (Ashley's affiliate platform)**: Spec at `/home/admin/.openclaw/workspace/reference/rasputin-production-ashley-spec.md`. Architecture: monorepo + Git submodules, K8s (VMware Tanzu), Kustomize, Cloudflare Tunnel, PostgREST, PostgreSQL Kubegres (3 replicas), pg-event-publisher, NGINX+njs tracking, React 19 backoffice, Astro marketing sites.
- **Anthropic Adaptive Thinking API (Feb 2026)**: New format: `thinking: {type: "adaptive"}` + `output_config: {effort: "medium"|"low"|"high"|"max"}`. Old `budget_tokens` deprecated for Opus 4.6 / Sonnet 4.6. Investigation in progress.
- **Sonnet 4.6 dropped Feb 17, 2026** — stronger computer-use, long-context reasoning, agent planning.
- **Rasputin Server**: Linux 6.18.9-arch1-2, K3s v1.34.3+k3s1, behind NAT, Tailscale 1.94.2 (100.108.249.14), **112 CPU cores, 251GB RAM**, 14 PM2 services.
- **OpenClaw Pipeline (LIVE, as of Feb 18 00:00 MSK)**:
  - **Primary**: `anthropic/claude-opus-4-6` (Max20 OAuth, $200/mo flat)
  - **Fallback 1**: `opencode/claude-opus-4-6` (OpenCode Black, $200/mo flat — ✅ **CONFIRMED WORKING** at `https://opencode.ai/zen/v1/messages`, HTTP 200, cost $0, 33 models, 2.6s latency)
  - **Fallback 2**: `google-antigravity/claude-opus-4-6-thinking` (FREE via j@mail99.me — OAuth tokens valid, **proxy port 4152 needs restart**)
  - **Fallback 3**: `openrouter/anthropic/claude-opus-4.6` (per-token $15/$75 MTok, ✅ working)
  - **Fallback 4**: `anthropic-direct/claude-opus-4-6` (per-token, last resort, ✅ working, ~1 Overloaded/18 probes)
  - **Fallback 5**: `anthropic-direct/claude-sonnet-4-5` (downgrade)
- **OpenCode Black — Correct API Details**:
  - Endpoint: `https://opencode.ai/zen/v1/messages` (Anthropic Messages API format)
  - Also: `https://opencode.ai/zen/v1/chat/completions` (OpenAI-compatible for non-Anthropic models)
  - Mastra docs confirm: model IDs like `opencode/big-pickle`, endpoint `https://opencode.ai/zen/v1`
  - API key: `***OPENCODE_API_KEY_REDACTED***`
  - Provider definition added to openclaw.json: baseUrl `https://opencode.ai/zen/v1`, api `anthropic-messages`
  - Rate limits: Weekly quota — users report 6-8hr/day heavy Opus coding for a full week before hitting cap
- **OpenCode Rate Limits vs Antigravity**:
  - OpenCode Black: ~$200+/week allowance, 6-8hr/day heavy Opus before weekly cap
  - Antigravity: ~5hr/week Opus, then weekly cooldown (some users locked out for 1+ weeks at a time)
  - Black gives roughly 8-10x more Opus capacity than Antigravity
- **Antigravity Technical Details**:
  - Account: j@mail99.me (NOT admin@operator.com)
  - GCP Project: `splendid-cirrus-487712-m3`
  - Model ID: `claude-opus-4-6-thinking` (non-thinking `claude-opus-4-6` returns 404)
  - OAuth tokens confirmed valid as of Feb 18, 2026
  - Proxy on port 4152 needs to be started
- **OpenClaw Auth Profiles** (source of truth: `/home/admin/.openclaw/agents/main/agent/auth-profiles.json`):
  - `anthropic:manual`: OAuth token `${ANTHROPIC_API_KEY}***REDACTED***...` (Max20 sub)
  - `anthropic-direct:default`: API key `${ANTHROPIC_API_KEY}***REDACTED***...` (Tier 4)
  - `openrouter:default`: `sk-or-***REDACTED***...`
  - `google-antigravity:default`: OAuth (j@mail99.me), valid access+refresh tokens, project `splendid-cirrus-487712-m3`
  - `opencode:default`: `***OPENCODE_API_KEY_REDACTED***`
  - `moonshot:default`: `sk-YhkB...`
- **Pipeline Monitoring**:
  - Probe: `/home/admin/.openclaw/workspace/tools/pipeline-monitor/probe.sh` (every 30 min)
  - Analyzer: `/home/admin/.openclaw/workspace/tools/pipeline-monitor/analyze.py`
  - Morning report: 08:00 MSK daily, Telegram
  - **Day 1 baseline**: anthropic-direct 94% up (avg 2,931ms), openrouter 100% up (avg 3,027ms), opencode-zen 0% (wrong endpoint tested), antigravity 0% (proxy not running)
  - NOTE: Probe needs updating to test correct OpenCode endpoint and Max20 primary
- **Grok 20-Category Scan Topics**: platform_regulation, brand_monitoring, affiliate/traffic, payments, player_sentiment, new_markets, M&A, AI models/agents, GPU inference, crypto/geopolitics, cars, health_biohacking, gaming, luxury, gadgets, audio_hometheater, russia_expat, xr_vr. Script: `/home/admin/.openclaw/workspace/tools/grok_social_intel.py`
- **Star Citizen Account**: RSI Handle `joperator`, Concierge Rank **Legatus Navium**, Original Backer (Aug 2013). Total Spent: **$34,275.47**, Melt Value: **$32,432.79**. 48 paid pledges, 181 total. Top items: The Legatus Pack ($27,000 melt, account-bound), Aegis Javelin ($2,500).
- **admin's Subscriptions**: Max20 ($200/mo Anthropic), OpenCode Black ($200/mo), Google One AI Premium (~$23/mo for admin@operator.com), Antigravity (via j@mail99.me)
- **Gemini API Key**: `***GEMINI_API_KEY_REDACTED***` — works with all 44 models, 1M context.
- **Medical**: Suspected umbilical medical-condition + possible diastasis recti. Needs хирург-герниолог. BPC-157/TB-500 in current stack would aid post-surgical healing.
- **Vehicle import in progress**: "Motos" handling import — utilization fee + VAT paid, waiting 2-3 days for customs conclusion
- **Dad (family-member) — post double lung transplant, Toronto**: Separating from Barbara, bronchoscopy ongoing, on 35mg prednisone dropping to 30mg, in great spirits. Tai chi pinned for post-release.
- **Coding Agents Available**:
  - **OpenCode** v1.2.5 — Opus 4.6 via Black sub, CLI AND external API (`opencode.ai/zen/v1/messages`). Both confirmed working.
  - **Claude Code** v2.1.2 — needs Anthropic API key
- **GPU Inference Stack**:
  - **RTX PRO 6000 Blackwell** (97,887 MiB): Qwen 3.5 122B MoE (47GB)
  - **RTX PRO 6000 Blackwell** (32,607 MiB): Qwen Coder 30B (18GB)
- **Manus Competitor Build Plan**: 4-stage sequential build. Stage 1 (Days 1-2): Multi-user chat. Stage 2 (Days 3-4): Agent mode + LangGraph. Stage 3 (Days 5-6): Split-screen UX. Stage 4 (Day 7): Hardening + deploy to manus.rasputin.to. $20-35 total cost. Filesystem-as-memory: SPEC.md, BUILD_STATE.md, CONTRACTS.md, decisions/, tasks/, shared/, logs/.
- **jarvis-postgres BROKEN**: Real creds: DB=`jarvis_vault`, user=`jarvis`, password=`***REDACTED***`. Needs fix before ALFIE backend can connect to Postgres.
- **OpenClaw Security Status (post-hardening)**: 0 CRITICAL (was 3), 4 WARN remaining. Config chattr +i locked.