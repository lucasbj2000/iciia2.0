/* IMPAR: entrada de emergencia autónoma, sin dependencias de módulos CRM. */
(function () {
  'use strict';
  var root = document.documentElement;
  var token = '';
  try { token = localStorage.getItem('iciia_token') || ''; } catch (_) {}
  if (token) root.classList.add('sesion-verificando');

  function mensaje(t) {
    var el = document.getElementById('l-err');
    if (el) { el.textContent = t; el.setAttribute('role','alert'); }
  }
  function interfazDisponible() {
    root.classList.remove('sesion-verificando');
    var login = document.getElementById('login');
    if (login) login.classList.remove('hidden');
    var estado = document.getElementById('inicio-estado');
    if (estado) estado.style.display = 'none';
  }
  function noCargo() {
    if (window.__imparAppLista) return;
    interfazDisponible();
    mensaje('No se pudo iniciar la interfaz del CRM. Podés comprobar tus credenciales aquí y reintentar. Si persiste, avisá al administrador.');
  }

  document.addEventListener('DOMContentLoaded', function () {
    var form=document.getElementById('form-login');
    if (!form) return;
    // Captura solo cuando el módulo principal aún no pudo inicializarse.
    form.addEventListener('submit', async function (ev) {
      if (window.__imparAppLista) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      var btn=document.getElementById('l-btn'), prev=btn.textContent;
      btn.disabled=true;btn.textContent='Comprobando acceso…';mensaje('');
      var ctrl=new AbortController();
      var timeout=setTimeout(function(){ctrl.abort();},12000);
      try {
        var resp=await fetch('/api/login',{
          method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},
          credentials:'same-origin',signal:ctrl.signal,cache:'no-store',
          body:JSON.stringify({usuario:document.getElementById('l-usr').value.trim(),
                               password:document.getElementById('l-pwd').value})
        });
        var tipo=resp.headers.get('content-type')||'';
        if (!tipo.includes('application/json')) throw new Error('El servidor devolvió una página en lugar de una respuesta de acceso.');
        var data=await resp.json();
        if (!resp.ok || !data.token) throw new Error(data.error||data.mensaje||'No se pudo validar el acceso.');
        try { localStorage.setItem('iciia_token',data.token); }
        catch (_) { throw new Error('El navegador bloquea guardar la sesión. Habilitá el almacenamiento de este sitio.'); }
        mensaje('Credenciales correctas. Reiniciando la interfaz del CRM…');
        if (!sessionStorage.getItem('impar_intento_rescate')) {
          sessionStorage.setItem('impar_intento_rescate','1');
          location.reload();
        } else {
          mensaje('Tus credenciales son correctas; hay un problema cargando la interfaz del CRM. Avisá al administrador para repararla.');
        }
      } catch (ex) {
        mensaje(ex.name==='AbortError'?'El servidor no respondió a tiempo. Intentá de nuevo.':ex.message||'Error al iniciar sesión.');
      } finally {
        clearTimeout(timeout);
        btn.disabled=false;btn.textContent=prev;
      }
    },true);
  });
  setTimeout(noCargo,9000);
  window.addEventListener('error',function(){if(!window.__imparAppLista)setTimeout(noCargo,100);});
  window.addEventListener('unhandledrejection',function(){if(!window.__imparAppLista)setTimeout(noCargo,100);});
})();
