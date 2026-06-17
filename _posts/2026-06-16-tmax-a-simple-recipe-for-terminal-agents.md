---
title: "TMax: A Simple Recipe for Terminal Agents"
author: WAI
date: 2026-06-16
permalink: /blog/tmax/
custom_header: true
description: >-
  TMax is an open recipe for training state-of-the-art terminal agents at small
  scale: a 14,600-environment dataset and a simple outcome-only RL recipe that
  reaches 27% on Terminal Bench 2.0 with a 9B model.
---

::::: {.post-hero}
<h1 class="title"><img class="title-logo" src="/assets/img/tmax/logo.png" alt="TMax mascot logo"> TMax: A Simple Recipe for Terminal Agents</h1>

:::: {.byline}
**Hamish Ivison**\*, **Junjie Oscar Yin**\*,<br>
Rulin Shao, Teng Xiao, Nathan Lambert, Hannaneh Hajishirzi[^cofirst]
::::

[^cofirst]: {-} \*Co-first authors. Work done while HI and NL were at Ai2.

:::: {.affiliations}
Allen Institute for AI · University of Washington
::::

:::: {.post-date}
June 16, 2026
::::
:::::

![Terminal Bench 2.0 score against model size. Tmax-9B is the strongest open model under 10B parameters and is competitive with much larger open and closed models. Final numbers (including a 27B variant) are being finalized for the paper.](/assets/img/tmax/teaser.png)

::: {.tldr}
[TL;DR]{.tldr-label}

