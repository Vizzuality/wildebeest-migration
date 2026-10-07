# Vegetación basada en datos reales

## Problema

La cobertura de bosque (`woodland()` en `src/terrain.ts`) es ruido fbm más una caja dibujada a mano que deja sin árboles las llanuras del sur. Cuando el Relieve pase a salir del DEM real, los bosques quedarán en sitios que no corresponden a nada: colinas reales sin árboles, llanuras con manchas inventadas.

## Propuesta

Hornear una máscara de bosque y matorral a partir de un mapa de cobertura real (por ejemplo ESA WorldCover a 10 m), dentro del mismo pre-bake que el DEM, y usarla en lugar de `woodland()` tanto en el color del terreno como en la colocación de los árboles.

## Por decidir

- La fuente (ESA WorldCover, Copernicus Global Land Cover, etc.) y su atribución.
- Qué clases cuentan como bosque, como matorral y como pradera.
- Si el bosque de galería sigue saliendo de la distancia a los ríos o también de la máscara.

## Contexto

Quedó fuera del cambio "Relieve desde DEM real" para no ampliar su alcance.
