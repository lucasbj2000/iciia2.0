"""Servicio org.pipewire.Telephony falso para probar la pasarela sin celular.
Imita lo documentado en README-Telephony.md de PipeWire: AudioGateway1 (Dial, HangupAll) y Call1 (Answer, Hangup)
con propiedades State y LineIdentification, anunciados por ObjectManager. Además expone impar.Prueba.Simular(numero)."""
import asyncio, sys
from dbus_fast.aio import MessageBus
from dbus_fast.service import ServiceInterface, method, dbus_property, signal
from dbus_fast import Variant, PropertyAccess

RAIZ = '/org/pipewire/Telephony'
AG = RAIZ + '/ag0'
llamadas = {}  # ruta -> Llamada
bus = None
contador = 0
registro = open('/tmp/telefonia-falsa.log', 'a', buffering=1)
def log(m): registro.write(m + '\n')

class Llamada(ServiceInterface):
    def __init__(self, ruta, numero, estado):
        super().__init__('org.pipewire.Telephony.Call1')
        self.ruta, self.numero, self.estado = ruta, numero, estado
    @dbus_property(access=PropertyAccess.READ)
    def State(self) -> 's': return self.estado
    @dbus_property(access=PropertyAccess.READ)
    def LineIdentification(self) -> 's': return self.numero
    @dbus_property(access=PropertyAccess.READ)
    def Name(self) -> 's': return ''
    @method()
    def Answer(self):
        log('Answer ' + self.ruta); self.estado = 'active'
    @method()
    def Hangup(self):
        log('Hangup ' + self.ruta); quitar(self.ruta)

def props(l): return {'org.pipewire.Telephony.Call1': {'State': Variant('s', l.estado), 'LineIdentification': Variant('s', l.numero), 'Name': Variant('s', '')}}

class Manager(ServiceInterface):
    def __init__(self, incluir_ag):
        super().__init__('org.freedesktop.DBus.ObjectManager'); self.incluir_ag = incluir_ag
    @method()
    def GetManagedObjects(self) -> 'a{oa{sa{sv}}}':
        out = {r: props(l) for r, l in llamadas.items()}
        if self.incluir_ag: out[AG] = {'org.pipewire.Telephony.AudioGateway1': {}}
        return out

def crear(numero, estado):
    global contador
    ruta = f'{AG}/call{contador}'; contador += 1
    l = Llamada(ruta, numero, estado); llamadas[ruta] = l; bus.export(ruta, l)
    return l
def quitar(ruta):
    l = llamadas.pop(ruta, None)
    if l: bus.unexport(ruta)

class Gateway(ServiceInterface):
    def __init__(self): super().__init__('org.pipewire.Telephony.AudioGateway1')
    @method()
    def Dial(self, numero: 's'):
        log('Dial ' + numero); l = crear(numero, 'dialing')
        async def avanzar():
            await asyncio.sleep(1); l.estado = 'alerting'
            await asyncio.sleep(2)
            if l.ruta in llamadas: l.estado = 'active'
        asyncio.get_event_loop().create_task(avanzar())
    @method()
    def HangupAll(self):
        log('HangupAll'); [quitar(r) for r in list(llamadas)]

class Prueba(ServiceInterface):
    def __init__(self): super().__init__('impar.Prueba')
    @method()
    def Simular(self, numero: 's'):
        log('Simular entrante'); crear(numero, 'incoming')
    @method()
    def Cortar(self):
        log('Cliente cortó'); [quitar(r) for r in list(llamadas)]
    @method()
    def Estado(self) -> 's':
        return ','.join(f'{r}={l.estado}' for r, l in llamadas.items()) or 'sin llamadas'

async def main():
    global bus
    bus = await MessageBus(bus_address=sys.argv[1]).connect()
    bus.export(RAIZ, Manager(True)); bus.export(AG, Manager(False)); bus.export(AG, Gateway()); bus.export('/', Prueba())
    await bus.request_name('org.pipewire.Telephony')
    log('listo'); await asyncio.get_event_loop().create_future()
asyncio.run(main())
