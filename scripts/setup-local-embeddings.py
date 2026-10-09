"""Download the pinned, free Chinese embedding model; no API key is required."""
import hashlib
import os
from pathlib import Path
import urllib.request

REVISION = "75c43b069aac4d136ba6bc1122f995fedcfd2781"
FILES = {
    "config.json": "d4193ead3a810fd694fa8a31d7fc72fbaebc0668b603e398734bf2f6538ff42f",
    "tokenizer.json": "48cea5d44424912a6fd1ea647bf4fe50b55ab8b1e5879c3275f80e339e8fae26",
    "tokenizer_config.json": "e6f3b96db926a37d4039995fbf5ad17de158dfb8f6343d607e4dbaad18d75f5a",
    "special_tokens_map.json": "b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3",
    "onnx/model_quantized.onnx": "15b717c382bcb518ba457b93ea6850ede7f4f1cd8937454aa06972366cd19bcc",
}


def main():
    root = Path(os.environ.get("RAG_DATA_DIR", "data")) / "models/bge-small-zh-v1.5"
    proxy = os.environ.get("MODEL_DOWNLOAD_PROXY")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({"http": proxy, "https": proxy})) if proxy else urllib.request.build_opener()
    for name, expected in FILES.items():
        target = root / name
        if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == expected:
            print(f"Verified: {name}", flush=True)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(target.name + ".download")
        try:
            url = f"https://huggingface.co/Xenova/bge-small-zh-v1.5/resolve/{REVISION}/{name}"
            with opener.open(url, timeout=90) as response:
                content = response.read(150_000_001)
            if len(content) > 150_000_000 or hashlib.sha256(content).hexdigest() != expected:
                raise ValueError(f"Model checksum mismatch: {name}")
            temporary.write_bytes(content)
            temporary.replace(target)
            print(f"Downloaded: {name} ({len(content)} bytes)", flush=True)
        finally:
            temporary.unlink(missing_ok=True)
    print("Local Chinese embedding model is ready. Select it in settings, then index documents.")


if __name__ == "__main__":
    main()
