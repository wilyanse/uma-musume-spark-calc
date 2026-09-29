# Copy (all UI strings)

Sentence case. No exclamation marks except where the game's own names contain them. `{x}` = a runtime value. Game names (skills, sparks, outfits) come from master data and are shown verbatim.

## Global
| Key | Text |
|---|---|
| app.name | Uma Spark Calc |
| nav.roster / review / cards / targets / planner / health | Roster / Review / Cards / Targets / Planner / Health |
| nav.more (mobile) | More |
| nav.review.badge.aria | {n} open review items |
| footer.master | Master data {version} |
| footer.model | Model: {kind} |
| footer.illustrative (prototypes only) | Illustrative data — not from a real account. |
| common.retry | Retry |
| common.cancel | Cancel |
| common.reset | Reset |
| common.save | Save |
| common.delete | Delete |
| common.loading | Loading… |
| common.lowConfidence.tooltip | Low confidence — review |
| common.lowData | low data (n < 10) |
| common.n | n={n} |
| error.network | Couldn't reach the server. Check your connection and retry. |
| error.auth | Your session has expired. Reload the page to sign in again. |
| error.generic | Something went wrong. Retry, or reload the page. |
| error.masterData | Couldn't load game data ({version}). Reload the page. |
| error.validation | {detail} |

## S01 Roster
| Key | Text |
|---|---|
| title | Roster |
| lastImport | Last import {datetime} |
| filter.character | Character |
| filter.character.all | All characters |
| filter.mode | Mode |
| filter.mode.all / independent / manual | All / Independent / Manual |
| filter.scenario / all | Scenario / All scenarios |
| filter.spark | Has spark |
| filter.spark.any | Any |
| filter.stars | Stars ≥ |
| filter.rating / min.aria / max.aria | Rating range / Minimum rating / Maximum rating |
| count | Showing {shown} of {total} veterans · sorted by {column}, {direction} |
| col.veteran / rank / rating / mode / sparks / scenario / acquired | Veteran / Rank / Rating / Mode / Sparks (own: blue / pink / green) / Scenario / Acquired |
| col.stats | Spd / Sta / Pow / Gut / Wit |
| mode.independent / manual | Independent / Manual |
| mode.override.aria | Manually overridden |
| mode.override.tooltip | Overridden by you (not from epithet) |
| pager | Page {p} of {n} |
| pager.prev / next | Previous / Next |
| empty.none | No veterans yet. Install the capture agent and import your first veteran. |
| empty.filtered | No veterans match these filters. |
| empty.filtered.action | Reset filters |
| error.load | Couldn't load your roster. |

## S02 Veteran detail
| Key | Text |
|---|---|
| title | Veteran detail |
| back | ← Roster |
| banner.lowConfidence | {n} field(s) have low confidence (dotted underline). Review them |
| mode.label | Train mode (detected from epithet) |
| mode.hint | Overrides are kept on re-import. |
| tab.skills / sparks / deck / lineage | Skills / Sparks / Deck / Lineage |
| group.self / parent1 / parent2 | Self / Parent 1 · {name} / Parent 2 · {name} |
| guest.badge | Guest |
| guest.trainer | Guest trainer: {name} |
| guest.noLink | Guests can't be linked to a roster veteran. |
| lineage.matched | Matched in roster |
| lineage.open | Open veteran → |
| lineage.unmatched | Not in your roster |
| deck.friend | Friend |
| career.scenario / races / wins / fans / acquired | Scenario / Races / Wins / Fans / Acquired |
| career.fans.none | — |
| sparks.none | No sparks were read for this group. |
| sparks.none.action | Review missing sparks |
| delete.button | Delete |
| delete.confirm.title | Delete this veteran? |
| delete.confirm.body | This removes {name} and its review items. Re-importing the same capture will add it back. |
| delete.confirm.ok | Delete veteran |
| error.notFound | This veteran no longer exists. |
| error.patch | Couldn't change the train mode. It has been reverted. |

## S03 Review queue
| Key | Text |
|---|---|
| title | Review queue |
| summary | {open} open · {resolved} resolved this week |
| list.title | Open items |
| item.ocr | OCR “{raw}” |
| crop.caption | Crop from capture ({w} × {h} px) |
| raw.label | Raw OCR text |
| path.label | Field path |
| confidence | confidence {value} |
| candidates.title | Candidates |
| candidates.none | No candidates. Search the vocabulary below. |
| search.label | None of these? Search the game vocabulary |
| search.placeholder | Type a spark, skill or outfit name… |
| apply | Apply “{value}” |
| dismiss | Dismiss |
| keys.hint | J next · K previous |
| footnote | Applying updates the veteran and recomputes its fingerprint. If that collides with another veteran you'll see a conflict message. |
| empty | Nothing to review. Every field from your last import was read with high confidence. |
| crop.none | No crop stored for this field. |
| crop.error | Crop failed to load. |
| error.conflict | This value would make {name} identical to another veteran already in your roster. Delete one of them or choose a different value. |
| error.resolve | Couldn't save the fix. Retry. |
| toast.resolved | Fixed. {left} left. |
| toast.dismissed | Dismissed. {left} left. |

