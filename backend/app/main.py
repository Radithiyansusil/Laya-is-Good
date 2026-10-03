"""FastAPI backend serving the Laya decision model (convaiinnovations/laya, English root checkpoint).

One state + one typed question in -> one calibrated decision out, with the full probability
distribution and the metadata the model returns. Inference is done by the official `laya`
runtime (pip package), loading the checkpoint from the local `models/laya` directory.
"""
from __future__ import annotations

import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Dict, List, Literal, Optional, Union

# transformers probes TensorFlow at import; the model card says to disable it to avoid hangs.
os.environ.setdefault("USE_TF", "0")

ROOT = Path(__file__).resolve().parents[2]
# Keep every Hugging Face cache inside this project folder, and never reach the network.
os.environ.setdefault("HF_HOME", str(ROOT / ".hf_cache"))
os.environ.setdefault("HF_HUB_OFFLINE", "1")

import torch  # noqa: E402
from fastapi import FastAPI, HTTPException  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from pydantic import BaseModel, Field, model_validator  # noqa: E402

import laya  # noqa: E402
from laya.common import QTYPES, temp_bucket  # noqa: E402

MODEL_DIR = Path(os.environ.get("LAYA_MODEL_DIR", ROOT / "models" / "laya"))
DEVICE = os.environ.get("LAYA_DEVICE") or ("cuda" if torch.cuda.is_available() else "cpu")
CORS_ORIGINS = os.environ.get("LAYA_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")

STATE: Dict[str, object] = {}


@asynccontextmanager
async def lifespan(_: FastAPI):
    if not (MODEL_DIR / "rl_agent_config.json").is_file():
        raise RuntimeError(f"Laya checkpoint not found in {MODEL_DIR}. Run backend/download_model.py first.")
    t0 = time.perf_counter()
    agent = laya.load(str(MODEL_DIR), device=DEVICE)
    STATE["agent"] = agent
    STATE["load_seconds"] = round(time.perf_counter() - t0, 2)
    # Warm-up pass so the first user request does not pay CUDA kernel initialisation.
    agent.predict("warm up", {"q": {"type": "noul", "instructions": "Is this a test?"}})
    yield
    STATE.clear()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


app = FastAPI(title="Laya Decision API", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])


# ----------------------------------------------------------------------------- schemas
class Question(BaseModel):
    """One typed question, in the Laya / Jev request shape.

    - choice: `criteria` is {option_key: description} (or a list of option keys); >= 2 options.
    - score:  `criteria` is an ordered list of levels, lowest first; >= 2 levels.
    - noul:   yes/no probability. `criteria` optional: {"true": "...", "false": "..."} descriptions.
    """

    type: Literal["choice", "score", "noul"]
    instructions: str = Field(min_length=1, max_length=4000)
    criteria: Optional[Union[Dict[str, Optional[str]], List[str]]] = None

    @model_validator(mode="after")
    def _check(self):
        c = self.criteria
        if self.type == "choice":
            if not c or len(c) < 2:
                raise ValueError("a choice question needs at least 2 options in criteria")
            keys = list(c.keys()) if isinstance(c, dict) else c
            if any(not str(k).strip() for k in keys):
                raise ValueError("choice option keys must be non-empty")
            if len(set(keys)) != len(keys):
                raise ValueError("choice option keys must be unique")
        elif self.type == "score":
            if not isinstance(c, list) or len(c) < 2:
                raise ValueError("a score question needs criteria as a list of at least 2 levels (lowest first)")
        elif c is not None:
            if not isinstance(c, dict) or set(c) - {"true", "false"}:
                raise ValueError("noul criteria may only be {'true': ..., 'false': ...}")
        return self


class DecideRequest(BaseModel):
    state: str = Field(min_length=1, max_length=50_000, description="The text the decision is about.")
    question: Question


class OptionProb(BaseModel):
    option: str
    description: Optional[str] = None
    probability: float


class DecideResponse(BaseModel):
    type: str
    decision: str
    probabilities: List[OptionProb]
    score: Optional[float] = None
    p_true: Optional[float] = None
    confidence: float
    answer_confidence: float
    act_probability: Optional[float] = None
    usage: Dict[str, object]
    meta: Dict[str, object]
    raw: Dict[str, object]


