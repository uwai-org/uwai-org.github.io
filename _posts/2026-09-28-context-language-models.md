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
Before publishing: confirm author formatting (the TMax post bolds co-first authors; the paper marks none), the publication date, and the missing links in the resources line (arXiv, tweet). Draft notes like this one only show up in local builds; production builds hide them.
:::

![Context Language Models natively manage their own context by treating context as a file. (A) Qualitative examples of context-management behaviors introduced by CLMs. (B) Out of the box, CLMs improve performance at lower cost on BrowseComp-Plus and on Software World, where an agent swarm jointly optimizes six repositories. (C) CLMs follow textual instructions to adopt a context-management strategy, and evolve better strategies through a skill-evolution loop. (D) CLMs explore and internalize context-management strategies through online reinforcement learning.]({{ '/assets/img/clm/teaser.png' | relative_url }})

::: {.tldr}
[TL;DR]{.tldr-label}

**Context Language Models (CLMs)** are language models that manage their own context. Instead of a harness deciding what to keep, summarize, or throw away, the model can rewrite its context however it wants. We implement this in the simplest way we could think of: **the context is a file**, and the model edits it with Bash like any other file.

Built zero-shot from existing models, **CLMs outperform state-of-the-art context-management strategies** on tasks that run from minutes to more than a day. With Qwen3.6-27B at a 32K context limit, CLM scores 59.4% on BrowseComp-Plus against 53.3% for the best baseline, while using 21.5% less compute. It also comes out ahead on 12-hour repository optimization, with 59% less compute, and in a 24-hour, six-repository agent swarm. Because context management is now an intrinsic model behavior, **CLMs enable both in-context and parametric learning**. We show that CLMs can be steered with natural-language instructions and, through a standard skill-optimization loop, improve held-out accuracy on a context-management task by up to 35.9 points. We also introduce an online reinforcement learning method for CLMs, improving Qwen3.5-9B performance on BrowseComp-Plus by 47.6% while using 12% fewer FLOPs. Finally, we co-design *Suffix Cache Reuse* for CLM serving, cutting server-side compute by 35% at the same accuracy.

