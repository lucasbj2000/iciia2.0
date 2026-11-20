-- IMPAR: clientes de WhatsApp con @usuario (BSUID).
-- Antes, cuando Meta no mandaba el número, se guardaba el texto «undefined» como teléfono
-- y todos esos clientes quedaban apuntando al mismo valor. Se limpia para que no se mezclen:
-- el próximo mensaje de cada uno llega con su BSUID y abre su propia ficha.
UPDATE contactos SET tel='', tel_norm='' WHERE tel='undefined';
UPDATE contactos SET externos = externos - 'whatsapp' WHERE externos->>'whatsapp'='undefined';
UPDATE negociaciones SET telefono_destino=NULL WHERE telefono_destino='undefined';
UPDATE mensajes SET remitente_numero=NULL WHERE remitente_numero='undefined';
DELETE FROM contacto_telefonos WHERE numero='undefined';
