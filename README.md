# iciia2.0 — CRM multiempresa omnicanal

CRM de negociaciones con WhatsApp (QR y Cloud API), Facebook Messenger e Instagram Direct.
Node.js + PostgreSQL. Multiusuario real, tiempo real por SSE, canales por sucursal.

---

## Qué incluye

| Módulo | Detalle |
|---|---|
| **Negociaciones** | Kanban con drag & drop, SLA con semáforo, patch por ítem (sin parpadeos) |
| **Canales por sucursal** | Cada sucursal con sus números de WhatsApp y sus redes sociales |
| **Adjuntos** | Imágenes, videos, audios y documentos — en PC y celular, pegando o arrastrando |
| **Direcciones** | Detecta ubicaciones que manda el cliente: GPS, enlaces de mapa y texto escrito |
| **Botones personalizados** | Acciones rápidas configurables en la conversación |
| **Contactos** | Ficha 360°, anti duplicado, solicitudes de contacto, import/export CSV |
| **Comunicación** | Chat interno 1:1 y grupos |
| **Calendario** | Cumpleaños, feriados, actividades, reuniones y capacitaciones |
| **Reportes** | KPIs, embudo, rendimiento por agente y por canal, cola de SLA |
| **Administración** | 39 funciones ON/OFF, 15 notificaciones editables, auditoría completa |

---

## Instalación en un VPS (Hostinger)

**Requisitos:** VPS Ubuntu 22.04 o 24.04 (mínimo 2 vCPU / 8 GB) y un dominio apuntando a la IP.

```bash
ssh root@TU_IP
git clone https://github.com/TU_USUARIO/iciia-crm.git /opt/iciia-crm
cd /opt/iciia-crm
sudo bash scripts/instalar-vps.sh crm.tudominio.com tu@email.com
```

El script instala Node 20, PostgreSQL, Nginx, PM2 y Certbot; crea la base, genera el `.env` con
claves aleatorias, configura el proxy y emite el SSL. Al terminar imprime la contraseña del
administrador y el token del webhook: **guardalos y cambiá la clave al entrar**.

> Antes de correrlo, el dominio ya tiene que resolver a la IP del VPS. Si no, Certbot falla.

---

## Conectar los canales

### WhatsApp por QR (lo más rápido)

1. **Administración → Canales** → elegí la sucursal → **Agregar canal** → *WhatsApp (QR)*
2. Poné un nombre (ej. *WhatsApp Ventas Central*) y guardá.
3. Tocá **Vincular** y escaneá desde el celular de esa sucursal:
   WhatsApp → Menú ⋮ → Dispositivos vinculados → Vincular un dispositivo.

La sesión queda en `auth/` y se reconecta sola. No hay que volver a escanear tras un reinicio.

### WhatsApp Cloud API · Messenger · Instagram

Los tres usan el mismo webhook de Meta.

