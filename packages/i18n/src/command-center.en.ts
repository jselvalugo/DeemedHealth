// English catalog for the Command Center pages (Overview, Today's priorities, Readiness
// briefs, Calendar). ux-content-writer owns the final copy. Readiness is always
// "internal readiness", never an HRSA determination (roadmap Phase 2, Command Center row).
export const commandCenterEn = {
  'cc.overview.description':
    'Where your health center stands today, what needs attention, and what is due next.',
  'cc.priorities.description':
    'Everything that is not met yet, in the order to work on it: overdue first.',
  'cc.briefs.description': 'A plain summary of readiness you can read in two minutes and share.',
  'cc.calendar.description': 'Every requirement due date, month by month.',

  'cc.disclaimer':
    'Internal readiness from your own records. It is not an HRSA determination, and requirement entries are drafts until they are verified.',
  'cc.loading': 'Loading readiness…',
  'cc.error.title': 'We couldn’t load readiness',
  'cc.error.body': 'Check your connection and try again. Nothing was changed.',
  'cc.retry': 'Try again',
  'cc.noReadiness.title': 'Readiness isn’t part of your role',
  'cc.noReadiness.body':
    'The Command Center summarizes HRSA Readiness. Ask your compliance officer if you need access.',
  'cc.empty.title': 'No requirements tracked yet',
  'cc.empty.body':
    'When requirements are applied to your health center, sites, and people, their status shows here.',
  'cc.empty.action': 'Open Requirements',
  'cc.truncated': 'Showing the first {count} requirements. Open Requirements to see them all.',
  'cc.lastChecked': 'Status last checked {time}',
  'cc.lastChecked.never': 'Status not checked yet',

  'cc.score.title': 'Internal readiness',
  'cc.score.detail': '{met} of {applicable} applicable requirements met',
  'cc.score.none': 'No applicable requirements yet',
  'cc.score.notApplicable': 'Not applicable (not counted): {count}',
  'cc.score.label': 'Internal readiness {percent} percent: {met} of {applicable} met',
  'cc.status.title': 'Requirements by status',

  'cc.sites.title': 'Readiness by site',
  'cc.sites.site': 'Site',
  'cc.sites.score': 'Readiness',
  'cc.sites.met': 'Met',
  'cc.sites.overdue': 'Overdue',
  'cc.sites.missing': 'Missing evidence',
  'cc.sites.ratio': '{met} of {applicable}',
  'cc.sites.noScore': 'Nothing applicable',

  'cc.priorities.title': 'Today’s priorities',
  'cc.priorities.viewAll': 'View all priorities',
  'cc.priorities.none': 'Nothing needs attention today.',
  'cc.priorities.clear.title': 'You’re all caught up',
  'cc.priorities.clear.body':
    'No requirement is overdue, due soon, or missing evidence. Check the calendar for what comes next.',
  'cc.priorities.clear.action': 'Open the calendar',
  'cc.group.overdue': 'Overdue',
  'cc.group.overdue.hint': 'Past the due date. Start here.',
  'cc.group.this_week': 'Due this week',
  'cc.group.this_week.hint': 'Due in the next 7 days.',
  'cc.group.missing': 'Missing evidence',
  'cc.group.missing.hint': 'No evidence on file yet.',
  'cc.group.coming_up': 'Coming up',
  'cc.group.coming_up.hint': 'Due soon, after this week.',
  'cc.group.count.one': '{count} requirement',
  'cc.group.count.other': '{count} requirements',

  'cc.due.overdue.one': '{count} day overdue',
  'cc.due.overdue.other': '{count} days overdue',
  'cc.due.today': 'Due today',
  'cc.due.in.one': 'Due in {count} day',
  'cc.due.in.other': 'Due in {count} days',
  'cc.due.none': 'No due date',
  'cc.item.owner': 'Owner',
  'cc.item.noOwner': 'No owner',
  'cc.item.appliesTo': 'Applies to',
  'cc.item.open': 'Open requirement {id}',

  'cc.upcoming.title': 'Due in the next 30 days',
  'cc.upcoming.none': 'Nothing is due in the next 30 days.',
  'cc.upcoming.viewCalendar': 'Open the calendar',
  'cc.changes.title': 'What changed',
  'cc.changes.body':
    'A day-by-day list of status changes arrives with readiness snapshots. Until then, each requirement’s History tab shows its changes.',
  'cc.briefCard.title': 'Deemed briefs',
  'cc.briefCard.body': 'A plain summary of readiness this week, ready to share with leadership.',
  'cc.briefCard.open': 'Read the readiness brief',

  'cc.brief.title': 'Readiness brief',
  'cc.brief.asOf': 'As of {date}',
  'cc.brief.computed':
    'Computed from your records, not written by AI. AI-drafted briefs come later with the Deemed Assistant.',
  'cc.brief.print': 'Print',
  'cc.brief.summary': 'Summary',
  'cc.brief.score':
    'Internal readiness is {percent}%: {met} of {applicable} applicable requirements are met.',
  'cc.brief.scoreNone': 'No applicable requirements are tracked yet.',
  'cc.brief.counts':
    'Overdue: {overdue}. Missing evidence: {missing}. Due soon: {dueSoon}. Not applicable: {notApplicable}.',
  'cc.brief.focus': 'Where to focus',
  'cc.brief.focusRow': '{overdue} overdue, {missing} missing evidence',
  'cc.brief.focusNone': 'No site has overdue requirements or missing evidence.',
  'cc.brief.upcoming': 'Due in the next 30 days',
  'cc.brief.upcomingNone': 'Nothing is due in the next 30 days.',

  'cc.calendar.prev': 'Previous month',
  'cc.calendar.next': 'Next month',
  'cc.calendar.thisMonth': 'This month',
  'cc.calendar.today': 'Today',
  'cc.calendar.more.one': '+{count} more',
  'cc.calendar.more.other': '+{count} more',
  'cc.calendar.dueCount.one': '{count} due',
  'cc.calendar.dueCount.other': '{count} due',
  'cc.calendar.list': 'Due in {month}',
  'cc.calendar.listNone': 'Nothing is due this month.',
} as const;
