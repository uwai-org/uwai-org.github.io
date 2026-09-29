"""Build the JSON data behind the interactive charts in the CLM blog post.

Each builder mirrors the data rules of the paper figure it replaces (generator named in the
docstring), so the charts show the same numbers as the paper. Inputs come from two sibling
checkouts next to this repo:

  PAPER = ../6a701cdd8249d28fe09f5a7e            (Overleaf paper repo; visualization/data)
  CODE  = ../self-context-management             (code repo; paper/experiments on main,
                                                 plus files read from origin/paper-data-migration)

Override with CLM_PAPER_DIR / CLM_CODE_DIR. Writes assets/data/clm/<name>.json.
Needs numpy + pandas:  python3 _scripts/clm_chart_data.py
"""
import csv, io, json, math, os, re, subprocess
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(HERE)
WS = os.path.dirname(SITE)
PAPER = os.environ.get("CLM_PAPER_DIR", os.path.join(WS, "6a701cdd8249d28fe09f5a7e"))
CODE = os.environ.get("CLM_CODE_DIR", os.path.join(WS, "self-context-management"))
EXP = os.path.join(CODE, "paper", "experiments")
BRANCH = "origin/paper-data-migration"
OUT = os.path.join(SITE, "assets", "data", "clm")


def branch_file(path):
    return subprocess.run(["git", "-C", CODE, "show", f"{BRANCH}:{path}"],
                          check=True, capture_output=True, text=True).stdout


def rows(path):
    with open(path) as f:
        return list(csv.DictReader(l for l in f if not l.startswith("#")))


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def r(x, k=4):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(float(x), k)


def write(name, obj):
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, name + ".json"), "w") as f:
        json.dump(obj, f, separators=(",", ":"))
    print(f"wrote {name}.json")


# --------------------------------------------------------------------------------------------
def contextbench():
    """fig:synthetic_task_results_main -- code repo fig/fig_main_paper.py on rows_gpt54_B_acmfd.csv
    with DROP='needle_retention:1,needle_retention:6,log_triage:-2' NORLMSR=1 NOSCULPTOR=1 GPT54ONLY=1."""
    d = pd.read_csv(io.StringIO(branch_file(
        "paper/sec5_synthetic/livectxbench_lite/fig/rows_gpt54_B_acmfd.csv")))
    drop = {"needle_retention": [1, 6], "log_triage": [-2]}
    arms = [("base", "Base"), ("rlm_hh", "RLM"), ("summary", "Summary"), ("fold", "Context folding"),
            ("selfcompact", "Self-Compact"), ("acm", "ACM"), ("livectx", "CLM")]
    tasks = [("needle_retention", "Needle Retention", [0.5, 2, 8, 24]),
             ("sudoku_sketchpad", "Sudoku Sketchpad", [0.5, 1, 2, 4, 8]),
             ("kv_store", "KV Store", [0.5, 2, 8, 24]),
             ("log_triage", "Log Triage", [0.25, 1, 4, 16])]
    out = {"arms": [label for _, label in arms], "tasks": []}
    for fam, title, ticks in tasks:
        xs = sorted(d[d.fam == fam].x.unique())
        dropped = {xs[i] for i in drop.get(fam, [])}
        series = {}
        for arm, label in arms:
            g = d[(d.fam == fam) & (d.arm == arm) & ~d.x.isin(dropped)]
            g = g.groupby("x")["reward"].agg(
                m="mean", se=lambda s: s.std(ddof=1) / len(s) ** .5 if len(s) > 1 else 0.0,
                n="count").reset_index().sort_values("x")
            # Sudoku rows carry the move count; total input = 3783 + 1725 * moves tokens (instruction,
            # move messages, board once per move), as in the paper figure's pressure axis.
            press = (3783.0 + 1725.0 * g.x) / 32768 if fam == "sudoku_sketchpad" else g.x
            series[label] = {"x": [r(v) for v in press], "y": [r(v) for v in g.m],
                             "se": [r(v) for v in g.se], "n": [int(v) for v in g.n]}
        out["tasks"].append({"key": fam, "title": title, "ticks": ticks, "series": series})
    write("contextbench", out)


