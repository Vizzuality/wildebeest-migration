# Serengeti Migration

Visualización 3D del ciclo anual de la migración de ñus en el ecosistema Serengeti–Mara, sobre un relieve basado en elevación real.

## Language

### Territorio

**Mapa**:
El rectángulo geográfico que se representa, de lon 33,27 a 35,98 y de lat −0,67 a −3,67, con margen para que ningún lugar de la historia quede en la bruma del borde, medido en kilómetros desde el origen (34,85, −2,3).
_Avoid_: mundo, escena, bbox

**DEM**:
Modelo digital de elevación real (metros sobre el nivel del mar) del que se obtiene el relieve del Mapa.
_Avoid_: tiles, elevation data

**Relieve**:
La altura del suelo en cada punto del Mapa, derivada exclusivamente del DEM, sin formas añadidas a mano.
_Avoid_: terreno procedural, heightmap

**Cota base**:
La elevación del Lago Victoria, que se toma como altura cero del Relieve.
_Avoid_: nivel del mar, sea level

**Lago**:
Agua quieta dentro del Mapa: la orilla oriental del Lago Victoria y partes de los lagos Eyasi, Manyara y Natron. Es la superficie plana que el DEM da a cada lago (en el caso del Victoria, la Cota base).
_Avoid_: agua, water mask, costa

**Exageración vertical**:
El factor fijo por el que se multiplica el desnivel real para que el Relieve sea legible a escala de 200 km.
_Avoid_: escala Y, multiplier

### Agua

**Río principal**:
Uno de los tres ríos que la manada tiene que cruzar o seguir: Mara, Grumeti y Mbalageti. Son los únicos con etiqueta en el mapa.
_Avoid_: river, cauce

**Afluente**:
Un río real con nombre que se muestra por contexto (Orangi, Seronera, Sand River, Talek, Olare Orok, Oldupai), con menos peso visual que un Río principal.
_Avoid_: tributario, arroyo, stream

**Cruce**:
Un punto de un Río principal donde la manada lo atraviesa en masa durante ciertos meses. Siempre está sobre el cauce real.
_Avoid_: hotspot, crossing
