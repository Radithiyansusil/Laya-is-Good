# Laya Decision (local)

Runs the open-source (Apache 2.0) **Laya** decision model,
[`convaiinnovations/laya`](https://huggingface.co/convaiinnovations/laya), entirely on this machine:

- **Model:** the English root checkpoint: ModernBERT-large encoder plus a decision head (2 transformer layers, an option-marker scorer and an act/escalate head), **421M params** in total, 512-token context (`head_max_len` 192). It never generates text. Each option is scored at its own `[MASK]` marker and softmaxed with temperature calibration.
- **Backend:** FastAPI (`backend/app/main.py`) using the official `laya` runtime (`laya.load("./models/laya")`), on CUDA in bf16.
- **Frontend:** Next.js 16 (`frontend/app/page.tsx`). Ask one question about one state and get one answer, with its probability scores and metadata.

All dependencies live in this folder: `backend/.venv` (Python), `frontend/node_modules`, `models/laya` (808 MB of weights), plus the `.hf_cache` and `.npm-cache` caches.

## Run

```powershell
.\start-backend.ps1        # http://127.0.0.1:8010  (wait for "Application startup complete")
.\start-frontend.ps1       # http://localhost:3000   (-Dev for hot reload)
```

To set up from scratch on another machine, run `.\setup.ps1`. It creates the venv, installs `backend/requirements.txt`, downloads the model and builds the frontend.

## Question types (from the model card)

| type | criteria | answer |
|---|---|---|
| `noul` | optional `{"true": "...", "false": "..."}` | P(yes); the UI shows both yes and no |
| `choice` | `{key: description}` with at least 2 options | the argmax key, with a probability per option |
| `score` | ordered list of levels, lowest first, at least 2 | the expected score Σ i·pᵢ, with a probability per level |

## API

`POST /api/decide`

```json
{"state": "I was charged twice. Please fix this ASAP.",
 "question": {"type": "noul", "instructions": "Is this ticket about billing?"}}
```

The response includes these fields:

- `decision`, plus `probabilities[]` with one entry per option.
- `answer_confidence`: max(p). This is the calibrated quantity.
- `confidence`: 1 − normalized entropy for choice and score, and max(p) for noul.
- `act_probability`: the model card says this carries no usable signal yet.
- `usage`: token counts and truncation.
- `meta`: latency, device, and the temperature bucket that was applied.
- `raw`: the unmodified `laya` output.

`GET /api/health` returns the model, device, dtype and context sizes.

## Limits stated on the model card

- The root checkpoint is English only. Non-Latin scripts collapse; the card reports 0.000 accuracy at 0.952 confidence on Khmer.
- The shipped probabilities are over-confident. Refit the temperatures on your own data before you gate on them.
- `noul` can follow its `false:`/`true:` labels rather than the state. If answers look stuck, ask a 2-option `choice` with neutral keys instead.
- `score` (ordinal) is the weakest question type. Choice questions with more than about 20 options lose accuracy because they share the 192-token option budget.
