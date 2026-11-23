# Stage 5: Visual and interaction excellence

## Objective

Make the coordinator and volunteer workflows usable without sacrificing the verified Stage 4 records, exports, or AutoRoster decisions. The FBLA Coding & Programming 2026–27 rubric rewards intuitive interfaces with clear instructions. This is evidence for judging, not a claim that the application has won or passed a human evaluation.

## Research and decisions

- W3C WCAG 2.2: reflow (1.4.10), keyboard access (2.1.1), focus order (2.4.3), focus visibility (2.4.7), focus not obscured (2.4.11), minimum target size (2.5.8), error identification (3.3.1), and status messages (4.1.3). https://www.w3.org/TR/WCAG22/
- WAI-ARIA APG disclosure navigation: ordinary navigation links do not require menu-widget keyboard semantics. https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/examples/disclosure-navigation/
- WAI-ARIA APG modal dialog: contain focus, provide a close control, restore focus on dismissal. https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
- Srinivasan, Harshbarger and Hilliker, Azimuth (2023): screen-reader-oriented dashboard navigation and complementary descriptions. https://scispace.com/papers/azimuth-designing-accessible-dashboards-for-screen-reader-1m3u0a02c9
- Fliti et al., FLOW-A11Y (2026 preprint): interaction traces expose dynamic focus, modal, and announcement defects that static scans miss. https://www.alphaxiv.org/abs/2607.03100

## Implementation and evidence

| Work area          | Evidence                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Shell and sidebar  | Real column expansion, persistent account footer, inert closed mobile drawer, accessible navigation names, dismissal and route focus |
| Shared forms       | Keep guidance alongside errors, preserve caller invalid state, visible invalid and focus borders                                     |
| Data tables        | Named keyboard-scrollable regions; no page-wide overflow required to access wide records                                             |
| Charts             | True zero-height bars, no zero donut wedges, distinct SVG gradient identifiers, accessible chart tables                              |
| Mission Control    | Full attention details, compact mobile cards, no unrelated demo stock cover for real workspaces, accurate workload-balance wording   |
| Notification panel | Scrollable within the viewport and readable text after marking an item read                                                          |
| Responsive checks  | Existing route zoom, screenshot, contrast, accessibility-tree and browser audits; added interactive focus containment test           |

Baseline: Stage 4 main commit `2fde217b4822cf0ca97ff9b67887790e7c55a291`. Prior CI screenshots are available in run 45281193766. Capture and compare the new artifacts from the exact Stage 5 head; do not treat screenshot creation as visual approval.

## Independent task testing (not yet performed)

Recruit at least three people unfamiliar with CivicFlow; include keyboard-only and assistive-technology users where available. Do not coach the first attempt. Use the isolated sample, not production records.

1. Locate a shift that needs a volunteer and explain what action to take.
2. Open AutoRoster, explain a proposed assignment, return to the schedule.
3. Find a volunteer record and identify the next action.
4. Generate a report, change a period, and explain the source data.
5. Navigate with only a keyboard, dismiss the mobile drawer, find accessibility preferences.
6. Attempt an invalid form entry; recover without losing instructions.

Record participant ID, viewport, input method, task success, time, wrong turns, blockers, and observed comments. Never invent participant results. Resolve critical blockers, retest, then attach before/after screenshots and the exact commit.

## Exit gate

Full six-job CI, targeted browser interaction acceptance, visual review of desktop/tablet/mobile/zoom captures, manual keyboard and screen-reader review, and independent participant task results. Automated checks are not WCAG certification. No live backend changes are part of this stage.
