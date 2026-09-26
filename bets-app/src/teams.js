// Logo files live in public/team-logos/<id>.png — replace any of them in
// place (same filename) to swap in a better version later.
export const TEAMS = [
  { id: 'octagone', name: 'Octagone' },
  { id: 'otoshi-nakamoto', name: 'O₿toshi Nakamoto' },
  { id: 'front-gate-dragon', name: 'Front Gate Dragon' },
  { id: 'ceedeez-chocolate-ballz', name: 'CeeDeez Chocolate Ballz' },
  { id: 'michaels-neat-team', name: "Michael's Neat Team" },
  { id: 'last-dart', name: 'Last Dart' },
  { id: 'creed', name: 'Creed' },
  { id: 'king-of-the-north', name: 'King Of The North' },
  { id: 'lord-of-lakengren', name: 'Lord of Lakengren' },
  { id: 'sportins-squad', name: 'Sportins Squad' },
].map((team) => ({ ...team, logo: `/team-logos/${team.id}.png` }));

// Applies a backend-provided team order (a list of team_ids, ranked) to the
// fixed TEAMS roster. Falls back to TEAMS' own order for any id it doesn't
// recognize or that's missing from the order — so a stale/partial order
// from the backend never drops a team from the page.
export function orderTeams(teamOrder) {
  if (!teamOrder || !teamOrder.length) return TEAMS;
  const byId = new Map(TEAMS.map((team) => [team.id, team]));
  const ordered = teamOrder.map((id) => byId.get(id)).filter(Boolean);
  const seen = new Set(ordered.map((team) => team.id));
  for (const team of TEAMS) {
    if (!seen.has(team.id)) ordered.push(team);
  }
  return ordered;
}
