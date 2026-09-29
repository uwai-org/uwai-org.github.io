---
title: "Context Language Models"
author: WAI
date: 2026-09-28
permalink: /blog/clm/
custom_header: true
math: true
plotly: true
scripts:
  - /assets/js/clm-charts.js
description: >-
  Context Language Models (CLMs) are language models that manage their own
  context: the context is a file the model can edit. They beat hand-designed
  context management out of the box, and they can learn better strategies in
  context and in weights.
---

::::: {.post-hero}
<h1 class="title">Context Language Models</h1>

:::: {.byline}
Rulin Shao, Shannon Zejiang Shen, Junjie Oscar Yin, Yuetai Li, Minheng Wang,
Hamish Ivison, Radha Poovendran, Nathan Lambert, Teng Xiao, Mike Lewis,
Wen-tau Yih, Luke Zettlemoyer, Pang Wei Koh
::::

:::: {.affiliations}
University of Washington · Meta Superintelligence Labs · MIT · Trillium Labs
::::

:::: {.post-date}
September 28, 2026
::::
:::::

::: {.draft-note}
Before publishing: confirm author formatting (the TMax post bolds co-first authors; the paper marks none), the publication date, and the missing links in the resources line (arXiv, tweet, ContextBench release). Draft notes like this one only show up in local builds; production builds hide them.
:::

![Context Language Models manage their own context. They work out of the box, and they can be improved further by learning in context and in weights.]({{ '/assets/img/clm/teaser.png' | relative_url }})

::: {.tldr}
[TL;DR]{.tldr-label}

**Context Language Models (CLMs)** are language models that manage their own context. Instead of a harness deciding what to keep, summarize, or throw away, the model can rewrite its context however it wants. We implement this in the simplest way we could think of: **the context is a file**, and the model edits it with Bash like any other file.

Used **out of the box** with strong models, CLMs beat state-of-the-art context-management strategies on tasks that run from minutes to more than a day. With Qwen3.6-27B at a 32K context limit, CLM scores **59.4% on BrowseComp-Plus against 53.3%** for the best baseline, while using 21.5% less compute. It also comes out ahead on 12-hour repository optimization, with 59% less compute, and in a 24-hour, six-repository agent swarm. Because context management is now something the model does, it can be **taught**: one sentence in the prompt changes the strategy, an evolution loop finds better strategies, and RL with a new **success-gated efficiency advantage** takes Qwen3.5-9B from 28.8% to 42.5% on BrowseComp-Plus. Finally, **Suffix Cache Reuse** cuts serving compute by 35% at the same accuracy.

