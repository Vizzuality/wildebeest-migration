# Serengeti Migration

Visualización 3D del ciclo anual de la migración de ñus en el ecosistema Serengeti–Mara, sobre un relieve basado en elevación real.

## Language

### Territorio

**Mapa**:
El rectángulo geográfico que se representa, de lon 33,27 a 35,98 y de lat −0,67 a −3,67, con margen para que ningún lugar de la historia quede en la Bruma, medido en kilómetros desde el origen (34,85, −2,3).
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
Uno de los tres ríos que estructuran la migración: Mara, Grumeti y Mbalageti. Son los únicos con etiqueta en el mapa.
_Avoid_: river, cauce

**Afluente**:
Un río real con nombre que se muestra por contexto (Orangi, Seronera, Sand River, Talek, Olare Orok, Oldupai), con menos peso visual que un Río principal. La Manada lo vadea por cualquier sitio.
_Avoid_: tributario, arroyo, stream

**Caudal**:
El agua que lleva cada río en cada mes de un año medio, con su propia curva por río, no deducida del Verdor. El Mara lleva agua todo el año; otros ríos pueden quedarse sin ella.
_Avoid_: flow, nivel, lluvia del río

**Lecho**:
El cauce entero de un río, lleve agua o no. Con poco Caudal asoma como arena pálida a los lados del agua; seco, es lo único que queda.
_Avoid_: cauce, canal, riverbed

**Poza**:
Charca suelta que queda en el Lecho cuando el Caudal ya no da para un hilo continuo. Aparecen siempre en los mismos sitios del río.
_Avoid_: charco, pool, waterhole

**Cruce**:
Un tramo de un Río principal que la Manada atraviesa a menudo según los collares: el del Mara se concentra en torno a Kogatende, mientras el Grumeti y el Mbalageti se cruzan casi a lo largo de todo su curso. Un río puede tener varios; fuera de ellos la Manada no lo atraviesa. Cuándo se cruza lo decide la Presencia. En la realidad cada cruce es una sola orilla de bajada de unos cientos de metros, así que la Mancha se estrecha en un embudo al pasarlo. Pertenece a la migración, no al río.
_Avoid_: vado, crossing, paso

### Vegetación

**Cobertura**:
La proporción de árbol, matorral, hierba, suelo desnudo y humedal en cada punto del Mapa, derivada exclusivamente de un mapa de cobertura real, sin manchas añadidas a mano.
_Avoid_: woodland, máscara de bosque, landcover

**Verdor**:
Lo verde que está la vegetación en cada punto del Mapa en cada mes de un año medio, medido por satélite, no simulado a partir de la lluvia. Cambia a manchas: cada sitio pasa de un mes al siguiente en su propio momento.
_Avoid_: greenness, NDVI, verdor de la lluvia

**Quema**:
Una mancha de sabana que arde casi todos los años en su mes habitual. Queda negra, pasa a ceniza y, cuando llega el Verdor, rebrota más verde que lo de alrededor.
_Avoid_: fuego, burn, incendio

**Bosque de galería**:
La franja de árboles densos que bordea los ríos. Es la Cobertura la que la define, no la distancia al cauce.
_Avoid_: riparian, ribera

**Bosquete**:
Un grupo de árboles o matas que se dibuja con volumen sobre la Cobertura. Hay tres tipos: acacia paraguas, copa redonda y matorral bajo.
_Avoid_: árbol, tree, instancia

### Atmósfera

**Bruma**:
Masa de calima cálida y volumétrica que envuelve el Mapa en un óvalo irregular, con lenguas que entran desde el borde. Solo existe hacia los bordes: el terreno del interior se ve limpio, sin velo. Se encharca en lo bajo, se retira en las tierras altas (el Relieve la recorta) y deja siempre despejado cada lugar con nombre.
_Avoid_: niebla de guerra, fog, fog of war, fade del borde

### Fauna

