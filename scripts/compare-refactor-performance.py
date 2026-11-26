"""Compare exact PR and base commits using interleaved, same-runner observations.

A tolerance is a noise-aware regression guard, not proof of identical
performance on every device. Test, documentation and migration files are not
removed by this check. The source metric is consistent with the earlier audit.
"""

import json
import re
import statistics
import sys
from pathlib import Path

root = Path(sys.argv[1])
source_pattern = re.compile(r"^(src/|src-tauri/(?:src|core/src)/).+\.(?:ts|tsx|rs|css)$")
fixture_pattern = re.compile(
    r"AutoRoster fixture: candidates=(\d+), seats=(\d+), filled=(\d+), "
    r"score=(\d+), run1_ms=([\d.]+), run2_ms=([\d.]+)"
)


def load(variant):
    size = 0
    files = 0
    for entry in (root / f"{variant}.tree").read_text().splitlines():
        meta, path = entry.split("\t", 1)
        _, kind, _, bytes_ = meta.split()
        if kind == "blob" and source_pattern.match(path) and not re.search(r"\.(test|spec)\.", path):
            size += int(bytes_)
            files += 1
    bundles = {
        row["name"]: row["gzipBytes"]
        for row in json.loads((root / f"{variant}.bundle.json").read_text())["results"]
    }
    fixtures = {}
    for candidates, seats, filled, score, first, second in fixture_pattern.findall(
        (root / f"{variant}.native.txt").read_text()
    ):
        key = f"{candidates}/{seats}"
        row = fixtures.setdefault(key, {"filled": int(filled), "score": int(score), "times": []})
        assert row["filled"] == int(filled) and row["score"] == int(score), key
        row["times"].extend([float(first), float(second)])
    assert fixtures, "No native fixture observations"
    for row in fixtures.values():
        assert len(row["times"]) == 6, "Expected six timing observations per fixture"
        row["medianMs"] = statistics.median(row["times"])
    browser = [float(value) for value in (root / f"{variant}.browser-seconds.txt").read_text().split()]
    assert len(browser) == 3, "Expected three browser journey observations"
    return {
        "sha": (root / f"{variant}.sha").read_text().strip(),
        "sourceBytes": size,
        "sourceFiles": files,
        "gzipBytes": bundles,
        "nativeFixtures": fixtures,
        "browserJourneySeconds": browser,
        "browserMedianSeconds": statistics.median(browser),
    }


base, head = load("baseline"), load("candidate")
failures = []
if head["sourceBytes"] >= base["sourceBytes"]:
    failures.append("Runtime source did not decrease")
if base["gzipBytes"].keys() != head["gzipBytes"].keys():
    failures.append("Bundle entrypoints differ")
else:
    for name, value in base["gzipBytes"].items():
        if head["gzipBytes"][name] > value * 1.01:
            failures.append(f"{name} grew beyond 1%")
if base["nativeFixtures"].keys() != head["nativeFixtures"].keys():
    failures.append("Native fixture workloads differ")
else:
    for name, old in base["nativeFixtures"].items():
        new = head["nativeFixtures"][name]
        if (new["filled"], new["score"]) != (old["filled"], old["score"]):
            failures.append(f"Native fixture {name} changed coverage or score")
        if new["medianMs"] > old["medianMs"] * 1.15 + 1:
            failures.append(f"Native fixture {name} exceeds 15% + 1ms timing guard")
if head["browserMedianSeconds"] > base["browserMedianSeconds"] * 1.10 + 1:
    failures.append("Browser journey exceeds 10% + 1s timing guard")
report = {"baseline": base, "candidate": head, "failures": failures}
(root / "report.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
if failures:
    raise SystemExit(1)
