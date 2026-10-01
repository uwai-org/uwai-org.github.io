---
title: "Serving Context Language Models with Suffix Cache Reuse"
author: WAI
date: 2026-09-28
permalink: /blog/clm/
custom_header: true
math: true
plotly: true
scripts:
  - /assets/js/clm-charts.js
description: >-
  Context Language Models edit their own context, which breaks prefix caching
  after every edit. Suffix Cache Reuse reuses the cache of the text that
  survives an edit, cutting serving compute by 35% at the same accuracy.
---

::::: {.post-hero}
<h1 class="title">Serving Context Language Models with Suffix Cache Reuse</h1>

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

**Resources:** [📄 Paper](https://arxiv.org/abs/2609.37725) · [👨‍💻 GitHub](https://github.com/facebookresearch/context-language-models) · [🐦 Tweet](#)

The question we hear most often about Context Language Models is about the KV cache: if the model keeps rewriting its context, doesn't it throw away the server's cache on every edit? It does lose part of it. This post covers how much, what we do about it, and what is still left on the table. For CLMs themselves, see [the paper](https://arxiv.org/abs/2609.37725).

## Measuring cost with prefix-reuse FLOPs

Model servers such as vLLM and SGLang cache the internal (key-value) states of each request and reuse them when the next request starts with the same tokens. An agent that only appends gets almost its whole history from this cache. Once the agent edits something in the middle of its context, every token after the edit has to be processed again, even the text that didn't change.

To compare methods that edit their context with methods that only append, we count the computation a server with prefix caching actually performs, which we call **prefix-reuse FLOPs**. At each turn the prompt has some number of tokens and the model generates a response. The server reuses the longest prefix of leading messages that already appeared in the prompt of an earlier turn, and processes only the rest of the prompt. So an edit invalidates the cached computation from the edited message onward, and a response is processed again when it first shows up in a later prompt, in addition to being generated when it was produced. Each processed or generated token pays a fixed cost for the model's linear layers, and the full-attention layers add a cost that grows with the context length; the cost of a trajectory is the sum over its turns.

![FLOPs of one Qwen3.6-27B turn with a 20K-token prompt and a 500-token response, for three lengths of the reusable prefix. Colors split the FLOPs actually computed by operation; gray shows the additional computation that would be needed without prefix caching. The lengths are chosen for illustration and do not come from a particular run.]({{ '/assets/img/clm/flops-cache-bars.png' | relative_url }})

For a sense of scale, take one Qwen3.6-27B turn with a 20K-token prompt and a 500-token response. When the turn only appends to its context, prefix caching avoids 87% of the computation, and the turn costs 1.41 × 10¹⁴ FLOPs. An edit in the middle of the context leaves 10K reusable tokens and raises the cost to 5.74 × 10¹⁴ FLOPs. An edit at the very start, which here is the same as having no cache at all, costs 10.81 × 10¹⁴ FLOPs, 7.7 times the append-only turn.

## The cost metric already pays for cache misses

Every cost number in the paper is in prefix-reuse FLOPs. So when we say CLMs are cheaper than the baselines, that is already after paying for the lower cache hit rate their edits cause.

The hit rate does drop, and we measured it. With a Qwen3.6-27B CLM on BrowseComp-Plus, standard SGLang serves 72.9% of all prompt tokens from its prefix cache, but only 24.2% on the turns right after a context edit. The rest of an edited turn is processed again, including the large part of the context that the edit left unchanged.

## Suffix Cache Reuse

![Standard serving versus Suffix Cache Reuse after an edit replaces B with B'. Standard serving reuses the cache for A but must process B' and all of C again. Suffix Cache Reuse also reuses the cached states of C.]({{ '/assets/img/clm/suffix-cache-reuse.png' | relative_url }})

Say the context is A B C, and an edit replaces B with B'. Standard serving reuses the cache for A and then stops, because a prefix cache only matches up to the first changed token: B' and all of C are processed again, even though C did not change. **Suffix Cache Reuse (SCR)** keeps the cached states for C instead of throwing them away. When the next prompt arrives, SCR compares it with the previous prompt of the same session to find the spans that survived the edit, shifts their rotary position encodings to their new positions, and splices them in after B'. Only B' and newly appended tokens are processed.

This is an approximation: C's cached states were computed under the old context, before the edit. To bound how much approximation one edit can introduce, SCR relocates at most six surviving spans per edit, the longest first, and processes the rest normally.[^k]

[^k]: In a sensitivity study on 64 BrowseComp-Plus questions, accuracy stays flat for one to 64 relocated spans per edit, while the cache savings mostly saturate by six. SCR is implemented as a patch to SGLang; relocated entries live in session-private cache slots, so the shared prefix cache never holds a moved entry.

![Suffix Cache Reuse for full-attention layers (left) and linear-attention layers (right).]({{ '/assets/img/clm/full-vs-linear-attention-reuse.png' | relative_url }})

Qwen3.6-27B is a hybrid model: 48 of its 64 layers use linear attention, which keeps a fixed-size recurrent state rather than a per-token cache, so there are no per-token entries to move. For those layers, SCR continues from a snapshot of the recurrent state taken before the edit. The edit itself is seen by the 16 full-attention layers, and through their outputs it still reaches the later linear-attention layers.

## Results on BrowseComp-Plus

::: {.clm-chart chart="scr"}
**Suffix Cache Reuse on BrowseComp-Plus with a Qwen3.6-27B CLM.** All 830 questions were served both ways. Left: compute per question, split into prefill and decode, with accuracy under each bar. Right: where the prompt tokens came from, over all turns or only the turns right after a context edit.
:::

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

## Acknowledgements

We thank Sewon Min and Steven Zijian Chen for helpful discussions, and Ilia Kulikov and Mickel Liu for their help with infrastructure questions. This work was supported by the Singapore National Research Foundation and the National AI Group in the Singapore Ministry of Digital Development and Information under the AI Visiting Professorship Programme (award number AIVP-2024-001), and by the AI2050 program at Schmidt Sciences.

## Citation

::: {.citation}
Please cite this work as:

```
Shao, Rulin and Shen, Shannon Zejiang and Yin, Junjie Oscar and Li, Yuetai and
Wang, Minheng and Ivison, Hamish and Poovendran, Radha and Lambert, Nathan and
Xiao, Teng and Lewis, Mike and Yih, Wen-tau and Zettlemoyer, Luke and
Koh, Pang Wei, "Context Language Models", arXiv preprint arXiv:2609.37725, 2026.
```

Or use the BibTeX citation:

```
@article{shao2026context,
  title   = {Context Language Models},
  author  = {Shao, Rulin and Shen, Shannon Zejiang and Yin, Junjie Oscar and Li, Yuetai and
             Wang, Minheng and Ivison, Hamish and Poovendran, Radha and Lambert, Nathan and
             Xiao, Teng and Lewis, Mike and Yih, Wen-tau and Zettlemoyer, Luke and Koh, Pang Wei},
  journal = {arXiv preprint arXiv:2609.37725},
  year    = {2026}
}
```
:::

::: {.draft-note}
Add the tweet link to the resources line once it is posted.
:::