**Manada**:
Los animales que migran juntos por el ciclo anual: ñus, cebras y gacelas de Thomson (los elands, pocos, se dejan fuera). A escala de Mapa se ve como una sola Mancha. Su número no cambia a lo largo del año: los Partos y las Bajas se cuentan con Señales, no con el tamaño de la Mancha. No incluye a los Residentes.
_Avoid_: herd, rebaño, migración, animales

**Residente**:
Un animal que vive todo el año en la misma zona y no sigue a la Manada: jirafa en las acacias, elefante en el Bosque de galería y el bosque del norte, búfalo donde hay agua y hierba alta, hipopótamo en los Ríos principales y las Pozas. Los hipopótamos se reparten por su río cuando hay Caudal y se apiñan en las Pozas cuando no.
_Avoid_: fauna local, animales de fondo

**Recorrido**:
La sucesión de lugares con nombre y fechas por la que pasa el centro de la Manada a lo largo del año: Ndutu (enero a mediados de marzo), Kopjes de Moru (abril), Seronera (mayo), Corredor occidental (junio), Kogatende (julio), Triángulo del Mara (agosto y septiembre, al otro lado del Mara), Kogatende (octubre), Lobo (noviembre) y de vuelta por Seronera a Ndutu (diciembre). Los lugares y las fechas se marcan a mano, como lo cuentan las fuentes; entre un lugar y el siguiente sigue el paso fácil por el Relieve, lejos de las orillas de los Ríos principales, y los cruza de frente y solo por sus Cruces.
_Avoid_: ruta, trayectoria, path

**Presencia**:
Cuánto se extiende la Manada en cada mes y en qué dirección se alarga, derivado exclusivamente de collares GPS de ñus de varios años. Da el tamaño y la orientación de la Manada alrededor del Recorrido, no su posición. Cebras y gacelas toman la de los ñus.
_Avoid_: densidad, heatmap, extensión

**Mancha**:
La forma en que se ve la Manada a escala de Mapa: un único líquido espeso, como barro, siempre de una pieza, que fluye por el Recorrido. Al trasladarse se estira en una corriente: la cabeza tira y la cola va detrás. En cada parada se encharca. Nunca salta ni se rompe.
_Avoid_: blob, metaball, líquido, gotas

**Apiñamiento**:
Lo apretada que va la Manada en cada punto de la Mancha. Es lo único de los eventos que se ve en la propia Mancha: donde más se apiña, más intenso es su color.
_Avoid_: densidad, superposición, Presencia

**Agolpamiento**:
La espera de la Manada en la orilla de un Cruce: la cabeza se para, la cola sigue llegando y la Mancha se encharca contra el río. Dura más cuanto más Caudal lleva el río y es sobre todo cosa del Mara, que se pasa en Kogatende a la ida y a la vuelta; en el Grumeti y el Mbalageti apenas hay espera.
_Avoid_: cola, atasco, espera

**Avalancha**:
El cruce en tropel que pone fin a un Agolpamiento: la Manada atraviesa el Cruce de golpe, más deprisa que su paso normal.
_Avoid_: estampida, cruce masivo

**Partos**:
La ventana de unas tres semanas, entre finales de enero y febrero, en que nacen las crías de ñu en las llanuras de Ndutu.
_Avoid_: nacimientos, crías, calving

**Baja**:
Un animal de la Manada que muere. El grueso cae en los Cruces del Mara durante las Avalanchas; fuera de ahí hay pocas, sueltas a lo largo del año.
_Avoid_: muerte, mortalidad

### Señales

**Señal**:
Una marca gráfica (destello o anillo) que cuenta un evento de la Manada sobre la Mancha, sin tocarla. Es lo único deliberadamente no naturalista del Mapa. Se ancla al lugar y la fecha que dan las fuentes, pero manda que se lea: el evento que cuenta puede alargarse en el calendario, y la Señal dura más que él. Las de Partos salen salpicadas sobre la Mancha, más seguidas en el pico de la ventana; las de Baja, de otro color, se apagan. Ninguna representa a un animal concreto.
_Avoid_: efecto, partícula, FX
