# Un plan contigo

Repositorio: [frankhdprado2-maker/Citas](https://github.com/frankhdprado2-maker/Citas).

Una app en español para invitar a salir a alguien que te gusta. Inspirada en el flujo del video: invitación → día, hora y actividad → comida y detalles → revisión → confirmación. Sin nombres personales. Tono cálido con cariño e interés para conocerse: «¿Salimos un día de estos?» y «Me gustaría pasar un rato contigo». Verde suave y crema con acentos rosados discretos, café/calendario y un pequeño corazón en la taza. Diseño adaptable a celulares.

Al abrir la página aparece una bienvenida breve con la taza, el calendario y pequeños destellos; después se revela la invitación de forma gradual. Se respeta la preferencia de movimiento reducido del dispositivo y los controles siguen disponibles.

## Probar en Windows

El proyecto ya tiene sus dependencias instaladas en este equipo. Abre `INICIAR.cmd` o, desde esta carpeta, ejecuta:

```powershell
npm.cmd ci
npm.cmd run setup
npm.cmd start
```

Abre http://localhost:3000. Si aparece un error de puerto ocupado, la app puede estar ejecutándose ya; abre el enlace existente.

`npm run setup` crea `.env` con claves aleatorias y conserva una configuración existente. En `.env` quedan las claves privadas del servidor y la configuración de Gmail. No compartas ni subas ese archivo. Se puede cambiar `PORT` en él si necesitas usar otro puerto.

Necesita Node.js 22 a 24; el despliegue está configurado con Node.js 24.

## Qué puedes hacer

- Compartir la URL de la invitación cuando esté publicada.
- Elegir fecha, hora y uno de seis planes; escoger comida, lugar y comentario.
- Guardar la salida, revisar su resumen, reprogramarla o cancelarla.
- Descargar un evento `.ics` para el calendario. Reserva dos horas como duración orientativa; puedes ajustarla en tu calendario.
- Compartir el resumen mediante el menú del celular o copiarlo para pegarlo en WhatsApp.
- Consultar las salidas y el estado de los avisos directamente en el archivo Excel.
- Indicar el correo de ella, obligatorio para agendar, y recibir una confirmación para ambos; recibir también los cambios de horario y la cancelación.

Las fechas se validan en **America/Lima**. Esta zona horaria puede configurarse con `TIME_ZONE`.

La confirmación personal se conserva en el navegador utilizado mediante un identificador y una clave aleatoria. Se pueden consultar y cambiar los datos solo con esa clave. Si se borran los datos del navegador o se usa otro dispositivo, la salida sigue registrada en Excel. El enlace público abre la invitación; compartir el resumen no comparte el permiso para modificarla.

La pantalla de agenda y su enlace fueron retirados por petición del usuario. La antigua ruta `/agenda` redirige a la invitación.

## Dónde queda el Excel

El archivo **`data/citas.xlsx` es el registro principal**, tanto para lecturas como para escrituras. Se crea automáticamente al arrancar, con la hoja `Citas`, encabezados, filtros, primera fila fija y filas alternadas en rosa. Cada fila contiene fecha, hora, plan, comida, lugar, comentario, correo de la invitada, estado del correo y marcas de registro/actualización UTC. Las columnas de control de acceso están ocultas. La hoja `Avisos` conserva destinatarios, tipo de aviso, estado, referencia del correo y los datos de cada envío. Los Excel de la versión anterior, de 13 columnas, se leen sin perder registros y se actualizan en el siguiente guardado.

El servidor procesa los cambios de uno en uno y escribe primero un archivo temporal antes de reemplazar el Excel. `citas.xlsx.bak` conserva la versión anterior. No se muestra una confirmación hasta que el archivo fue guardado. Los reintentos de un mismo envío no generan citas duplicadas. El mismo día y hora exactos no admiten dos planes confirmados; no se comprueba el solapamiento por duración.

Haz una copia de `data/citas.xlsx` para abrirla con Microsoft Excel. Evita mantener abierto el archivo de trabajo mientras el servidor escribe, porque Windows puede bloquearlo. Conserva los nombres y el orden de las columnas si modificas el archivo manualmente. Un archivo dañado detiene el arranque, sin sustituir los registros por una agenda vacía.

Para recuperar la copia anterior: detén la app, conserva una copia del archivo actual y copia `citas.xlsx.bak` sobre `citas.xlsx`. Vuelve a iniciar la app y comprueba los registros. Crea respaldos periódicos del archivo y guárdalos fuera del servidor.

## Desplegar en Render

El archivo `render.yaml` deja preparado un **Web Service** de Node.js con un disco persistente de 1 GB montado en `/var/data` y `DATA_DIR=/var/data`.

**Este Blueprint utiliza el plan de cómputo de pago `0.5c-512mb`** (0.5 CPU y 512 MB de memoria), según la documentación vigente de Render. Render permite discos persistentes en servicios de pago; los servicios gratuitos pierden cambios locales al reiniciar o redesplegar. Revisa el costo antes de crear el servicio. El servidor comprueba en Render que el directorio de datos esté dentro de un punto de montaje real.

1. Utiliza el repositorio de este proyecto en GitHub. Incluye `package-lock.json` y `render.yaml`. `.env`, `node_modules`, `data`, `.qa` y los archivos ZIP están excluidos mediante `.gitignore`; las credenciales y citas locales no se publican. El ZIP de entrega también excluye esos elementos.
2. En Render, elige **New → Blueprint** y conecta ese repositorio.
3. Render detectará `render.yaml`. Revisa el plan y el disco, y completa `ADMIN_PASSWORD` con una clave privada de al menos 12 caracteres. `SESSION_SECRET` se genera automáticamente. Completa también las variables de correo descritas en **Activar las confirmaciones por Gmail**.
4. Crea el servicio. El comando de instalación es `npm ci --omit=dev` y el arranque `npm start`. El chequeo de salud usa `/api/health`.
5. Cuando el despliegue esté activo, abre la URL `https://tu-servicio.onrender.com`. Confirma un plan de prueba y comprueba su confirmación y el registro en `/var/data/citas.xlsx`. Cancela ese plan de prueba desde la confirmación.
6. Para verificar persistencia, vuelve a desplegar y comprueba que el registro sigue en el Excel. Comparte la URL pública de inicio con ella.

Si prefieres crear el servicio manualmente: selecciona **Web Service**, configura esos comandos y añade un disco con ruta `/var/data`. Variables: `NODE_ENV=production`, `NODE_VERSION=24`, `TIME_ZONE=America/Lima`, `DATA_DIR=/var/data`, `ADMIN_PASSWORD` (12+ caracteres) y `SESSION_SECRET` (32+ caracteres aleatorios). Render asigna `PORT` automáticamente.

Usa **una sola instancia y un solo proceso Node**. Excel como registro es adecuado para este pequeño uso personal; el disco de Render también limita el servicio a una instancia. La publicación en tu cuenta de Render queda pendiente.

Fuentes oficiales consultadas: [discos persistentes](https://render.com/docs/disks), [servicios gratuitos](https://render.com/docs/free), [Blueprint YAML](https://render.com/docs/blueprint-spec), [variables de entorno](https://render.com/docs/configure-environment-variables).

## Activar las confirmaciones por Gmail

Para esta versión, la configuración se hace en tu cuenta de Gmail. Primero activa la verificación en dos pasos en [Seguridad de tu cuenta de Google](https://myaccount.google.com/security), siguiendo la [guía oficial](https://support.google.com/accounts/answer/185839?hl=es). Después crea la contraseña de aplicación indicada en los pasos siguientes. Si usas varias cuentas, comprueba que sea la misma que figura en `SMTP_USER`.

Tu correo de avisos está en `OWNER_EMAIL` de `.env`. El campo obligatorio **Tu correo** en la invitación recoge la dirección de ella. El formulario y el servidor exigen una dirección válida antes de guardar una nueva salida. Cada uno recibe un mensaje separado con el día, la hora de Lima, el plan, la comida, el lugar y el comentario. El correo tiene una tarjeta de fecha/hora, detalles ordenados y un mensaje cercano, en crema, verde y rosa suave. El asunto es **Salida agendada**; si cambia la salida, **Salida reprogramada** o **Salida cancelada**.

1. Abre [Contraseñas de aplicación de Google](https://myaccount.google.com/apppasswords) con la cuenta que usarás para enviar. Google requiere la verificación en dos pasos y esta función puede no estar disponible en todas las cuentas; consulta su [ayuda oficial](https://support.google.com/accounts/answer/185833?hl=es).
2. Crea una contraseña de aplicación, por ejemplo para **Un plan contigo**. Guarda sus 16 caracteres, sin espacios, en `SMTP_PASSWORD` dentro de `.env`. Usa esa contraseña de aplicación, no tu contraseña habitual de Gmail. No la pegues en el chat ni la subas a GitHub.
3. En ese mismo archivo revisa lo siguiente; `SMTP_USER` y el correo de `EMAIL_FROM` deben pertenecer a la cuenta remitente:

```dotenv
OWNER_EMAIL=tu-correo@gmail.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=tu-correo@gmail.com
SMTP_PASSWORD=contraseña-de-aplicación
EMAIL_FROM=Un plan contigo <tu-correo@gmail.com>
```

4. Reinicia la app y ejecuta `npm.cmd run correo:comprobar` desde esta carpeta. El comando verifica el acceso a Gmail sin enviar un mensaje.
5. Agenda una salida de prueba indicando un correo real en **Tu correo** y revisa ambos buzones, incluida la carpeta de spam. En la hoja `Avisos` del Excel puedes comprobar el estado de cada destinatario.

En **Render**, configura las mismas seis variables en **Environment**. El Blueprint las declara y solicita sus valores privados. Usa el servicio de pago con disco persistente ya indicado: [Render admite SMTP en servicios de pago y bloquea esos puertos en servicios gratuitos](https://render.com/changelog/free-web-services-will-no-longer-allow-outbound-traffic-to-smtp-ports). Google podría bloquear un acceso desde una ubicación nueva; si la comprobación de conexión falla, revisa la actividad de seguridad de la cuenta. Para uso personal se usa SMTP de Gmail; para volúmenes mayores conviene un proveedor de correo transaccional.

La salida y los avisos se guardan juntos en Excel **antes** de enviar. Si falta la contraseña de aplicación, la salida se confirma y el aviso queda **Sin configurar**. Al activar el correo y reiniciar se procesan los avisos pendientes del estado vigente; los anteriores de una salida que cambió o se canceló se marcan **Obsoleto**.

**Aceptado** significa que el servidor SMTP aceptó el mensaje; no certifica que haya llegado a la bandeja ni que lo hayan leído. Revisa ambos buzones para verificar la entrega real.

Los avisos fallidos quedan registrados en la hoja `Avisos`. La API privada del servidor permite reintentar solo los que faltan, conservando los ya aceptados. Un timeout durante el envío o un reinicio podrían dejar el resultado **Revisar**: SMTP no garantiza deduplicación. En ese caso revisa los buzones antes de solicitar un reenvío, porque el mensaje anterior podría haberse recibido. Los avisos pendientes persisten en el mismo disco que las citas.

Las citas antiguas sin correo se conservan y pueden consultarse o cancelarse. Para editarlas hay que añadir una dirección válida. Al editar una cita que ya tiene correo, la API conserva la dirección si no se envía ese campo, pero rechaza vaciarla. Las citas existentes no generan correos retrospectivos automáticamente. El nuevo diseño se usa en los próximos envíos.

La plantilla utiliza tablas, estilos en línea y ajustes para celular, siguiendo la [compatibilidad CSS publicada por Gmail](https://developers.google.com/workspace/gmail/design/css?hl=es). Conserva una versión de texto para lectores que no muestran HTML.

## Pruebas de la app

```powershell
npm.cmd run check
npm.cmd test
npm.cmd audit
```

Las pruebas usan directorios temporales separados de tus citas. Comprueban acceso privado, fechas y horas, Excel real, envíos simultáneos, reintentos, recuperación de una nueva instancia, calendario, reprogramación, cancelación, descarga, cambios del dueño y rechazo de archivos dañados. Las pruebas de correo usan un buzón SMTP local simulado: se comprueba el transporte real de Nodemailer, los dos destinatarios por separado, la persistencia, los fallos y los reintentos, sin enviar mensajes a personas ni usar tus credenciales. También se prueba la migración del Excel anterior.

La dependencia transitiva `uuid` de ExcelJS está fijada mediante `overrides` a 11.1.1 para corregir el aviso de seguridad de versiones anteriores. El Excel se escribe y se lee con ExcelJS en el servidor. El navegador muestra texto escapado y el Excel guarda los comentarios como texto, sin ejecutarlos como fórmulas.

## Archivos principales

- `server.js`: API, acceso privado, validación y calendario.
- `lib/store.js`: lectura/escritura del Excel y cola de cambios.
- `lib/email.js`: mensajes en español, transporte SMTP y avisos persistentes.
- `public/index.html`, `public/app.js`, `public/style.css`: invitación.
- `scripts/check-email.js`: comprobación de acceso a Gmail sin enviar mensajes.
- `render.yaml`: configuración de despliegue.
- `test/appointments.test.js`: pruebas de integración.
