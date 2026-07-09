// Login calendar — a 30-day cycle layered on the existing daily streak. Each
// consecutive daily claim advances the calendar; milestone days pay escalating
// bonus shards (and the occasional free pack) on top of the normal daily reward.
// The cycle repeats every 30 streak-days; a broken streak resets it to day 1.

export const CALENDAR_CYCLE = 30;

export interface Milestone {
  day: number;
  shards: number;
  packTier?: string;
}

export const MILESTONES: Milestone[] = [
  { day: 5, shards: 100 },
  { day: 10, shards: 200 },
  { day: 15, shards: 350, packTier: "basic" },
  { day: 20, shards: 500 },
  { day: 25, shards: 700 },
  { day: 30, shards: 1200, packTier: "basic" },
];

const MILESTONE_BY_DAY = new Map(MILESTONES.map(m => [m.day, m]));

// Position within the 30-day cycle for a given streak length (1-based).
export function cycleDay(streak: number): number {
  if (streak <= 0) return 0;
  return ((streak - 1) % CALENDAR_CYCLE) + 1;
}

export function milestoneFor(day: number): Milestone | undefined {
  return MILESTONE_BY_DAY.get(day);
}

export function nextMilestone(day: number): Milestone | undefined {
  return MILESTONES.find(m => m.day > day) ?? MILESTONES[0];
}

// Render the 30-day grid. `currentDay` cells are marked claimed; milestone days
// stand out (🏆 once reached, 🎁 while still upcoming).
export function renderGrid(currentDay: number): string {
  const cells: string[] = [];
  for (let d = 1; d <= CALENDAR_CYCLE; d++) {
    const isMilestone = MILESTONE_BY_DAY.has(d);
    if (d <= currentDay) cells.push(isMilestone ? "🏆" : "🟩");
    else cells.push(isMilestone ? "🎁" : "⬜");
  }
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += 6) rows.push(cells.slice(i, i + 6).join(" "));
  return rows.join("\n");
}
