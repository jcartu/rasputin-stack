#!/usr/bin/env python3
"""
Generate realistic test data for the operator Compaction Benchmark.
Uses the Opus summary as previous_summary and generates realistic
conversation messages to simulate a real compaction scenario.
"""

import json
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
PAPER_DIR = SCRIPT_DIR.parent / "paper"

# Load the Opus summary as the previous summary baseline
opus_summary = (PAPER_DIR / "summary_opus_46.md").read_text()
# Strip the header metadata
idx = opus_summary.find("---\n\n")
if idx > 0:
    opus_summary = opus_summary[idx+5:]

# Generate realistic conversation messages (~65K chars, ~76 messages)
# These simulate a real admin + ALFIE session with diverse topics
MESSAGES = [
    # Block 1: Morning check-in and pipeline health
    {"role": "user", "content": "Morning. What's the pipeline status? Any issues overnight?"},
    {"role": "assistant", "content": """Good morning admin. Pipeline overnight report:

📊 **Pipeline Health (00:00 - 08:00 MSK)**
- Max20 primary: 47/48 requests successful (98% uptime), avg latency 2,847ms
- 1 rate limit hit at 03:22 MSK (auto-recovered in 12s via OpenCode Black fallback)
- OpenCode Black: 6/6 fallback calls successful, avg 2,614ms — working perfectly as 2nd fallback
- Antigravity: 0 calls (proxy still not running on port 4152)
- OpenRouter: 0 calls needed
- anthropic-direct: 0 calls needed

**Overnight activity**: 3 cron jobs ran successfully (Grok scanner at 00:00, 03:00, 06:00). No dedup issues — the scanner correctly diffed against previous scans and found 2 genuinely new items:
1. New Brazilian operations regulation draft leaked (mentions Curaçao operators specifically)
2. Rival Powered partnership with Evolution Gaming for live dealer content

No compaction events overnight. Context at 67% — healthy.

⚠️ **One item needs attention**: The Antigravity proxy on port 4152 is still down. Free Opus access sitting idle. Want me to investigate and restart it?"""},
    
    {"role": "user", "content": "Yes fix the antigravity proxy. And what's this about Brazilian regulation?"},
    {"role": "assistant", "content": """On it. Investigating Antigravity proxy...

**Antigravity Proxy Status:**
```
Port 4152: Not listening
Last known process: google-antigravity-proxy (PID 892341) — killed during server reboot on Feb 16
Config: /home/admin/.openclaw/plugins/google-antigravity-auth/proxy-config.json
OAuth tokens: Valid (user@example.com, refreshed 2h ago by OpenClaw plugin internally)
```

The proxy binary exists at `/home/admin/.openclaw/plugins/google-antigravity-auth/proxy`. Starting it now...

```
Started google-antigravity-proxy on port 4152
PID: 1247891
Health check: HTTP 200 on localhost:4152/health
Test call: claude-opus-4-6-thinking — 200 OK, 3.2s latency
```

✅ **Antigravity proxy is LIVE.** Pipeline now has all 6 providers active:
1. Max20 (primary) ✅
2. OpenCode Black ✅
3. Antigravity ✅ (just restored)
4. OpenRouter ✅
5. anthropic-direct ✅
6. Sonnet 4.6 (downgrade) ✅

---

**🇧🇷 Brazilian Regulation Intel:**

From Grok scanner (06:00 run, source: X/operations forums):

A draft of Brazil's SIGAP (Sistema de Gestão de Apostas) implementation rules leaked on operations industry forums. Key points:
- **Curaçao operators explicitly mentioned** as requiring "enhanced due diligence" for .com.br domains
- Proposed requirement: all operators serving Brazilian players must either hold a Brazilian license OR route through a licensed local partner by Q3 2026
- Estimated licensing cost: R$30M (~$5M USD) upfront + R$5M/year
- Grace period: 6 months from publication

**Impact on your operation:**
- platform-beta BR traffic (~12% of total) would be affected
- But remember — Brazil is NOT your primary market. English-speaking grey markets are.
- Worth monitoring but not a fire drill. Exactly the kind of thing that's "just Tuesday" for grey-market operators.

Want me to add this to the morning briefing digest or just note it in memory?"""},

    {"role": "user", "content": "Note it in memory. Don't care about brazil really. What about the star citizen account? Did you figure out what to do with it?"},
    {"role": "assistant", "content": """Noted and committed to memory. Brazilian regulation tracked but deprioritized.

**Star Citizen Account — Analysis:**

Your account is genuinely impressive:
- **RSI Handle:** joperator
- **Concierge Rank:** Legatus Navium (highest tier — $25,000+ spent)
- **Total Spent:** $34,275.47
- **Melt Value:** $32,432.79
- **Original Backer:** August 2013

**Top Assets:**
- The Legatus Pack: $27,000 melt value (account-bound, cannot be traded)
- Aegis Javelin: $2,500 (tradeable, rare capital ship)
- 48 paid pledges, 181 total items

**Options:**

1. **Hold** — Star Citizen is approaching 1.0 (expected late 2026/2027). Account values typically spike at major releases. Your Legatus status and original backer perks make this a collector-tier account.

2. **Sell the account** — Grey market (Star Hangar, r/starcitizen_trades):
   - Legatus accounts with original backer status: $15-25K realistic (buyers pay premium for the status + rare ships)
   - The Javelin alone could fetch $3-4K on the grey market
   - Risk: RSI ToS prohibits account sales, but enforcement is rare

3. **Partial liquidation** — Melt tradeable ships, gift store credit to alt accounts, sell those
   - Lower risk than full account sale
   - Could extract $5-8K from tradeable items

4. **Gift to someone** — If you know anyone who plays

Given your financial position, the $15-25K isn't life-changing. I'd recommend **holding** unless you actively want to clear it out. The Legatus status appreciates over time and original backer accounts are becoming rarer.

What's your thinking?"""},

    {"role": "user", "content": "Hold it. Don't care about selling it. More curious than anything. What's happening with the manus competitor? You said you had specs ready."},
    
    # Block 2: Manus competitor deep dive
    {"role": "assistant", "content": """Yep, specs are ready. Here's where we are:

**Manus Competitor — Status Update**

Phase 0 (the bible) is written and ready for your review. Here's the architecture summary:

**Stack:**
- Frontend: Next.js 15 + shadcn/ui + Tailwind + Zustand
- Backend: FastAPI + LangGraph orchestrator
- Database: PostgreSQL (event-sourced sessions)
- Vector memory: Qdrant (per-user isolation)
- Cache/pubsub: Redis
- Sandbox: Docker per session
- Inference: Ollama (Qwen 3.5 122B MoE + Coder 30B) — $0/mo per-user cost

**4-Stage Build Plan:**

| Stage | Days | What | Agents |
|-------|------|------|--------|
| 1 | 1-2 | Multi-user chat (auth, WebSocket, message persistence) | 3 parallel |
| 2 | 3-4 | Agent mode (LangGraph + 5 core tools: browser, file, shell, search, code) | 3 parallel |
| 3 | 5-6 | Split-screen Manus UX (live preview, file tree, terminal) | 3 parallel |
| 4 | 7 | Hardening + deploy to example.com | 2 parallel |

**Day-1 Locked Decisions (can't change later):**
- Tenant isolation: per-user Docker sandbox
- Event protocol: JSON event-sourced session log
- API contract: REST + WebSocket streaming
- Stateless backend: no server-side session state
- Interface-based services: all tool interactions via abstract interfaces

**Day-N Swappable:**
- Docker → K8s (when scale demands)
- Local disk → S3 (when multi-node)
- Ollama → vLLM (when throughput matters)
- JWT → OAuth/SSO (when enterprise users arrive)
- Direct WebSocket → Redis Streams (when horizontal scaling)

**Cost estimate:** $20-35 total build cost using OpenCode Black ($0 marginal) + Claude Code (~$5-10 API) + Qwen local ($0)

**Key files ready:**
- `/workspace/manus-competitor/SPEC.md` — full architecture spec
- `/workspace/manus-competitor/CONTRACTS.md` — API contracts
- `/workspace/manus-competitor/BUILD_STATE.md` — progress tracker
- `/workspace/manus-competitor/decisions/` — architectural decision records

Want me to start Stage 1 now?"""},

    {"role": "user", "content": "Not yet. I want to review the spec first. Send it to me on telegram."},
    {"role": "assistant", "content": "Sent SPEC.md to Telegram. 47 pages. Take your time reviewing — the architecture decisions in section 3 are the most critical. Those are the ones that lock in day-1 and can't be changed later without a rewrite.\n\nWhile you review, I'll keep working on other tasks. Let me know when you're ready to greenlight Stage 1."},

    # Block 3: Health and personal
    {"role": "user", "content": "partner says she booked the surgeon appointment for next thursday. Also my glucose has been spiking after lunch — dexcom shows 180+ consistently. What should I look at?"},
    {"role": "assistant", "content": """Great news on the surgeon appointment. Noted: **Thursday appointment with хирург-герниолог** for the suspected umbilical medical-condition. Want me to set a reminder?

**🩺 Glucose Spikes — Analysis:**

Post-meal spikes to 180+ mg/dL are significant. Your Dexcom G7 data is the best diagnostic tool here. Let me break down what to look at:

**Likely Culprits:**
1. **Mounjaro timing** — You're on 7.5mg/week. When do you inject relative to these lunch spikes? Mounjaro's GLP-1 effect peaks 8-12h post-injection. If you're injecting in the evening, your lunch coverage might be weakest.

2. **Meal composition** — What are you eating for lunch specifically? Russian lunch tends to be carb-heavy (bread, potatoes, pasta). Even "healthy" options like buckwheat or rice can spike you.

3. **TRT interaction** — TRT at 10mg/day can increase insulin resistance slightly. You've been back on it for ~2 weeks. This could be contributing to higher post-prandial numbers.

4. **Somatropin** — Growth hormone at 1iu/day is low-dose, but GH is inherently diabetogenic. It increases hepatic glucose output. Combined with TRT and the Mounjaro, there's a pharmacological tug-of-war happening.

**Actionable Steps:**
1. Check your Dexcom data for the last 7 days — what's your average time-in-range (70-140)?
2. Try moving Mounjaro injection to **morning** if it's currently evening — better lunch coverage
3. Log what you eat for lunch for 3 days — I'll correlate with Dexcom readings
4. Consider adding a 15-min walk after lunch — single most effective non-pharmacological intervention for post-prandial spikes

Want me to pull your Dexcom data via ADB and do a proper analysis? I can chart your glucose patterns against meal times."""},

    {"role": "user", "content": "Yeah pull the dexcom data. Also remind me about the surgeon thursday."},
    {"role": "assistant", "content": """Setting reminder for Thursday surgeon appointment.

✅ **Reminder set:** Thursday, February 20, 2026 at 09:00 MSK — "Surgeon appointment today (хирург-герниолог) — suspected umbilical medical-condition"

Now pulling Dexcom G7 data via ADB...

```
adb devices
List of devices attached
R5CR30XXXXX    device

adb shell am broadcast -a com.dexcom.cgm.EXPORT_DATA
Broadcasting: Intent { act=com.dexcom.cgm.EXPORT_DATA }
```

**Dexcom G7 — Last 7 Days Summary:**

| Metric | Value | Target |
|--------|-------|--------|
| Average glucose | 128 mg/dL | < 120 |
| Time in range (70-140) | 68% | > 70% |
| Time above range (>140) | 24% | < 25% |
| Time above 180 | 8% | < 5% |
| Time below 70 | 0% | < 4% |
| GMI (estimated A1c) | 6.1% | < 5.7% |
| Coefficient of variation | 31% | < 36% |

**Pattern Analysis:**
- **Lunch spike pattern confirmed**: 12:00-14:00 window shows consistent spikes to 165-190 range
- **Worst day**: Tuesday — peaked at 196 after what looks like a carb-heavy lunch
- **Best day**: Saturday — stayed under 150 all day (lighter eating?)
- **Morning fasting**: Consistently 95-110 — good
- **Evening**: Stable 100-130 — Mounjaro working well during dinner window

**Correlation with Mounjaro timing:**
Your injection appears to be Sunday evening based on the glucose curve pattern (lowest readings Monday-Tuesday morning, highest spikes Thursday-Friday lunch). This suggests the GLP-1 effect is waning by end of week.

**Recommendation:** Move injection to Thursday evening or Friday morning. This shifts peak GLP-1 activity to cover your worst spike days."""},

    # Block 4: medical-procedure update
    {"role": "user", "content": "Got an email from Chloe at Almond Blossoms. She says they received the consent letter but need the apostille on the marriage certificate before they can proceed. partner needs to handle this — it's the Russian ZAGS document that needs to go through the Ministry of Justice for apostille. Can you write instructions for her?"},
    {"role": "assistant", "content": """Here are the instructions for partner in Russian:

---

**Саша, инструкция по апостилю свидетельства о браке:**

1. **Что нужно**: Апостиль на свидетельство о браке (выдано ЗАГСом 14 января 2026)

2. **Куда обращаться**: Управление Министерства юстиции РФ по г. Москве
   - Адрес: ул. Кржижановского, д. 13, корп. 1
   - Тел: +7 (495) 955-59-99
   - Время приёма: ПН-ЧТ 10:00-17:00, ПТ 10:00-15:45

3. **Документы**:
   - Оригинал свидетельства о браке
   - Паспорт (твой российский)
   - Копия паспорта
   - Заявление (дадут бланк на месте или скачать на сайте Минюста)
   - Квитанция об оплате госпошлины — **2,500₽** (оплатить заранее через Госуслуги или в банке)

4. **Срок**: 3-5 рабочих дней обычно, но можно попросить срочно (иногда делают за 1 день)

5. **Результат**: На свидетельство прикрепят штамп-апостиль (квадратная наклейка на обороте)

6. **После получения**: Сфоткай апостилированное свидетельство и отправь мне — я перешлю в клинику Almond Blossoms (Chloe)

---

Want me to send this to partner directly via WhatsApp, or do you want to forward it yourself?"""},

    {"role": "user", "content": "Send it to her on whatsapp."},
    {"role": "assistant", "content": "Sent to partner via WhatsApp. She should be able to handle this at the Ministry of Justice — it's a straightforward bureaucratic process, just annoying.\n\n**Updated medical-procedure timeline:**\n- ✅ Consent letter — received by Almond Blossoms\n- ✅ Legal restrictions letter — received\n- ⏳ Marriage certificate apostille — partner handling\n- ⏳ Notarized consent — needs apostilled marriage cert first\n- ⏳ medical-sample transport from NGC SPb → Dubai\n- 🎯 Target: April 2027 cycle (partner's egg retrieval late March/early April)\n\nNext bottleneck after apostille: coordinating medical-sample transport from NGC Clinic to Dubai. medical-procedure Couriers is the recommended hand-carry service, or partner can bring it herself when she travels."},

    # Block 5: Technical deep-dive on compaction
    {"role": "user", "content": "OK back to the compaction thing. I've been thinking about this. The real bottleneck isn't the model quality — sonnet is good enough for compaction. The bottleneck is SPEED. What if we ran compaction on a local model? Like Qwen 3.5 122B MoE on the RTX Pro 6000? It's sitting there with 87GB free VRAM. We could rip through compaction in like 30 seconds instead of 4 minutes."},
    {"role": "assistant", "content": """This is a brilliant insight. You're right — the paper proved quality isn't the bottleneck (Sonnet captures 85%+ of key facts). Speed is everything.

Let me do the math on local compaction:

**RTX PRO 6000 Blackwell — Qwen 3.5 122B-A10B Performance:**
- VRAM: 96GB (47GB used by model, 49GB free for KV cache)
- Typical throughput: ~30-40 tok/s generation at 122B Q8_0
- Context processing: ~2000-3000 tok/s for prompt ingestion

**Compaction workload:**
- Input: ~35,000 tokens (conversation + previous summary + prompt)
- Output: ~9,000-14,000 tokens (summary)
- Total: ~44,000-49,000 tokens

**Estimated local performance:**
- Prompt processing: 35K tokens ÷ 2500 tok/s = **~14 seconds**
- Generation: 12K tokens ÷ 35 tok/s = **~340 seconds** (5.7 min)

Wait. That's actually not faster. The generation speed at 122B is the killer.

**But here's where it gets interesting:**

If we use **Qwen 3 Coder 30B** instead (on GPU1 (RTX PRO 6000 Blackwell)):
- Generation speed: ~60-80 tok/s at 30B Q4
- 12K tokens ÷ 70 tok/s = **~170 seconds** (2.8 min)
- Still not amazing, but cheaper.

Or if we switch to a **speculative decoding** setup or use **vLLM** instead of Ollama:
- vLLM on RTX PRO 6000: ~60-80 tok/s for 72B with continuous batching
- 12K tokens ÷ 70 tok/s = **~170 seconds**

The real play might be:

1. **Smaller, faster model** — A 7-14B model purpose-tuned for summarization could hit 150-200 tok/s on your hardware
2. **Reduce output size** — If we compress the summary format, 6K tokens instead of 12K = half the time
3. **Two-stage compaction** — Fast local model for immediate compaction, then background Opus sweep for quality

**My recommendation:** Let's actually benchmark this. I'll run the test against Qwen 3.5 122B MoE, Qwen Coder 30B, and a smaller model to get REAL numbers instead of estimates. The RTX PRO 6000 might surprise us with Blackwell's improved inference performance.

Want me to run the full benchmark suite now?"""},

    {"role": "user", "content": "Yes run it. Test everything we have locally. Also test gemini flash — it's basically free and fast."},
    {"role": "assistant", "content": "On it. Running the full benchmark suite now:\n\n**Local models:**\n1. Qwen 3.5 122B-A10B (RTX PRO 6000)\n2. Qwen 3 Coder 30B (RTX PRO 6000 Blackwell)\n3. GPT-OSS 120B (would need to unload Qwen 3.5 122B MoE — skipping for now)\n\n**Cloud models:**\n4. Gemini 3 Flash (basically free)\n5. Gemini 2.5 Flash (cheap)\n6. Gemini 2.5 Pro (moderate cost)\n7. Sonnet 4.6 without thinking (untested variation)\n\nPlus we have paper data for:\n- Sonnet 4.6 with thinking: 227s, $0.16\n- Opus 4.6 with thinking: 379s, $0.61\n\nStarting the benchmark now. Local models will take a while — Qwen 3.5 122B MoE might be 5-10 minutes per run. I'll report back with full results.\n\nKicking off..."},

    # Block 6: Business updates
    {"role": "user", "content": "While that runs — any updates from the platforms? platform-beta numbers?"},
    {"role": "assistant", "content": """I don't have direct admin panel access yet (still blocked on credentials), but from the data I have in memory:

**platform-beta — Last Known Metrics (from Feb 15 intel):**
- Monthly revenue: ~$850K-950K (platform-beta alone, ~35-40% of total group)
- Daily active players: ~12,000-15,000
- Primary markets: Canada, India, Northern Europe
- BR traffic: ~12% of total (but lower conversion, mostly sports trading)

**Group Total (all brands):**
- Combined revenue: ~$2.2-2.65M/month
- Growth rate: ~12% MoM
- Best performing: platform-alpha (platform-heavy, highest ARPU), platform-beta (volume leader)
- Weakest: platform-zeta (newest, still ramping)

**From Grok Scanner (recent):**
- Rival Powered (separate from Rivalry Corp) signed Evolution Gaming partnership — could affect your live dealer supplier negotiations
- PropellerAds costs for BR traffic up 15% in Feb — but again, BR isn't your focus
- Two Canadian affiliate networks (one is AffPapa) running promotions that could drive traffic to your competitors

**What I need to give you real numbers:**
- platform admin panel URL + credentials (for any of the brands)
- Or a screenshot of the dashboard
- Or access to the payment processor reports

Want me to ping Ashley to see if he can provide read-only admin access?"""},

    {"role": "user", "content": "Don't ping Ashley about this. I'll get you access when I'm ready. What about the ELF email — did I ever give the go ahead on that?"},
    {"role": "assistant", "content": """No, you haven't given the go-ahead yet. The draft is sitting ready:

**ELF Email Draft — Status: AWAITING YOUR APPROVAL**

**To:** info@example.com (Stanislav Kshevitsky, Managing Principal)
**Subject:** Consultation Request — law-enforcement legal-notice Defense & Russian Residency

The draft covers:
- Your situation (US legal-case Case No. 8:21-cr-00331-PX, D. Md.)
- financial-products charges (2013-2017)
- 2024 St. Petersburg detention on legal-notice
- Brothers' Dubai experience (US never submitted legal-proceeding docs)
- No bilateral Russia/US legal-proceeding treaty
- Request for: legal-proceeding defense + legal-notice challenge + ВНЖ protection
- Mentions existing US counsel (ArentFox Schiff) and Israeli counsel
- Professional tone, no desperation

The draft does NOT mention any specific amounts, business details, or grey-market operations. It's clean.

Want me to:
1. **Send it now** — I'll fire it off to info@example.com
2. **Re-send the draft to you on Telegram** for another look
3. **Hold** — keep waiting

Your call."""},

    {"role": "user", "content": "Hold for now. I want to talk to Michelle first before engaging Russian lawyers."},
    {"role": "assistant", "content": "Got it. ELF email **held indefinitely** — waiting for you to talk to lawyer-us first. Makes sense to coordinate with your existing US counsel before adding Russian lawyers to the mix.\n\nUpdated status:\n- ELF draft: Ready, on hold pending lawyer-us consultation\n- lawyer-us: lawyer-us@afslaw.com (ArentFox Schiff)\n\nWant me to draft an email to Michelle instead? Or is this a call you want to handle yourself?"},

    {"role": "user", "content": "I'll call her. Back to tech stuff — how's the benchmark going?"},
    {"role": "assistant", "content": """Still running. Qwen 3.5 122B MoE is grinding through the compaction — as expected, the generation phase is slow at 72B scale. Here's what we have so far:

**Completed:**
- ✅ Gemini 3 Flash: Done in 18.3s (!!) — reviewing quality now
- ✅ Gemini 2.5 Flash: Done in 24.7s — with thinking
- ✅ Sonnet 4.6 no thinking: Done in 31.2s — significantly faster without thinking

**Running:**
- ⏳ Qwen 3.5 122B-A10B: ~4 minutes in, still generating...
- ⏳ Gemini 2.5 Pro: Still processing...

**Queued:**
- Qwen 3 Coder 30B (next after Qwen 3.5 122B MoE finishes)

The cloud models are FAST. Gemini Flash at 18 seconds is insane — if the quality holds up, that's a 20x improvement over Opus. Let me check the quality of what's come back..."""},

    # Block 7: Dad update
    {"role": "user", "content": "Quick update on dad — he had the bronchoscopy yesterday. They found the infection source, it's a fungal thing. They're putting him on voriconazole. Docs say 2-3 more weeks in hospital then home. So start looking at tai chi for him."},
    {"role": "assistant", "content": """Good news that they found it — fungal infections post-transplant are common and voriconazole is the right antifungal for most pulmonary fungi. Committed to memory.

**Dad (family-member) Update:**
- Bronchoscopy: ✅ Completed, infection source identified
- Diagnosis: Fungal infection (pulmonary)
- Treatment: Voriconazole (antifungal)
- Prognosis: 2-3 more weeks hospitalized, then home
- Prednisone: 35mg → 30mg taper continuing
- Timeline: Home ~early March 2026

**🥋 Tai Chi Search — ACTIVATED**

Starting the Toronto tai chi research now. Here's what I'm looking for:
1. **Studios near family-member's home** (I need his Toronto address — is it the Hillcrest property or somewhere else?)
2. **Private in-home instructors** — better for post-transplant since he'll be immunocompromised
3. **Respiratory rehabilitation focus** — tai chi instructors with experience in post-surgical/lung patients
4. **Yang style preferred** — most evidence-based for respiratory rehab

**Initial search in progress...**

Found several options:

**Studios:**
1. **Toronto Tai Chi Academy** (Yonge & St. Clair) — Yang style, beginner classes, $180/mo
2. **Fung Loy Kok Taoist Tai Chi** — Multiple Toronto locations, specifically designed for health recovery, donation-based
3. **The Peaceful Dragon** (Bloor West) — Seniors program, respiratory-focused classes

**Private Instructors:**
1. **Tai Chi for Health Institute** — Certified instructors do house calls, $80-120/session
2. **Dr. Paul Lam's Tai Chi for Health** network — Specifically trained for post-surgical rehabilitation
3. Several registered kinesiologists who incorporate tai chi (would be covered by OHIP referral)

**Recommendation:** Start with a private in-home instructor for the first 4-6 weeks (immunocompromised, building strength), then transition to Fung Loy Kok studio classes (donation-based, community atmosphere, health-focused).

I'll compile a full report with contact details, pricing, and instructor bios. Need his Toronto address to sort by proximity.

⚠️ **Important note for family-member's docs:** Voriconazole + prednisone interaction — voriconazole inhibits CYP3A4, which metabolizes prednisone. This can increase prednisone levels by 30-40%. His endocrinologist should be aware. Not dangerous at 30mg, but worth monitoring."""},

    {"role": "user", "content": "He's at the Toronto Western Hospital right now. When he gets out he'll go to the Hillcrest place but that's being sold. Might go to David's. I'll get you the address when we know. Good catch on the voriconazole interaction."},
    {"role": "assistant", "content": "Noted. I'll prepare options across central Toronto so we're ready regardless of where he ends up. The Fung Loy Kok has 8 locations across the GTA so there'll be one near wherever he goes.\n\nTai chi report will be ready when you have the address. I've pinned this as active — will check back when he's closer to release.\n\n**Updated Dad Status:**\n- Location: Toronto Western Hospital (currently)\n- Post-release: Hillcrest property (being sold) or David's place (TBD)\n- Voriconazole interaction flagged ✅\n- Tai chi: Options compiled, need address for final recommendations\n- Timeline: Home ~early March 2026"},

    # Block 8: Compaction research discussion
    {"role": "user", "content": "I've been thinking more about the compaction paper. The real innovation isn't just decoupling the model — it's the METHODOLOGY. Nobody has published a systematic way to evaluate compaction quality across models. We should publish this. The operator Method."},
    {"role": "assistant", "content": """You're onto something. Let me think about what "The operator Method" actually IS as a methodology:

**The operator Method — Framework:**

It's not just "use Sonnet instead of Opus for compaction." It's a systematic evaluation framework for context compaction in AI agent systems. Here's what makes it novel:

**1. The Compaction Quality Triad:**
- **Speed** (time to compact)
- **Fidelity** (information retention %)
- **Efficiency** (context window utilization — smaller summary = more room for conversation)

Most people optimize for ONE of these. The operator Method says you need to balance all three, and the balance point depends on your use case.

**2. The Feedback Loop Insight:**
Your paper's key insight: bigger ≠ better for compaction. A more detailed summary EATS more context window, which triggers MORE frequent compaction, which creates a negative feedback loop. There's an optimal summary size that maximizes total useful conversation before the next compaction.

**3. The Decoupled Architecture:**
Compaction is infrastructure, not conversation. It should run on infrastructure-grade models (fast, cheap, reliable) not conversation-grade models (smart, nuanced, expensive).

**4. The Benchmark Protocol:**
A standardized way to evaluate any model for compaction:
- Fixed test dataset (conversation + previous summary)
- Quality metrics: section completeness, key fact retention, technical detail preservation
- Speed metrics: time to first token, total generation time, tokens/second
- Efficiency metrics: output size, context window utilization ratio
- Cost metrics: $ per compaction

**This IS publishable.** As a blog post, a GitHub repo with the benchmark suite, or even a proper paper. The agent framework community (OpenClaw, LangChain, CrewAI, AutoGen) would eat this up.

Want me to build this out? A website showcasing the methodology, the benchmark results, the plugin, and the framework for others to replicate?"""},

    {"role": "user", "content": "YES. Build it. \"The operator Method\" — a website, beautiful, modern design. Show the research, the benchmarks, the plugin. Make it look professional but not corporate. Like a tech research lab vibe. Host it on example.com or example.com."},
    {"role": "assistant", "content": """I'm on it. Here's the plan:

**The operator Method — Website Build Plan**

**Domain:** example.com (or example.com)
**Stack:** Next.js 15 + Tailwind + Framer Motion + Recharts
**Vibe:** Dark tech research lab — think Linear.app meets arXiv. Clean, data-heavy, animated charts.

**Pages:**
1. **Hero** — "The operator Method" with the key insight (compaction is infrastructure, not conversation)
2. **The Problem** — Visual explanation of synchronous compaction blocking
3. **The Research** — Interactive benchmark comparison (charts, tables, model cards)
4. **The Method** — The Quality Triad framework (speed × fidelity × efficiency)
5. **The Plugin** — Download/install the OpenClaw compaction offloader
6. **Run Your Own** — Benchmark suite download + instructions

**Design:**
- Dark mode (near-black background)
- Accent: Electric blue + warm amber for data highlights
- Typography: Inter for body, JetBrains Mono for code/data
- Animated chart reveals on scroll
- Interactive model comparison slider
- Glassmorphism cards for model results

**Timeline:**
- Benchmark results: ~30 min (finishing now)
- Website build: 2-3 hours (sub-agent)
- Plugin packaging: 1 hour
- Deployment: 30 min

Starting now. I'll spawn a sub-agent for the website build while I finish the benchmarks."""},

    # Block 9: More technical
    {"role": "user", "content": "Also — the grok scanner dedup. Did that ever get fixed?"},
    {"role": "assistant", "content": """No, it's still broken. I flagged it multiple times but haven't implemented the fix yet. Let me do it now.

**Grok Scanner Dedup — Current State:**
- Script: `/home/admin/.openclaw/workspace/tools/grok_social_intel.py`
- Problem: Scanner runs every 3 hours, surfaces the SAME items repeatedly without checking what was already delivered
- Impact: You get the same analysis 3x/day, which you specifically called out as annoying

**Fix Implementation:**

Adding a diff check that:
1. After each scan, saves a hash of delivered content to `/workspace/data/scans/last_delivered.json`
2. Before delivery, compares new findings against last delivered hashes
3. Only surfaces genuinely NEW items
4. Includes a "previously reported" count so you know coverage is happening

```python
# Adding to grok_social_intel.py:
import hashlib

def hash_finding(finding):
    return hashlib.sha256(finding['title'].encode() + finding['summary'].encode()).hexdigest()[:16]

def filter_new_findings(findings, last_delivered_path):
    # Load previous hashes
    previous = set()
    if os.path.exists(last_delivered_path):
        with open(last_delivered_path) as f:
            previous = set(json.load(f).get('hashes', []))
    
    new_findings = []
    for f in findings:
        h = hash_finding(f)
        if h not in previous:
            new_findings.append(f)
    
    # Save current hashes
    all_hashes = previous | {hash_finding(f) for f in findings}
    with open(last_delivered_path, 'w') as fh:
        json.dump({'hashes': list(all_hashes), 'updated': datetime.now().isoformat()}, fh)
    
    return new_findings
```

Implementing and testing now...

✅ **Dedup fix applied.** Next Grok scan will only surface new items. The 3-repeat problem should be gone.

Tested with last scan data — would have filtered out 12/15 items (only 3 genuinely new). Working as expected."""},

    # Block 10: Wrapping up the session
    {"role": "user", "content": "Good. What's on the plate for the rest of today?"},
    {"role": "assistant", "content": """Here's what's active:

**🔴 Running Now:**
- Compaction benchmark suite — local models still grinding, cloud results in
- Grok scanner dedup fix — just deployed, testing on next run

**🟡 Today's Priorities:**
1. Finish compaction benchmarks → compile results
2. Start "The operator Method" website build
3. Package the compaction offloader plugin for OpenClaw
4. Deploy website to example.com

**🟢 Waiting On You:**
- Manus competitor: SPEC.md sent to Telegram, awaiting your review
- ELF email: Held pending your call with lawyer-us
- platform admin access: Whenever you're ready
- Dad's post-release address: For tai chi instructor proximity search
- ВНЖ: Need Tarasenko contact info

**📋 Background/Automated:**
- Pipeline monitoring: Running through Feb 24 (probes every 30 min)
- Grok scanner: Next run in ~2 hours, dedup active
- Morning report: Tomorrow 08:00 MSK

**Context:** Currently at ~72% — healthy, no compaction needed yet. Ironic given what we're working on.

Anything you want me to reprioritize?"""},

    {"role": "user", "content": "No that's good. Focus on the compaction stuff — benchmarks, website, plugin. That's the priority."},
    {"role": "assistant", "content": "Roger. Full focus on operator Method — benchmarks finishing, website build starting, plugin packaging. I'll report back when I have the full benchmark comparison and the website is up.\n\nBack to work. 🔨"},

    # Block 11: Additional context for richness
    {"role": "user", "content": "One more thing — partner's asking about the wedding planning. We need to figure out venue. She wants something in city-hq but I'm thinking maybe St Petersburg. We got married at the ZAGS in January but haven't done the ceremony/party yet. Budget isn't really a concern but I don't want something too ostentatious. Maybe 50-80 people."},
    {"role": "assistant", "content": """Got it. Let me note this and do some initial research:

**Wedding Planning — Key Details:**
- Legal marriage: ✅ Done (ZAGS, city-hq, January 14, 2026)
- Ceremony/party: Not yet planned
- Guest count: 50-80 people
- Budget: Flexible (not a primary concern)
- Vibe: Elegant but not ostentatious
- partner prefers: city-hq
- admin prefers: St. Petersburg
- Timeline: TBD (presumably 2026?)

**city-hq vs. St. Petersburg — Quick Take:**

**city-hq:**
- Pros: Easier logistics for city-hq-based guests, more venue variety, partner's preference
- Top venues: Gorky Park Event Hall, The Ritz-Carlton city-hq, Barvikha Luxury Village, Neskuchny Sad
- Price range: 500K-3M₽ for 50-80 guests at premium venues

**St. Petersburg:**
- Pros: More photogenic (canals, palaces, White Nights if summer), romantic vibe, your preference
- Top venues: Belmond Grand Hotel Europe, Yusupov Palace, New Holland Island, Astoria Hotel
- Price range: 400K-2.5M₽ (slightly cheaper than city-hq for comparable quality)
- Con: Travel logistics for city-hq guests (but it's a 4-hour Sapsan ride)

**Compromise idea:** St. Petersburg in summer (June-July) during White Nights. The city is magical, and the long daylight makes everything more photogenic. 50-80 people is small enough that travel logistics aren't a nightmare.

Want me to put together a proper venue comparison? I can create a shortlist with photos, pricing, availability, and pros/cons for both cities. Or is this something you and partner want to explore together first?"""},

    {"role": "user", "content": "We'll talk about it together. Just note it for now."},
    {"role": "assistant", "content": "Noted and committed to memory. Wedding planning added to tracking — ceremony/party for 50-80 people, city-hq vs SPb, budget flexible, elegant not ostentatious. Ready to help with venue research whenever you and partner decide on the city.\n\nBack to the compaction benchmarks. 🔨"},
]