## S04 Support cards
| Key | Text |
|---|---|
| title | Support cards |
| sync | Last sync {datetime} · Held {n} / 255 |
| filter.type / lb / rarity / search | Type / Limit break / Rarity / Search |
| filter.type.all | All types |
| filter.lb.any / max / rest | Any / LB4 (max) / LB0–3 |
| count | Showing {shown} of {total} owned cards |
| tile.add / inDeck | Add to deck / In deck |
| deck.title | Deck builder |
| deck.subtitle | 5 owned + 1 Friend |
| deck.slot | Slot {n} |
| deck.friend | Slot 6 · Friend (borrowed) |
| deck.friend.search | Friend card (any card in the game) |
| deck.friend.placeholder | Search all cards… |
| deck.remove.aria | Remove slot {n} |
| deck.use | Use in planner |
| deck.clear | Clear |
| deck.emptySlot | Empty slot |
| deck.full | The deck already has 5 owned cards. Remove one first. |
| deck.incomplete | Choose {missing} more card(s) to complete the deck. |
| empty.none | No cards synced yet. Run the support-card sync from the capture agent. |
| empty.filtered | No cards match these filters. |
| error.load | Couldn't load your cards. |

## S05 CM targets
| Key | Text |
|---|---|
| title | CM targets |
| new | + New target |
| list.title | Saved targets |
| list.meta | {surface} · {distance} · {meters} m · updated {date} |
| edit.title | Edit target |
| name | Name |
| course / surface / distance / meters / notes | Course / Surface / Distance / Meters (optional) / Notes |
| style | Running style |
| minStats | Minimum stats (blank = no requirement) |
| minApts | Minimum aptitudes |
| requiredSkills | Required skills (all must be acquired) |
| optionalSkills | Optional skills (weight for secondary sort) |
| statWeights | Stat weights for surplus (default 1) |
| skill.add | Add skill… |
| skill.none | No skills match |
| save / saveNew / delete | Save target / Save as new / Delete |
| delete.confirm | Delete “{name}”? This can't be undone. |
| empty.none | No targets yet. Create one to start ranking parents. |
| error.stat | Enter a whole number from 1 to 2000. |
| error.name | Give the target a name. |
| error.weight | Enter a number greater than 0. |
| error.duplicateSkill | {skill} is already in the required list. |
| error.save | Couldn't save the target. Retry. |
| toast.saved | Saved “{name}”. |

## S06 Planner
| Key | Text |
|---|---|
| title | Planner |
| plan.title | Plan |
| trainee | Trainee (outfit) |
| deck | Support deck |
| deck.edit | edit in Cards |
| mode | Train mode |
| scenario | Scenario |
| target / target.edit | CM target / edit |
| lock | Lock parent 1 (optional) |
| lock.none | — none — |
| rank / cancel | Rank pairs / Cancel |
| model.line | Model {kind} · fitted on {n} veterans · 80% interval coverage {c} (holdout) |
| progress.running | Ranking… {done} of {total} pairs |
| progress.done | Ranked {total} legal pairs in {s} s · showing top {shown} of {N} |
| progress.method | Fast pass → Monte Carlo on top 100 (2,000 samples each) |
| col.rank / p1 / p2 / pmeet / surplus / affinity / bottleneck | # / Parent 1 / Parent 2 / P(meet target) / Stat surplus / Affinity / Bottleneck |
| row.expand / collapse.aria | Expand details for pair {n} / Collapse details for pair {n} |
| detail.stats | Predicted stats · mean and p10–p90 vs target (dashed) · model n={n} |
| detail.stats.note | Interval from {samples} simulated children. Stat cap {cap}. |
| detail.apt | Aptitude before → after |
| detail.apt.prob | {p}% ≥ {grade} |
| detail.skills | Required skills · P(acquired) |
| detail.contrib | Spark contributions (top) |
| detail.affinity | Affinity · total {n} |
| tag.bottleneck | bottleneck |
| state.needsFit | The model needs fitting before ranking. Fitting on {n} veterans… |
| empty.noRoster | Import at least 3 veterans to plan parents. |
| empty.noTarget | Create a CM target first. |
| empty.noDeck | Choose a full deck in Cards first. |
| empty.noPairs | No legal pairs. Parents must be different characters and differ from the trainee. |
| empty.lockNoPairs | No legal partner for the locked parent. |
| warn.lowData | Low data: fewer than 10 veterans for {scenario} · {mode}. Treat these numbers as rough. |
| error.worker | Ranking failed: {detail}. |
| error.model | Couldn't fit or load the model. |
| cancelled | Ranking cancelled. Showing partial results. |

## S07 Model health
| Key | Text |
|---|---|
| title | Model health |
| refit / calibrate | Refit model / Run calibration |
| kpi.rows / coverage / model | Training rows / 80% interval coverage / Model |
| kpi.rows.sub | min confidence ≥ 0.9 |
| kpi.coverage.sub | target 0.72–0.88 |
| tag.inRange / outRange | in range / out of range |
| samples.title | Sample counts |
| samples.col | Scenario / Mode / Veterans |
| mae.title | Holdout error (MAE, stat points) |
| scatter.title | Predicted vs actual (held-out veterans) |
| scatter.note | Dashed line = perfect prediction. |
| scatter.n | n={n} held out |
| rules.title | Inheritance rules ({version}) |
| rules.col | Rule / Value / Status / Source |
| rules.verified / unverified | ✓ verified / ⚠ unverified |
| calib.title | Calibration result |
| calib.note | Suggested values are never applied automatically. |
| calib.apply / dismiss | Apply suggested multipliers / Dismiss |
| calib.running | Calibrating… |
| empty.noModel | No model yet. Import veterans, then fit one from the Planner. |
| empty.noHoldout | Not enough data for a held-out check (needs at least 25 veterans). |
| empty.noCalib | Calibration hasn't been run. |
| error.load | Couldn't load model health. |
