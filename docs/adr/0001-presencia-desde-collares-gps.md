---
status: superseded by ADR-0002
---

# La Presencia sale de collares GPS, no de una ruta trazada a mano

Dónde está la Manada cada mes se deriva de las posiciones reales de collares GPS de varios años, agrupadas por mes del calendario: los ñus de la versión CC0 de Dryad (Masolele et al. 2026, 2019–2023) y las cebras, que Dryad no tiene, del shapefile de Hopcraft (2013–2018). Se descartó trazar a mano una ruta a partir de la literatura porque rompería la regla del resto del Mapa (Relieve, Cobertura, Verdor y Caudal salen de datos reales), y se descartó mezclar los collares con el Verdor porque dos fuentes de verdad impiden saber cuál culpar cuando algo se ve raro. De la Presencia cuelga cuándo se Marcha, y los Cruces salen de los mismos collares (los tramos que cruzan a menudo), así que cambiar esta fuente arrastra ese comportamiento.

## Consecuencias

- Las gacelas de Thomson no tienen collares: siguen la Presencia de los ñus con un retraso fijo.
- El shapefile de Hopcraft en serengetidata.weebly.com no declara licencia y de él salen las cebras: hay que pedírsela antes de publicar (`docs/backlog/licencia-cebras.md`).
- Se descartó un único Cruce por río: los collares cruzan el Grumeti y el Mbalageti casi por todo su curso, y obligarlos a un solo tramo les hacía dar rodeos que los datos no muestran.
