"""Download the English Laya checkpoint (repo root of convaiinnovations/laya) into ../models/laya.

Fetches exactly the files the `laya` runtime loads for the root checkpoint (same allow-list as
laya.Agent): rl_agent_config.json, model.safetensors (~808 MB), tokenizer/*, encoder/*.
The multilingual and typed-decisions subfolders are not downloaded.
"""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault("HF_HOME", str(ROOT / ".hf_cache"))

from huggingface_hub import snapshot_download  # noqa: E402

path = snapshot_download(
    "convaiinnovations/laya",
    local_dir=str(ROOT / "models" / "laya"),
    allow_patterns=["rl_agent_config.json", "model.safetensors", "tokenizer/*", "encoder/*"],
)
print("Checkpoint ready at", path)
