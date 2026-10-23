---
status: accepted
---

# El Mapa se pinta en 2D como un cuadro puntillista

El Mapa era una maqueta 3D: Relieve exagerado, recortado en un Corte con paredes y estratos sobre una mesa de arena, con Bosquetes en volumen, luz, bloom y tone mapping. El diseño nuevo lo cambia por un cuadro visto desde arriba, pintado con Brochazos puntillistas sobre papel, y se sigue tal cual aunque tira mucho trabajo hecho. Todo lo del Mapa (suelo, vegetación, ríos, Lagos, Cultivo, Quemas y la Mancha) es solo el color de unos Brochazos fijos; nada tiene geometría propia.

## Consecuencias

- El Relieve sigue saliendo del DEM, pero solo como dato: guía el Recorrido entre lugares y marca los escarpes y los Lagos que limitan la Mancha. No se ve como altura ni como sombreado.
- Se retiran el Corte, los Bosquetes, la Exageración vertical, las luces y el postproceso. La Bruma pasa a ser el borde sin terminar del cuadro.
- La Mancha deja de tener malla propia: repinta los Brochazos por donde pasa. Como los Brochazos no cambian de forma, el Apiñamiento (puntos más grandes donde la Manada se apiña) desaparece.
- La cámara se queda fija sobre todo el Mapa; ya no sigue a la Manada.
- Los Meteoros se apagan hasta que el cuadro esté hecho; los Residentes y los animales de cerca hay que repensarlos para 2D.