# --------------------------------------------------------------------------------------------
def pareto():
    """fig:pareto_27b and appendix fig:pareto_9b_27b -- visualization/pareto.py on data/main_table.csv,
    restricted to the two models in the paper (Qwen3.5-9B, Qwen3.6-27B)."""
    src = rows(os.path.join(PAPER, "visualization", "data", "main_table.csv"))
    keep = {"Base", "Summary", "MEM1", "RLM", "Self-Compact", "ACM", "CLM"}
    models = {"Qwen3.5-9B", "Qwen3.6-27B"}
    out = {}
    for x in src:
        arm = "Summary" if x["arm"] == "Codex Summary" else x["arm"]
        if arm not in keep or x["model"] not in models or x["bench"] not in ("BCP", "TB2.1", "TBLite"):
            continue
        acc, cost = num(x["acc"]), num(x["cost"])
        if acc is None or cost is None:
            continue
        out.setdefault(x["model"], {}).setdefault(x["bench"], []).append(
            {"arm": arm, "acc": acc, "cost": cost, "flag": x["cost_flag"]})
    write("pareto", out)


# --------------------------------------------------------------------------------------------
def open_problems():
    """fig:openended-progress -- visualization/open_problems_progress.py (Sonnet main-text grid)."""
    D = os.path.join(EXP, "open_problems")
    tasks = [("circle_packing", "Circle packing", "Sum of radii", True),
             ("minimizing_max_min_dist_2d", "Min-max/min-dist 2D", "(min/max)² distance ratio", True),
             ("erdos", "Erdős minimum overlap", "C₅ bound", False),
             ("heilbronn_triangle", "Heilbronn triangle", "Min. triangle area", True)]
    arms = [("oe_llm", "OpenEvolve"), ("oe_agent", "OpenEvolve-Agent"),
            ("lcma", "CLMs (subagents)"), ("p0t1", "CLM")]
    short = {"circle_packing": "circle", "erdos": "erdos", "heilbronn_triangle": "heilbronn",
             "minimizing_max_min_dist_2d": "minmax"}
    files = {"oe_llm": ["{t}_oe_llm_r2_attempts.csv", "{t}_oe_llm_attempts.csv"],
             "oe_agent": ["{t}_oe_agent_attempts.csv"],
             "lcma": ["{t}_lcma_attempts.csv", "{s}-lcma_attempts.csv"],
             "p0t1": ["{t}_p0t1_v3_attempts.csv", "{t}_p0t1_v2_attempts.csv", "{t}_p0t1_attempts.csv"]}
    raw_cols = ["sum_radii", "min_max_ratio", "c5_bound", "min_area_normalized", "min_area"]
    meta_keys = {"attempt_idx", "wallclock_s", "is_valid", "score_file", "program_sha", "ts_source",
                 "in_budget", "attempt_file", "iteration", "file", "rel_s", "valid", "combined_score",
                 "score", "status"}
    run_end = {}
    for x in rows(os.path.join(D, "results.csv")):
        st = (x.get("status") or "") + (x.get("verdict") or "")
        if any(k in st for k in ("salvage", "early-stop", "RED", "pending")) or "superseded-see" in (x.get("status") or ""):
            continue
        m = re.match(r"([0-9.]+)", x.get("wall_h") or "")
        if m:
            run_end[(x["task"], x["arm"].replace("-v2", "").replace("-v3", ""))] = float(m.group(1))
    for x in rows(os.path.join(D, "cost_columns.csv")):
        a = x["arm"].replace("-v2", "").replace("-v3", "")
        w = num(x.get("wall_h"))
        if w is not None:
            run_end.setdefault((x["task"], a), w)

    def meta(task):
        for p in (os.path.join(D, "figure_inputs", f"{task}_meta.json"),
                  os.path.join(D, "figure_inputs", task, "meta.json"), os.path.join(D, task, "meta.json")):
            if os.path.exists(p):
                return json.load(open(p))
        return {}

    def load(task, arm, m, hb):
        cands = [os.path.join(D, "figure_inputs_rerun", f.format(t=task, s=short[task])) for f in files[arm]]
        p = next((c for c in cands if os.path.exists(c)), None)
        if p is None:
            return None
        rs = rows(p)
        if "in_budget" in rs[0]:
            rs = [x for x in rs if x["in_budget"] in ("True", "1", "true")]
        if len(rs) > 100:
            rs = rs[:100]
        elif "wallclock_s" in rs[0] and not arm.startswith("oe"):
            rs = [x for x in rs if not x["wallclock_s"] or float(x["wallclock_s"]) <= 18000]
        pref = (raw_cols + ["raw_metric(score)", "raw_metric", "score_normalized", "score"]) if arm.startswith("oe") \
            else (raw_cols + ["raw_metric", "score"])
        key = next((k for k in pref if k in rs[0] and any(x.get(k) not in (None, "") for x in rs)), None)
        raw_key = key in raw_cols
        if key is None:
            key = [k for k in rs[0] if k not in meta_keys | {"attempt_file", "in_budget", "cost_usd_cum", "cost_cum_method"}
                   and not k.startswith("task_reference") and not k.startswith("cost")][0]
        v = np.array([float(x[key]) if x[key] and x.get("is_valid", "1") in ("1", "True", "true") else np.nan for x in rs])
        if arm.startswith("oe") and not raw_key and "best_known" in m:
            c = np.where(v > 0, v, np.nan)
            v = c * m["best_known"] if hb else m["best_known"] / c
        return v

    out = {"arms": [label for _, label in arms], "tasks": []}
    for task, title, unit, hb in tasks:
        m = meta(task)
        acc = np.maximum.accumulate if hb else np.minimum.accumulate
        series = {}
        for arm, label in arms:
            v = load(task, arm, m, hb)
            if v is None or len(v) < 2:
                continue
            best = acc(np.where(np.isnan(v), -np.inf if hb else np.inf, v))
            best = np.where(np.isfinite(best), best, np.nan)
            series[label] = {"att": [r(x, 6) for x in v], "best": [r(x, 6) for x in best],
                             "wall_stop": bool(run_end.get((task, arm), 0) >= 4.95 and len(v) < 100)}
        out["tasks"].append({"key": task, "title": title, "unit": unit, "higher_better": hb,
                             "best_known": m.get("best_known"), "series": series})
    write("open_problems", out)


