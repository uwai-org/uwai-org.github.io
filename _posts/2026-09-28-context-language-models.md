---
title: "Suffix Cache Reuse Explained"
author: WAI
date: 2026-09-28
permalink: /blog/clm/
custom_header: true
math: true
plotly: true
scripts:
  - /assets/js/clm-charts.js
  - /assets/js/flops-sim.js
  - /assets/js/scr-teaser.js
description: >-
  Context Language Models edit their own context, which breaks prefix caching
  after every edit. Suffix Cache Reuse reuses the cache of the text that
  survives an edit, cutting serving compute by 35% at the same accuracy.
---

::::: {.post-hero}
<h1 class="title">Suffix Cache Reuse Explained</h1>

:::: {.post-subtitle}
Deep Dive in Efficient Serving for [Context Language Models]{.clm-blue}
::::

:::: {.byline}
Rulin Shao & Oscar Yin in collaboration with others in CLM team
::::

:::: {.post-date}
September 28, 2026
::::
:::::

:::: {.scr-tagline}
“How to stop KV cache from crying\
when they’re no longer in an append-only relationship with the context” 😉
::::

::: {.scr-teaser}
**Suffix Cache Reuse.** After an edit replaces *B* with a shorter *B′*, only *B′* is prefilled. The cache of *A* is reused as a prefix, and the cache of the unchanged *C* moves to its new positions.
:::

::: {.draft-note}
Before publishing: confirm author formatting (the TMax post bolds co-first authors; the paper marks none), the publication date, and the missing links in the resources line (arXiv, tweet). Draft notes like this one only show up in local builds; production builds hide them.
:::

