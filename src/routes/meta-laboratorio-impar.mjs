import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requiere } from '../auth.mjs';
import { autorizadoLaboratorio, diagnosticarMeta } from '../meta-laboratorio-impar.mjs';
const r = Router();
r.use(requiere('admin'));
r.use((req,res,next)=>{
  res.set('Cache-Control','no-store');
  if (!autorizadoLaboratorio(req.user,req.empresa)) return res.status(403).json({error:'Laboratorio exclusivo del usuario admin de IMPAR.'});
  next();
});
r.use(rateLimit({windowMs:60000,max:6,standardHeaders:true,legacyHeaders:false}));
r.post('/diagnostico',async(req,res)=>{
  try { res.json(await diagnosticarMeta(req.body?.token)); }
  catch(e) {res.status(e.status||503).json({error:e.status===422?e.message:'No se pudo consultar Meta.'});}
});
export default r;
