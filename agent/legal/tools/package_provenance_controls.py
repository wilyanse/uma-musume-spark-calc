#!/usr/bin/env python3
"""Actual hash-pinned archive positives and wrong-source negatives; no network or Windows execution."""
import argparse
import copy
import json
from pathlib import Path

from package_provenance import REQUIRED, check_record
from verification_safety import Failure


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--packages', required=True)
    ap.add_argument('--inventory', type=Path, default=Path(__file__).parent.parent / 'inventory.json')
    a = ap.parse_args()
    inv = json.loads(a.inventory.read_bytes())
    h = inv['singleFileHost']
    records = [(c['deps'], c) for c in inv['components']] + [(h['package'] + '/' + h['version'], h)]
    positives = negatives = 0
    for key, record in records:
        if key.removeprefix('runtimepack.').split('/')[0] not in REQUIRED:
            continue
        observed = check_record(a.packages, key, record)
        print(key, 'positive:', observed)
        positives += 1
        for mutation in ('wrong-commit-and-source', 'wrong-source-only', 'missing-repository'):
            bad = copy.deepcopy(record)
            commit = bad['repository']['commit']
            wrong = 'de078f3eabf87d4dce3e2a311c1d23b9bbd6b1e4'
            if mutation == 'wrong-commit-and-source':
                bad['repository']['commit'] = wrong
                bad['source'] = bad['source'].replace(commit, wrong)
                needle = 'nuspec repository differs'
            elif mutation == 'wrong-source-only':
                bad['source'] = bad['source'].replace(commit, wrong)
                needle = 'source does not identify'
            else:
                del bad['repository']
                needle = 'required repository missing'
            try:
                check_record(a.packages, key, bad)
            except Failure as e:
                assert needle in str(e), str(e)
                print(key, mutation, 'rejected:', e)
                negatives += 1
            else:
                raise AssertionError(key + ': accepted ' + mutation)
    assert positives == len(REQUIRED) and negatives == 3 * len(REQUIRED)
    print('actual archive controls: %d positives, %d negatives; all expected' % (positives, negatives))


if __name__ == '__main__':
    main()