**Resources:** [📄 Paper](https://arxiv.org/abs/2609.37725) · [👨‍💻 GitHub](https://github.com/facebookresearch/context-language-models) · [🐦 Tweet](#)

We recently introduced Context Language Models (CLMs),[^clm][![The Context Language Models paper at a glance]({{ '/assets/img/clm/clm-paper-cover.jpg' | relative_url }}){.clm-cover}]{.marginnote} which treat context as a file and can perform arbitrary manipulations on it. We showed that CLMs outperform state-of-the-art, human-designed context-management harnesses at lower cost. In this blog, we dive deeper into the efficiency side of CLMs: what metric do we use to capture the realistic serving cost while being cache aware, and how could we further improve the cache hit rate by designing serving systems for agents?

## Accounting for Prefix-Cache Violations in Cost: Prefix-Reuse FLOPs

**Background: existing cache reuse often assumes append-only context.** Serving engines such as [SGLang](https://arxiv.org/abs/2312.07104) and [vLLM](https://arxiv.org/abs/2309.06180) cache KV states, for example in a [radix tree](https://en.wikipedia.org/wiki/Radix_tree), and reuse the longest matching prefix of a new request. Tokens after the first mismatch must be re-prefilled. This works naturally for append-only histories, but after an in-the-middle edit, even unchanged suffix tokens are recomputed.

Below is a simplified example: the context [[*A*]{.ctx-g} [*B*]{.ctx-g} [*C*]{.ctx-g}]{.nowrap} is edited into [[*A*]{.ctx-o} [*B′*]{.ctx-e} [*C*]{.ctx-e}]{.nowrap}, with the colors matching the token strip. The prefix [*A*]{.ctx-o} still matches, so its cache is reused; the match breaks at [*B′*]{.ctx-e}, so [*B′*]{.ctx-e} and the unchanged [*C*]{.ctx-e} after it are prefilled together.

[^clm]: Rulin Shao, Shannon Zejiang Shen, Junjie Oscar Yin, Yuetai Li, Minheng Wang, Hamish Ivison, Radha Poovendran, Nathan Lambert, Teng Xiao, Mike Lewis, Wen-tau Yih, Luke Zettlemoyer, and Pang Wei Koh. "[Context Language Models](https://arxiv.org/abs/2609.37725)." arXiv preprint arXiv:2609.37725, 2026.

:::: {.tok-viz}
::: {.tok-row label="previous prompt, already in the cache"}
[[this]{.tok} [is]{.tok} [sentence]{.tok} [A]{.tok} [*A*]{.tok-seg-label}]{.tok-seg .prev}
[[this]{.tok} [is]{.tok} [sentence]{.tok} [B]{.tok} [*B*]{.tok-seg-label}]{.tok-seg .prev}
[[this]{.tok} [is]{.tok} [sentence]{.tok} [C]{.tok} [*C*]{.tok-seg-label}]{.tok-seg .prev}
:::

::: {.tok-row label="after rewriting B to B′"}
[[this]{.tok} [is]{.tok} [sentence]{.tok} [A]{.tok} [*A* · hit prefix cache]{.tok-seg-label}]{.tok-seg}
[[compacted]{.tok} [B]{.tok} [*B′* · prefilled]{.tok-seg-label}]{.tok-seg .prefill .first-change}
[[this]{.tok} [is]{.tok} [sentence]{.tok} [C]{.tok} [*C* · re-prefilled]{.tok-seg-label}]{.tok-seg .prefill}
:::
::::

When measuring CLM efficiency, we account for **prefix-cache reuse**, i.e., which tokens can reuse cached KV states. We capture this with a theoretical inference-cost metric we call **Prefix-Reuse FLOPs**:

$$
\mathrm{FLOPs}_{\text{Prefix Reuse}}
= \underbrace{\mathrm{FLOPs}_{\text{prefill}}\big(\text{unmatched suffix}\big)}_{\text{from the first prefix mismatch onward}}
+ \underbrace{\mathrm{FLOPs}_{\text{decode}}\big(\text{generated tokens}\big)}_{\text{new output tokens}}
$$

By default, we use this metric to measure CLM efficiency under standard serving. [Thus, when we say CLMs are cheaper than the baselines, we've accounted for the lower cache hit rate caused by context edits.]{.clm-blue}[^pareto] The visualization below shows how an edit affects the Prefix-Reuse FLOPs of a single turn.

[^pareto]: For example, in these performance-efficiency Pareto plots, we used prefix-reuse FLOPs with standard serving. ![Performance-efficiency Pareto plots from the paper: accuracy against prefix-reuse PFLOPs per question on BrowseComp-Plus, TerminalBench 2.1 and TBLite.]({{ '/assets/img/clm/pareto_q36_main.png' | relative_url }}){.sn-fig}

::: {.flops-sim mode="standard"}
**Prefix Reuse FLOPs of one Qwen3.6-27B turn under standard serving.** Move the edit or change its size; the bar splits the Prefix Reuse FLOPs of the turn into the prefill of [*B′*]{.ctx-e}, the re-prefill of the unchanged [*C*]{.ctx-e}, and decoding.
:::

The hit rate does drop with in-the-middle edits and incurs re-prefilling of the unchanged C.[^think] In our experiments with a Qwen3.6-27B CLM on BrowseComp-Plus, standard SGLang serves 72.9% of all prompt tokens from its prefix cache, but only 24.2% on the turns right after a context edit. The rest of an edited turn is prefilled again, including the large part of the context that the edit left unchanged.

[^think]: This also happens beyond CLM editing: some chat endpoints remove the thinking tokens of earlier turns, so the tokens after them are re-prefilled in the next turn.

## Suffix Cache Reuse

Prefix cache reuse has been the tradition in serving engines because context has always been append-only. But we ask: **can we adapt serving engines for AI's convenience**, especially given the trend toward recursive self-improvement (RSI)? To that end, we propose a simple yet effective method, Suffix Cache Reuse, to make CLM serving even more efficient on the system side.

::::: {.tok-viz .tok-viz-fig}
::: {.tok-row label="before the edit"}
[[this]{.tok} [is]{.tok} [sentence]{.tok} [A]{.tok} [*A*]{.tok-seg-label}]{.tok-seg .prev}
[[this]{.tok} [is]{.tok} [sentence]{.tok} [B]{.tok} [*B*]{.tok-seg-label}]{.tok-seg .prev}
[[this]{.tok} [is]{.tok} [sentence]{.tok} [C]{.tok} [*C*]{.tok-seg-label}]{.tok-seg .prev}
:::

::: {.tok-row label="standard serving"}
[[this]{.tok} [is]{.tok} [sentence]{.tok} [A]{.tok} [*A* · hit prefix cache]{.tok-seg-label}]{.tok-seg}
[[compacted]{.tok} [B]{.tok} [*B′* · prefilled]{.tok-seg-label}]{.tok-seg .prefill .first-change}
[[this]{.tok} [is]{.tok} [sentence]{.tok} [C]{.tok} [*C* · re-prefilled]{.tok-seg-label}]{.tok-seg .prefill}
:::

::: {.tok-row label="Suffix Cache Reuse"}
[[this]{.tok} [is]{.tok} [sentence]{.tok} [A]{.tok} [*A* · hit prefix cache]{.tok-seg-label}]{.tok-seg}
[[compacted]{.tok} [B]{.tok} [*B′* · prefilled]{.tok-seg-label}]{.tok-seg .prefill .first-change}
[[this]{.tok} [is]{.tok} [sentence]{.tok} [C]{.tok} [*C* · suffix cache reused]{.tok-seg-label}]{.tok-seg .reused}
:::

::: {.tok-caption}
Standard serving versus Suffix Cache Reuse after an edit replaces B with B′. Standard serving hits the prefix cache for A but must prefill B′ and re-prefill all of C; Suffix Cache Reuse also reuses the cached states of C. The × marks the first prefix-mismatch position.
:::
:::::

Say the context is [[*A*]{.ctx-g} [*B*]{.ctx-g} [*C*]{.ctx-g}]{.nowrap}, and an edit replaces [*B*]{.ctx-g} with [*B′*]{.ctx-e}. Standard serving reuses the cache for [*A*]{.ctx-o} and then stops, because a prefix cache only matches up to the first changed token: [*B′*]{.ctx-e} and all of [*C*]{.ctx-e} are prefilled again, even though [*C*]{.ctx-e} did not change. **Suffix Cache Reuse (SCR)** keeps the cached states for [*C*]{.ctx-r} instead of throwing them away. When the next prompt arrives, SCR compares it with the previous prompt of the same session to find the spans that survived the edit, shifts their rotary position encodings to their new positions, and splices them in after [*B′*]{.ctx-e}. Only [*B′*]{.ctx-e} and newly appended tokens are prefilled. Below is an interactive visualization of SCR serving compared with prefix-reuse-only serving.

::: {.flops-sim mode="scr"}
**Adding Suffix Cache Reuse on top of prefix caching.** The same turn as in the first figure; the bars compare prefix caching with and without SCR, and the dashed green outline is the re-prefill of [*C*]{.ctx-e} that SCR removes. SCR is counted with [*B′*]{.ctx-e} prefilled through every layer and [*C*]{.ctx-r} relocated as one span.
:::

**Technical details.** For full-attention layers, SCR reuses the cached keys and values of [*C*]{.ctx-r} as they are, except for position: after the edit, [*C*]{.ctx-r} sits earlier by the length difference between [*B*]{.ctx-g} and [*B′*]{.ctx-e}, so SCR re-rotates the rotary position encodings of its cached keys by that offset. Because rotary encodings depend only on position, this rotation is exact and far cheaper than recomputing the entries. SCR is an approximation: [*C*]{.ctx-r}'s cached states were computed under the old context, before the edit. To bound how much approximation one edit can introduce, SCR relocates at most six surviving spans per edit, the longest first, and re-prefills the rest.[^k]

[^k]: More details, such as how the cap on relocated spans is set and what effect it has, are in Appendix B of the paper; the main text uses k = 6.

Qwen3.6-27B is a hybrid model: 48 of its 64 layers use linear attention, which keeps a fixed-size recurrent state rather than a per-token cache, so there are no per-token entries to move. For those layers, SCR continues from a snapshot of the recurrent state taken before the edit. The edit itself is seen by the 16 full-attention layers, and through their outputs it still reaches the later linear-attention layers.

![Suffix Cache Reuse for full-attention layers (left) and linear-attention layers (right).]({{ '/assets/img/clm/full-vs-linear-attention-reuse.png' | relative_url }})

### Results on BrowseComp-Plus

We perform an end-to-end evaluation of SCR on BrowseComp-Plus by simply switching the Qwen3.6-27B endpoint from standard SGLang to our patched SGLang with SCR.[^impl]

[^impl]: Our implementation of Suffix Cache Reuse is available at [facebookresearch/context-language-models/suffix_cache_reuse](https://github.com/facebookresearch/context-language-models/tree/main/suffix_cache_reuse).

![Suffix Cache Reuse on BrowseComp-Plus with a Qwen3.6-27B CLM. All 830 questions were served both ways. Left: task accuracy. Middle: compute per question, split into prefill and decode. Right: where the prompt tokens came from, over all turns and over the turns right after a context edit.]({{ '/assets/img/clm/scr-bcp830-results.png' | relative_url }})

Accuracy is identical, 60.2% both ways, while compute drops from 10.98 to 7.14 PFLOPs per question. On the turns right after an edit, SCR serves an extra 28.2% of the prompt from relocated cache that standard serving would have recomputed. CLMs were already cheaper than the baselines under standard serving, through better context management alone; SCR brings their serving cost down to 65% of that.

**Bonus: reasoning-token stripping is a context edit too.** Other cache misses arise from reasoning-token stripping in some chat-template serving. For models such as Qwen3.6, earlier reasoning blocks are removed from subsequent prompts, forcing the unchanged suffix to be prefilled again. SCR reuses this suffix cache as well. In fact, most of SCR’s extra reuse comes from stripped reasoning rather than CLM edits. The figure below shows a decomposition of the tokens hit by Suffix Cache Reuse.

![Where Suffix Cache Reuse finds reusable cache on BrowseComp-Plus, over all turns and over the turns right after an edit. Qwen3.6-27B, 830 questions.]({{ '/assets/img/clm/scr-strip-savings.png' | relative_url }})

**What is still missed, and why.** We also looked at the unchanged tokens that are still prefilled with SCR. SCR removes most re-prefilling of unchanged suffixes after an edit. Much of the remaining overhead comes from unchanged prefixes that standard SGLang fails to reuse efficiently for hybrid models, because linear-attention states are cached only at request boundaries. This leaves substantial room for improvement: finer-grained recurrent-state checkpoints could increase cache hit rates for both standard prefix caching and SCR. More broadly, serving models with editable context opens many new systems research directions.

![Remaining re-prefill under standard serving and under Suffix Cache Reuse on BrowseComp-Plus, split by why each token was prefilled. Same runs as above.]({{ '/assets/img/clm/scr-prefill-split.png' | relative_url }})


## Related work

With standard prefix caching, changing an early part of a prompt forces the serving system to recompute the KV states of everything that follows, even when the later text is unchanged. Prior work relaxes this requirement in different settings. [Prompt Cache](https://arxiv.org/abs/2311.04934) precomputes attention states for predefined prompt modules, allowing a module to be reused in prompts that do not share the same preceding text. In retrieval-augmented generation, the same document may appear after different documents or instructions. [CacheBlend](https://arxiv.org/abs/2405.16444) and [EPIC](https://arxiv.org/abs/2410.15332) reuse cached document chunks in these new contexts, recomputing selected tokens to account for the changed surroundings.

[PIE](https://arxiv.org/abs/2407.03157) studies cache reuse when a user modifies previously processed code and requests a new completion. It retains cached states for unchanged text after an edit and corrects their rotary positions, avoiding suffix recomputation. [Memento](https://arxiv.org/abs/2604.09852) evicts each completed reasoning block from the KV cache but keeps the cached states of its summary, which were computed while the block was still in context, and finds that these states retain useful information from the evicted block. Concurrently, [KV-streams](https://arxiv.org/abs/2609.35750), released in the last few days, keeps the KV cache across agentic compaction during reinforcement learning instead of flushing it, and reports a 2× speed-up on SWE tasks with any compaction method. Suffix Cache Reuse applies the same reuse principle to an agent's live context: when the agent replaces a span, the unchanged suffix retains its cached states rather than being prefilled again. We integrate this mechanism into SGLang for agent-driven context editing and further extend it to hybrid architectures that combine full-attention layers with linear-attention layers.

We believe cache space can enable more context management opportunities than pure token space. We are excited to see more work along this line.

## References

::: {.references}
1. Rulin Shao, Shannon Zejiang Shen, Junjie Oscar Yin, Yuetai Li, Minheng Wang, Hamish Ivison, Radha Poovendran, Nathan Lambert, Teng Xiao, Mike Lewis, Wen-tau Yih, Luke Zettlemoyer, and Pang Wei Koh. [Context Language Models](https://arxiv.org/abs/2609.37725). arXiv:2609.37725, 2026.
2. Lianmin Zheng et al. [SGLang: Efficient Execution of Structured Language Model Programs](https://arxiv.org/abs/2312.07104). arXiv:2312.07104, 2023.
3. Woosuk Kwon et al. [Efficient Memory Management for Large Language Model Serving with PagedAttention](https://arxiv.org/abs/2309.06180) (vLLM). SOSP 2023.
4. [Radix tree](https://en.wikipedia.org/wiki/Radix_tree). Wikipedia.
5. In Gim et al. [Prompt Cache: Modular Attention Reuse for Low-Latency Inference](https://arxiv.org/abs/2311.04934). arXiv:2311.04934, 2023.
6. Jiayi Yao et al. [CacheBlend: Fast Large Language Model Serving for RAG with Cached Knowledge Fusion](https://arxiv.org/abs/2405.16444). arXiv:2405.16444, 2024.
7. Junhao Hu et al. [EPIC: Efficient Position-Independent Caching for Serving Large Language Models](https://arxiv.org/abs/2410.15332). arXiv:2410.15332, 2024.
8. Zhenyu He et al. [Let the Code LLM Edit Itself When You Edit the Code](https://arxiv.org/abs/2407.03157) (PIE). arXiv:2407.03157, 2024.
9. Vasilis Kontonis et al. [MEMENTO: Teaching LLMs to Manage Their Own Context](https://arxiv.org/abs/2604.09852). arXiv:2604.09852, 2026.
10. Emiliano Penaloza et al. [KV-streams for Efficient Compaction in Agentic Reinforcement Learning](https://arxiv.org/abs/2609.35750). arXiv:2609.35750, 2026.
:::

## Citation

::: {.citation}
Please cite this work as:

```
@article{shao2026context,
  title   = {Context Language Models},
  author  = {Shao, Rulin and Shen, Shannon Zejiang and Yin, Junjie Oscar and
             Li, Yuetai and Wang, Minheng and Ivison, Hamish and
             Poovendran, Radha and Lambert, Nathan and Xiao, Teng and
             Lewis, Mike and Yih, Wen-tau and Zettlemoyer, Luke and
             Koh, Pang Wei},
  journal = {arXiv preprint arXiv:2609.37725},
  year    = {2026}
}
```
:::

::: {.draft-note}
Add the tweet link to the resources line once it is posted.
:::