# --------------------------------------------------------------------------------------------
def edgebench():
    """fig:long_horizon (a) -- visualization/long_horizon.py draw() for the 32K run (family d10v2) and the
    appendix 128K run (fig:long_horizon_128k_r50, family d10v2r50-128k), plus long_horizon_sonnet_panel.py
    (family d10s46)."""
    D = os.path.join(EXP, "long_horizon")
    arms = [("r-base", "Base"), ("r-codex", "Summary"), ("p0t1", "CLM"), ("live_ctx_ma", "CLMs (subagents)")]
    R50 = "d10v2r50-128k"

    def curves(path, family):
        u = pd.read_csv(path, comment="#")
        u = u[u.family == family]
        return u.groupby(["arm", "mark_h"]).agg(mean=("best_so_far", "mean"),
                                                alive=("alive_at_mark", "sum")).reset_index()

    fin = pd.read_csv(os.path.join(D, "v2_final_merged_arm.csv"), comment="#")
    cost = pd.concat([pd.read_csv(os.path.join(D, "v2_cost.csv")),
                      pd.read_csv(os.path.join(D, "v2_128k_r50_rebank_cost.csv"), comment="#").query("family == @R50")],
                     ignore_index=True)
    sub = pd.read_csv(os.path.join(D, "v2_cost_subagents.csv"), comment="#")
    sub = pd.concat([sub[sub.family != R50],
                     pd.read_csv(os.path.join(D, "v2_128k_r50_rebank_subagents.csv"), comment="#").query("family == @R50")],
                    ignore_index=True)

    def qwen_view(csv_name, family):
        g = curves(os.path.join(D, csv_name), family)
        f = fin[fin.family == family].set_index("arm").merged_12h
        pf = cost[cost.family == family].groupby("arm").pflops_cache_aware.mean().add(
            sub[sub.family == family].groupby("arm").subagent_pflops_cache_aware_scaled.mean(), fill_value=0.0)
        out = {}
        for arm, label in arms:
            dd = g[g.arm == arm].sort_values("mark_h")
            if arm == "r-base":
                # as in the paper's Base inset: labelled with its last value, drawn up to where its last trial stopped
                final = float(dd["mean"].iloc[-1])
                dd = dd[dd.mark_h <= dd[dd.alive == dd.alive.min()].mark_h.iloc[0]]
            else:
                final = float(f[arm])
            out[label] = {"h": [r(v, 3) for v in dd.mark_h], "y": [r(v, 3) for v in dd["mean"]],
                          "final": r(final, 1), "pf_total": r(pf[arm], 0)}
        return out

    qwen = qwen_view("v2_32k_unit_curve_oe_main.csv", "d10v2")
    qwen128 = qwen_view("v2_128k_r50_rebank_unit_curve_uor.csv", R50)

    gs = curves(os.path.join(D, "v2_32k_sonnet_oe_unit_curve.csv"), "d10s46")
    sonnet = {}
    for arm, label in arms:
        dd = gs[gs.arm == arm].sort_values("mark_h")
        if arm == "r-base":
            stop = dd[dd.alive == dd.alive.min()].mark_h.iloc[0]
        else:
            stop = dd[dd.alive > 0].mark_h.max()
        dd = dd[dd.mark_h <= stop]
        sonnet[label] = {"h": [r(v, 3) for v in dd.mark_h], "y": [r(v, 3) for v in dd["mean"]],
                         "final": r(float(dd["mean"].iloc[-1]), 1)}
    write("edgebench", {"qwen": qwen, "sonnet": sonnet, "qwen128": qwen128})