# ----------------------------------------------------------------------------- helpers
def _clean_question(q: Question) -> Dict[str, object]:
    out: Dict[str, object] = {"type": q.type, "instructions": q.instructions}
    c = q.criteria
    if q.type == "choice" and isinstance(c, dict):
        out["criteria"] = {k: (v or "").strip() or None for k, v in c.items()}
    elif c is not None:
        out["criteria"] = c
    return out


def _calibration_meta(agent, q: Question) -> Dict[str, object]:
    """Which temperature the runtime applied, using the same bucket rule as laya's decoder."""
    qt = QTYPES[q.type]
    k = 2 if q.type == "noul" else len(q.criteria)
    bucket = temp_bucket(qt, k)
    by_opt = getattr(agent, "temperature_by_options", {}) or {}
    temps = getattr(agent, "temperature", [1.0, 1.0, 1.0])
    in_bucket = bucket in by_opt
    return {"temperature_bucket": bucket, "temperature": round(float(by_opt[bucket] if in_bucket else temps[qt]), 4),
            "temperature_source": "temperature_by_options" if in_bucket else "per-type fallback"}


# ----------------------------------------------------------------------------- routes
@app.get("/api/health")
def health():
    agent = STATE.get("agent")
    if agent is None:
        raise HTTPException(503, "model not loaded")
    cfg = agent.cfg
    return {
        "status": "ok",
        "model": "convaiinnovations/laya",
        "checkpoint_dir": str(MODEL_DIR),
        "backbone": cfg.get("encoder"),
        "params": "421M",
        "device": str(agent.device),
        "gpu": torch.cuda.get_device_name(0) if agent.device.type == "cuda" else None,
        "dtype": str(getattr(agent, "dtype", "")).replace("torch.", ""),
        "max_len": cfg.get("max_len"),
        "head_max_len": cfg.get("head_max_len"),
        "load_seconds": STATE.get("load_seconds"),
        "laya_version": getattr(laya, "__version__", None),
    }


@app.post("/api/decide", response_model=DecideResponse)
def decide(req: DecideRequest):
    agent = STATE.get("agent")
    if agent is None:
        raise HTTPException(503, "model not loaded")
    q = req.question
    t0 = time.perf_counter()
    try:
        result = agent.predict(req.state, {"q": _clean_question(q)})
    except ValueError as e:  # e.g. options do not fit into head_max_len
        raise HTTPException(422, str(e))
    latency_ms = round((time.perf_counter() - t0) * 1000, 1)
    a = result["answers"]["q"]

    if q.type == "choice":
        crit = q.criteria if isinstance(q.criteria, dict) else {k: None for k in q.criteria}
        probs = [OptionProb(option=k, description=crit.get(k), probability=p) for k, p in a["probabilities"].items()]
        decision, score, p_true = a["choice"], None, None
    elif q.type == "score":
        probs = [OptionProb(option=f"level {i}", description=a["legend"][i], probability=p)
                 for i, p in a["probabilities"].items()]
        top = max(a["probabilities"], key=a["probabilities"].get)
        decision, score, p_true = f"level {top}: {a['legend'][top]}", a["score"], None
    else:
        p_true = a["noul"]
        crit = q.criteria or {}
        probs = [OptionProb(option="no", description=crit.get("false"), probability=round(1 - p_true, 4)),
                 OptionProb(option="yes", description=crit.get("true"), probability=p_true)]
        decision, score = ("yes" if p_true >= 0.5 else "no"), None

    return DecideResponse(
        type=q.type, decision=decision, probabilities=probs, score=score, p_true=p_true,
        confidence=a["confidence"], answer_confidence=a["answer_confidence"],
        act_probability=(a.get("action") or {}).get("act_probability"),
        usage=result.get("usage", {}),
        meta={"model": result.get("model"), "device": str(agent.device), "latency_ms": latency_ms,
              **_calibration_meta(agent, q)},
        raw=a,
    )
