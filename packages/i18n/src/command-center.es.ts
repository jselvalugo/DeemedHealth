// Spanish catalog for the Command Center pages (see command-center.en.ts). ux-content-writer
// owns the final copy; Florida Spanish, usted form, plain language.
import type { commandCenterEn } from './command-center.en.js';

export const commandCenterEs: Record<keyof typeof commandCenterEn, string> = {
  'cc.overview.description':
    'Dónde está hoy su centro de salud, qué necesita atención y qué vence después.',
  'cc.priorities.description':
    'Todo lo que aún no se cumple, en el orden en que debe atenderlo: primero lo vencido.',
  'cc.briefs.description':
    'Un resumen sencillo de la preparación que puede leer en dos minutos y compartir.',
  'cc.calendar.description': 'Cada fecha de vencimiento de requisitos, mes por mes.',

  'cc.disclaimer':
    'Preparación interna según sus propios registros. No es una determinación de HRSA, y los requisitos son borradores hasta que se verifiquen.',
  'cc.loading': 'Cargando la preparación…',
  'cc.error.title': 'No pudimos cargar la preparación',
  'cc.error.body': 'Revise su conexión e inténtelo de nuevo. No se cambió nada.',
  'cc.retry': 'Intentar de nuevo',
  'cc.noReadiness.title': 'La preparación no forma parte de su rol',
  'cc.noReadiness.body':
    'El Centro de mando resume la Preparación HRSA. Pida acceso a su oficial de cumplimiento si lo necesita.',
  'cc.empty.title': 'Aún no hay requisitos en seguimiento',
  'cc.empty.body':
    'Cuando se apliquen requisitos a su centro de salud, sus sitios y su personal, su estado aparecerá aquí.',
  'cc.empty.action': 'Abrir Requisitos',
  'cc.truncated': 'Se muestran los primeros {count} requisitos. Abra Requisitos para verlos todos.',
  'cc.lastChecked': 'Estado revisado por última vez {time}',
  'cc.lastChecked.never': 'Estado aún no revisado',

  'cc.score.title': 'Preparación interna',
  'cc.score.detail': '{met} de {applicable} requisitos aplicables cumplidos',
  'cc.score.none': 'Aún no hay requisitos aplicables',
  'cc.score.notApplicable': 'No aplica (no se cuenta): {count}',
  'cc.score.label': 'Preparación interna {percent} por ciento: {met} de {applicable} cumplidos',
  'cc.status.title': 'Requisitos por estado',

  'cc.sites.title': 'Preparación por sitio',
  'cc.sites.site': 'Sitio',
  'cc.sites.score': 'Preparación',
  'cc.sites.met': 'Cumplidos',
  'cc.sites.overdue': 'Vencidos',
  'cc.sites.missing': 'Falta evidencia',
  'cc.sites.ratio': '{met} de {applicable}',
  'cc.sites.noScore': 'Nada aplicable',

  'cc.priorities.title': 'Prioridades de hoy',
  'cc.priorities.viewAll': 'Ver todas las prioridades',
  'cc.priorities.none': 'Nada necesita atención hoy.',
  'cc.priorities.clear.title': 'Está al día',
  'cc.priorities.clear.body':
    'Ningún requisito está vencido, por vencer ni sin evidencia. Consulte el calendario para ver lo que viene.',
  'cc.priorities.clear.action': 'Abrir el calendario',
  'cc.group.overdue': 'Vencidos',
  'cc.group.overdue.hint': 'Pasó la fecha de vencimiento. Empiece aquí.',
  'cc.group.this_week': 'Vencen esta semana',
  'cc.group.this_week.hint': 'Vencen en los próximos 7 días.',
  'cc.group.missing': 'Falta evidencia',
  'cc.group.missing.hint': 'Aún no hay evidencia registrada.',
  'cc.group.coming_up': 'Próximos',
  'cc.group.coming_up.hint': 'Vencen pronto, después de esta semana.',
  'cc.group.count.one': '{count} requisito',
  'cc.group.count.other': '{count} requisitos',

  'cc.due.overdue.one': 'Vencido hace {count} día',
  'cc.due.overdue.other': 'Vencido hace {count} días',
  'cc.due.today': 'Vence hoy',
  'cc.due.in.one': 'Vence en {count} día',
  'cc.due.in.other': 'Vence en {count} días',
  'cc.due.none': 'Sin fecha de vencimiento',
  'cc.item.owner': 'Responsable',
  'cc.item.noOwner': 'Sin responsable',
  'cc.item.appliesTo': 'Se aplica a',
  'cc.item.open': 'Abrir el requisito {id}',

  'cc.upcoming.title': 'Vencen en los próximos 30 días',
  'cc.upcoming.none': 'Nada vence en los próximos 30 días.',
  'cc.upcoming.viewCalendar': 'Abrir el calendario',
  'cc.changes.title': 'Qué cambió',
  'cc.changes.body':
    'La lista diaria de cambios de estado llegará con las instantáneas de preparación. Mientras tanto, la pestaña Historial de cada requisito muestra sus cambios.',
  'cc.briefCard.title': 'Resúmenes de Deemed',
  'cc.briefCard.body':
    'Un resumen sencillo de la preparación de esta semana, listo para compartir con la dirección.',
  'cc.briefCard.open': 'Leer el resumen de preparación',

  'cc.brief.title': 'Resumen de preparación',
  'cc.brief.asOf': 'Al {date}',
  'cc.brief.computed':
    'Calculado a partir de sus registros, no escrito por IA. Los resúmenes redactados por IA llegarán más adelante con el Asistente Deemed.',
  'cc.brief.print': 'Imprimir',
  'cc.brief.summary': 'Resumen',
  'cc.brief.score':
    'La preparación interna es del {percent}%: se cumplen {met} de {applicable} requisitos aplicables.',
  'cc.brief.scoreNone': 'Aún no hay requisitos aplicables en seguimiento.',
  'cc.brief.counts':
    'Vencidos: {overdue}. Falta evidencia: {missing}. Por vencer: {dueSoon}. No aplica: {notApplicable}.',
  'cc.brief.focus': 'Dónde enfocarse',
  'cc.brief.focusRow': '{overdue} vencidos, {missing} sin evidencia',
  'cc.brief.focusNone': 'Ningún sitio tiene requisitos vencidos ni sin evidencia.',
  'cc.brief.upcoming': 'Vencen en los próximos 30 días',
  'cc.brief.upcomingNone': 'Nada vence en los próximos 30 días.',

  'cc.calendar.prev': 'Mes anterior',
  'cc.calendar.next': 'Mes siguiente',
  'cc.calendar.thisMonth': 'Este mes',
  'cc.calendar.today': 'Hoy',
  'cc.calendar.more.one': '+{count} más',
  'cc.calendar.more.other': '+{count} más',
  'cc.calendar.dueCount.one': '{count} vence',
  'cc.calendar.dueCount.other': '{count} vencen',
  'cc.calendar.list': 'Vencen en {month}',
  'cc.calendar.listNone': 'Nada vence este mes.',
};