def software_world():
    """fig:long_horizon (b), right panel -- visualization/long_horizon.py sw_series() (speedup vs active hours)."""
    src = rows(os.path.join(EXP, "software_world", "exp23_sweeps.csv"))
    arms = [("23.2v2", "Summary (agent swarm)"), ("23.3v2", "CLMs (agent swarm)")]
    ser = {c: [x for x in src if x["cell"] == c] for c, _ in arms}
    cut = min(max(float(x["active_hours"]) for x in ser[c]) for c in ser)
    out = {"cut_hours": r(cut, 2)}
    for c, label in arms:
        rs = [x for x in ser[c] if float(x["active_hours"]) <= cut + 1e-9]
        out[label] = {"h": [r(float(x["active_hours"]), 2) for x in rs],
                      "y": [r(float(x["geomean_raw"]), 4) for x in rs]}
    write("software_world", out)


# --------------------------------------------------------------------------------------------
def steering():
    """fig:steering -- visualization/steering_row.py (constants in data/steering_panels_ac.csv,
    panel (b) from data/s2_panel_b_positions_w1.csv)."""
    vd = os.path.join(PAPER, "visualization", "data")
    pa = {(x["panel"], x["arm_or_x"], x["quantity"]): float(x["value"]) for x in rows(os.path.join(vd, "steering_panels_ac.csv"))}
    thr = []
    for y in (16, 24, 32):
        k = f"Y={y}k"
        thr.append({"y": y * 1000, "median": pa[("a", k, "natural_first_compaction_median")],
                    "lo": pa[("a", k, "ci_lo")], "hi": pa[("a", k, "ci_hi")]})
    with open(os.path.join(vd, "s2_panel_b_positions_w1.csv")) as f:
        pos = [x for x in csv.reader(f) if x and not x[0].startswith("#")]
    hdr, pos = pos[0], pos[1:]
    ix = {h: i for i, h in enumerate(hdr)}
    K = list(range(-4, 16))

    def aligned(arm):
        B = []
        for x in pos:
            if x[ix["arm"]] != arm or x[ix["status"]] != "OK":
                continue
            wt = [int(float(x[ix[f"wt_a{k}"]])) for k in range(1, 5)]
            ed = sorted(int(float(e)) for e in x[ix["edit_turns"]].split(";") if e.strip())
            for j in range(3):
                if wt[j] < wt[j + 1]:
                    B.append((wt[j], ed))
        at, cum = np.zeros(len(K)), np.zeros(len(K))
        for t, ed in B:
            offs = {e - t for e in ed}
            for i, k in enumerate(K):
                at[i] += k in offs
                cum[i] += any(0 <= o <= k for o in offs)
        return [r(v, 3) for v in at / len(B)], r(cum[K.index(2)] / len(B), 3), len(B)

    b = {}
    for arm, label in (("bareNF", "no instruction"), ("s2eNF", "instructed")):
        at, within2, n = aligned(arm)
        b[label] = {"rate": at, "within2": within2, "n_boundaries": n}
    write("steering", {
        "threshold": {"points": thr, "no_instruction_median": pa[("a", "no_instruction", "first_compaction_median")]},
        "boundaries": {"k": K, **b},
        "backup": {"instructed": {"full": pa[("c", "instructed", "full_backup_fraction")],
                                  "partial": pa[("c", "instructed", "partial_backup_fraction")]},
                   "no instruction": {"full": pa[("c", "no_instruction", "full_backup_fraction")], "partial": 0.0}}})


