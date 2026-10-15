# -*- coding: utf-8 -*-
"""从腾讯镜像下载 gradle-8.2.1-all.zip 放入 wrapper 缓存。"""
import os, sys, urllib.request, hashlib

MIRRORS = [
    "https://mirrors.cloud.tencent.com/gradle/gradle-8.2.1-all.zip",
    "https://mirrors.aliyun.com/macports/distfiles/gradle/gradle-8.2.1-all.zip",
]
DST_DIR = r"C:\Users\27348\.gradle\wrapper\dists\gradle-8.2.1-all\d8pvvlun5bx6sdtwqhf8y9z4b"
DST = os.path.join(DST_DIR, "gradle-8.2.1-all.zip")
os.makedirs(DST_DIR, exist_ok=True)
for f in os.listdir(DST_DIR):
    if f.endswith(".part") or f.endswith(".lck"):
        try: os.remove(os.path.join(DST_DIR, f))
        except Exception: pass

for url in MIRRORS:
    try:
        print("try", url, flush=True)
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            total = int(r.headers.get("Content-Length", 0))
            print("size", total, flush=True)
            with open(DST, "wb") as f:
                got = 0
                while True:
                    chunk = r.read(1 << 20)
                    if not chunk: break
                    f.write(chunk); got += len(chunk)
                    if total:
                        print("\r%d%%" % (got * 100 // total), end="", flush=True)
            print("\n done", got)
            break
    except Exception as e:
        print("failed:", e, flush=True)
else:
    sys.exit(1)
print("zip ready at", DST)
