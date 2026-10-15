# -*- coding: utf-8 -*-
"""下载并安装 Android commandline-tools 到 C:\\Android\\Sdk\\cmdline-tools\\latest。"""
import os, sys, urllib.request, zipfile, shutil, io

URL = "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip"
SDK = r"C:\Android\Sdk"
TMP = r"C:\Android\cmdline-tools.zip"

os.makedirs(r"C:\Android", exist_ok=True)
if os.path.exists(os.path.join(SDK, "cmdline-tools", "latest", "bin", "sdkmanager.bat")):
    print("cmdline-tools already installed")
    sys.exit(0)

print("downloading", URL, flush=True)
req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0"})
with urllib.request.urlopen(req, timeout=300) as r, open(TMP, "wb") as f:
    total = int(r.headers.get("Content-Length", 0))
    got = 0
    while True:
        chunk = r.read(1 << 20)
        if not chunk:
            break
        f.write(chunk)
        got += len(chunk)
        if total:
            print("\r%d%%" % (got * 100 // total), end="", flush=True)
print("\n downloaded", got, "bytes")

print("extracting...")
with zipfile.ZipFile(TMP) as z:
    z.extractall(r"C:\Android\_cmd")
src = r"C:\Android\_cmd\cmdline-tools"
dst = os.path.join(SDK, "cmdline-tools", "latest")
os.makedirs(os.path.dirname(dst), exist_ok=True)
shutil.move(src, dst)
shutil.rmtree(r"C:\Android\_cmd", ignore_errors=True)
os.remove(TMP)
print("installed at", dst)