1. En [developers.facebook.com](https://developers.facebook.com) creá una app tipo *Business*.
2. **Webhooks → Editar suscripción:**
   - URL de callback: `https://tu-dominio.com/webhook/meta`
   - Token de verificación: el `META_VERIFY_TOKEN` de tu `.env` (lo copiás desde el panel de Canales)
   - Campos: `messages` (y `messaging_postbacks` en Messenger)
3. Copiá el **App Secret** a `META_APP_SECRET` en `.env` y reiniciá (`pm2 restart iciia-crm`).
4. En **Administración → Canales**, agregá el canal en su sucursal con las credenciales:

| Canal | Datos necesarios | Dónde se obtienen |
|---|---|---|
| WhatsApp Cloud API | Token permanente + Phone Number ID | App → WhatsApp → Configuración de la API |
| Messenger | Token de página + Page ID | App → Messenger → Configuración |
| Instagram | Token de página + Instagram ID | Cuenta profesional vinculada a una página |

El sistema **verifica las credenciales al crear el canal** y te avisa si algo falla. También podés
revalidar cuando quieras con el botón *Probar*.

> Para producción usá un token permanente de usuario del sistema, no el temporal de 24 horas.

---

## Canales por sucursal

Cada canal pertenece a una sucursal (o a ninguna, si atiende a toda la empresa). Cuando entra un
mensaje, el sistema busca un agente **disponible de esa sucursal**; si no hay, amplía a toda la
sucursal sin filtrar por línea y, como último recurso, a toda la empresa. Así el WhatsApp de la
sucursal Norte no le cae a un agente de Central.

Se controla con la función *Asignar por sucursal del canal* en **Funciones ON/OFF**.

---

## Adjuntos

Tres formas de adjuntar, idénticas en PC y celular:

- **Botón 📎** → menú con cámara, galería, documento o explorador. En el celular abre la cámara directamente.
- **Pegar** → Ctrl+V sobre el campo de mensaje, o la opción *Pegar del portapapeles* del menú.
- **Arrastrar** → soltás el archivo sobre la conversación.

Se envían por los cuatro canales con el texto como pie de foto. Lo que manda el cliente también se
descarga y queda guardado en tu servidor, así sigue disponible aunque el enlace de Meta expire.

Las **respuestas rápidas admiten imagen o archivo**: por ejemplo una plantilla «Lista de precios»
con el PDF ya adjunto.

| Tipo | Formatos | Límite de WhatsApp |
|---|---|---|
| Imagen | JPG, PNG, WebP, GIF, HEIC | 5 MB |
| Video | MP4, MOV, WebM, 3GP | 16 MB |
| Audio | MP3, OGG, M4A, AAC, WAV | 16 MB |
| Documento | PDF, Word, Excel, PowerPoint, TXT, CSV, ZIP, RAR | 100 MB |

Límite general configurable con `MAX_UPLOAD_MB` (16 MB por defecto). Si cambiás ese valor, ajustá
también `client_max_body_size` en Nginx.

---

## Detección de direcciones

Cuando el cliente manda una ubicación, el sistema la identifica de tres formas:

| Fuente | Qué detecta | Confianza |
|---|---|---|
| 🛰 GPS | Ubicación nativa de WhatsApp o Messenger | Alta |
| 🔗 Enlace | Google Maps, Apple Maps, Waze, OpenStreetMap | Alta si trae coordenadas |
| ✍️ Texto | «Av. Mcal. López 1234», «Palma casi Chile», «barrio San Roque manzana 4» | Según el detalle |

Las direcciones escritas se geocodifican para ubicarlas en el mapa. Todo queda en la ficha del
contacto y en un panel de **Administración → Direcciones**. El agente puede confirmar cuál es la
dirección definitiva con un clic.

---

## Botones personalizados

En **Administración → Botones** configurás hasta 12 accesos rápidos que los agentes ven arriba del
campo de mensaje. Cada uno tiene ícono, texto, color y una acción:

| Acción | Qué hace |
|---|---|
| Insertar mensaje | Carga un texto predefinido en el campo |
| Enviar catálogo | Inserta el link de stock configurado |
| Mover de etapa | Cambia la negociación de columna |
| Detectar dirección | Analiza el último mensaje buscando una ubicación |
| Adjuntar archivo | Abre el selector de archivos |

Se reordenan arrastrando y hay vista previa en vivo.

---

## Reglas de negocio (validadas en el servidor)

- **Cerrado Ganado exige el monto** de cierre; el resto de cierres pide motivo.
- **Un cliente no puede tener dos negociaciones abiertas.** Si vuelve a escribir, el mensaje entra en la existente.
- **El bot se apaga** apenas responde una persona.
- **Asignación equitativa** por menor carga, priorizando la sucursal del canal.
- **SLA configurable** en horas laborales, con aviso previo y cierre automático.
- **Aislamiento total entre empresas**: las 109 consultas que tocan datos filtran por `empresa_id`.

Todo se activa o desactiva desde **Funciones ON/OFF**.

---

## Garantía de mensajería

1. El mensaje entrante se guarda en `inbox` **antes** de procesarse, con índice único `(canal_id, ext_id)`.
2. Un worker lo convierte en negociación y recién ahí lo marca como procesado.
3. Si falla, reintenta 3 veces; luego pasa a **cuarentena visible** con opción de cargarlo a mano.
4. Los envíos fallidos quedan en `outbox` y se reintentan hasta 8 veces al reconectar.
5. Las sesiones de WhatsApp se pre-levantan al arrancar y un vigilante las revisa cada minuto.

---

## Operación

```bash
pm2 logs iciia-crm          # ver logs
pm2 restart iciia-crm       # reiniciar
node scripts/verificar.mjs  # verificar el código antes de desplegar
bash scripts/actualizar.sh  # actualizar desde GitHub
bash scripts/backup.sh      # respaldar base, sesiones y adjuntos
curl https://tu-dominio.com/api/health
```

Respaldo diario automático:
```bash
(crontab -l 2>/dev/null; echo "0 3 * * * cd /opt/iciia-crm && bash scripts/backup.sh") | crontab -
```

---

## Seguridad

- Contraseñas con bcrypt (cost 12) · sesiones JWT con expiración
- Helmet con CSP, rate limit en el login, firma HMAC en los webhooks de Meta
- Los tokens de los canales se enmascaran al enviarlos al navegador
- `.env`, `auth/` y `media/` están en `.gitignore`: **nunca los subas al repositorio**
- Solo los puertos 22, 80 y 443 quedan expuestos

---

## Estructura

```
src/
  server.mjs            API + estáticos
  db.mjs                Pool, migraciones, semilla y defaults
  auth.mjs              JWT, bcrypt y alcance por rol
  core.mjs              Reglas de negocio e ingesta unificada
  ubicaciones.mjs       Detección y geocodificación de direcciones
  archivos.mjs          Almacenamiento de adjuntos
  multipart.mjs         Parser de subidas sin dependencias
  worker.mjs            Drenado de inbox/outbox
  realtime.mjs          Canal SSE
  channels/             baileys.mjs (QR) · meta.mjs (Cloud API, Messenger, Instagram)
  routes/               negociaciones · contactos · admin · canales · archivos · varios
  migrations/           001_init.sql
public/
  index.html · styles.css
  js/ core · app · negociaciones · ficha · contactos · modulos · admin · adjuntos
scripts/
  instalar-vps.sh · actualizar.sh · backup.sh · verificar.mjs
```
