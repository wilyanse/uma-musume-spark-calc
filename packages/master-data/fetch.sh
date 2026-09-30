#!/bin/sh
# usage: fetch.sh key... ; caches /data/umamusume/<key>.<hash>.json into .cache/data/
UA="uma-spark-calc/0.1 (+https://github.com/wilyanse/uma-musume-spark-calc)"
cd "$(dirname "$0")/.cache" || exit 1
for k in "$@"; do
  h=$(python3 -c "import json,sys;print(json.load(open('man.json'))[sys.argv[1]])" "$k") || exit 1
  out="data/$(echo "$k" | tr / _).json"; mkdir -p data
  [ -f "$out" ] && continue
  sleep 1; curl -sf -A "$UA" "https://gametora.com/data/umamusume/$k.$h.json" -o "$out" && echo "$k ok $(wc -c <"$out")" || echo "$k FAIL"
done