**Resources:** [📄 Paper](#) · [👨‍💻 GitHub](https://github.com/facebookresearch/context-language-models) · [🐦 Tweet](#)
:::

This post gives a casual walkthrough of Context Language Models, highlighting the ideas and results we find most interesting. For a more detailed and technical dive, please see the paper and the code.

## 1. Context management is still hand-designed

Everything a language model knows about the task in front of it lives in its context. For a short chat, that's fine. But agents now run for hours: they read files, run searches, try ideas, and generate far more tokens than any context window can hold. Something has to decide what stays in the context and what goes.

Today, that something is usually the harness, not the model. A typical agent harness appends every action and observation to the context, and when the context reaches a fixed threshold (say, 75% of the window), it asks the model to summarize everything and continues from the summary. A person wrote that rule, and it is the same for every task.[^harnesses]

Recent work has started to hand some of this control to the model. Some methods let the model decide *when* to compact.[^when] Others let it compact a chosen part of its context, offload content to storage and retrieve it later, or pick which fragments of the context to operate on.[^actions] Each step gives the model more autonomy, but always within a small menu of actions that people designed in advance.

We wanted to see what happens if we drop the menu and give the model full control over its own context. The bet follows the Bitter Lesson:[^bitter] rather than hand-designing context-management strategies, let models search for and learn their own. It turns out that existing models already do this well without any training, matching or outperforming hand-designed strategies across a range of tasks.

[^harnesses]: Examples include Cursor, Codex, and Terminus 2, which compact once the context reaches a predefined length. MEM1 (Zhou et al., 2026) instead updates the context at every turn, but that schedule is also fixed by the harness.

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

How do you let a model rewrite its own context without inventing a new interface for it? We use one it already knows well: files. The model's live context is mirrored to a file, and the system prompt tells the model where that file is. The model edits it with ordinary Bash, exactly as it would edit any other file. Edits are synchronized back into the model's live context before the next model call. If the model leaves the file alone, new tokens are appended as usual, so nothing changes unless the model decides it should.

We deliberately keep everything else minimal. In most experiments the agent runs on Mini-SWE-Agent, a harness with a minimal Bash interface, and even task tools such as search are provided as in-context skills rather than hard-coded into the harness, so they can be added or revised without retraining.[^rlm]

[^rlm]: The closest idea we know of is Recursive Language Models (Zhang et al., 2025), which place a long input in a REPL variable that the model can access programmatically. That gives the model control over how it reads the input, but its own live context stays read-only. CLMs make the live context itself editable; the two approaches are complementary.

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
**ContextBench with GPT-5.4 at a 32K context limit.** Accuracy against context pressure. Hover over a point for exact values, click a method in the legend to hide it, or double-click to show it alone.
:::

The fixed strategies can't adapt to the live context, and none of the existing methods performs perfectly, even on these simple tasks. Each fails in a different way:

- **Summaries lose exact content.** Summary-based compaction can lose or hallucinate information on Needle Retention and Sudoku Sketchpad.
- **Append-only methods can't make small edits.** Methods without flexible in-place editing must regenerate the full Sudoku state for every fine-grained edit.
- **Offloading isn't the same as forgetting.** Standard coding tools can offload information on KV Store and Log Triage, but they can't evict it from the live context on demand.

These failures are what motivate fully adaptive, model-controlled context management.

## 4. CLMs out of the box

Everything in this section uses existing models without any training; the only thing we change is how the context is managed.

### Emergent context-management behaviors

Here is what models actually do once they can edit their own context. Some of these behaviors are new; others reproduce effective compaction behaviors familiar from existing harnesses.

:::: {.clm-tabs .clm-examples}
::: {.tab tab="Subagent scoreboard"}
To orchestrate and monitor subagents, the CLM builds scoreboards and trackers inside its context and keeps them current with in-place edits. In one run it updated agent status through 163 in-place edits while keeping its context at only 6–8K tokens.

<pre class="clm-edit"><code><span class="sc">open(p, "w").write("""[[CTX_TURN 1 role=assistant]]</span>
## STATE — Erdős Minimum Overlap Problem (compact)
<span class="hl">LEDGER TOP:</span> 0.9992491 ...
<span class="hl">AGENTS:</span> 21 launched, 5 currently running ...
<span class="hl">KEY FILES:</span> /workspace/subctx_4/h_best_final.npy ...
<span class="hl">FINDINGS:</span> All methods plateau at 0.381157 ...<span class="sc">""")</span></code></pre>

<pre class="clm-edit"><code><span class="sc">new = """</span><span class="hl">## ORCHESTRATOR STATE (compact)</span>
<span class="hl">Budget:</span> 7/100 used. All 5 slots BUSY (subctx_0..4 ...
<span class="hl">Dead ends:</span> simple grid(0.822), hexagonal(0.9977) ...
<span class="hl">Next:</span> score my own candidates while workers run ...<span class="sc">"""</span></code></pre>

[Erdős minimum overlap, step 455; circle packing, steps 194 and 198]{.tab-source}
:::

::: {.tab tab="A new role for notes"}
When rewriting old turns, the CLM created a new role alongside the chat template's roles, `notes`, to mark information it wrote for its own internal use.

<pre class="clm-edit"><code><span class="sc">re.sub(r"</span><span class="rm">\[\[CTX_TURN 4 .*?(?=\[\[CTX_TURN 16)</span><span class="sc">",</span>
<span class="sc">       """[[CTX_TURN 4 </span><span class="hl">role=notes</span><span class="sc">]]</span>
STATUS: ... James Gallagher (docid=58939) ...<span class="sc">""")</span></code></pre>

[BrowseComp-Plus, step 40]{.tab-source}
:::

::: {.tab tab="Loops that prune results"}
The CLM writes loops over its own turns: here it replaces past searches that found nothing with a one-line marker, and in another run it compacts overly long tool outputs into short references.

<pre class="clm-edit"><code><span class="hl">for t in turns[1:]:</span> <span class="sc">...</span>
<span class="sc">    result += f'\n[[CTX_TURN search]]\n</span><span class="hl">Searched: {m.group(1).strip()}.</span> <span class="hl">No relevant results.</span><span class="sc">\n'</span></code></pre>

<pre class="clm-edit"><code><span class="hl">while i &lt; len(lines):</span> <span class="sc">...</span>
<span class="sc">    if </span><span class="hl">len(body) &gt; 500</span><span class="sc">: ...</span>
<span class="sc">        if </span>'bcp_search' in body<span class="sc">: ...</span>
<span class="sc">            result.append(f"</span><span class="hl">[Searched: {query}]</span><span class="sc">")</span>
<span class="sc">        elif </span>'bcp_get_document' in body<span class="sc">: ...</span>
<span class="sc">            result.append(f"</span><span class="hl">[Retrieved doc {docid}]</span><span class="sc">")</span>
<span class="sc">    else:</span>
<span class="sc">        result.extend(body_lines)</span></code></pre>

[BrowseComp-Plus, steps 1509 and 13]{.tab-source}
:::

::: {.tab tab="A reusable helper"}
The CLM defines its own compaction function, which keeps a progress note and replaces old search results with a pointer to that note. It invoked `compact_turns` 37 times in one run.

<pre class="clm-edit"><code><span class="sc">progress = """</span>[Search progress: VERIFIED ... NEXT: ...]<span class="sc">"""</span>
<span class="sc">s = re.sub(..., </span><span class="hl">progress</span><span class="sc">, s)</span>

<span class="hl">def compact_turns(text):</span>
<span class="sc">    return re.sub(..., lambda m: </span>m.group(0).split('\n')[0]
<span class="sc">        + '\n</span><span class="hl">[search results - see progress note]</span><span class="sc">', text)</span>
<span class="hl">s = compact_turns(s)</span></code></pre>

[BrowseComp-Plus, step 109]{.tab-source}
:::

::: {.tab tab="Summaries that keep what matters"}
The CLM also reproduces effective behaviors from existing baselines. It compresses 21K tokens into a summary that keeps the facts needed for the answer, and it summarizes finished experiments while keeping a list of untried ideas for later.

<pre class="clm-edit"><code><span class="sc">re.sub(r"</span><span class="rm">\[\[CTX_TURN 2.*</span><span class="sc">",</span>
<span class="sc">  "</span>[SUMMARY: ... <span class="hl">Kader Asmal Excellence Award</span>
   <span class="hl">launched 2011 by Mrs A Motshekga</span> ...]<span class="sc">")</span></code></pre>

<pre class="clm-edit"><code><span class="sc">new = """</span>[EXPLORATION LEDGER - <span class="hl">86 scored attempts</span> ...
Best score: 0.9931 (sum_radii=2.6177) from ...
<span class="hl">UNTRIED IDEAS (priority order):</span>
<span class="hl">1.</span> Gradient clipping norm=1.0 with 12k steps
<span class="hl">2.</span> Try lam=2200+uniform(0,2800) with 12k steps ...<span class="sc">"""</span></code></pre>

[BrowseComp-Plus, step 20; circle packing, step 332]{.tab-source}
:::

::: {.edit-legend}
[new text the CLM writes into its context]{.hl} [context the edit deletes]{.rm} [code around the edit]{.sc}
:::

**Qualitative examples of CLM context-management behaviors.** Each tab shows a real edit command from our runs, shortened where marked with `...`. The highlighted span is what each example is about, usually the new text the CLM writes into its next context.
::::

### Measuring cost when the context changes

Model servers such as vLLM and SGLang cache the internal (key-value) states of each request and reuse them when the next request starts with the same tokens. An agent that only appends gets almost its whole history from this cache. Once the agent edits something in the middle of its context, though, every token after the edit has to be processed again, even the text that didn't change.

So we measure cost in **prefix-reuse FLOPs**: the FLOPs to process every prompt token from the first mismatch with the cached prefix onward, plus the FLOPs to generate new tokens. This charges CLMs for every edit they make.[^flops] All the accuracy-versus-cost plots below use this metric.

[^flops]: For a sense of scale, take one Qwen3.6-27B turn with a 20K-token prompt and a 500-token response. With prefix caching, an append-only turn costs 1.4 × 10¹⁴ FLOPs. An edit in the middle of the context raises that to 5.7 × 10¹⁴, and an edit at the very start to 10.8 × 10¹⁴, 7.7 times the append-only turn.

### Coding and deep research

We start with two terminal-coding benchmarks, TerminalBench 2.1 and TBLite, and the deep-research benchmark BrowseComp-Plus. Every method runs on the same Mini-SWE-Agent backbone with a 32K context limit, and all are evaluated out of the box. Besides the base harness and Summary, we compare against MEM1, Self-Compact, ACM, and RLM.

::: {.clm-chart chart="pareto"}
**Accuracy against inference cost on coding and deep research, at a 32K context limit.** Each point is one context-management method, and the dashed line marks the Pareto frontier. Cost is prefix-reuse PFLOPs per question. Use the buttons to switch between Qwen3.6-27B and the smaller Qwen3.5-9B.
:::

With Qwen3.6-27B, CLM is on the Pareto frontier on all three benchmarks:

- **BrowseComp-Plus:** 59.4% against 53.3% for Summary, the strongest baseline, while using 21.5% less compute than Summary and 28.9% less than MEM1.
- **TerminalBench 2.1:** matches Summary at 53.4% while using only 70% of its compute.
- **TBLite:** 73.7% against 67.0%, using 91% of Summary's compute.

CLM leaves the decision of when and how to edit the context to the model, so its gains grow with the model's ability to make that decision. With Qwen3.5-9B, CLM still reaches 39.9% on BrowseComp-Plus, above Summary (37.7%), but the smaller model edits its context less often. On TerminalBench 2.1, Qwen3.5-9B edits its context 1.4 times per task on average and makes no edit in half of the tasks, while Qwen3.6-27B edits 2.6 times per task. The median peak context is correspondingly higher for Qwen3.5-9B: 30.2K tokens of the 32K limit, against 17.6K for Qwen3.6-27B.

### Long-horizon discovery: math, repositories, and agent swarms

Context management matters most when tasks run long. We look at three open-ended settings, running from hours to more than a day.

**Math optimization (up to 5 hours).** We take four open problems popularized by AlphaEvolve: circle packing, the min-max/min-distance ratio, Erdős minimum overlap, and the Heilbronn triangle problem. The main baseline is OpenEvolve, a specialized AlphaEvolve-style workflow for program generation, evaluation, and evolutionary selection. We also run OpenEvolve-Agent, which replaces OpenEvolve's proposer with a Mini-SWE-Agent that can interact with the environment before each submission. The CLM gets the same minimal Bash harness as everywhere else, with the evolutionary algorithm provided as in-context guidance; planning and context management are left to the agent. Every method uses Claude 4.6 Sonnet, the same evaluator, and a 32K context limit, and stops after 100 scored attempts or 5 hours.

| Method | Circle packing ↑ | Heilbronn ↑ | Min-max/min-dist ↑ | Erdős overlap ↓ |
| --- | --- | --- | --- | --- |
| OpenEvolve | 2.541 | 0.03127 | 0.07690 | 0.38123 |
| OpenEvolve-Agent | 2.525 | 0.03053 | 0.07724 | 0.38167 |
| **CLM** | 2.618 | **0.03653** | **0.07758** | **0.38094** |
| **CLMs (subagents)** | **2.636** | 0.03617 | 0.07758 | 0.38109 |

*Best-of-run scores with Claude 4.6 Sonnet and a 32K context limit.*

::: {.clm-chart chart="open_problems"}
**Best score so far against scored attempts on the four problems.** Lines show the best score so far and dots individual scored candidates. "Zoom to the top" frames the final-score range, like the insets in the paper's figure.
:::

CLM achieves the highest best-of-run score on all four problems, including improvements over OpenEvolve of 16.8% on the Heilbronn triangle problem and 3.0% on circle packing. A general agent with direct control over its context outperforms a specialized evolutionary workflow, with less fixed orchestration.

**Single-repository optimization (12 hours).** EdgeBench-10 is a fixed set of ten EdgeBench tasks in which the agent optimizes a repository for up to 12 hours, with verifier feedback on its submissions. We compare the base harness, Summary, CLM, and CLM with up to five concurrent subagents, all with a 32K context budget, and report the best score over three seeds per task.[^retry]

[^retry]: When a request would exceed the context budget, the harness rolls back the last turn and lets the agent continue, up to 50 times.

::: {.clm-chart chart="edgebench"}
**Twelve-hour repository optimization on EdgeBench-10.** Curves show best-of-three scores over 12 hours. End labels give final scores and, for Qwen3.6-27B, mean compute per trial (PF = prefix-reuse PFLOPs). The 128K view repeats the Qwen3.6-27B comparison with a 128K context budget.
:::

With Qwen3.6-27B, CLM reaches 44.6 using 179 PFLOPs per trial, against 42.3 and 437 PFLOPs for Summary, which means 59% less compute. The subagent variant reaches 44.2 at 181 PFLOPs, so subagents provide little additional benefit on this single-repository benchmark. With Claude 4.6 Sonnet, CLM and its subagent variant reach 51.0 and 50.4, against 42.3 for Summary. With a 128K budget, the three methods that manage context keep improving over the twelve hours, while the base harness stops improving within the first two hours; CLM with subagents reaches 50.2, against 47.3 for CLM and 47.8 for Summary, using 219, 142, and 222 PFLOPs per trial.

**Multi-repository optimization with agent swarms (24+ hours).** Software World scales this up to an agent swarm. Six agents, one per Python repository (`requests`, `urllib3`, and four downstream packages), work in parallel for more than 24 hours to make their repositories faster. We score the result on 17 held-out CPU benchmarks from four downstream packages that the agents never see, measuring speedup in executed instructions; a benchmark that breaks counts as no speedup. All agents use GPT-5.6-Sol in the Pi agent harness with its default 272K context. We compare a swarm of CLMs against a swarm that uses summary compaction.

::: {.clm-chart chart="software_world"}
**Twenty-four-hour agent swarm on Software World.** Geometric-mean speedup on the 17 held-out benchmarks against active hours, for the CLM swarm and the summary swarm.
:::

The CLM swarm reaches a 1.044× speedup on the held-out benchmarks, against 1.026× for the summary swarm, which the paper reports as a 65% greater downstream speedup at the same spend. Because the benchmarks come from packages the agents never see, this is an extrinsic test of whether their improvements transfer beyond the repositories they work on directly.

## 5. Learning in context

CLMs make context management an intrinsic model behavior, so it can be learned like any other skill. The simplest way to change it is to tell the model what you want.

### Steering with a single sentence

We ran Claude 4.6 Sonnet as a CLM on BrowseComp-Plus and appended a single sentence to the task prompt, then compared against the same questions without it. Nothing else changes: not the harness, not the model.

::: {.clm-chart chart="steering"}
**One sentence in the prompt changes the context-management strategy.** Pick a sentence to see its effect; grey is the same questions without the instruction. Threshold: the median context size at the first compaction, with bootstrap confidence intervals. Boundaries: the share of sub-question boundaries followed by a compaction at each turn offset, over sessions of four chained questions. Backup: the share of context edits preceded by a copy of the context on disk.
:::

- **"Compact once you reach Y tokens."** The first compaction lands close to the requested threshold: at 16.0K, 23.6K, and 30.9K tokens for thresholds of 16K, 24K, and 32K.
- **"Compact at sub-question boundaries."** 88% of boundaries are followed by a compaction within two turns, against 40% without the instruction.
- **"Back up before you compact."** 68% of edits are preceded by a full backup and another 9% by a partial one. Without the instruction, none are.

### Evolving a context-management skill

CLMs can also improve their context-management strategy through textual evolution. We write the strategy down as an in-context skill document and optimize it with a standard prompt-evolution loop:[^gepa] the agent produces rollouts on a training split, a proposer model uses the traces to write candidate skills, and the candidates are scored on a development split to decide what to keep. Once the search is frozen, we evaluate the selected skill once on a held-out test split. We run two settings on ContextBench at a 32K limit:

- **Assisted evolution:** Qwen3.6-27B is the agent and starts with no context-management instruction; Claude Fable 5.1 proposes skills.
- **Self-evolution:** Opus 5 is both the agent and the proposer.

[^gepa]: Following GEPA (Agrawal et al., 2026).

::: {.clm-chart chart="selfevo"}
**Evolving context-management skills on ContextBench.** Each point is a skill that improved the Pareto frontier when it was proposed (darker means later), gold outlines mark the final frontier, and the hollow circle is the starting point with no instruction. Accuracy is on the development split used for selection. Drag the slider to replay the search.
:::

On KV Store, assisted evolution takes Qwen3.6-27B from 22.3% to 83.8% on the development split while lowering compute. On the held-out test split, the selected skill raises accuracy from 38.3% to 74.2%, a gain of 35.9 points. On Log Triage, where Qwen3.6-27B with no instruction answers nothing correctly, the selected skill reaches 100%. Opus 5 already starts between 94% and 100%, and self-evolution still finds skills that either reduce cost at the same or higher accuracy, or raise accuracy further.

## 6. Learning in weights

Before training, CLM with Qwen3.5-9B scores 28.8% on BrowseComp-Plus, six points behind the summary harness (34.7%), because of the smaller model's limited context-management capabilities. So we trained it. That raised two design questions.

**Which model calls get credit?** A CLM trajectory consists of many model calls, and because the context gets edited, each call sees a different input rather than one ever-growing sequence. We use stepwise GRPO: for each prompt we sample a group of complete trajectories, compute the usual GRPO advantage from each trajectory's final outcome, and apply that advantage to every model call in the trajectory.

**How do we reward efficiency without inviting reward hacking?** The outcome reward alone says little about editing, since successful trajectories can contain wasteful edits and failed ones can contain useful edits. Rewarding edits or deleted tokens directly is worse: the model learns to make unnecessary edits that throw away important information or hurt prefix reuse. So we use a **success-gated efficiency advantage**. Among the successful trajectories in a group, those cheaper than the group's successful average (in prefix-reuse FLOPs) get a bonus, and more expensive ones get a penalty. Failed trajectories get nothing, and neither does any group with fewer than two successes:

$$A_i = A_i^{\text{out}} + w_{\text{eff}}\, A_i^{\text{eff}}, \qquad A_i^{\text{eff}} = \operatorname{clip}\!\left(\frac{\bar c_g - c_i}{\bar c_g},\, -1,\, 1\right) \text{ if trajectory } i \text{ succeeded, else } 0$$

Here $c_i$ is the trajectory's prefix-reuse FLOPs, $\bar c_g$ is the mean over the successful trajectories in its group, and we set $w_{\text{eff}} = 0.25$. We train on 3,040 deep-research prompts from OpenResearcher and evaluate on BrowseComp-Plus, which is held out.

| Harness | BrowseComp-Plus accuracy (%) | PFLOPs / question |
| --- | --- | --- |
| Summary | 34.7 → 42.1 | 4.01 → 2.19 |
| **CLM** | 28.8 → **42.5** | 1.52 → **1.34** |

*Qwen3.5-9B before and after RL on OpenResearcher, evaluated on BrowseComp-Plus. The checkpoint is selected on held-out OpenResearcher questions.*

RL adds 13.7 points to CLM, which ends up matching the trained summary harness while using 39% less compute per question.

::: {.clm-chart chart="rl"}
**RL training curves through step 70.** Qwen3.5-9B trained on OpenResearcher and evaluated on BrowseComp-Plus with a 32K context limit, for CLM and the summary harness, each trained with and without the efficiency (FLOPs) reward. Switch to "Accuracy vs. compute" to see where each run moves; up and to the left is better.
:::

Adding the efficiency reward further reduces inference cost without a clear loss in accuracy, for both CLM and the summary harness.

## 7. Serving CLMs with Suffix Cache Reuse

Prefix-reuse FLOPs charge CLMs for every token they force the server to process again. Can we make that cheaper?

![Standard serving versus Suffix Cache Reuse after an edit replaces B with B'. Standard serving reuses the cache for A but must process B' and all of C again. Suffix Cache Reuse also reuses the cached states of C.]({{ '/assets/img/clm/suffix-cache-reuse.png' | relative_url }})

Say the context is A B C, and an edit replaces B with B'. Standard serving reuses the cache for A but processes B' and then C again, because C now sits after different text at different positions. **Suffix Cache Reuse (SCR)** keeps the cached states for C, shifts their position encodings to the new positions, and splices them in after B'. Only B' and any new tokens get processed. This is an approximation: C's cached states still encode the old prefix, which can even help in some cases, since they retain richer information from the past. To limit how much approximation a single edit can introduce, we relocate at most six surviving spans per edit.[^scr]

[^scr]: SCR is implemented as a patch to SGLang. Qwen3.6-27B is a hybrid model: 48 of its 64 layers use linear attention, which keeps a fixed-size recurrent state instead of a per-token cache. For those layers, we continue from a snapshot of the state taken before the edit, and the edit is reflected through the 16 full-attention layers.

::: {.clm-chart chart="scr"}
**Suffix Cache Reuse on BrowseComp-Plus with a Qwen3.6-27B CLM.** All 830 questions were served both ways. Left: compute per question, split into prefill and decode, with accuracy under each bar. Right: where the prompt tokens came from, over all turns or only the turns right after a context edit.
:::

Accuracy is identical, 60.2% both ways, while compute drops from 10.98 to 7.14 PFLOPs per question, a 35% saving. On the turns right after an edit, SCR serves 28% of the prompt from relocated cache that standard serving would have recomputed.

SCR is not limited to CLMs. The chat templates of many reasoning models drop the reasoning blocks of earlier assistant turns once the next user message arrives. To the server, that's an edit: everything after the first dropped block gets recomputed, even though the agent never touched its context. SCR treats this like any other edit. On BrowseComp-Plus, SCR serves 7.8% of all prompt tokens from relocated cache, and 5.3 points of that come from dropped reasoning, against 2.5 from other context edits.

## 8. Limitations and open questions

- **It depends on the model.** CLM leaves the decision of when and how to edit the context to the model, so its gains grow with the model's ability to make that decision. Qwen3.5-9B, for example, edits its context less often than Qwen3.6-27B.
- **Models can't count their own tokens.** When we asked models to estimate how many tokens were in their context, they tended to answer with a few recurring values (like 6.2K, 9.8K, or 10.4K), and Claude 4.6 Sonnet tended to underestimate; GPT-5.4 was the best calibrated of the three models we tried. A token-count hint helps, and helps more the closer it is to the question. Today, CLM gets an editing reminder shortly before it reaches its budget; better built-in awareness would make that less necessary.
- **An editable context is a new attack surface.** A prompt injection could try to get the model to gradually rewrite its own working memory, drop important constraints, or plant false history in a summary. Such attacks are a practical concern: OpenAI has reported that [self-replicating prompt injections exist](https://alignment.openai.com/misalignment-reports/self-replicating-prompt-injections-exist/). Characterizing these attacks and defending against them without giving up flexibility is important future work.

## 9. Conclusion

Context Language Models turn context management from a rule written into the harness into something the model does itself. The implementation is simple, a context file the model can edit, yet it outperforms hand-designed strategies on tasks from synthetic diagnostics to 24-hour agent swarms. Because the behavior lives in the model, it can be steered with a sentence, improved by evolving a skill document, and trained with RL, and Suffix Cache Reuse keeps it cheap to serve.

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
