import type { modulesEn } from './modules.en.js';

// Spanish module and page names. Draft for ux-content-writer review.
export const modulesEs: Record<keyof typeof modulesEn, string> = {
  'module.command-center.name': 'Centro de mando',
  'module.command-center.description':
    'La preparación diaria en cada requisito, las prioridades de hoy y lo que cambió.',
  'page.command-center.overview': 'Resumen',
  'page.command-center.priorities': 'Prioridades de hoy',
  'page.command-center.briefs': 'Informes de preparación',
  'page.command-center.calendar': 'Calendario',

  'module.readiness.name': 'Preparación HRSA',
  'module.readiness.description':
    'El estado de cada requisito, la evidencia, los hallazgos y la preparación para la visita al sitio.',
  'page.readiness.requirements': 'Requisitos',
  'page.readiness.evidence': 'Biblioteca de evidencia',
  'page.readiness.findings': 'Hallazgos y condiciones',
  'page.readiness.osv': 'Preparación de la visita',
  'page.readiness.policy-updates': 'Actualizaciones de políticas',

  'module.providers.name': 'Proveedores y credenciales',
  'module.providers.description':
    'Expedientes de proveedores, verificación de fuente primaria, privilegios y vencimientos.',
  'page.providers.providers': 'Proveedores',
  'page.providers.credentialing': 'Credenciales',
  'page.providers.privileging': 'Privilegios',
  'page.providers.expirations': 'Vencimientos',
  'page.providers.committee': 'Revisión del comité',

  'module.enrollment.name': 'Inscripción',
  'module.enrollment.description':
    'Inscripción con pagadores, reasignaciones, revalidación y fechas de vigencia por proveedor y sitio.',
  'page.enrollment.board': 'Tablero de inscripción',
  'page.enrollment.payers': 'Pagadores',
  'page.enrollment.revalidations': 'Revalidaciones',
  'page.enrollment.applications': 'Solicitudes',

  'module.screening.name': 'Verificación de exclusiones',
  'module.screening.description':
    'Verificación en las listas de exclusión de OIG, SAM y el estado para el personal, la junta y los proveedores de servicios.',
  'page.screening.runs': 'Verificaciones realizadas',
  'page.screening.matches': 'Posibles coincidencias',
  'page.screening.history': 'Historial de verificaciones',

  'module.governance.name': 'Gobernanza',
  'module.governance.description':
    'Miembros y composición de la junta, reuniones, actas, aprobaciones y conflictos de interés.',
  'page.governance.board': 'Miembros de la junta',
  'page.governance.meetings': 'Reuniones y actas',
  'page.governance.approvals': 'Registro de aprobaciones',
  'page.governance.coi': 'Conflicto de interés',
  'page.governance.policies': 'Políticas',

  'module.scope.name': 'Alcance y sitios',
  'module.scope.description':
    'Servicios del Formulario 5A, sitios del 5B, actividades del 5C, horarios y solicitudes de cambio de alcance.',
  'page.scope.services': 'Servicios (5A)',
  'page.scope.sites': 'Sitios (5B)',
  'page.scope.activities': 'Otras actividades (5C)',
  'page.scope.changes': 'Cambio de alcance',
  'page.scope.hours': 'Horarios y cobertura',

  'module.contracts.name': 'Contratos y acuerdos',
  'module.contracts.description':
    'Contratos, subadjudicaciones y acuerdos de referido y de colaboración con las cláusulas requeridas.',
  'page.contracts.contracts': 'Contratos',
  'page.contracts.subawards': 'Subadjudicaciones',
  'page.contracts.collaborations': 'Relaciones de colaboración',
  'page.contracts.renewals': 'Renovaciones',

  'module.finance.name': 'Finanzas y subvenciones',
  'module.finance.description':
    'Programa de tarifas escalonadas, políticas de facturación y cobro, presupuesto y controles financieros.',
  'page.finance.sfdp': 'Programa de tarifas escalonadas',
  'page.finance.billing': 'Facturación y cobros',
  'page.finance.budget': 'Presupuesto',
  'page.finance.grants': 'Informes de subvenciones',
  'page.finance.audit': 'Auditoría',

  'module.ftca.name': 'FTCA y riesgos',
  'module.ftca.description':
    'Preparación para la cobertura FTCA, evaluaciones de riesgo, capacitación, reclamaciones y sistemas de seguimiento.',
  'page.ftca.deeming': 'Solicitud de cobertura FTCA',
  'page.ftca.risk': 'Evaluaciones de riesgo',
  'page.ftca.incidents': 'Incidentes',
  'page.ftca.claims': 'Reclamaciones',
  'page.ftca.tracking': 'Sistemas de seguimiento',

  'module.quality.name': 'Calidad y UDS',
  'module.quality.description':
    'Programa de QI/QA, medidas clínicas, revisión por pares y preparación del informe UDS.',
  'page.quality.plan': 'Plan de QI/QA',
  'page.quality.measures': 'Medidas',
  'page.quality.peer-review': 'Revisión por pares',
  'page.quality.uds': 'UDS',
  'page.quality.needs-assessment': 'Evaluación de necesidades',

  'module.experience.name': 'Experiencia del paciente',
  'module.experience.description':
    'Encuestas a pacientes, quejas y tendencias de comentarios que se informan a la junta.',
  'page.experience.surveys': 'Encuestas',
  'page.experience.grievances': 'Quejas',
  'page.experience.trends': 'Tendencias',

  'module.learning.name': 'Aprendizaje',
  'module.learning.description':
    'Capacitaciones requeridas, asignaciones y evidencia de finalización por rol.',
  'page.learning.catalog': 'Catálogo',
  'page.learning.assignments': 'Asignaciones',
  'page.learning.completions': 'Finalizaciones',

  'module.tasks.name': 'Tareas y flujos de trabajo',
  'module.tasks.description':
    'Cada acción pendiente en todos los módulos, con responsables, fechas límite y aprobaciones.',
  'page.tasks.mine': 'Mis tareas',
  'page.tasks.team': 'Cola del equipo',
  'page.tasks.workflows': 'Flujos de trabajo',
  'page.tasks.approvals': 'Aprobaciones',

  'module.self-service.name': 'Autoservicio',
  'module.self-service.description':
    'El personal y los miembros de la junta actualizan sus propios documentos, declaraciones y capacitaciones.',
  'page.self-service.profile': 'Mi perfil',
  'page.self-service.documents': 'Mis documentos',
  'page.self-service.attestations': 'Mis declaraciones',

  'module.admin.name': 'Administración',
  'module.admin.description':
    'Usuarios, roles, sitios, integraciones, registro de auditoría y configuración del centro de salud.',
  'page.admin.users': 'Usuarios y roles',
  'page.admin.org': 'Organización y sitios',
  'page.admin.integrations': 'Integraciones',
  'page.admin.catalog': 'Catálogo de requisitos',
  'page.admin.audit': 'Registro de auditoría',
  'page.admin.supportAccess': 'Acceso de soporte',
};