# --------------------------------------------------------------------------------------------
def selfevo():
    """fig:selfevo_evolution / fig:selfevo_evolution_full -- visualization/selfevo_main_two_rows.py replay rule:
    a card is drawn iff it entered the running Pareto frontier (acc >= start, non-dominated) when proposed."""
    D = os.path.join(EXP, "haas", "selfevo_pareto", "families")

    def pcost(x):
        v = num(x.get("pflops_solved_only"))
        if v is None:
            return None
        n, w = int(num(x.get("n")) or 0), int(num(x.get("n_walled")) or 0)
        if n and (n - w) < max(1, math.ceil(0.1 * n)):
            return None
        return v

    def usd(x):
        u, n = num(x.get("usd")), num(x.get("n"))
        return u / n if (u is not None and n) else None

    def dominated(x, y, pts):
        return any(qx <= x and qy >= y and (qx, qy) != (x, y) for qx, qy in pts)

    fams = [("ndl", "Needle Retention"), ("sud", "Sudoku Sketchpad"), ("kv", "KV Store"), ("log", "Log Triage")]
    settings = [("", "assisted", pcost, ("claude-5-fable-genai", "api-opus5")),
                ("_opus", "self", usd, ("claude-5-opus-genai",))]
    out = {}
    for suffix, key, cf, allowed in settings:
        out[key] = {}
        for fam, title in fams:
            p = os.path.join(D, f"{fam}_L0{suffix}_attempts.csv")
            dev = [x for x in rows(p) if x["stage"] == "dev" and x["split"] == "dev-v2"]
            anc = next((x for x in dev if x.get("proposer") == "anchor" or x["attempt_idx"] == "0"), None)
            exp = next((x for x in dev if x.get("proposer") == "human-expert"), None)
            cards = sorted([x for x in dev if x is not anc and x is not exp and num(x["acc"]) is not None
                            and cf(x) is not None and x.get("proposer") in allowed],
                           key=lambda x: int(num(x["attempt_idx"]) or 0))
            a_acc = num(anc["acc"]) * 100 if anc else None
            a_cost = cf(anc) if anc else None
            if anc and a_cost is None and num(anc.get("pflops_measured")) is not None and suffix == "":
                a_cost = num(anc["pflops_measured"])
            front = [(a_cost, a_acc)] if a_cost is not None else []
            entered = []
            for x in cards:
                cx, cy = cf(x), num(x["acc"]) * 100
                if a_acc is not None and cy < a_acc - 1e-9:
                    continue
                if dominated(cx, cy, front):
                    continue
                front = [(px, py) for px, py in front if not (cx <= px and cy >= py and (cx, cy) != (px, py))] + [(cx, cy)]
                entered.append({"x": r(cx, 4), "y": r(cy, 2), "attempt": int(num(x["attempt_idx"]) or 0)})
            out[key][fam] = {"title": title, "start": {"x": r(a_cost, 4), "y": r(a_acc, 2)},
                             "n_evaluated": len(cards), "entered": entered}
    write("selfevo", out)


