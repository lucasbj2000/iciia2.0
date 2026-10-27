# IMPAR · conexión segura a WhatsApp Cloud API (Meta)
Estado: integración preparada en código, **no conectada a un número**.

## Antes de comenzar
- El número y la WABA deben estar habilitados; si Meta restringió la cuenta o el número, resolver esa restricción con Meta antes de intentar la conexión.
- Confirmar con el administrador si la app y la WABA pertenecen a la misma organización y si existe un proveedor BSP gestionando el número.
- Obtener por canal seguro: Phone Number ID, WABA ID, token de usuario de sistema con permisos `whatsapp_business_messaging` y `whatsapp_business_management`, y Meta App Secret de la **misma app**.
- No colocar tokens ni secretos en GitHub, correos no cifrados, screenshots ni chats.

## Hostinger
1. Publicar la revisión aprobada mediante `IMPAR_OBJETIVO_SHA=<SHA> bash scripts/actualizar.sh`.
2. Dentro de `/opt/iciia-crm`, ejecutar `node scripts/preparar-meta-impar.mjs` para generar `META_VERIFY_TOKEN` y `META_TOKEN_ENCRYPTION_KEY` sin mostrar sus valores.
3. Incorporar `META_APP_SECRET=...` en el archivo `.env` con permisos 600. No compartir su contenido.
4. Reiniciar exclusivamente `iciia-crm` con PM2 para cargar las variables. Hacerlo fuera del horario crítico y comprobar `/api/health`.
5. Respaldar el `.env` de forma segura: **la clave AES es necesaria para poder recuperar tokens cifrados**.

## Meta Developers / WhatsApp
- Callback: `https://crm.iciia.tech/webhook/meta`
- Verify token: leer en IMPAR → Administración → Canales → Webhook.
- App Secret: definido exclusivamente en Hostinger.
- Suscribir el campo **messages** de WhatsApp. Si la app aún no está suscrita a la WABA, el administrador debe completar esa suscripción desde la plataforma de Meta.
- Verificar que las notificaciones lleguen a la misma app cuya firma HMAC acepta el CRM.

## CRM IMPAR
1. Administración → Canales → Agregar canal → **WhatsApp Cloud API**.
2. Ingresar nombre, Phone Number ID, WABA ID y token de usuario del sistema.
3. Guardar: el canal se crea **inactivo** y el token se almacena cifrado con AES-256-GCM.
4. Probar credenciales. El resultado positivo valida los permisos de lectura del número, **no** garantiza entrega ni recepciones todavía.
5. Configurar Webhook en Meta. Activar el canal temporalmente para una prueba real con un número autorizado; confirmar mensaje entrante, respuesta saliente, imagen/PDF y estados de envío.
6. Solo después de pruebas reales, decidir si se configura como línea principal. **Las negociaciones existentes conservan su canal original**; migrarlas requiere una operación posterior explícita, con plan y respaldos.

## Límites de funcionamiento
- La integración actual recibe textos, medios y ubicación, y responde con texto y adjuntos por la API.
- Fuera de la ventana de atención de 24 horas, WhatsApp exige plantillas aprobadas para iniciar/reabrir la conversación. El flujo de plantillas requiere implementación y pruebas específicas antes de depender de él.
- La aceptación HTTP de Meta no significa mensaje entregado; leer los estados asíncronos `sent`, `delivered`, `read` y `failed`.
- No se desvincula ni se borra `auth/`; jamás usar la API para saltarse una suspensión de Meta.
- Los eventos entrantes se guardan en la cola PostgreSQL antes de responder 200; los eventos que fallan repetidamente quedan en cuarentena para su evaluación.
