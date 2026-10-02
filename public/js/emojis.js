/* Selector compartido: inserta texto, nunca envía el mensaje. */
const grupos = [
  ['Caritas', ['😀','😃','😄','😁','😊','🙂','😉','😍','🥰','😎','🤔','😅','😂','🤣','😔','😢','😭','😮','😴','🤗']],
  ['Gestos', ['👍','👎','👌','✌️','🤞','👏','🙌','🙏','🤝','👋','💪','🫶']],
  ['Símbolos', ['❤️','💚','💛','💙','🤍','🖤','💕','✨','⭐','🎉','🎊','✅','❌','⚠️','❓','❗','💯']],
  ['Trabajo', ['📄','📃','📋','📚','📦','🛍️','🛒','🚚','📍','📞','📱','✉️','💬','🕒','📅','💰','💳','🏢','🇵🇾']]
];

export function insertarEmoji(input, emoji) {
  const desde = input.selectionStart ?? input.value.length;
  const hasta = input.selectionEnd ?? desde;
  if (input.maxLength >= 0 && input.value.length - (hasta - desde) + emoji.length > input.maxLength) return false;
  input.focus({ preventScroll: true });
  input.setRangeText(emoji, desde, hasta, 'end');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

export function conectarEmojis(selector) {
  const input = document.querySelector(selector);
  if (!input || input.parentElement.querySelector(`[data-emoji-input="${input.id}"]`)) return;
  const picker = document.createElement('details');
  picker.className = 'emoji-picker'; picker.dataset.emojiInput = input.id;
  picker.innerHTML = `<summary aria-label="Agregar emojis" title="Agregar emojis">😊</summary>
    <div class="emoji-panel" role="group" aria-label="Selector de emojis">
      ${grupos.map(([titulo, emojis]) => `<div class="emoji-group"><b>${titulo}</b><div class="emoji-grid">
        ${emojis.map(emoji => `<button type="button" class="emoji-option" aria-label="Insertar ${emoji}">${emoji}</button>`).join('')}
      </div></div>`).join('')}</div>`;
  input.before(picker);
  picker.querySelectorAll('.emoji-option').forEach(button => {
    button.addEventListener('mousedown', e => e.preventDefault());
    button.onclick = () => {
      insertarEmoji(input, button.textContent);
      picker.open = false;
    };
  });
  picker.addEventListener('toggle', () => {
    if (picker.open) document.querySelectorAll('.emoji-picker[open]').forEach(other => { if (other !== picker) other.open = false; });
  });
}

document.addEventListener('click', e => {
  document.querySelectorAll('.emoji-picker[open]').forEach(picker => { if (!picker.contains(e.target)) picker.open = false; });
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const abiertos = document.querySelectorAll('.emoji-picker[open]');
  if (!abiertos.length) return;
  abiertos.forEach(picker => { picker.open = false; picker.querySelector('summary').focus(); });
  e.preventDefault(); e.stopImmediatePropagation();
}, true);
