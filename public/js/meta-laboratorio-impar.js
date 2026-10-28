import { $, S, post, esc } from './core.js';
export async function vistaLaboratorioMeta() {
  const box=$('#adm-body');
  if(S.usuario?.rol!=='admin'||S.usuario?.usuario?.toLowerCase()!=='admin') {
    box.textContent='Acceso exclusivo del usuario admin.';return;
  }
  box.innerHTML=`<div class="card-box"><h3>Laboratorio API · solo administrador</h3>
    <p>Impar Papeles · +595 976 992668</p>
    <p>Consultas de solo lectura. La herramienta actual continúa atendiendo las conversaciones. Esta prueba no envía mensajes, no activa bots y no modifica webhooks ni suscripciones.</p>
    <p>Phone Number ID: 661580813700225 · WABA ID: 703035692081905</p>
    <form id="meta-lab-form"><div class="field"><label for="meta-lab-token">Token de acceso (solo para esta consulta)</label>
    <input id="meta-lab-token" type="password" autocomplete="off" required maxlength="4096"></div>
    <button class="btn" id="meta-lab-probar">Verificar conexión sin enviar mensajes</button></form>
    <p>El token no se guarda. No cambies el webhook de Alamo mientras la otra herramienta lo utilice. La recepción y el envío real quedan pendientes de una prueba coordinada con un teléfono de prueba.</p>
    <div id="meta-lab-resultado" role="status" aria-live="polite"></div></div>`;
  $('#meta-lab-form').onsubmit=async e=>{
    e.preventDefault();const input=$('#meta-lab-token'),button=$('#meta-lab-probar'),out=$('#meta-lab-resultado');
    let token=input.value.trim();input.value='';button.disabled=true;out.textContent='Consultando Meta…';
    try {
      const r=await post('/meta-laboratorio/diagnostico',{token});
      out.innerHTML='<p>Diagnóstico terminado. No se realizaron cambios ni envíos.</p>'+Object.entries(r.resultados).map(([nombre,v])=>
        `<h4>${esc(nombre)}</h4><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(JSON.stringify(v,null,2))}</pre>`).join('')+
        '<p>Credenciales válidas no confirman entrega, recepción ni facturación habilitada. Las listas muestran hasta 100 resultados.</p>';
    }catch(err){out.textContent=err.message;}finally{token='';button.disabled=false;}
  };
}
