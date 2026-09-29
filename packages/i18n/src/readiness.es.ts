// Spanish readiness strings (S4). Draft translation by backend-engineer; ux-content-writer
// owns the final copy. Same keys and {placeholders} as readiness.en.ts.
import type { readinessEn } from './readiness.en.js';

export const readinessEs: Record<keyof typeof readinessEn, string> = {
  'readiness.status.met': 'Cumplido',
  'readiness.status.due_soon': 'En riesgo (vence pronto)',
  'readiness.status.overdue': 'No cumplido (vencido)',
  'readiness.status.missing': 'No cumplido (falta evidencia)',
  'readiness.status.not_applicable': 'No aplica',
  'readiness.status.not_assessed': 'Sin evaluar',

  'readiness.label.hrsa': 'Estado de preparación interno; no es una determinación de HRSA.',
  'readiness.label.florida':
    'Requisito de Florida. Estado de preparación interno; no es una determinación de HRSA ni del Estado de Florida.',
  'readiness.label.best_practice':
    'Buena práctica, no es un requisito de HRSA. Estado de preparación interno; no es una determinación de HRSA.',

  'readiness.reason.no_catalog_release':
    'Sin evaluar: todavía no hay una versión del catálogo publicada en este entorno.',
  'readiness.reason.not_in_catalog':
    'Sin evaluar: este requisito no está en el catálogo {catalogVersion} de este entorno.',
  'readiness.reason.entry_not_verified':
    'Sin evaluar: esta entrada del catálogo no está verificada, así que producción no la evalúa.',
  'readiness.reason.entry_retired':
    'Sin evaluar: este requisito se retiró en el catálogo {catalogVersion}.',
  'readiness.reason.not_effective': 'Sin evaluar: este requisito no está vigente el {asOfDate}.',
  'readiness.reason.outside_applicability':
    'Sin evaluar: este requisito no aplica a este caso ({dimension}).',
  'readiness.reason.marked_not_applicable':
    'Marcado como no aplica el {decidedOn}, con un motivo registrado.',
  'readiness.reason.na_superseded_needs_review':
    'Hay una marca de "no aplica", pero esta versión del catálogo no la permite. La marca se conserva; revísela.',
  'readiness.reason.tenant_parameter_unset':
    'Sin evaluar: defina "{parameter}" para su centro de salud (se permite de {min} a {max}).',
  'readiness.reason.tenant_parameter_out_of_bounds':
    'Sin evaluar: su valor para "{parameter}" ({value}) está fuera del rango permitido de {min} a {max}.',
  'readiness.reason.rule_unresolved':
    'Sin evaluar: la entrada del catálogo no tiene una regla que el sistema pueda evaluar.',
  'readiness.reason.no_evidence': 'No hay evidencia válida registrada.',
  'readiness.reason.approval_capacity_insufficient':
    'Una aprobación registrada no se hizo con la autoridad requerida ({required}).',
  'readiness.reason.approval_rejected': 'La decisión de aprobación más reciente fue un rechazo.',
  'readiness.reason.approval_type_missing':
    'Una aprobación registrada no indica qué aprobó, así que no cuenta.',
  'readiness.reason.valid_through': 'Vigente hasta el {date}.',
  'readiness.reason.expires_today':
    'Vence hoy ({date}); vigente hasta la medianoche, hora del sitio.',
  'readiness.reason.expired': 'Venció el {date}.',
  'readiness.reason.due_on': 'Próximo vencimiento: {date}.',
  'readiness.reason.due_today': 'Vence hoy ({date}).',
  'readiness.reason.past_due': 'Vencía el {date}.',
  'readiness.reason.lead_tier': 'Dentro del aviso de {days} días.',
  'readiness.reason.period_satisfied': 'Cumplido para el período del {periodStart} al {periodEnd}.',
  'readiness.reason.period_pending': 'Vence el {periodEnd} para el período actual.',
  'readiness.reason.period_missed':
    'No hay nada registrado para el período del {periodStart} al {periodEnd}.',
  'readiness.reason.evidence_on_file': 'Evidencia registrada, con fecha del {date}.',
  'readiness.reason.changed_since_evidence':
    'El dato de base cambió el {date}, después de la evidencia registrada.',
  'readiness.reason.draft_entry':
    'Entrada de catálogo en borrador (no verificada): solo se muestra fuera de producción.',
};
