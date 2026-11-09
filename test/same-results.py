#!/usr/bin/env python3
"""Compare two Vitest JSON reports: the status of every file and every test.

Usage: same-results.py <a.json> <b.json>
Prints "same" or the differences. Exit code 0 if the same, 1 if not.
"""
import json, sys


def load(path):
    report = json.load(open(path))
    files, tests = {}, {}
    for f in report["testResults"]:
        name = f["name"]
        files[name] = f["status"]
        for t in f["assertionResults"]:
            tests[(name, t["fullName"])] = t["status"]
    return files, tests, report.get("numFailedTestSuites"), report.get("success")


a, b = load(sys.argv[1]), load(sys.argv[2])
diff = []
for kind, x, y in (("file", a[0], b[0]), ("test", a[1], b[1])):
    for key in sorted(set(x) | set(y), key=str):
        if x.get(key) != y.get(key):
            diff.append(f"{kind} {key}: {x.get(key)} -> {y.get(key)}")
if a[3] != b[3]:
    diff.append(f"success: {a[3]} -> {b[3]}")
if diff:
    print("\n".join(diff))
    sys.exit(1)
print(f"same: {len(a[0])} files, {len(a[1])} tests, {sum(s == 'failed' for s in a[0].values())} failed files")