def build_test_data():
    """Build the test data JSON file."""
    # Build conversation text from messages
    conversation_lines = []
    for msg in MESSAGES:
        role_label = "User" if msg["role"] == "user" else "Assistant"
        conversation_lines.append(f"{role_label}: {msg['content']}")
    
    conversation_text = "\n\n".join(conversation_lines)
    
    test_data = {
        "metadata": {
            "description": "operator Compaction Benchmark Test Data",
            "created": "2026-02-18",
            "conversation_messages": len(MESSAGES),
            "conversation_chars": len(conversation_text),
            "previous_summary_chars": len(opus_summary),
            "total_chars": len(conversation_text) + len(opus_summary),
            "estimated_tokens": (len(conversation_text) + len(opus_summary)) // 4,
        },
        "previous_summary": opus_summary,
        "conversation_text": conversation_text,
    }
    
    output_file = SCRIPT_DIR / "test_data.json"
    with open(output_file, "w") as f:
        json.dump(test_data, f, indent=2, ensure_ascii=False)
    
    print("Test data generated:")
    print(f"  Conversation: {len(conversation_text):,} chars across {len(MESSAGES)} messages")
    print(f"  Previous summary: {len(opus_summary):,} chars")
    print(f"  Total: {len(conversation_text) + len(opus_summary):,} chars (~{(len(conversation_text) + len(opus_summary)) // 4:,} tokens)")
    print(f"  Saved to: {output_file}")

if __name__ == "__main__":
    build_test_data()
