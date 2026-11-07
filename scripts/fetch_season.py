#!/usr/bin/env python3
"""Fetch a season snapshot for career mode into data/<year>.json.

Source: the Statbotics API (public, no key; its event and team data comes from The Blue Alliance).
Usage: python3 scripts/fetch_season.py [year]
"""
import json, sys, time, urllib.request
from pathlib import Path

YEAR = int(sys.argv[1]) if len(sys.argv) > 1 else 2026
API = 'https://api.statbotics.io/v3'


def get_all(path):
    out, offset = [], 0
    while True:
        url = f'{API}/{path}{"&" if "?" in path else "?"}limit=1000&offset={offset}'
        with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'simbotics-fetch'}), timeout=60) as r:
            page = json.load(r)
        out += page
        if len(page) < 1000:
            return out
        offset += 1000
        time.sleep(0.3)


def r1(x):
    return round(x or 0, 1)


events = get_all(f'events?year={YEAR}')
team_years = get_all(f'team_years?year={YEAR}')
team_events = get_all(f'team_events?year={YEAR}')

teams = {}
for t in team_years:
    b = t['epa']['breakdown']
    teams[str(t['team'])] = [t['name'], r1(t['epa']['total_points']), t.get('district'), t.get('state') or t.get('country') or '',
                             r1(b.get('auto_fuel')), r1(b.get('teleop_fuel')), r1(b.get('total_tower')), t.get('rookie_year')]

roster = {}
for te in team_events:
    roster.setdefault(te['event'], []).append([te['team']])

def einstein_alliances(key):
    """The 8 playoff alliances in seed order, read off the first round of the bracket (1v8, 4v5, 2v7, 3v6)."""
    ms = {m['key'].split('_')[1]: m['alliances'] for m in get_all(f'matches?event={key}')}
    seeds = [None] * 8
    for i, (a, b) in enumerate([(0, 7), (3, 4), (1, 6), (2, 5)]):
        m = ms.get(f'sf{i + 1}m1')
        if m:
            seeds[a], seeds[b] = m['red']['team_keys'], m['blue']['team_keys']
    return seeds


def einstein_alliances(key):
    """The 8 playoff alliances in seed order, read off the first bracket round (1v8, 4v5, 2v7, 3v6)."""
    ms = {m['key'].split('_')[1]: m['alliances'] for m in get_all(f'matches?event={key}')}
    seeds = [None] * 8
    for i, (a, b) in enumerate([(0, 7), (3, 4), (1, 6), (2, 5)]):
        m = ms.get(f'sf{i + 1}m1')
        if m:
            seeds[a], seeds[b] = m['red']['team_keys'], m['blue']['team_keys']
    return seeds


out_events = []
for e in sorted(events, key=lambda e: (e['week'], e['key'])):
    rows = roster.get(e['key'], [])
    if not rows:
        continue
    out_events.append({
        'key': e['key'], 'name': e['name'], 'type': e['type'], 'week': e['week'], 'district': e.get('district'),
        'state': e.get('state') or '', 'country': e.get('country') or '', 'start': e.get('start_date'),
        'teams': sorted(r[0] for r in rows),
    })
    if e['type'] == 'einstein':
        out_events[-1]['alliances'] = einstein_alliances(e['key'])

data = {'year': YEAR, 'source': 'Statbotics (statbotics.io), event data from The Blue Alliance', 'fetched': time.strftime('%Y-%m-%d'),
        'fields': ['name', 'epa', 'district', 'state', 'autoFuel', 'teleFuel', 'tower', 'rookie'],
        'teams': teams, 'events': out_events}
path = Path(__file__).resolve().parent.parent / 'data' / f'{YEAR}.json'
path.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')))
print(f'{len(teams)} teams, {len(out_events)} events -> {path} ({path.stat().st_size // 1024} KB)')
