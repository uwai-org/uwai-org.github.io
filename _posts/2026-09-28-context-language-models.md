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

**Background: existing cache reuse often assumes append-only context.** Serving engines such as [SGLang](https://arxiv.org/abs/2312.07104) cache KV states in a [radix tree](https://en.wikipedia.org/wiki/Radix_tree) and reuse the longest matching prefix of a new request. Tokens after the first mismatch must be re-prefilled. This works naturally for append-only histories, but after an in-the-middle edit, even unchanged suffix tokens are recomputed.

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

By default, we use this metric to measure CLM efficiency under standard serving. [Thus, when we say CLMs are cheaper than the baselines, we've accounted for the lower cache hit rate caused by context edits.]{.clm-blue} The visualization below shows how an edit affects the Prefix-Reuse FLOPs of a single turn.

::: {.flops-sim mode="standard"}
**Prefix Reuse FLOPs of one Qwen3.6-27B turn under standard serving.** Move the edit or change its size; the bar splits the Prefix Reuse FLOPs of the turn into the prefill of B′, the re-prefill of the unchanged C, and decoding.
:::

The hit rate does drop with in-the-middle edits.[^think] In our experiments with a Qwen3.6-27B CLM on BrowseComp-Plus, standard SGLang serves 72.9% of all prompt tokens from its prefix cache, but only 24.2% on the turns right after a context edit. The rest of an edited turn is prefilled again, including the large part of the context that the edit left unchanged.

[^think]: This also happens beyond CLM serving: some chat endpoints remove the thinking tokens of earlier turns, so the tokens after them are re-prefilled in the next turn.

## Suffix Cache Reuse

![Standard serving versus Suffix Cache Reuse after an edit replaces B with B'. Standard serving reuses the cache for A but must process B' and all of C again. Suffix Cache Reuse also reuses the cached states of C.]({{ '/assets/img/clm/suffix-cache-reuse.png' | relative_url }})

Say the context is A B C, and an edit replaces B with B'. Standard serving reuses the cache for A and then stops, because a prefix cache only matches up to the first changed token: B' and all of C are processed again, even though C did not change. **Suffix Cache Reuse (SCR)** keeps the cached states for C instead of throwing them away. When the next prompt arrives, SCR compares it with the previous prompt of the same session to find the spans that survived the edit, shifts their rotary position encodings to their new positions, and splices them in after B'. Only B' and newly appended tokens are processed.

This is an approximation: C's cached states were computed under the old context, before the edit. To bound how much approximation one edit can introduce, SCR relocates at most six surviving spans per edit, the longest first, and processes the rest normally.[^k]

[^k]: In a sensitivity study on 64 BrowseComp-Plus questions, accuracy stays flat for one to 64 relocated spans per edit, while the cache savings mostly saturate by six. SCR is implemented as a patch to SGLang; relocated entries live in session-private cache slots, so the shared prefix cache never holds a moved entry.

![Suffix Cache Reuse for full-attention layers (left) and linear-attention layers (right).]({{ '/assets/img/clm/full-vs-linear-attention-reuse.png' | relative_url }})

Qwen3.6-27B is a hybrid model: 48 of its 64 layers use linear attention, which keeps a fixed-size recurrent state rather than a per-token cache, so there are no per-token entries to move. For those layers, SCR continues from a snapshot of the recurrent state taken before the edit. The edit itself is seen by the 16 full-attention layers, and through their outputs it still reaches the later linear-attention layers.

::: {.flops-sim mode="scr"}
**Adding Suffix Cache Reuse on top of prefix caching.** The same turn as in the first figure; the bars compare prefix caching with and without SCR, and the dashed green outline is the re-prefill of C that SCR removes. SCR is counted with B′ prefilled through every layer and C relocated as one span.
:::

## Results on BrowseComp-Plus

![Suffix Cache Reuse on BrowseComp-Plus with a Qwen3.6-27B CLM. All 830 questions were served both ways. Left: task accuracy. Middle: compute per question, split into prefill and decode. Right: where the prompt tokens came from, over all turns and over the turns right after a context edit.]({{ '/assets/img/clm/scr-bcp830-results.png' | relative_url }})

Accuracy is identical, 60.2% both ways, while compute drops from 10.98 to 7.14 PFLOPs per question. On the turns right after an edit, SCR serves an extra 28.2% of the prompt from relocated cache that standard serving would have recomputed. CLMs were already cheaper than the baselines under standard serving, through better context management alone; SCR brings their serving cost down to 65% of that.

## Bonus: reasoning models re-prefill even without edits

There are other reasons a cache can miss. The chat templates of many reasoning models, including Qwen3.6, drop the reasoning blocks of earlier assistant turns once the next user message arrives. To the server, this looks like an edit: everything after the first dropped block is processed again, even when the agent never touched its context. As a result, each turn's final answer is processed twice, once when it is generated and again when the next prompt arrives without the reasoning in front of it.

SCR treats the dropped reasoning like any other edit and reuses the cache of the text after it. Breaking down where SCR's savings come from gave us a surprise: more of the reused cache comes from dropped reasoning than from the CLM's own edits.

![Where Suffix Cache Reuse finds reusable cache on BrowseComp-Plus, over all turns and over the turns right after an edit. Qwen3.6-27B, 830 questions.]({{ '/assets/img/clm/scr-strip-savings.png' | relative_url }})

Over all turns, SCR reuses 7.8% of the prompt tokens beyond the prefix-cache hits; 5.3 points of that come after dropped reasoning and 2.5 after context edits. On the edited turns, the split is 19.3 against 8.9 points. So a large part of SCR's benefit also applies to standard reasoning-model serving, with no context editing at all.

## What is still missed, and why

We also looked at the prompt tokens that are still processed again under SCR.

![Remaining re-prefill under standard serving and under Suffix Cache Reuse on BrowseComp-Plus, split by why each token was processed. Same runs as above.]({{ '/assets/img/clm/scr-prefill-split.png' | relative_url }})

SCR removes most of the re-processing of unchanged text *after* an edit (31.1% of the prompt on edited turns under standard serving, 5.0% under SCR). Much of what remains is unchanged text *before* the edit, which a prefix cache should match in principle. This turns out to be a limitation of how standard SGLang caches hybrid models, not of SCR. Full-attention layers keep a cache entry for every token, so a match can stop exactly where the prompt changes. Linear-attention layers only have their recurrent state saved at a few points (at cached request boundaries in SGLang), so when a later prompt diverges in the middle of a cached span, the nearest usable state can be far before the divergence, and the match falls back to a much shorter prefix.

Over all turns, standard SGLang misses 8.1% of the prompt tokens this way, and 29.5% on edited turns. SCR still leaves a similar margin (6.4% and 22.7%). Saving recurrent states more often, for example at every message boundary, would trade memory for hit rate and improve both standard prefix caching and SCR; there may well be better techniques for it. We think there are many good research directions in serving models that edit their own context.

For the full details, see Appendix B of the paper.

## Related work

With standard prefix caching, changing an early part of a prompt forces the serving system to recompute the KV states of everything that follows, even when the later text is unchanged. Prior work relaxes this requirement in different settings. [Prompt Cache](https://arxiv.org/abs/2311.04934) precomputes attention states for predefined prompt modules, allowing a module to be reused in prompts that do not share the same preceding text. In retrieval-augmented generation, the same document may appear after different documents or instructions. [CacheBlend](https://arxiv.org/abs/2405.16444) and [EPIC](https://arxiv.org/abs/2410.15332) reuse cached document chunks in these new contexts, recomputing selected tokens to account for the changed surroundings.

[PIE](https://arxiv.org/abs/2407.03157) studies cache reuse when a user modifies previously processed code and requests a new completion. It retains cached states for unchanged text after an edit and corrects their rotary positions, avoiding suffix recomputation. [Memento](https://arxiv.org/abs/2604.09852) evicts each completed reasoning block from the KV cache but keeps the cached states of its summary, which were computed while the block was still in context, and finds that these states retain useful information from the evicted block. Suffix Cache Reuse applies the same reuse principle to an agent's live context: when the agent replaces a span, the unchanged suffix retains its cached states rather than being prefilled again. We integrate this mechanism into SGLang for agent-driven context editing and further extend it to hybrid architectures that combine full-attention layers with linear-attention layers.

Concurrently, [KV-streams](https://arxiv.org/abs/2609.35750), released in the last few days, keeps the KV cache across agentic compaction during reinforcement learning instead of flushing it, and reports a 2× speed-up on SWE tasks with any compaction method. That cache reuse across context edits is being picked up at the same time by several groups suggests it is becoming a hot topic, and we look forward to more work in this direction.

## References

::: {.references}
1. Rulin Shao, Shannon Zejiang Shen, Junjie Oscar Yin, Yuetai Li, Minheng Wang, Hamish Ivison, Radha Poovendran, Nathan Lambert, Teng Xiao, Mike Lewis, Wen-tau Yih, Luke Zettlemoyer, and Pang Wei Koh. [Context Language Models](https://arxiv.org/abs/2609.37725). arXiv:2609.37725, 2026.
2. Lianmin Zheng et al. [SGLang: Efficient Execution of Structured Language Model Programs](https://arxiv.org/abs/2312.07104). arXiv:2312.07104, 2023.
3. [Radix tree](https://en.wikipedia.org/wiki/Radix_tree). Wikipedia.
4. In Gim et al. [Prompt Cache: Modular Attention Reuse for Low-Latency Inference](https://arxiv.org/abs/2311.04934). arXiv:2311.04934, 2023.
5. Jiayi Yao et al. [CacheBlend: Fast Large Language Model Serving for RAG with Cached Knowledge Fusion](https://arxiv.org/abs/2405.16444). arXiv:2405.16444, 2024.
6. Junhao Hu et al. [EPIC: Efficient Position-Independent Caching for Serving Large Language Models](https://arxiv.org/abs/2410.15332). arXiv:2410.15332, 2024.
7. Zhenyu He et al. [Let the Code LLM Edit Itself When You Edit the Code](https://arxiv.org/abs/2407.03157) (PIE). arXiv:2407.03157, 2024.
8. Vasilis Kontonis et al. [MEMENTO: Teaching LLMs to Manage Their Own Context](https://arxiv.org/abs/2604.09852). arXiv:2604.09852, 2026.
9. Emiliano Penaloza et al. [KV-streams for Efficient Compaction in Agentic Reinforcement Learning](https://arxiv.org/abs/2609.35750). arXiv:2609.35750, 2026.
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
