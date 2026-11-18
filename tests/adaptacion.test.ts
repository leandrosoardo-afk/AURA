import { describe, expect, it } from 'vitest';
import { adaptarInterfaz } from '../shared/adaptacion';

describe('la interfaz se adapta al perfil', () => {
  it('una pyme con empleados ve la pregunta de sueldos y la categoría Sueldos', () => {
    const a = adaptarInterfaz('pyme', { empleados: '1_3', preocupacion: 'pagos', rubro: 'gastronomia', medios_cobro: ['efectivo'] });
    expect(a.preguntaFoco).toBe('¿Te alcanza para pagar los sueldos?');
    expect(a.categorias.egreso).toContain('Sueldos');
    expect(a.categorias.egreso).toContain('Insumos');
    expect(a.categorias.ingreso).toContain('Cobros en efectivo');
  });

  it('quien trabaja solo no ve sueldos y un oficio usa Materiales', () => {
    const a = adaptarInterfaz('pyme', { empleados: 'solo', preocupacion: 'pagos', rubro: 'oficios' });
    expect(a.preguntaFoco).toBe('¿Te alcanza para pagarles a tus proveedores?');
    expect(a.categorias.egreso).not.toContain('Sueldos');
    expect(a.categorias.egreso).toContain('Materiales');
  });

  it('la preocupación de la pyme cambia el orden de los módulos', () => {
    expect(adaptarInterfaz('pyme', { preocupacion: 'cuotas' }).modulos[0]).toBe('simulador');
    expect(adaptarInterfaz('pyme', { preocupacion: 'vencimientos' }).modulos[0]).toBe('vencimientos');
    expect(adaptarInterfaz('pyme', { preocupacion: 'ganancia' }).modulos[0]).toBe('informes');
  });

  it('una persona ve categorías del hogar y su objetivo manda', () => {
    const a = adaptarInterfaz('persona', { objetivo: 'ahorrar', ocupacion: 'empleo', hogar: 'familia', cuotas: 'muchas' });
    expect(a.preguntaFoco).toBe('¿Cuánto podés guardar este mes?');
    expect(a.modulos[0]).toBe('metas');
    expect(a.categorias.ingreso[0]).toBe('Sueldo');
    expect(a.categorias.egreso).toEqual(expect.arrayContaining(['Comida', 'Cuotas', 'Familia']));
    expect(a.categorias.egreso).not.toContain('Sueldos');
  });

  it('ingresos variables adelantan los escenarios sin perder módulos', () => {
    const a = adaptarInterfaz('persona', { objetivo: 'fin_de_mes', ingresos: 'variables' });
    expect(a.modulos[2]).toBe('escenarios');
    expect(new Set(a.modulos).size).toBe(8);
  });

  it('las explicaciones aparecen solo para quien las pidió', () => {
    expect(adaptarInterfaz('pyme', { experiencia: 'nueva' }).explicaciones).toBe(true);
    expect(adaptarInterfaz('pyme', { experiencia: 'alta' }).explicaciones).toBe(false);
  });

  it('funciona con respuestas parciales, para la vista previa del alta', () => {
    expect(adaptarInterfaz('pyme', {}).modulos.length).toBe(8);
    expect(adaptarInterfaz('persona', {}).preguntaFoco).toBe('¿Llegás a fin de mes?');
  });
});
