export const presets = [
  { title: 'Program × GL', query: 'rows=program&cols=glAccount&from=2026-01-01&to=2026-03-31' },
  {
    title: 'Grant budget line × GL',
    query: 'rows=grantBudgetLine&cols=glAccount&page=grant&from=2026-01-01&to=2026-03-31',
  },
  { title: 'Grant × Program', query: 'rows=grant&cols=program&from=2026-01-01&to=2026-03-31' },
  {
    title: 'Monthly trend by grant',
    query: 'rows=month&cols=grantBudgetLine&from=2026-01-01&to=2026-03-31',
  },
];
