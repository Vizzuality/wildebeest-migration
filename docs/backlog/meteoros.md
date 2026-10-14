# Meteoros

Status: needs-triage

## Problema

El momento del año solo se ve en el Mapa: el Verdor, el Caudal, las Quemas. El que mira no vive nada de la estación: no llueve en las lluvias largas, no hay polvo cuando la Manada cruza la llanura seca, no huele a humo cuando arde la sabana.

## Decidido

- Los Meteoros son una capa entre el ojo y el Mapa que cubre toda la imagen por igual. No se toca el Mapa ni la Bruma; nada se ancla al suelo.
- Cinco Meteoros: lluvia, sombras de nubes, Polvo, humo y Reverbero. Relámpagos y columnas de humo con base en el suelo quedan fuera.
- Su fuerza la marca el tiempo que hace donde está la Manada (el punto al que mira la cámara), no la media del Mapa. Al irse al norte en junio, la lluvia se apaga con ella.
- **Lluvia**: cae a Chubascos, nunca seguida. La lluvia media de cada mes, medida (una climatología por punto del Mapa preparada de antemano, como el Verdor), decide cada cuánto llegan y cuánto duran. La tabla ilustrativa `RAIN_SOUTH`/`RAIN_NORTH` de `src/geo.ts` no vale para esto.
- **Sombras de nubes**: manchas suaves y oscuras que cruzan la imagen. Siguen a la misma lluvia, pero llegan antes que los Chubascos de la estación y se quedan después.
- **Polvo**: la base la da lo seco que está el suelo, según el Verdor donde está la Manada; el paso de la Manada lo sube, sobre todo en una Avalancha (`agolpamiento-en-cruces.md`). Con lluvia no hay Polvo.
- **Humo**: velo con ceniza flotando que entra por un lado de la imagen, solo cuando arde una Quema cerca de la Manada en su mes habitual.
- **Reverbero**: temblor sutil de toda la imagen, igual en todo el encuadre, cuando el Verdor donde está la Manada es pajizo (ago–oct, Triángulo del Mara y Kogatende).
- Acompañan, nunca tapan: la Mancha y las etiquetas se leen siempre, también en el peor Chubasco o la peor nube de Polvo.
- Los Chubascos van con el momento del año, no con el reloj: un enlace `?mes=…` cae siempre en el mismo Chubasco o en el mismo claro. En pausa el Chubasco se queda, pero la lluvia sigue cayendo y el Polvo flotando; al acelerar el año pasan más deprisa.
- Con "reducir movimiento" activado en el sistema, el Reverbero desaparece y la lluvia y el Polvo se suavizan.

## Contexto

Términos en `CONTEXT.md`: Meteoro, Chubasco, Polvo, Reverbero, Bruma, Verdor, Quema, Avalancha.