**Resources:** [📄 Paper](#) · [👨‍💻 GitHub](https://github.com/RulinShao/Context-Language-Model) · [🐦 Tweet](#)
:::

This post walks through our paper on Context Language Models, [TODO]. For a more technical and deeper dive, please see the paper[TODO] and the code[TODO].

## 1. Context management is still hand-designed

Everything a language model knows about the task in front of it lives in its context. For a short chat, that's fine. But agents now run for hours: they read files, run searches, try ideas, and generate far more tokens than any context window can hold. Something has to decide what stays in the context and what goes.

Today, that something is usually the harness, not the model. A typical agent harness appends every action and observation to the context, and when the context reaches a fixed threshold (say, 75% of the window), it asks the model to summarize everything and continues from the summary. A person wrote that rule, and it is the same for every task.[^harnesses]

Recent work has started to hand some of this control to the model. Some methods let the model decide *when* to compact.[^when] Others let it compact a chosen part of its context, offload content to storage and retrieve it later, or pick which fragments of the context to operate on.[^actions] Each step gives the model more autonomy, but always within a small menu of actions that people designed in advance.

We wanted to see what happens if we drop the menu and give the model full control over its own context. The bet follows the Bitter Lesson:[^bitter] rather than hand-designing context-management strategies, let models search for and learn their own. It turns out that strong models already do this well without any training, and they match or beat hand-designed strategies on most of the tasks we tried.

[^harnesses]: Examples include Cursor's Composer, OpenAI's Codex, and Terminus 2. MEM1 (Zhou et al., 2026) goes the other way and rewrites a single memory state at every turn, but that schedule is also fixed by the harness.

[^when]: AutoCompact (Zhang et al., 2026) and Self-Compact (Li et al., 2026).

[^actions]: Context-as-a-Tool (Liu et al., 2026), ACM (Li et al., 2026), and Sculptor (Li et al., 2026).

[^bitter]: Sutton, "The Bitter Lesson," 2019.

## 2. Context Language Models

A standard language model treats its context as append-only. At each step it generates something new, $f^{\mathrm{LM}}_\theta(c_t)$, and that gets added to the end:

$$c_{t+1} = c_t \oplus f^{\mathrm{LM}}_\theta(c_t)$$

A **Context Language Model (CLM)** instead produces its entire next context:

$$c_{t+1} = f^{\mathrm{CLM}}_\theta(c_t)$$

Here $f^{\mathrm{CLM}}_\theta$ can be any transformation the model chooses: delete a stale search result, rewrite a plan, move a large block to disk, or simply append as usual. A fixed menu of context-management tools is a special case of this. The difference is that nobody has to define those tools in advance. A CLM can come up with its own, either implicitly as part of its plan or explicitly as a reusable function (we'll see one in Section 4).

### Context as a file

How do you let a model rewrite its own context without inventing a new interface for it? We use one it already knows well: files. The model's live context is mirrored to a file, and the system prompt tells the model where that file is. The model edits it with ordinary Bash, exactly as it would edit any other file. Before the next model call, the edited file becomes the model's context. If the model leaves the file alone, new tokens are appended as usual, so nothing changes unless the model decides it should.

In code, the only difference from a standard agent loop is that the action can change the context itself:

```python
# Standard agent loop: the context only grows
ctx = prompt
while True:
    act = llm(ctx)
    state, obs = run(act, state)
    ctx = ctx + act + obs
    if done(act): break

# CLM loop: the action can also rewrite ctx
ctx = prompt
while True:
    act = llm(ctx)
    state, obs, ctx = run(act, state, ctx)
    ctx = ctx + act + obs
    if done(act): break
```

We deliberately keep everything else minimal. In most of our experiments the agent runs in Mini-SWE-Agent, a harness that exposes little more than a Bash shell. Even task tools such as search are provided as in-context skills rather than hard-coded into the harness, so they can be added or changed without retraining.[^rlm]

[^rlm]: The closest idea we know of is Recursive Language Models (Zhang et al., 2025), which load a long input into a REPL variable that the model can read and recurse over. The model's own conversation history, though, still only grows. CLMs make that history itself writable.

### Multi-agent CLMs

Because each context is just a file, multiple agents come almost for free. An agent swarm is a workspace that starts with several context files, each kept in sync with its own model server. A subagent is spawned by creating a new context file and shut down by deleting it. We use both in the long-running experiments in Section 4.

## 3. ContextBench: testing context management in isolation

On a real agent benchmark, context management is tangled up with reasoning and knowledge. If an agent gets a deep-research question wrong, was it the search, the reasoning, or something it forgot? To see more directly where context-management strategies break, we built **ContextBench**, four synthetic tasks in which managing the context is the only thing that matters.

:::: {.task-row}
![**Needle Retention**<br>keep needle lines verbatim]({{ '/assets/img/clm/task-needle-retention.png' | relative_url }})

![**Sudoku Sketchpad**<br>edit a board in place]({{ '/assets/img/clm/task-sudoku-sketchpad.png' | relative_url }})

![**KV Store**<br>offload values, look them up]({{ '/assets/img/clm/task-kv-store.png' | relative_url }})

![**Log Triage**<br>offload logs, answer queries]({{ '/assets/img/clm/task-log-triage.png' | relative_url }})
::::

Each task streams its input into the agent's context one message at a time: 4K-token document chunks with a few needle lines buried in filler, moves on a 16×16 Sudoku board, batches of 100 key-value writes followed by lookups, or batches of service logs followed by questions. The agent's only control over the stream is when to ask for the next message. Nothing requires search or reasoning beyond following instructions, so an agent that could keep everything in context would score 100%. Answers are graded from the agent's context; an answer that only exists in a file on disk doesn't count.

We fix the context limit at 32K tokens and turn up the **context pressure**, the total input divided by the context limit, to as much as 24×. We compare CLM against the base harness with no context management, Codex-style summarization (which we call Summary below), Context Folding, RLM, Self-Compact, and ACM. So that the comparison is about each strategy rather than about whether the model understood its tools, every method gets a detailed skill document explaining how to use its own mechanism on each task.[^skills]

[^skills]: We wrote each method's skill to a level of detail comparable to the CLM skill. The skills are released with the benchmark.

::: {.clm-chart chart="contextbench"}
**ContextBench with GPT-5.4 at a 32K context limit.** Accuracy against context pressure; error bars show one standard error. Hover over a point for exact values, click a method in the legend to hide it, or double-click to show it alone.
:::

CLM stays at or near 100% on all four tasks at every pressure level; its lowest point is 97%, on Log Triage. Every other method breaks somewhere, and the way each one breaks is telling:

- **Summaries lose exact content.** On Needle Retention, Summary keeps only 56% of the needles once the input reaches the context limit, and about 3% by 7× pressure. A summary paraphrases what should have been kept verbatim, and sometimes hallucinates it.
- **Append-only methods can't make small edits.** On Sudoku Sketchpad, changing one cell means regenerating the whole board, and mistakes compound move after move. The base harness and Context Folding fall to about 5% at 8× pressure.
- **Offloading isn't the same as forgetting.** With ordinary coding tools, an agent can copy a batch of records to disk, but it can't remove that batch from its live context, so the context keeps filling up. On KV Store, the base harness scores 0% once the input approaches the context limit. ACM, which can offload and retrieve, holds up to 12× pressure and then collapses at 24×.

None of these tasks would trouble a person with a notepad. What the baselines lack is the ability to change what's in front of them.

## 4. CLMs out of the box

Everything in this section uses existing models without any training; the only thing we change is how the context is managed.

### Emergent context-management behaviors

Before getting to numbers, it's worth looking at what models actually do once they can edit their own context. We never told them to do any of the things below. Each tab shows a real edit command from our runs, shortened (`...` marks cut text).

:::: {.clm-tabs}
::: {.tab tab="Subagent scoreboard"}
While orchestrating five subagents on circle packing, the CLM keeps a small state block at the top of its context and rewrites it in place as workers report back. It updated this block 163 times while holding its context at 6–8K tokens.

```python
new = """## ORCHESTRATOR STATE (compact)
Budget: 7/100 used. All 5 slots BUSY (subctx_0..4 ...
Dead ends: simple grid(0.822), hexagonal(0.9977) ...
Next: score my own candidates while workers run ..."""
```

[Circle packing, steps 194 and 198]{.tab-source}
:::

::: {.tab tab="A new role for notes"}
When rewriting old turns, the CLM invented a chat role that doesn't exist in the chat template, `notes`, to mark information it wrote for its own use.

```python
re.sub(r"\[\[CTX_TURN 4 .*?(?=\[\[CTX_TURN 16)",
       """[[CTX_TURN 4 role=notes]]
STATUS: ... James Gallagher (docid=58939) ...""")
```

[BrowseComp-Plus, step 40]{.tab-source}
:::

::: {.tab tab="Loops that prune results"}
The CLM writes loops over its own turns. Here it replaces searches that found nothing with a one-line marker, and in another run it collapses any tool output longer than 500 characters into a short reference.

```python
for t in turns[1:]:
    ...
    result += f'\n[[CTX_TURN search]]\nSearched: {m.group(1).strip()}. No relevant results.\n'
```

```python
while i < len(lines):
    ...
    if len(body) > 500:
        if 'bcp_search' in body:
            result.append(f"[Searched: {query}]")
        elif 'bcp_get_document' in body:
            result.append(f"[Retrieved doc {docid}]")
    else:
        result.extend(body_lines)
```

[BrowseComp-Plus, steps 1509 and 13]{.tab-source}
:::

::: {.tab tab="A reusable helper"}
The CLM defines its own compaction function, which keeps a progress note and replaces old search results with a pointer to that note. It called `compact_turns` 37 times in one run.

```python
progress = """[Search progress: VERIFIED ... NEXT: ...]"""
s = re.sub(..., progress, s)

def compact_turns(text):
    return re.sub(..., lambda m: m.group(0).split('\n')[0]
                  + '\n[search results - see progress note]', text)

s = compact_turns(s)
```

[BrowseComp-Plus, step 109]{.tab-source}
:::

::: {.tab tab="A to-do list"}
After 86 scored attempts at circle packing, the CLM compacts its history into a ledger with the best result so far and a numbered queue of untried ideas. The next eighteen turns work through that queue.

```python
new = """[EXPLORATION LEDGER - 86 scored attempts ...
Best score: 0.9931 (sum_radii=2.6177) from ...
UNTRIED IDEAS (priority order):
1. Gradient clipping norm=1.0 with 12k steps
2. Try lam=2200+uniform(0,2800) with 12k steps
3. Try quartic penalty (v^4) instead ..."""
```

[Circle packing, step 332]{.tab-source}
:::

::: {.tab tab="Dead ends"}
On a deep-research question, the CLM keeps the key facts, lists the searches that went nowhere, and marks exact phrases not to try again. By the end of the run, that list had 56 entries.

```python
re.sub(r"\[\[CTX_TURN 3.*", r"""[SUMMARY]
KEY FACTS: CCE established 1836, plaque 2018 ...
SEARCHES DONE (no relevant results): ...
DO NOT RETRY: "challenging and never boring" exact
phrase, "never boring" exact phrase
NEXT: Try searching for "Aliwal Road" ...""")
```

[BrowseComp-Plus, question 872, step 57]{.tab-source}
:::
::::

Some of these are things a harness designer might write, like a summary that keeps exactly the facts needed for the answer. Others, like inventing a chat role or writing a helper function, fall outside the menus that current context tools offer.

### Measuring cost when the context changes

Editing the context isn't free, and it's worth being precise about why. Model servers such as vLLM and SGLang cache the internal (key-value) states of each request and reuse them when the next request starts with the same tokens. An agent that only appends gets almost its whole history from this cache. Once the agent edits something in the middle of its context, though, every token after the edit has to be processed again, even the text that didn't change.

So we measure cost in **prefix-reuse FLOPs**: the FLOPs to process every prompt token from the first mismatch with the cached prefix onward, plus the FLOPs to generate new tokens. This charges CLMs for every edit they make.[^flops] All the accuracy-versus-cost plots for open models below use this metric.

[^flops]: For a sense of scale, take one Qwen3.6-27B turn with a 20K-token prompt and a 500-token response. With prefix caching, an append-only turn costs 1.4 × 10¹⁴ FLOPs. An edit in the middle of the context raises that to 5.7 × 10¹⁴, and an edit at the very start to 10.8 × 10¹⁴, 7.7 times the append-only turn.

### Coding and deep research

We start with two terminal-coding benchmarks, TerminalBench 2.1 and TBLite, and the deep-research benchmark BrowseComp-Plus. For open models, every method uses a 32K context limit and the same step budget within each benchmark. Besides the base harness and Summary, we compare against MEM1, Self-Compact, ACM, and RLM.

::: {.clm-chart chart="pareto"}
**Accuracy against inference cost on coding and deep research.** Each point is one context-management method, and the dashed line marks the Pareto frontier. Open models use a 32K context limit and are measured in prefix-reuse PFLOPs per question; Claude models use a 16K limit and are measured in billed dollars per question (†: a list-price upper bound where billing wasn't logged). Use the buttons to switch benchmark and model.
:::

With Qwen3.6-27B, CLM is on the Pareto frontier on all three benchmarks:

- **BrowseComp-Plus:** 59.4% against 53.3% for Summary, the next-best method, while using 21.5% less compute (5.9 against 7.5 PFLOPs per question).
- **TerminalBench 2.1:** a tie with Summary at 53.4%, using 30% less compute.
- **TBLite:** 73.7% against 67.0%, using 91% of Summary's compute.

We encourage you to click through the other models, because the picture isn't uniform. With Qwen3.8-27B, Summary is ahead on TerminalBench 2.1 (66.7% against 44.3%) and on BrowseComp-Plus. With Qwen3.5-9B, CLM either scores poorly at low cost (TerminalBench 2.1) or reaches good accuracy at high cost (BrowseComp-Plus); Section 6 fixes that with RL. Among the Claude models at 16K, CLM is best or second-best on TBLite for all three models, leads TerminalBench 2.1 with Sonnet, and comes second to Summary on BrowseComp-Plus. Our read is that summarization is a strong, well-trodden default, while editing your own context is a new skill that some models handle much better than others. That's part of why teaching it (Sections 5 and 6) matters.

::: {.draft-note}
The paper's main Pareto caption says "a 100-turn cap", but TerminalBench 2.1 used a 64-step cap (per the 2026-09-26 correction in `tables/main_table_open.tex`). The text above avoids the number.
:::

### Long-horizon discovery: math, repositories, and agent swarms

Context management matters most when tasks run long. We look at three open-ended settings, running from hours to more than a day.

**Math optimization (up to 5 hours).** We take four open problems popularized by AlphaEvolve: circle packing, the min-max/min-distance ratio, Erdős minimum overlap, and the Heilbronn triangle problem. The main baseline is OpenEvolve, a specialized evolutionary system in which the proposer prompts, program database, parent sampling, and island migration are all fixed in code. We also run OpenEvolve-Agent, which replaces OpenEvolve's proposer with a Mini-SWE-Agent. The CLM gets the same minimal harness as everywhere else, plus a short description of the evolutionary search procedure as in-context guidance; planning and context management are left to the agent. Every method uses Claude 4.6 Sonnet, the same evaluator, and a 32K context limit, and stops after 100 scored attempts or 5 hours.

| Method | Circle packing ↑ | Heilbronn ↑ | Min-max/min-dist ↑ | Erdős overlap ↓ |
| --- | --- | --- | --- | --- |
| OpenEvolve | 2.541 | 0.03127 | 0.07690 | 0.38123 |
| OpenEvolve-Agent | 2.525 | 0.03053 | 0.07724 | 0.38167 |
| **CLM** | 2.618 | **0.03653** | **0.07758** | **0.38094** |
| **CLMs (subagents)** | **2.636** | 0.03617 | 0.07758 | 0.38109 |

*Best score found in each run, with Claude 4.6 Sonnet and a 32K context limit.*

::: {.clm-chart chart="open_problems"}
**Best score so far against scored attempts.** Faint dots are individual attempts. A hollow end marker means the run hit the 5-hour limit before using all 100 attempts. "Zoom to the top" frames the region where the methods differ.
:::

CLM finds the best result on all four problems, including a 16.8% improvement over OpenEvolve on the Heilbronn triangle problem. On three of the four problems, the CLM runs stopped at the 5-hour limit with attempts to spare, and they still came out ahead. A general agent that manages its own context outperforms a specialized evolutionary system whose orchestration code is roughly an order of magnitude larger than the harness the CLM runs in.

**Single-repository optimization (12 hours).** EdgeBench-10 is a fixed set of ten EdgeBench tasks in which the agent optimizes a repository for 12 hours and gets verifier feedback on every submission. We compare the base harness, Summary, CLM, and CLM with up to five concurrent subagents, all at a 32K context limit, with three seeds per task.

::: {.clm-chart chart="edgebench"}
**Twelve-hour repository optimization on EdgeBench-10.** Each curve is the mean, over 30 runs (10 tasks × 3 seeds), of each run's best score so far. End labels give the final score and, for Qwen3.6-27B, the mean compute per run. For Qwen3.6-27B you can also plot score against cumulative compute.
:::

With Qwen3.6-27B, CLM ends at 44.6 using 179 PFLOPs per run, against 42.3 and 437 PFLOPs for Summary, which means 59% less compute. The subagent variant ends at 44.2 with about the same compute, so subagents add little on a single repository. The base harness overflows its context within about two hours. With Claude 4.6 Sonnet, the gap is larger: CLM reaches 51.0 and the subagent variant 50.4, against 42.3 for Summary.[^retry]

[^retry]: In these runs, when a request would overflow the context, the harness rolls back the last turn and lets the agent continue, up to 50 times. Summary never overflows by construction. If instead a CLM run ends at its first overflow, CLM falls behind Summary on this benchmark (33.8 against 43.6). At a 128K context limit, all the context-managing methods finish within about a point of each other. The paper's appendix has these results.

::: {.draft-note}
Two things to settle with the EdgeBench owner. First, how much of the recovery ("retry-50") caveat belongs in the main text rather than a sidenote. Second, the paper's main text and figure caption say "best score over three seeds per task", but the plotted curves average all 30 runs (checked in `v2_32k_unit_curve_oe_main.csv`), which matches the appendix. The caption here describes what's plotted.
:::

**Multi-repository optimization with agent swarms (24+ hours).** Software World is a small software ecosystem. Six agents each maintain one Python repository on a shared code forge: the HTTP libraries `requests` and `urllib3`, and four packages that depend on them. Like human maintainers, they change code, run tests, open and merge pull requests, and cut releases, and they choose their own work. We score the ecosystem on 17 CPU benchmarks from four downstream packages that the agents never see, measured in executed instructions; any change that breaks a held-out package's tests is thrown out. All agents use GPT-5.6-Sol in the Pi harness with its default 272K context. We compare a swarm of CLMs against a swarm that uses summary compaction, with everything else identical.

::: {.clm-chart chart="software_world"}
**Twenty-four-hour agent swarm on Software World.** Geometric-mean speedup on the 17 held-out benchmarks, sampled every two hours. Both runs are cut at the same active hour; switch the x-axis to compare them by spend.
:::

After the same 26.8 active hours, the CLM swarm has made the held-out benchmarks 4.4% faster, against 2.6% for the summary swarm. The paper puts this as a 65% larger improvement at matched spend. The benchmarks are code the agents never looked at, so these gains come from changes to the upstream libraries that carry over to their users.

::: {.draft-note}
The abstract says "65% greater improvement with the same compute". At the shared cut hour, the CLM swarm had spent $644 against $531 for the summary swarm (see the spend view). The 65% figure comes from comparing against the summary swarm's best value at or below $644 (provenance comment in `paper.tex`). Worth confirming the wording with Shannon.
:::

## 5. Learning in context

Once context management is something the model does, rather than something the harness does to the model, it can be taught like any other behavior. The simplest way is to ask.

### Steering with a single sentence

We ran Claude 4.6 Sonnet as a CLM on BrowseComp-Plus and appended a single sentence to the task prompt, then compared against the same questions without it. Nothing else changes: not the harness, not the model.

::: {.clm-chart chart="steering"}
**One sentence in the prompt changes the context-management strategy.** Pick a sentence to see its effect; grey is the same questions without the instruction. Threshold: the median context size at the first compaction, with 95% confidence intervals. Boundaries: the share of sub-question boundaries followed by a compaction at each turn offset, over sessions of four chained questions. Backup: the share of context edits preceded by a copy of the context on disk.
:::

- **"Compact once you reach Y tokens."** The first compaction lands within 3% of the requested threshold at 16K, 24K, and 32K tokens. Without the instruction, the agent first compacts at around 38K.[^attention]
- **"Compact at sub-question boundaries."** 88% of boundaries are followed by a compaction within two turns, against 40% without the instruction, and answer accuracy is unchanged.
- **"Back up before you compact."** 68% of edits are preceded by a full backup and another 9% by a partial one. Without the instruction, none of 479 edits are.

[^attention]: At an 8K threshold the same sentence is ignored. A reworded instruction that makes the agent read its context size every turn does work (first compaction at 8.5K), so the limit is attention rather than ability.

### Evolving a context-management skill

Asking works when you already know what you want. When you don't, the model can search for a good strategy itself. We write the strategy down as an in-context skill document and optimize it with a standard prompt-evolution loop:[^gepa] agents produce rollouts on a training split, a proposer model reads the traces and writes candidate skills, and the candidates are scored on a development split to decide what to keep. Once the search is frozen, we evaluate the selected skills once on a held-out test split. We run two settings on ContextBench at a 32K limit:

- **Assisted evolution:** Qwen3.6-27B is the agent and starts with no context-management instruction; Claude Fable 5.1 proposes skills.
- **Self-evolution:** Opus 5 is both the agent and the proposer.

[^gepa]: Following GEPA (Agrawal et al., 2026).

::: {.clm-chart chart="selfevo"}
**Evolving context-management skills on ContextBench.** Each point is a skill that improved the Pareto frontier when it was proposed (darker means later), gold outlines mark the final frontier, and the hollow circle is the starting point with no instruction. Accuracy is on the development split used for selection. Drag the slider to replay the search.
:::

On KV Store, assisted evolution takes Qwen3.6-27B from 22% to 84% on the development split while *lowering* compute (4.17 to 3.94 PFLOPs per task); on the held-out test split, that's 38% to 74%. On Log Triage, where Qwen3.6-27B with no instruction answers nothing correctly, evolved skills reach 100%. Opus 5 starts at 94–100% with no instruction, and on three of the four tasks self-evolution still finds skills that are both more accurate and cheaper than where it started. Not every model writes good skills for itself, though. On Log Triage, the best skill Claude 4.6 Sonnet wrote for itself scored 48%, while the skill Fable wrote takes Sonnet to 100%.

::: {.draft-note}
The abstract's headline "up to 26.9 points while reducing compute" is the KV Store L1 test gain (71.0 to 97.9) in `tables/selfevo_summary.tex`, but that row's dev compute goes up (3.23 to 3.39). The text above uses the L0 row (38.3 to 74.2 on test, with lower compute), which is what the figure shows. Please confirm with the evolution owner which number the paper and post should lead with.
:::

## 6. Learning in weights

Out of the box, smaller models are worse at this. With Qwen3.5-9B, CLM scores 28.8% on BrowseComp-Plus, six points behind the summary harness (34.7%). So we trained it. That raised two design questions.

**Which model calls get credit?** A CLM trajectory consists of many model calls, and because the context gets edited, each call sees a different input rather than one ever-growing sequence. We use stepwise GRPO: for each prompt we sample a group of complete trajectories, compute the usual GRPO advantage from each trajectory's final outcome, and apply that advantage to every model call in the trajectory.

**How do we reward efficiency without inviting reward hacking?** The outcome reward alone says little about editing, since successful trajectories can contain wasteful edits and failed ones can contain useful edits. Rewarding edits or deleted tokens directly is worse: the model learns to delete things it still needs, or to edit so often that it destroys prefix reuse. So we use a **success-gated efficiency advantage**. Among the successful trajectories in a group, those cheaper than the group's successful average (in prefix-reuse FLOPs) get a bonus, and more expensive ones get a penalty. Failed trajectories get nothing, and neither does any group with fewer than two successes:

$$A_i = A_i^{\text{out}} + w_{\text{eff}}\, A_i^{\text{eff}}, \qquad A_i^{\text{eff}} = \operatorname{clip}\!\left(\frac{\bar c_g - c_i}{\bar c_g},\, -1,\, 1\right) \text{ if trajectory } i \text{ succeeded, else } 0$$

Here $c_i$ is the trajectory's prefix-reuse FLOPs, $\bar c_g$ is the mean over the successful trajectories in its group, and we set $w_{\text{eff}} = 0.25$. We train on 3,040 deep-research prompts from OpenResearcher and evaluate on BrowseComp-Plus, which is held out.

| Harness | BrowseComp-Plus accuracy (%) | PFLOPs / question |
| --- | --- | --- |
| Summary | 34.7 → 42.1 | 4.01 → 2.19 |
| **CLM** | 28.8 → **42.5** | 1.52 → **1.34** |

*Qwen3.5-9B before and after RL on OpenResearcher, evaluated on all 830 BrowseComp-Plus questions. The checkpoint is selected on held-out OpenResearcher questions.*

RL adds 13.7 points to CLM, which ends up matching the trained summary harness while using 39% less compute per question.

::: {.clm-chart chart="rl"}
**Reward ablation over the first 80 training steps.** BrowseComp-Plus accuracy and compute at each evaluated checkpoint, with and without the efficiency advantage, for CLM and for the summary harness. Switch to "Accuracy vs. compute" to see where each run moves; up and to the left is better.
:::

With the efficiency advantage, CLM keeps its accuracy while compute per question stays low; with the task reward alone, its compute climbs to nearly 2 PFLOPs per question in the middle of training. The summary-harness run with the efficiency advantage collapsed by step 40.

::: {.draft-note}
Two things for the RL owner. (1) The paper retracted the claim that the efficiency reward causes the summary collapse (comment in `paper.tex`: a matched task-reward-only summary run also collapsed, so it's a training-recipe instability). The last sentence above states only what the curve shows; decide whether to add that context or drop the collapsed run. (2) These curves come from the training-time evaluation ledger, and they don't match the table: CLM is at 46–48% around steps 40–50 in the curves, but at 42.5% at iteration 44 in the table, and the step-0 values differ too (27.5% against 28.8%). We need a sentence explaining the difference, or matching data.
:::

## 7. Serving CLMs with Suffix Cache Reuse

Prefix-reuse FLOPs charge CLMs for every token they force the server to process again. Can we make that cheaper?

![Standard serving versus Suffix Cache Reuse after an edit replaces B with B'. Standard serving reuses the cache for A but must process B' and all of C again. Suffix Cache Reuse also reuses the cached states of C.]({{ '/assets/img/clm/suffix-cache-reuse.png' | relative_url }})

Say the context is A B C, and an edit replaces B with B'. Standard serving reuses the cache for A but processes B' and then C again, because C now sits after different text at different positions. **Suffix Cache Reuse (SCR)** keeps the cached states for C, shifts their position encodings to the new positions, and splices them in after B'. Only B' and any new tokens get processed. This is an approximation, since C's cached states were computed while B was still there. In practice, though, most CLM edits delete or compress text the model has already read, and we cap each edit at six relocated spans to limit how much approximation a single edit can introduce.[^scr]

[^scr]: SCR is implemented as a patch to SGLang. Qwen3.6-27B is a hybrid model: 48 of its 64 layers use linear attention, which keeps a fixed-size recurrent state instead of a per-token cache. For those layers, we continue from a snapshot of the state taken before the edit, and the edit is reflected through the 16 full-attention layers.

::: {.clm-chart chart="scr"}
**Suffix Cache Reuse on BrowseComp-Plus with a Qwen3.6-27B CLM.** All 830 questions were served both ways. Left: compute per question, split into prefill and decode, with accuracy under each bar. Right: where the prompt tokens came from, over all turns or only the turns right after a context edit.
:::

Accuracy is identical, 60.2% both ways, while compute drops from 10.98 to 7.14 PFLOPs per question, a 35% saving.[^scr-acc] On the turns right after an edit, SCR serves 28% of the prompt from relocated cache that standard serving would have recomputed.

[^scr-acc]: These serving runs use a different configuration from Section 4 (among other things, the chat template drops earlier reasoning), so CLM's accuracy here, 60.2%, differs slightly from the 59.4% in the main comparison.

There's a bonus: SCR helps even if you never use a CLM. The chat templates of reasoning models, including Qwen3.6, drop the reasoning blocks of earlier assistant turns whenever a new user message arrives. To the server, that's an edit: everything after the first dropped block gets recomputed, even though the agent never touched its context. SCR treats this like any other edit. On BrowseComp-Plus, SCR serves 7.8% of all prompt tokens from relocated cache, and 5.3 points of that come from dropped reasoning, against 2.5 from the CLM's own edits.

## 8. Limitations and open questions

- **It depends on the model.** Strong models use an editable context well with no training, but not uniformly. Summarization still wins some pairings of model and benchmark (Qwen3.8-27B on TerminalBench 2.1, for example), and the 9B model needed RL before editing paid off.
- **Models can't count their own tokens.** When we asked models to estimate how many tokens were in their context, they tended to answer with a few recurring values (6.2K, 9.8K, 10.4K), and Claude 4.6 Sonnet tended to underestimate; GPT-5.4 was the best calibrated of the models we tried. A token-count hint helps, and helps more the closer it is to the question. Our agents see a context-size readout after every tool result and a reminder near the budget; better built-in awareness would make both less necessary.
- **Edits miss their target.** To edit, the model has to point at exactly the right span of text. On 150 single-edit tests, models produced a correct edit command between 45% (Qwen3.5-9B) and 79% (GPT-5.4) of the time, and vague goals over realistic transcripts were the hardest. The common failures were rewriting a span into a lossy paraphrase instead of cutting it, continuing the task instead of editing (Claude models on coding transcripts), and mangling rare tokens, such as writing four angle brackets where the context has three.
- **Long runs need a way to recover from overflow.** As the EdgeBench sidenote in Section 4 describes, CLM's lead on 12-hour runs depends on letting the agent recover when it lets its context overflow.
- **An editable context is a new attack surface.** A prompt injection could try to get the model to gradually rewrite its own working memory, drop important constraints, or plant false history in a summary. Characterizing these attacks and defending against them without giving up flexibility is important future work.

## 9. Conclusion

Context Language Models turn context management from a rule written into the harness into something the model does itself. The implementation is almost embarrassingly simple, a context file the model can edit, and yet it beats hand-designed strategies on tasks from synthetic diagnostics to 24-hour agent swarms. Because the behavior lives in the model, it can be steered with a sentence, improved by evolving a skill document, and trained with RL, and Suffix Cache Reuse keeps it cheap to serve.

**Where we'd go next.** The obvious direction is scaling RL so that CLMs can explore and learn context-management strategies well beyond what we tried here. A second is distilling existing harnesses into CLMs. A standard language model maps input tokens to next-token probabilities, and the harness decides how the context is built and updated. Most harness operations are context transformations, so they can be written as CLM actions and eventually learned in the weights. Seen this way, a harness is a form of procedural memory: a skill developed outside the model that a CLM can absorb and use more generally.

## Acknowledgements

We thank Sewon Min and Steven Zijian Chen for helpful discussions, and Ilia Kulikov and Mickel Liu for their help with infrastructure questions. This work was supported by the Singapore National Research Foundation and the National AI Group in the Singapore Ministry of Digital Development and Information under the AI Visiting Professorship Programme (award number AIVP-2024-001), and by the AI2050 program at Schmidt Sciences.

## Citation

::: {.citation}
Please cite this work as:

```
Shao, Rulin and Shen, Shannon Zejiang and Yin, Junjie Oscar and Li, Yuetai and
Wang, Minheng and Ivison, Hamish and Poovendran, Radha and Lambert, Nathan and
Xiao, Teng and Lewis, Mike and Yih, Wen-tau and Zettlemoyer, Luke and
Koh, Pang Wei, "Context Language Models", 2026.
```

Or use the BibTeX citation:

```
@misc{shao2026contextlanguagemodels,
      title={Context Language Models},
      author={Rulin Shao and Shannon Zejiang Shen and Junjie Oscar Yin and Yuetai Li and Minheng Wang and Hamish Ivison and Radha Poovendran and Nathan Lambert and Teng Xiao and Mike Lewis and Wen-tau Yih and Luke Zettlemoyer and Pang Wei Koh},
      year={2026},
}
```
:::

::: {.draft-note}
Add the arXiv ID and URL to both citation formats once the paper is posted.
:::
