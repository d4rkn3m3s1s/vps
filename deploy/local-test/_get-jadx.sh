#!/usr/bin/env bash
cd /tmp
command -v java >/dev/null 2>&1 || { echo "163244" | sudo -S apt-get install -y default-jre-headless >/dev/null 2>&1; }
echo "java: $(java -version 2>&1 | head -1)"
URL=$(curl -s https://api.github.com/repos/skylot/jadx/releases/latest 2>/dev/null | grep -oE '"browser_download_url": "[^"]*jadx-[0-9][^"]*\.zip"' | grep -v gui | head -1 | sed -E 's/.*"(https[^"]*)"/\1/')
echo "jadx url: $URL"
timeout 90 curl -sL -o jadx.zip "$URL" 2>&1
ls -la jadx.zip
rm -rf jadx && mkdir jadx && cd jadx && unzip -o ../jadx.zip >/dev/null 2>&1
ls bin/ 2>/dev/null
