/* Contactos compartidos por WhatsApp: el agente ve nombre y número (línea normal y verificada). */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { leerVCard, textoContactos, contactosDeBaileys, contactosDeCloud } from '../src/contactos-compartidos-impar.mjs';

// Tarjeta típica de una cuenta de empresa (como «RR Envios Pilar»).
const empresa = 'BEGIN:VCARD\nVERSION:3.0\nN:;RR Envios Pilar;;;\nFN:RR Envios Pilar\nORG:RR Envios Pilar\n' +
  'item1.TEL;waid=595981234567:+595 981 234567\nitem1.X-ABLabel:Móvil\nX-WA-BIZ-NAME:RR Envios Pilar\nEND:VCARD';
assert.deepEqual(leerVCard(empresa), { nombre: 'RR Envios Pilar', telefonos: ['+595 981 234567'] });
assert.equal(textoContactos(contactosDeBaileys({ contactMessage: { displayName: 'RR', vcard: empresa } })),
  '👤 Contacto compartido: RR Envios Pilar · +595 981 234567');

// Solo waid, sin número visible; nombre por N; escapes vCard; línea plegada.
assert.deepEqual(leerVCard('BEGIN:VCARD\r\nN:Pérez;Ana;;;\r\nTEL;type=CELL;waid=595982000111:\r\nEND:VCARD'),
  { nombre: 'Ana Pérez', telefonos: ['+595982000111'] });
assert.equal(leerVCard('FN:Ferretería\\, Luque\nTEL:0981 00\n 0 111').nombre, 'Ferretería, Luque');
assert.deepEqual(leerVCard('FN:X\nTEL:0981 00\n 0 111').telefonos, ['0981 000 111'], 'línea plegada');

// Sin vCard: queda el nombre que muestra WhatsApp.
assert.equal(textoContactos(contactosDeBaileys({ contactMessage: { displayName: 'Mamá' } })), '👤 Contacto compartido: Mamá · sin número');

// Varios contactos a la vez (antes no se mostraba nada).
const varios = contactosDeBaileys({ contactsArrayMessage: { contacts: [
  { displayName: 'A', vcard: 'FN:Ana\nTEL;waid=595981111111:+595 981 111111' },
  { displayName: 'B', vcard: 'FN:Beto\nTEL:+595 982 222222\nTEL:+595 21 333444' }] } });
assert.equal(textoContactos(varios), '👤 Contactos compartidos:\n• Ana · +595 981 111111\n• Beto · +595 982 222222 / +595 21 333444');
assert.equal(contactosDeBaileys({ conversation: 'hola' }), null);
assert.equal(textoContactos([]), '[contacto compartido sin datos]');

// Cloud API (línea verificada): tipo «contacts».
assert.equal(textoContactos(contactosDeCloud([{ name: { formatted_name: 'RR Envios Pilar' }, phones: [{ phone: '+595 981 234567', wa_id: '595981234567' }] }])),
  '👤 Contacto compartido: RR Envios Pilar · +595 981 234567');
assert.deepEqual(contactosDeCloud([{ name: { first_name: 'Luis' }, phones: [{ wa_id: '595983000000' }] }]), [{ nombre: 'Luis', telefonos: ['+595983000000'] }]);

// Cableado.
const b = readFileSync(new URL('../src/channels/baileys.mjs', import.meta.url), 'utf8');
const m = readFileSync(new URL('../src/channels/meta.mjs', import.meta.url), 'utf8');
assert.doesNotMatch(b, /return '\[contacto compartido\]'/, 'ya no se descarta la tarjeta');
assert.match(b, /const contactos = contactosDeBaileys\(m\.message\);/);
assert.match(b, /qm\.contactMessage\|\|qm\.contactsArrayMessage/, 'también en mensajes citados');
assert.match(m, /case 'contacts': texto = textoContactos\(contactosDeCloud\(m\.contacts\)\)/);
console.log('✔ Contactos compartidos: nombre y número visibles en línea normal, verificada y citas');
