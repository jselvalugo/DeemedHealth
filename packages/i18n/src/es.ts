import type { en } from './en.js';

// Spanish catalog. Draft for ux-content-writer review. Spanish runs 20–30% longer;
// layouts must leave room for it.
export const es: Record<keyof typeof en, string> = {
  'preview.banner':
    'VISTA PREVIA · Solo datos sintéticos. No ingrese información real de pacientes.',
  'preview.label': 'Entorno de vista previa',

  'landing.title': 'Deemed Health — Software de cumplimiento para FQHC',
  'landing.subtitle': 'Vista previa de desarrollo',

  'app.name': 'Deemed Health',
  'app.tagline': 'Software de cumplimiento para FQHC',
  'skip.main': 'Saltar al contenido principal',
  'header.home': 'Inicio de Deemed Health',
  'header.search': 'Ir a un módulo o página',
  'header.searchShortcut': 'Atajo de teclado: {keys}',
  'header.tenantEyebrow': 'Centro de salud',
  'header.tenantLogo': 'Logotipo de {name}',
  'header.userMenu': 'Menú de la cuenta de {name}',
  'userMenu.signedInAs': 'Sesión iniciada como',
  'userMenu.profile': 'Perfil',
  'userMenu.language': 'Idioma',
  'userMenu.switchCenter': 'Cambiar de centro de salud',
  'userMenu.switchCenterNone': 'Usted pertenece a un solo centro de salud.',
  'userMenu.signOut': 'Cerrar sesión',
  'language.label': 'Idioma',
  'language.en': 'English',
  'language.es': 'Español',
  'moduleBar.label': 'Módulos',
  'moduleBar.placeholder': 'Los módulos aparecerán aquí.',
  'moduleBar.switcher': 'Cambiar de módulo. Actual: {module}',
  'moduleBar.switcherNone': 'Cambiar de módulo',
  'moduleBar.pages': 'Páginas de {module}',
  'moduleBar.more': 'Más',
  'moduleBar.moreLabel': 'Más páginas de {module}',

  'launcher.title': 'Ir a un módulo o página',
  'launcher.placeholder': 'Ir a un módulo o página…',
  'launcher.close': 'Cerrar',
  'launcher.results': 'Módulos y páginas',
  'launcher.colModule': 'Módulo',
  'launcher.colPages': 'Páginas',
  'launcher.current': 'Actual',
  'launcher.modules.one': '{count} módulo',
  'launcher.modules.other': '{count} módulos',
  'launcher.pages.one': '{count} página',
  'launcher.pages.other': '{count} páginas',
  'launcher.keyTab': 'Tab',
  'launcher.keyEnter': 'Intro',
  'launcher.keyEsc': 'Esc',
  'launcher.hintMove': 'mover',
  'launcher.hintOpen': 'abrir',
  'launcher.hintClose': 'cerrar',
  'launcher.empty': 'Ningún módulo o página coincide con “{query}”.',
  'launcher.emptyHint': 'Revise la ortografía o pruebe con una palabra más corta.',
  'launcher.noAccess': 'Todavía no tiene acceso a ningún módulo. Pídaselo a su administrador.',
  'launcher.instructions':
    'Escriba para filtrar. Use las flechas o Tab para moverse, Intro para abrir y Escape para cerrar.',
  'launcher.pageOf': '{page}, {module}',

  'status.ok': 'En cumplimiento',
  'status.warn': 'Vence pronto',
  'status.critical': 'Fuera de cumplimiento',
  'status.info': 'En revisión',
  'status.neutral': 'Sin comenzar',
  'status.planned': 'Planificado',
  'release.mvp': 'MVP',
  'release.next': 'Próxima versión',
  'release.planned': 'Planificado',

  'role.org_admin.name': 'Administrador del centro de salud',
  'role.executive.name': 'Ejecutivo',
  'role.compliance_officer.name': 'Oficial de cumplimiento',
  'role.credentialing_coordinator.name': 'Coordinador de credenciales',
  'role.board_liaison.name': 'Enlace con la junta',
  'role.board_member.name': 'Miembro de la junta',
  'role.qi_risk_manager.name': 'Gerente de calidad y riesgos',
  'role.finance.name': 'Finanzas',
  'role.staff_provider.name': 'Personal / proveedor',
  'role.auditor.name': 'Auditor (acceso temporal)',

  'home.greeting': 'Hola, {name}',
  'placeholder.eyebrow': '{module} · {tenant}',
  'placeholder.empty.title': 'Aún no hay nada aquí',
  'placeholder.empty.body':
    '{page} mostrará los datos de su centro de salud cuando se conecte el servicio de {module}. Esta vista previa usa solo datos sintéticos.',
  'placeholder.release': 'Versión',
  'placeholder.wiki': 'Wiki',
  'placeholder.openLauncher': 'Ir a un módulo o página',
  'howItWorks.title': 'Cómo funciona Deemed Health',
  'howItWorks.step1.title': 'Configure su centro de salud',
  'howItWorks.step1.body':
    'Agregue sus sitios, personas y roles para que cada requisito tenga un responsable.',
  'howItWorks.step2.title': 'Relacione cada requisito',
  'howItWorks.step2.body':
    'Cada requisito de HRSA se sigue con su fuente, su frecuencia y su estado.',
  'howItWorks.step3.title': 'Reúna la evidencia',
  'howItWorks.step3.body':
    'Suba los documentos una sola vez y vincúlelos a los requisitos que demuestran.',
  'howItWorks.step4.title': 'Siga lo que vence',
  'howItWorks.step4.body':
    'Las tareas y los recordatorios mantienen al día las credenciales, las verificaciones y las aprobaciones.',
  'howItWorks.step5.title': 'Esté listo para la visita al sitio',
  'howItWorks.step5.body': 'Vea cómo está cada día, no solo antes de la visita al sitio.',
  'howItWorks.open': 'Abrir {page}',

  'loading.label': 'Cargando…',
  'error.title': 'Algo salió mal',
  'error.body':
    'No pudimos cargar esta página. Inténtelo de nuevo. Si sigue ocurriendo, comuníquese con soporte e indique la hora en que ocurrió.',
  'error.retry': 'Intentar de nuevo',
  'notFound.title': 'No se encontró la página',
  'notFound.body': 'Esta dirección no corresponde a ninguna página de Deemed Health.',
  'notFound.home': 'Ir a su página de inicio',
  'noPermission.title': 'No tiene acceso a esta página',
  'noPermission.body':
    'Su rol no incluye {page}. Si la necesita para su trabajo, pida al administrador de su centro de salud que actualice su rol.',
  'noPermission.bodyGeneric':
    'Su rol no incluye esta página. Si la necesita para su trabajo, pida al administrador de su centro de salud que actualice su rol.',
  'noPermission.badge': 'Sin acceso',
  'noPermission.home': 'Ir a su página de inicio',

  'signIn.title': 'Inicie sesión en Deemed Health',
  'signIn.subtitle': 'Software de cumplimiento para FQHC',
  'signIn.email.label': 'Correo electrónico del trabajo',
  'signIn.email.required': 'Ingrese su correo electrónico del trabajo.',
  'signIn.email.invalid': 'Ingrese un correo electrónico como nombre@sucentro.org.',
  'signIn.continue': 'Continuar',
  'signIn.checking': 'Verificando…',
  'signIn.method.title': 'Elija cómo iniciar sesión',
  'signIn.signingInAs': 'Iniciando sesión como {email}',
  'signIn.changeEmail': 'Usar otro correo electrónico',
  'signIn.sso': 'Continuar con inicio de sesión único (SSO)',
  'signIn.ssoHint': 'Use la cuenta de Microsoft o Google de su centro de salud.',
  'signIn.or': 'o',
  'signIn.password.label': 'Contraseña',
  'signIn.password.required': 'Ingrese su contraseña.',
  'signIn.password.submit': 'Iniciar sesión con contraseña',
  'signIn.cantSignIn': '¿No puede iniciar sesión?',
  'signIn.error.invalid':
    'El correo electrónico y la contraseña no coinciden con nuestros registros.',
  'signIn.error.locked':
    'Esta cuenta está bloqueada por demasiados intentos. Espere 15 minutos o pida al administrador de su centro de salud que la desbloquee.',
  'signIn.error.notImplemented':
    'El inicio de sesión todavía no está disponible. No hay un proveedor de identidad conectado a este entorno.',
  'signIn.error.unexpected': 'No pudimos iniciar su sesión. Inténtelo de nuevo en un momento.',
  'signIn.notice.expired':
    'Su sesión terminó después de 15 minutos sin actividad. Inicie sesión de nuevo para continuar.',
  'signIn.notice.signedOut': 'Cerró la sesión.',
  'signIn.notice.title': 'Aviso',
  'signIn.error.title': 'Hay un problema',
  'signIn.demo':
    'Solo en la vista previa: inicie sesión como demo@xyz-chc.test con cualquier contraseña de 12 caracteres o más y luego use el código 000000. Pruebe coordinator@xyz-chc.test o board@xyz-chc.test para ver menos módulos, y locked@xyz-chc.test para ver el estado bloqueado.',
  'mfa.title': 'Verifique su identidad',
  'mfa.body': 'Su centro de salud exige un segundo paso cada vez que inicia sesión.',
  'mfa.passkey': 'Usar una llave de acceso',
  'mfa.passkeyHint': 'Touch ID, Windows Hello o una llave de seguridad.',
  'mfa.code.label': 'Código de su aplicación de autenticación',
  'mfa.code.hint': 'Ingrese los 6 dígitos que muestra la aplicación.',
  'mfa.code.required': 'Ingrese el código de 6 dígitos.',
  'mfa.code.format': 'El código tiene 6 dígitos, sin espacios ni letras.',
  'mfa.code.invalid':
    'Ese código no funcionó. Los códigos cambian cada 30 segundos; ingrese el más reciente.',
  'mfa.verify': 'Verificar',
  'mfa.verifying': 'Verificando…',
  'mfa.lost': '¿Perdió su llave de acceso o su aplicación de autenticación?',
  'mfa.expired.title': 'Su inicio de sesión expiró',
  'mfa.expired.body':
    'Por su seguridad, el segundo paso debe completarse en un plazo de 10 minutos. Comience de nuevo.',
  'mfa.startAgain': 'Comenzar de nuevo',
  'recovery.title': '¿No puede iniciar sesión?',
  'recovery.body':
    'Si perdió su llave de acceso o su aplicación de autenticación, use uno de los códigos de recuperación que guardó al configurar la verificación en dos pasos.',
  'recovery.email.label': 'Correo electrónico del trabajo',
  'recovery.code.label': 'Código de recuperación',
  'recovery.code.hint': 'Letras y números, como ABCD-EFGH. Cada código funciona una sola vez.',
  'recovery.code.required': 'Ingrese un código de recuperación.',
  'recovery.code.invalid':
    'Ese código de recuperación no funcionó. Cada código se puede usar una sola vez.',
  'recovery.submit': 'Usar código de recuperación',
  'recovery.admin.title': '¿No tiene un código de recuperación?',
  'recovery.admin.body':
    'Pida al administrador de su centro de salud que restablezca sus métodos de inicio de sesión. Por su seguridad, no podemos restablecerlos por correo electrónico ni por teléfono.',
  'recovery.password.title': '¿Olvidó su contraseña?',
  'recovery.password.body':
    'Si su centro de salud usa inicio de sesión único, restablézcala con su equipo de TI. Si no, su administrador puede enviarle un enlace para restablecerla.',
  'recovery.back': 'Volver a iniciar sesión',
  // Configuración del segundo paso al iniciar sesión por primera vez
  'mfa.setup.title': 'Configure la verificación en dos pasos',
  'mfa.setup.body':
    'Su centro de salud exige un segundo paso cada vez que inicia sesión. Elija uno ahora; no puede omitir este paso.',
  'mfa.setup.passkey': 'Crear una llave de acceso',
  'mfa.setup.passkeyHint': 'Recomendado. Usa Touch ID, Windows Hello o una llave de seguridad.',
  'mfa.setup.totp': 'Usar una aplicación de autenticación',
  'mfa.setup.secret.label': 'Clave de configuración para su aplicación de autenticación',
  'mfa.setup.secret.hint':
    'En su aplicación de autenticación, agregue una cuenta e ingrese esta clave. Luego escriba el código de 6 dígitos que aparece.',
  'mfa.setup.token.label': 'Código de configuración de su administrador',
  'mfa.setup.token.hint':
    'Su administrador se lo envía cuando crea su cuenta o restablece sus métodos de inicio de sesión.',
  'mfa.setup.submit': 'Terminar la configuración',

  // Diálogo de nueva autenticación
  'reauth.title': 'Confirme que es usted',
  'reauth.body':
    'Esta acción requiere una verificación reciente. Confirme con su llave de acceso o con un código de su aplicación de autenticación.',
  'reauth.passkey': 'Confirmar con una llave de acceso',
  'reauth.code.label': 'Código de su aplicación de autenticación',
  'reauth.submit': 'Confirmar',
  'reauth.cancel': 'Cancelar',

  'recovery.unavailable':
    'Los códigos de recuperación aún no están disponibles. Pida al administrador de su centro de salud que restablezca sus métodos de inicio de sesión.',

  // Errores de la API
  'apiError.bad_request':
    'Falta información o no tiene el formato correcto. Revise el formulario e intente de nuevo.',
  'apiError.unauthenticated': 'Su sesión está cerrada. Inicie sesión para continuar.',
  'apiError.session_expired': 'Su sesión terminó. Inicie sesión de nuevo para continuar.',
  'apiError.reauth_required': 'Confirme que es usted para continuar.',
  'apiError.mfa_required': 'Complete el segundo paso de inicio de sesión para continuar.',
  'apiError.mfa_enrollment_required': 'Configure la verificación en dos pasos para continuar.',
  'apiError.invalid_credentials': 'El correo y la contraseña no coinciden con nuestros registros.',
  'apiError.invalid_code':
    'Ese código no funcionó. Ingrese el código más reciente de su aplicación.',
  'apiError.too_many_attempts': 'Demasiados intentos. Espere unos minutos e intente de nuevo.',
  'apiError.organization_required': 'Elija el centro de salud al que desea ingresar.',
  'apiError.forbidden': 'Su función no permite esta acción.',
  'apiError.not_found': 'No encontramos ese registro.',
  'apiError.conflict':
    'Este registro cambió o ya se actualizó. Vuelva a cargar e intente de nuevo.',
  'apiError.csrf_failed':
    'No pudimos confirmar que esta solicitud viene de Deemed Health. Vuelva a cargar la página e intente de nuevo.',
  'apiError.payload_too_large':
    'Es demasiado grande para enviarlo. Pruebe con un archivo más pequeño o menos texto.',
  'apiError.unsupported': 'Esta opción no está disponible para su cuenta.',
  'apiError.not_configured':
    'Este entorno aún no está conectado a su base de datos. Intente más tarde.',
  'apiError.enrollment_token_invalid':
    'Ese código de configuración no funcionó. Puede haber vencido o ya se usó. Pida uno nuevo al administrador de su centro de salud.',
  'apiError.internal':
    'Algo salió mal de nuestro lado. Intente de nuevo. Si sigue ocurriendo, comuníquese con soporte e indique el número de referencia.',
};
