# Pasarela telefónica IMPAR

Conecta un celular con chip de IMPAR al CRM. La computadora de la sucursal se empareja por
Bluetooth con el celular, como si fuera el manos libres de un auto. Así el CRM puede:

- avisar las llamadas que entran al chip, y que el agente las atienda desde el navegador;
- hacer llamadas desde la ficha del cliente, por la línea del chip;
- crear la negociación sola cuando llama un número nuevo, con el sello de teléfono;
- guardar cada llamada en el historial.

El audio viaja directo entre la pasarela y el navegador del agente (WebRTC). Por ahora es una
prueba: solo el administrador probador ve y atiende estas llamadas.

## Qué hace falta

- **Una computadora con Linux y Bluetooth**, que quede encendida en la sucursal. Sirve una
  Raspberry Pi 4 o 5 con **Raspberry Pi OS (Trixie)**, o una mini PC con **Debian 13**.
  Hace falta PipeWire 1.4 o superior, que es la versión que trae la telefonía por Bluetooth.
- **Un celular Android con el chip de IMPAR**, que quede fijo al lado de la computadora y
  enchufado al cargador.
- Internet en la sucursal.

Un celular atiende una sola llamada a la vez. Para dos llamadas simultáneas hacen falta dos
celulares con dos chips (y dos pasarelas).

## Instalación

1. **Generá el token en el CRM.** Entrá con el usuario administrador y abrí
   «Llamadas · Prueba» → «Pasarela telefónica» → «Generar token». Copialo: se muestra una sola vez.
2. **Copiá esta carpeta a la computadora** (por ejemplo con un pendrive o `git clone`).
3. **Instalá**, con tu usuario normal (no como root):

   ```bash
   bash instalar.sh
   ```

4. **Emparejá el celular.** En el celular activá el Bluetooth y dejalo visible. En la computadora:

   ```bash
   bluetoothctl
   power on
   agent on
   scan on            # esperá a ver el nombre del celular y copiá su dirección XX:XX:XX:XX:XX:XX
   pair XX:XX:XX:XX:XX:XX
   trust XX:XX:XX:XX:XX:XX
   connect XX:XX:XX:XX:XX:XX
   exit
   ```

   En el celular, en los ajustes de Bluetooth de esa computadora, dejá activado
   **«Llamadas telefónicas»**.
5. **Pegá el token** en `~/pasarela-telefono/pasarela.env`, en la línea `PASARELA_TOKEN=`.
6. **Probá** sin llamar a nadie:

   ```bash
   cd ~/pasarela-telefono && node pasarela.mjs --probar
   ```

   Tiene que decir «Telefonía: celular conectado» y «CRM: conexión y token correctos».
7. **Dejala funcionando siempre** (arranca sola al prender la computadora):

   ```bash
   systemctl --user enable --now pasarela-telefono
   ```

   Para ver qué está haciendo: `journalctl --user -u pasarela-telefono -f`.
   Los registros nunca muestran números de teléfono.

## Si algo no anda

- **«El servicio de telefonía de PipeWire no responde»**: el celular no está conectado por
  Bluetooth o PipeWire es anterior a 1.4. Revisá con `pipewire --version` y volvé a conectar el
  celular con `bluetoothctl connect XX:XX…`.
- **«No apareció el audio Bluetooth del celular»**: en el celular, en el Bluetooth de esa
  computadora, activá «Llamadas telefónicas».
- **La llamada conecta pero no se escucha**: el navegador del agente y la pasarela no logran
  conectarse directo (redes distintas con NAT estricto). Se resuelve con un servidor TURN:
  completá `TURN_URL`, `TURN_USUARIO` y `TURN_CLAVE` en `pasarela.env`.
- **El CRM dice que la pasarela no está conectada**: revisá que la computadora tenga internet y
  que el servicio esté activo (`systemctl --user status pasarela-telefono`).
- **Cambiar el token**: generá uno nuevo en el CRM (el anterior deja de valer al instante),
  pegalo en `pasarela.env` y reiniciá con `systemctl --user restart pasarela-telefono`.

## Probar sin celular

- **Tono de prueba:** con `PASARELA_AUDIO=tono node pasarela.mjs`, cuando el agente atiende escucha un
  tono de 440 Hz en vez del celular, y la pasarela muestra cuánto audio le llega del navegador.
  Sirve para comprobar la red entre la sucursal y el CRM antes de instalar el celular.
- **Celular simulado (para desarrollo):** `pruebas/telefonia_falsa.py` imita el servicio de telefonía
  de PipeWire en un bus D-Bus propio (necesita `pip install dbus-fast`). Con
  `busctl --user call org.pipewire.Telephony / impar.Prueba Simular s 0981123456` simula una llamada
  entrante y con `… impar.Prueba Cortar` simula que el cliente corta.
