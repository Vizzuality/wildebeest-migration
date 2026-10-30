# Serengeti Migration

Visualización 2D del ciclo anual de la migración de ñus en el ecosistema Serengeti–Mara, pintada como un cuadro impresionista visto desde arriba.

## Language

### Territorio

**Mapa**:
El rectángulo geográfico que se representa, de lon 33,27 a 35,98 y de lat −0,67 a −3,67, con margen para que ningún lugar de la historia quede en la Bruma, medido en kilómetros desde el origen (34,85, −2,3).
_Avoid_: mundo, escena, bbox

**Brochazo**:
Un toque corto de pintura, puntillista e irregular, con su sitio fijo en el Mapa. Todo el Mapa está pintado con ellos: primero el suelo y, encima, la vegetación. Su color lo da lo que hay en ese punto en cada mes; nunca se mueve ni cambia de forma.
_Avoid_: punto, pincelada, stroke, dab, partícula

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
Agua quieta dentro del Mapa: la orilla oriental del Lago Victoria, partes de los lagos Eyasi, Manyara y Natron, y los lagos Ndutu y Masek, pequeños y salobres, en las llanuras del sur. Es la superficie plana que el DEM da a cada lago (en el caso del Victoria, la Cota base).
_Avoid_: agua, water mask, costa

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
La proporción de árbol, matorral, hierba, Cultivo, suelo desnudo y humedal en cada punto del Mapa, derivada exclusivamente de un mapa de cobertura real, sin manchas añadidas a mano.
_Avoid_: woodland, máscara de bosque, landcover

**Cultivo**:
Tierra de labor fuera de las áreas protegidas, sobre todo al oeste del Serengeti, al norte del Mara y en torno a Karatu. Se dibuja como un mosaico de parcelas de tierra roja, rastrojo y, con las lluvias, cosecha verde. Su borde marca el límite del parque.
_Avoid_: farmland, agricultura, campos

**Verdor**:
Lo verde que está la vegetación en cada punto del Mapa en cada mes de un año medio, medido por satélite, no simulado a partir de la lluvia. Cambia a manchas: cada sitio pasa de un mes al siguiente en su propio momento.
_Avoid_: greenness, NDVI, verdor de la lluvia

**Quema**:
Una mancha de sabana que arde casi todos los años en su mes habitual. Queda negra, pasa a ceniza y, cuando llega el Verdor, rebrota más verde que lo de alrededor.
_Avoid_: fuego, burn, incendio

**Bosque de galería**:
La franja de árboles densos que bordea los ríos. Es la Cobertura la que la define, no la distancia al cauce.
_Avoid_: riparian, ribera

### Atmósfera

**Bruma**:
El borde sin terminar del cuadro: hacia los bordes los Brochazos se espacian y se aclaran hasta dejar el papel desnudo, en un óvalo irregular con lenguas que entran desde el borde. El interior está pintado entero. Deja siempre pintado cada lugar con nombre.
_Avoid_: niebla de guerra, fog, fog of war, fade del borde, Corte, recorte

**Meteoro**:
Lo que el que mira vive del momento del año sin que cambie el Mapa: lluvia, sombras de nubes, polvo, humo y Reverbero. Cubre toda la imagen por igual, como si estuviera entre el ojo y el Mapa, y su fuerza la marca el tiempo que hace allí donde está la Manada. Acompaña, nunca tapa: la Mancha y las etiquetas se leen siempre. El humo solo sale cuando arde una Quema cerca de la Manada. No es la Bruma, que es del Mapa.
_Avoid_: clima, weather, efecto, overlay, partículas

**Chubasco**:
Un aguacero que llega y se va. La lluvia de cada Meteoro cae siempre a Chubascos, nunca seguida: la lluvia media medida de cada mes donde está la Manada decide cada cuánto llegan y cuánto duran. Las sombras de nubes llegan antes que los Chubascos de la estación y se quedan después.
_Avoid_: lluvia continua, tormenta, shower

**Polvo**:
El que levanta la Manada sobre el suelo seco. Lo seco lo da el Verdor donde está la Manada, y el paso de la Manada lo sube, sobre todo en una Avalancha. Con lluvia no hay Polvo.
_Avoid_: calima, arena, dust

**Reverbero**:
El temblor sutil de la imagen por el aire caliente sobre el suelo seco, cuando el Verdor donde está la Manada es pajizo, al final de la estación seca. Es un Meteoro, no una calima.
_Avoid_: calima de calor, heat haze, shimmer, espejismo

### Fauna

**Manada**:
Los animales que migran juntos por el ciclo anual: ñus, cebras y gacelas de Thomson (los elands, pocos, se dejan fuera). A escala de Mapa cada especie se ve como su propia Mancha. Su número no cambia a lo largo del año. No incluye a los Residentes.
_Avoid_: herd, rebaño, migración, animales