# --------------------------------------------------------------------------------------------
def rl():
    """fig:rl_curves -- visualization/rl_curves.py: the 4-arm x step trace (code repo
    rl/eff_combined/rl_eff_combined_traced.csv), through training step 70."""
    src = [x for x in csv.DictReader(io.StringIO(branch_file("paper/experiments/rl/eff_combined/rl_eff_combined_traced.csv")))
           if int(x["step"]) <= 70]
    names = {"ours_eff": "CLM, with efficiency advantage", "ours_noeff": "CLM, task reward only",
             "sum_eff": "Summary, with efficiency advantage", "sum_noeff": "Summary, task reward only"}
    out = {}
    for x in src:
        s = out.setdefault(names[x["arm"]], {"step": [], "acc": [], "pflops": []})
        s["step"].append(int(x["step"])); s["acc"].append(float(x["acc"])); s["pflops"].append(float(x["pflops"]))
    write("rl", out)


# --------------------------------------------------------------------------------------------
def scr():
    """fig:suffix_cache_reuse_wip -- code repo kv_reuse/fig/stage2_fig.csv (BCP-830, K=6)."""
    LIN = 4.87064e10
    src = {x["arm"]: x for x in rows(os.path.join(EXP, "kv_reuse", "fig", "stage2_fig.csv")) if x["qid_set"] == "all_830"}
    out = {}
    for arm, label in (("standard", "Standard SGLang"), ("k6", "Suffix Cache Reuse")):
        x = {k: num(v) for k, v in src[arm].items()}
        n = x["n"]
        out[label] = {
            "acc": r(100 * x["acc_correct"] / x["acc_n"], 1),
            "total_pflops": r(x["pflops_per_question"], 2),
            "prefill_pflops": r(LIN * x["forwarded_tokens"] / 1e15 / n, 2),
            "decode_pflops": r(LIN * x["decode_tokens_served"] / 1e15 / n, 2),
            "all": {"hit": r(100 * x["allturn_hit"] / x["allturn_L"], 1),
                    "reused": r(100 * x["allturn_relocated"] / x["allturn_L"], 1),
                    "prefilled": r(100 * x["allturn_forwarded"] / x["allturn_L"], 1)},
            "edited": {"hit": r(100 * x["edited_hit"] / x["edited_L"], 1),
                       "reused": r(100 * x["edited_relocated"] / x["edited_L"], 1),
                       "prefilled": r(100 * x["edited_forwarded"] / x["edited_L"], 1)}}
    write("scr", out)


if __name__ == "__main__":
    for fn in (contextbench, pareto, open_problems, edgebench, software_world, steering, selfevo, rl, scr):
        fn()