**TMax** is a simple, fully-open recipe for training strong terminal agents at small scale. We release data and models: **Tmax-15k**, a dataset of **14,600 RL environments** built from a compositional pipeline with explicit control over difficulty and diversity — over **2.5× larger** than the next-largest open terminal dataset that releases full environment data; and a **simple, outcome-only RL recipe** (GRPO plus a few stability fixes). Our 9B model, **Tmax-9B**, reaches **27.2% on [Terminal Bench 2.0](https://www.tbench.ai/leaderboard/terminal-bench/2.0)**: the strongest open-weights model under 10B we are aware of, beating 32B terminal agents from prior work and approaching closed models like Claude Haiku 4.5 (29.8%). 

**Resources:** 📄 Paper · 👨‍💻 GitHub · 🤗 HF Models · 🤗 HF Dataset · 🐦 Tweet — *links todo.*
:::

## 1. Terminal agents, and why they're hard to train

Terminal-using agents have quickly become the most popular way people put language models to work, yet almost all of the recipes for *training* them live behind closed doors. A *terminal agent* is a language model that gets things done the way a developer does: by issuing commands in a shell, reading the output, and iterating. Resolve a failing build, profile a slow service, recover a corrupted archive, wire up a multi-service stack. The model plans, runs a command, looks at `stdout`/`stderr`, and tries again. This loop is now the dominant interface for agentic coding products,[^products] and the tasks terminal agents asked to solve are getting more complex and long-horizon.

[^products]: For example, Anthropic's Claude Code and other terminal-native coding products.

Despite this popularity, there is surprisingly little *open* academic work on training terminal agents with RL. We think this comes down to three gaps:

- **Hard benchmarks.** Evaluations like [Terminal Bench](https://www.tbench.ai/)[^termbench] capture genuinely long-horizon, multi-step terminal work — but they are difficult, and much prior work sidesteps them in favor of simpler bug-fixing or natural-language-to-bash setups.
- **A lack of data.** Real-world terminal traces are scarce or proprietary, and the synthetic datasets that do exist tend to be small, narrow (mostly file manipulation or one dominant domain), or never release their actual RL environments.
- **A lack of a simple baseline recipe.** Most data-generation papers stop at supervised fine-tuning; the ones that try RL often report ~1-point gains, leaving little signal for the community to build on.

[^termbench]: Merrill et al., "Terminal Bench," 2026.

TMax closes the data and recipe gaps. We provide both a large, difficulty-controlled dataset of complex terminal tasks and a simple RL recipe that produces large, reliable improvements — over **5 points** on Terminal Bench, with gains that transfer across tasks and harnesses. Concretely, our contributions are:

1. **Tmax-15k**, a dataset of 14,600 RL environments, over 2.5× larger than prior open terminal datasets and notably harder.
2. **Open-weights terminal agents** trained on this data, reaching state-of-the-art among open models under 10B — our best 9B model hits 27.2% on Terminal Bench 2.0.
3. **A simple, reproducible RL recipe**, with all components released for training the models.
4. **Evidence that terminal RL generalizes** across harnesses and across tasks, suggesting the model learns real new skills rather than overfitting a single setup.

## 2. Generating terminal environments at scale

Training a terminal agent with RL needs a lot of executable environments: each task has to ship with the files, dependencies, and an automated check that says whether the agent succeeded. Existing pipelines tend to fall short in three ways. They lean on **complex, multi-stage generation** that is hard to scale; they produce **homogeneous** task suites dominated by one or two domains; and they offer **little control over difficulty**, yielding tasks that are either trivially solved or hopelessly out of reach.

Our pipeline is designed to avoid all three. We use [Gemini-3-Pro](https://deepmind.google/technologies/gemini/) as the generator,[^gen] and the core idea is simple: **compose each task by independently sampling from a set of structured axes.**

[^gen]: We chose Gemini-3-Pro for its strong performance on Terminal Bench.

![The TMax data pipeline. Each task is composed by independently sampling 9 structured axes, after which the generator instantiates a Dockerfile, a unit-test verifier, source files, and task instructions. A single build step — no teacher-based validation — keeps generation cheap to scale.](/assets/img/tmax/data-pipeline.png)

### 2.1 Generation pipeline

A task is composed by drawing one value from each of **nine structured axes**. Three are seeded from the [Nemotron-Terminal](https://huggingface.co/nvidia) skill taxonomy[^nemotron] — domain, skill type, and primitive skills — and six more are ours, added to push diversity and difficulty directly. We leave the full axis table (with cardinalities and examples) to the paper; the pipeline figure above gives the gist.

[^nemotron]: Pi et al., "Nemotron-Terminal," 2026. We seed our domain and skill axes from their taxonomy.

Because the axes are drawn independently, the sampler yields combinatorially many distinct task signatures — and lets us calibrate each axis on its own. Three design choices make the pipeline work.

**Scalability via soft filtering.** Prior pipelines validate every task by having a strong model attempt it, which is expensive. We skip that step entirely. Our RL training already does *soft* filtering for free: it drops any task where all rollouts get the same reward, since those contribute no gradient. In practice the all-zero rate on our data is low — fewer than 8 samples filtered per batch — so unsolvable tasks simply wash out during training. All we have to guarantee at generation time is that the environment *builds*, which we ensure with one Docker image per task (sharing a pre-built base image per domain). One build step instead of two, and synthetic environments scale cheaply.

**Diversity via independent sampling.** Independent sampling is itself the main diversity mechanism, and we add two more. We condition generation on domain-specific **personas**[^persona] (6–18 per domain) so that, say, a "red-team operator crafting an evasion payload" naturally shapes a plausible security task. And we ship **multi-modal fixtures**: a PNG, an audio file, a video, a stripped binary, a vendored package, or a multi-service compose stack. The policy itself stays a text-only model — it inspects these artifacts through ordinary terminal tooling (OCR, audio transcription, `ffmpeg`), so no multi-modal model or training change is required.

[^persona]: Persona-conditioned synthesis follows a line of prior data work, e.g. Ge et al., "Scaling Synthetic Data Creation with Personas," 2025.

**Difficulty via explicit calibration.** To avoid the usual bimodal "trivial or impossible" split, we calibrate difficulty along two new complexity axes (*task complexity*, from a handful of commands to intricate 30–60-command workflows, and *command complexity*, from bash-only to bash + code + system services) and sample uniformly across buckets. We also go beyond brittle string-equality checks with **graded verifiers** — metric thresholds (e.g. accuracy ≥ 0.95), adversarial corpora (accept clean, reject malicious), fuzz equivalence against an oracle, or multi-protocol service checks. Thresholds give a continuous difficulty knob; multi-condition checks naturally extend task length.

### 2.2 Comparing terminal datasets

We annotated our data and six prior datasets with [Gemini-3-Pro](https://deepmind.google/technologies/gemini/) and measured difficulty with [Gemini-3-Flash](https://deepmind.google/technologies/gemini/) (250-task subsample per dataset, 8 rollouts each).

| Dataset | Size | Pass@1 | Pass@8 | Domain balance | Skill balance |
| --- | --- | --- | --- | --- | --- |
| **Tmax-15k (ours)** | **15k** | **42%** | **53%** | **0.998** | **0.732** |
| Endless Terminals | 2.4k | 92% | 95% | 0.481 | 0.284 |
| Open Thoughts Agents | 0.7k | 51% | 60% | 0.292 | 0.153 |
| TermiGen | 3k | 57% | 66% | 0.646 | 0.477 |
| TerminalTraj | 5.5k | 54% | 65% | 0.363 | 0.374 |
| CLI-Gym | 1.5k | 41% | 55% | 0.283 | 0.061 |
| SWE-smith | 59k | 54% | 72% | 0.146 | 0.042 |

*Difficulty and balance statistics (Gemini-3-Flash, pass@k as mean over tasks). Balance is a "fraction-of-uniform" diversity score in [0, 1].*

Two things stand out. First, **balance**: prior datasets pile 34–95% of their mass onto a single domain (software engineering alone is 95% of SWE-smith), while ours spreads roughly uniformly across all nine — the highest domain balance (0.998) and skill-type balance (0.732) of any dataset.

![Domain distribution across datasets. Prior datasets skew heavily toward one or two domains; our compositional sampler yields balanced coverage across all nine.](/assets/img/tmax/data-composition.png)

Second, **difficulty**: our data is among the hardest of the bunch. Pass@1 is 42% (vs. 41–92% for prior datasets), and crucially it has the **lowest pass@8** (53%) — the difficulty gap persists even as we draw more rollouts, so the tasks are genuinely hard rather than merely high-variance. We also checked for contamination using a 13-gram sliding window against the Terminal Bench tasks and found **0% overlap**.

### 2.3 SFT data and a simple harness

A light SFT warm-up can help stability and performance before RL,[^warmstart] so for our weaker-model experiments — on the older [Qwen3-8B](https://huggingface.co/Qwen) — we also generate a small SFT dataset. Reusing the same pipeline, we make 2.2k more environments and sample 8 trajectories each from [Qwen3.6-27B](https://huggingface.co/Qwen), yielding 16.5K trajectories (8K of them successful). This SFT data is used only for the Qwen3-8B runs; since this post centers on our primary Qwen3.5 results, we point readers to the paper for the full Qwen3 numbers.

Both data generation and RL rollouts run through a simple harness based on [mini-swe-agent](https://github.com/SWE-agent/mini-swe-agent) with a persistent shell — we found the default Terminus-2 harness more brittle with small models, since it expects the agent to send raw keystrokes.

[^warmstart]: Shown e.g. in DeepSeek-R1 and Olmo 3.

## 3. Training TMax with RL

With the data in hand, the question is whether a *simple* recipe can turn it into a strong agent. We deliberately keep the algorithm plain — the goal is a clean, reproducible testbed where there is obvious room for future algorithmic improvement, not a bag of tricks.

### 3.1 The recipe

We train with **GRPO**[^grpo] — outcome-only, no learned reward model — with a handful of changes for stability in the long-horizon agentic setting:

[^grpo]: Shao et al., "DeepSeekMath," 2024.

- **DPPO** instead of vanilla GRPO.[^dppo] DPPO masks tokens where the inference (vLLM) and training logprobs disagree, using a binary approximation of the total-variation divergence — a small change that meaningfully tames training collapse.
- A **token-level loss**,[^dapo] fully **asynchronous** training, filtering of zero-standard-deviation groups, and active sampling to keep batches full.[^olmo]
- An **FP32 LM head**, keeping the language-model head in full precision to minimize the train/inference mismatch — which we found especially important for the hybrid Qwen3.5 models.

[^dppo]: Qi et al., "Rethinking the Trust Region for LLM RL" (DPPO), 2026.
[^dapo]: Token-level loss as in Yu et al., "DAPO," 2025.
[^olmo]: Following Olmo 3.

Infrastructure-wise, we extend [open-instruct](https://github.com/allenai/open-instruct), use [vLLM](https://github.com/vllm-project/vllm) for rollouts, and run sandboxes via [Podman](https://podman.io/) or Apptainer. A typical run uses 2 nodes for training and 6 for inference on H100s, and takes 2–3 days. Key hyperparameters: 500 steps, a group size of 32, 8 prompts per batch, up to 65,536 tokens of context, and up to 64 tool calls per episode. We keep thinking on intermediate turns ("interleaved thinking"). We evaluate on Terminal Bench 2.1 and [Terminal Bench Lite](https://www.tbench.ai/), averaging over 3 runs.

### 3.2 The data is what matters

We first hold the model fixed ([Qwen3.5-9B](https://huggingface.co/Qwen)) and vary only the RL dataset. Training on **Tmax-15k gives the strongest Terminal Bench performance of any dataset we tried** — we call the resulting model **Tmax-9B**.

| RL dataset | TB Lite | TB 2.1 |
| --- | --- | --- |
| None (Qwen3.5-9B) | 41.9 | 16.1 |
| TermiGen | 49.4 | 25.1 |
| Endless Terminals | 52.6 | 25.5 |
| TerminalTraj | 45.8 | 18.0 |
| CLI-Gym | 50.7 | 25.1 |
| SWE-Smith | 47.2 | 21.0 |
| **Tmax-15k (ours)** | **57.2** | **28.8** |

*RL on Qwen3.5-9B across datasets; mean over 3 runs. Our data lifts Terminal Bench 2.1 by nearly 13 points over the base model.*

Why does our data keep paying off? Because it stays hard. Plotting the average number of steps the model takes during training, **Tmax-15k consistently drives more steps per episode** than other datasets — the tasks keep demanding real, multi-step work rather than being solved in a couple of commands.

![Average steps per episode over training (15-step smoothing). Training on Tmax-15k sustains higher step counts than other datasets, indicating the tasks stay difficult throughout.](/assets/img/tmax/step-count.png)

We also see the model *learn to think more* over the course of training: the number of tokens it spends per assistant turn — both reasoning and tool-calling — climbs steadily. This is the agentic analogue of inference-time reasoning scaling, and it tracks the model's improving performance.

![Average assistant-turn and tool-call length (tokens) over training. Per-turn output grows, suggesting the model learns to make better use of inference-time compute.](/assets/img/tmax/turn-tokens.png)

### 3.3 Tmax-9B against the field

Tmax-9B is not just a good baseline — it is a genuinely strong small model. At **27.2%** on Terminal Bench 2.0, it is the best open-weights model under 10B we compare against, beating 32B terminal agents from several prior works and edging toward closed offerings like Claude Haiku 4.5 (29.8%). The same recipe lifts the smaller Qwen3.5 models too: Tmax-2B and Tmax-4B reach 2.9% and 18.9% (from 2.3% and 16.6%). A 27B variant is in progress.

### 3.4 Generalization across tasks and harnesses

If RL were just teaching the model to fit our particular harness and benchmark, the gains would not travel. They do.

**Across tasks.** Evaluating Tmax-9B beyond Terminal Bench, performance improves across the board — including on a non-agentic math benchmark:

| Benchmark | Qwen3.5-9B | Tmax-9B |
| --- | --- | --- |
| SWE-Bench Verified | 44.0 | **53.5** |
| AIME'24/25 (terminal-agent) | 73.3 | **91.1** |

*Generalization to other tasks; mean over 3 runs. RL on terminal data improves an agentic SWE benchmark by ~9 points and math by ~18.*

**Across harnesses.** Swapping out the harness — different prompts and tools than the one used during RL — Tmax-9B improves by **roughly 9 to 15 points in every harness we tried**, even ones it never saw in training.

| Harness | Qwen3.5-9B | Tmax-9B |
| --- | --- | --- |
| Ours (mini-swe-agent + persistent shell) | 41.9 | **57.2** |
| OpenHands | 36.0 | **46.9** |
| mini-swe-agent | 44.1 | **55.3** |
| Terminus-2 | 36.4 | **45.3** |

*Terminal Bench Lite across evaluation harnesses; mean over 3 runs.*

Taken together, these results strongly suggest that TMax RL training teaches the model **new, transferable terminal skills** — not harness-fitting, and not overfitting to Terminal Bench-style tasks.

**It also helps weaker, older models.** As a sanity check that the recipe is not Qwen3.5-specific, we apply it to the older [Qwen3-8B](https://huggingface.co/Qwen/Qwen3-8B) (with a short SFT warm-start and shorter context). It improves substantially on Terminal Bench Lite (7.3 → 17.7), though gains on the harder Terminal Bench 2.1 are smaller — at this scale the benchmark's difficulty makes improvements hard to see.

## 4. What we learned

Two findings shaped the recipe, and we think both are useful for anyone training in this setting.

### 4.1 Strong models don't always want your SFT data

Conventional wisdom says to warm-start RL with SFT. For our primary model, that backfired. Qwen3.5-9B has already been through heavy post-training, and fine-tuning it on existing terminal SFT mixtures — even our own, generated from a strong Qwen3.6-27B teacher — **degrades** its Terminal Bench performance. The older Qwen3-8B, by contrast, clearly *benefits* from the same SFT.

| Model | TB Lite | TB 2.1 |
| --- | --- | --- |
| Qwen3.5-9B | **41.9** | 16.1 |
| &nbsp;&nbsp;+ TMax SFT | 35.5 | 15.0 |
| &nbsp;&nbsp;+ large SFT | 31.3 | 16.9 |
| Qwen3-8B | 7.3 | 1.1 |
| &nbsp;&nbsp;+ TMax SFT | 11.5 | 6.0 |
| &nbsp;&nbsp;+ large SFT | **16.4** | **7.9** |

*SFT before RL helps the older model but hurts the stronger one.*

We suspect the larger mixtures lean on relatively weak teacher models from prior work, and that a heavily post-trained model has less to gain and more to lose from imitation. For Qwen3.5, the right move was to skip SFT and go straight to RL. Finding SFT mixtures that actually help strong models is open work.

### 4.2 Terminal-agent RL is hard to stabilize

This is the honest part. Across the project, training was frequently unstable, with runs often collapsing past ~300 steps. We trace it to three compounding factors:

- **Numeric mismatch.** The hybrid nature of Qwen3.5 makes train/inference logprob mismatches more common. The **FP32 LM head** cuts the worst spikes dramatically, and **DPPO** limits the extent of collapse relative to plain GRPO. A larger **group size** (32) also helped. A small KL penalty reduced collapse severity but cost reward overall, so we left it out.

![Maximum inference-vs-trainer logprob difference over the first 100 steps for Qwen3.5-9B. The FP32 LM head removes the large spikes (Qwen3-8B does not show them even without it).](/assets/img/tmax/fp32-lm-head.png)

![Average training reward with GRPO vs. DPPO. DPPO limits training collapse, though it does not fully prevent it.](/assets/img/tmax/dppo-vs-grpo.png)

![Average training reward with DPPO at group sizes 8 and 32. A larger group size improves stability.](/assets/img/tmax/group-size.png)

- **Long horizons.** The highly multi-turn nature of terminal tasks — often 20+ steps — amplified the instabilities. We saw them grow after ~10 assistant turns, and not at all below 5.
- **Infrastructure load.** Running sandboxes on the same nodes as inference engines created resource contention; under load, the model has to cope with conditions (e.g. slow commands) that don't arise at evaluation time, and sandbox management occasionally became the bottleneck.

We saw the same instabilities on Qwen3-8B, so this is not a quirk of one model family. We believe more stable, longer training would yield substantially better models — making stability one of the most promising directions to push next.

## 5. Conclusion

TMax is a simple recipe for training strong terminal agents at small scale. Its two pieces — **Tmax-15k**, a difficulty- and diversity-controlled dataset of 14,600 RL environments, and a plain DPPO training recipe — are enough to train **Tmax-9B**, state-of-the-art among open-weights models under 10B at the time of writing. The gains transfer to SWE-Bench and AIME and across harnesses, evidence that the model has genuinely improved its ability to use a terminal rather than memorized one setup. We release the data, models, and code as a starting point for others.

**Where we'd go next.** The clearest opportunities are in **stability** (longer, more reliable runs almost certainly buy more performance), in **data** (can a synthetic pipeline produce tasks that push *past* its generator, not just match it?), and in **scaling** — both larger models and longer-context harnesses.

**Limitations.** Our pipeline is fully synthetic and depends on a strong generator model; it is unclear whether it can build data that surpasses that generator. Our training is unstable, so some of our gains may stem from stability-promoting choices as much as from data difficulty and variety. Running many isolated containers remains expensive in open frameworks, which constrains training speed and may still put terminal-agent RL out of reach for some academic groups. And our absolute numbers are likely below the achievable ceiling because of our shorter context and simple harness — a deliberate trade we think makes the recipe friendlier to small teams.

We hope TMax serves as a strong baseline and a useful testbed for the community to improve the stability, performance, and efficiency of terminal agents.

## Acknowledgements

We thank members of UW NLP and the Open Ecosystem team at Ai2 for feedback and discussion throughout this project, Michael Noukhovitch for useful discussions on RL stability, and the Ai2 Beaker team for help with infrastructure.

## Citation

::: {.citation}
Please cite this work as:

```
Ivison, Hamish and Yin, Junjie Oscar and Shao, Rulin and Xiao, Teng and
Lambert, Nathan and Hajishirzi, Hannaneh, "TMax: A Simple Recipe for Terminal
Agents", WAI, Jun 2026.
```

Or use the BibTeX citation:

```
@article{ivison2026tmax,
  author  = {Ivison, Hamish and Yin, Junjie Oscar and Shao, Rulin and Xiao, Teng and Lambert, Nathan and Hajishirzi, Hannaneh},
  title   = {TMax: A Simple Recipe for Terminal Agents},
  journal = {WAI},
  year    = {2026},
  note    = {https://wai-org.com/blog/tmax/},
}
```
:::
