#!/usr/bin/env node
/**
 * Parche temporal para @whiskeysockets/baileys 6.7.24.
 *
 * Upstream: WhiskeySockets/Baileys#2763
 * "retry decrypt with stanza-provided LID/PN pairing on session mismatch"
 *
 * Motivo: WhatsApp puede enviar un stanza dirigido por LID cuando la sesión
 * Signal válida está almacenada bajo el PN (o viceversa). Baileys 6.7.24
 * intenta sólo una identidad y puede caer en Bad MAC / No matching sessions.
 *
 * Este script modifica únicamente el JS compilado instalado en node_modules.
 * Es idempotente y falla de forma segura si el código esperado cambia.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const raiz = resolve(new URL('..', import.meta.url).pathname);
const candidatos = [
  resolve(raiz, 'node_modules/@whiskeysockets/baileys/lib/Utils/decode-wa-message.js'),
  resolve(raiz, 'node_modules/@whiskeysockets/baileys/lib/Utils/decode-wa-message.mjs')
];

const archivo = candidatos.find(existsSync);
if (!archivo) {
  console.error('✖ No se encontró decode-wa-message compilado de Baileys.');
  process.exit(1);
}

let src = readFileSync(archivo, 'utf8');
const MARCA = 'ICIIA_LID_PN_DECRYPT_RETRY';

if (src.includes(MARCA)) {
  console.log('✔ Parche Baileys LID/PN ya aplicado');
  process.exit(0);
}

/*
 * TSC conserva esta estructura en el paquete publicado. El regex tolera
 * espacios, tabs y punto y coma para no depender del formateo exacto.
 */
const patron = /case\s+['"]pkmsg['"]\s*:\s*case\s+['"]msg['"]\s*:\s*const\s+user\s*=\s*isJidUser\(sender\)\s*\?\s*sender\s*:\s*author\s*;?\s*msgBuffer\s*=\s*await\s+repository\.decryptMessage\(\s*\{\s*jid\s*:\s*user\s*,\s*type\s*:\s*e2eType\s*,\s*ciphertext\s*:\s*content\s*\}\s*\)\s*;?\s*break\s*;?/m;

if (!patron.test(src)) {
  console.error('✖ El código de Baileys cambió: no se aplicó el parche LID/PN.');
  console.error('  Revisar compatibilidad antes de continuar el despliegue.');
  process.exit(1);
}

const reemplazo = `case 'pkmsg':
            case 'msg': {
              const user = isJidUser(sender) ? sender : author;
              try {
                msgBuffer = await repository.decryptMessage({
                  jid: user,
                  type: e2eType,
                  ciphertext: content
                });
              } catch (err) {
                // ICIIA_LID_PN_DECRYPT_RETRY
                // Upstream: WhiskeySockets/Baileys#2763
                const altUser = isLidUser(user)
                  ? stanza.attrs.participant_pn || stanza.attrs.sender_pn
                  : stanza.attrs.participant_lid || stanza.attrs.sender_lid;

                if (!altUser || altUser === user) {
                  throw err;
                }

                logger.debug(
                  { key: fullMessage.key, primary: user, retryWith: altUser },
                  'primary identity failed to decrypt, retrying with stanza-provided PN/LID pairing'
                );

                try {
                  msgBuffer = await repository.decryptMessage({
                    jid: altUser,
                    type: e2eType,
                    ciphertext: content
                  });
                } catch {
                  throw err;
                }
              }
              break;
            }`;

src = src.replace(patron, reemplazo);
writeFileSync(archivo, src, 'utf8');

if (!readFileSync(archivo, 'utf8').includes(MARCA)) {
  console.error('✖ No se pudo verificar el parche LID/PN.');
  process.exit(1);
}

console.log('✔ Parche Baileys LID/PN aplicado');