**Residente**:
Un animal que vive todo el año en la misma zona y no sigue a la Manada: jirafa en las acacias, elefante en el Bosque de galería y el bosque del norte, búfalo donde hay agua y hierba alta, hipopótamo en los Ríos principales y las Pozas. Los hipopótamos se reparten por su río cuando hay Caudal y se apiñan en las Pozas cuando no.
_Avoid_: fauna local, animales de fondo

**Recorrido**:
La sucesión de lugares con nombre y fechas por la que pasa el centro de los ñus a lo largo del año: Ndutu (enero a mediados de marzo), Kopjes de Moru (abril), Seronera (mayo), Corredor occidental (junio), Wogakuria (mediados de julio), Kogatende (finales de julio), Triángulo del Mara (agosto y septiembre, al otro lado del Mara), Kogatende (octubre), Lobo (noviembre) y de vuelta por Seronera a Ndutu (diciembre). Los lugares y las fechas se marcan a mano, como lo cuentan las fuentes; entre un lugar y el siguiente sigue el paso fácil por el Relieve, lejos de las orillas de los Ríos principales, y los cruza de frente y solo por sus Cruces. Las cebras siguen el mismo Recorrido mezcladas con la cabeza de los ñus, apenas por delante. Las gacelas de Thomson salen de Ndutu con los ñus, pero se quedan en Seronera de mayo a principios de diciembre en vez de ir al norte, y vuelven al sur con ellos.
_Avoid_: ruta, trayectoria, path

**Presencia**:
Cuánto se extiende la Manada en cada mes y en qué dirección se alarga, derivado exclusivamente de collares GPS de ñus de varios años. Da el tamaño y la orientación de la Manada alrededor del Recorrido, no su posición. Cebras y gacelas toman la de los ñus.
_Avoid_: densidad, heatmap, extensión

**Mancha**:
La forma en que se ve cada especie de la Manada a escala de Mapa: un único cuerpo espeso, como barro, siempre de una pieza, que fluye por el Recorrido. Al trasladarse se estira en una corriente: la cabeza tira y la cola va detrás. La cabeza avanza en dedos que se adelantan por el Recorrido y se quedan quietos en el suelo hasta que el resto los alcanza; la cola no hace dedos, se escurre y se adelgaza. En cada parada se encharca: el borde se extiende despacio, sin dedos. Se pega al suelo: coge un Brochazo en cuanto llega y tarda más en soltarlo al irse. Nunca salta ni se rompe. Las Manchas de distintas especies se funden en un solo cuerpo donde coinciden y se separan donde sus Recorridos se apartan. No tiene trazo propio: repinta del color de su especie los Brochazos que ya hay donde pasa la Manada, sin moverlos ni cambiarles la forma, y al irse la Manada vuelven a su color. Repinta tanto los del suelo como los de la vegetación. Cada Brochazo entra en la Mancha en su propio momento, así que su borde es granulado. El color no cambia de golpe: se pinta, con un barrido de pincel a lo largo del Brochazo, y al irse la Manada el color del suelo vuelve a pasar por encima de la misma manera. Cada Brochazo guarda la especie con que se pintó; solo cambia a otra cuando esa otra domina claramente, y otra vez con un barrido, nunca de golpe. Solo se extiende por el suelo que pisan los collares: nunca sobre un Lago ni encima de un escarpe al que no suben, salvo justo alrededor del Recorrido, para no romperse. El Mara la corta: solo pasa a la otra orilla por donde la cruza.
_Avoid_: blob, metaball, líquido, gotas, punteado, malla de puntos

**Agolpamiento**:
La espera de la Manada en la orilla de un Cruce: la cabeza se para, la cola sigue llegando y la Mancha se encharca contra el río. Dura más cuanto más Caudal lleva el río y es sobre todo cosa del Mara, que se pasa en Kogatende a la ida y a la vuelta; en el Grumeti y el Mbalageti apenas hay espera. Las cebras, que van en la cabeza, llegan algo antes y cruzan primero.
_Avoid_: cola, atasco, espera

**Avalancha**:
El cruce en tropel que pone fin a un Agolpamiento: la Manada atraviesa el Cruce de golpe, más deprisa que su paso normal.
_Avoid_: estampida, cruce masivo


### Relato

**Capítulo**:
Uno de los cinco tramos en que se cuenta el año, cada uno anclado a un lugar del Recorrido y a una fecha, con su título y su texto (por ejemplo, "The crossing": el Mara, 1 de agosto). Va desde su fecha hasta la del siguiente.
_Avoid_: escena, sección, paso, chapter
