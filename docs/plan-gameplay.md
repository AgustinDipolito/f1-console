# Plan de expansión de gameplay

Sale del brief «F1 Console - Brief de expansión de gameplay» (v0.1, 23 de octubre de 2026) cruzado con el código de hoy. Cada tarea tiene dependencias y criterios de aceptación medibles. El alcance de esta entrega sigue las decisiones del propio brief (sección 10): primero la cadena récord con historial, comparación y repetición; después lo que hace que una carrera genere otra. Campeonato, supervivencia y equipos quedan planeados y sin implementar hasta que esa cadena se pruebe con personas.

## 1. Comprensión

- Requerimiento: convertir la consola en un instrumento que se aprende, se usa para resolver situaciones y se compara contra otras personas. Cuatro pasos: correr algo reproducible, ver el resultado con diagnóstico, revisar qué comando se hizo y cuándo, repetir o correr contra alguien.
- Actores: el jugador solo (computadora o teléfono), el jugador en sala (2 a 4), quien recibe un link de fantasma sin haber jugado.
- Entidades nuevas: evento de comando, traza versionada, categoría de récord, escenario, macro, perfil de bot, resultado de desafío.
- Lo que cambia sin que nadie lo pida: la mejor vuelta guardada pasa a tener categoría (hoy mezcla 1 vuelta en fácil con 5 en difícil); el link de fantasma crece; la tabla de resultados nombra a los bots; la ayuda suma teclas y secciones; el service worker guarda los módulos nuevos solo.

## 2. Auditoría del sistema actual (hechos)

| Hecho | Dónde |
|---|---|
| La caja negra `Lap.rec` registra consola y estado cada 10 m, solo en la sesión | `src/sim/car.ts` `blackBox`, `record`; `src/sim/types.ts` |
| La mejor vuelta se guarda por circuito, sin vueltas ni dificultad, sin `rec` | `src/config.ts` `saveBest`, clave `f1c.best.v1.` |
| El link de fantasma es `circuito~nombre~bytes`, versión 1, sin eventos | `src/net/protocol.ts` `lapBytes`, `GHOST_VER` |
| El diagnóstico reparte pérdidas por causa y tramo y se memoriza por vuelta | `src/sim/diagnose.ts` `lapDiagnosis` |
| La telemetría muestra velocidad, delta contra la mejor, pérdidas y tabla de vueltas; no tiene cursor ni repetición | `src/ui/telemetry.ts` |
| La carrera siempre lleva bots según config y arranca con batería 80, motor 80, gomas 100, nafta por dificultad | `src/sim/race.ts` `reset`; `src/sim/car.ts` `newCar`; `START`, `FUEL.LOAD` |
| Las fallas son un sorteo por paso con RNG sembrado; no hay falla programada | `src/sim/car.ts` `rollFault` |
| Los bots se llaman «Bot N» y difieren solo por `SPREAD` alrededor de la dificultad | `src/sim/race.ts` `names`; `src/bot/bot.ts` `botLevel` |
| Sonido: motor, clic, pitidos de largada y alarma; vibración: toque y fusible | `src/audio/sound.ts`; `src/ui/device.ts` |
| El resultado abre un diálogo con tabla, telemetría, otro circuito y correr de nuevo | `src/ui/results.ts`; `main.ts` `finish` |
| Los fantasmas en el mapa son la mejor vuelta y el rival, por `ghostS` | `main.ts` `ghostsAt` |
| La cabecera del teléfono tiene cuatro acciones con ícono en un renglón de 360 px | `index.html`; `styles.css` `.bar .act` |
| La calibración corre contra el bot 0, que tiene que seguir exacto | `tests/calibrate.cal.ts`; `tests/bots.test.ts` |

Riesgos de regresión: `frameKey` del mapa (lo nuevo que se dibuja tiene que entrar en la clave), `check:mobile` (la cabecera y los diálogos tienen que entrar en 360 × 640 y 844 × 340), el build file:// (módulos nuevos cargados con `import()`), la lista del service worker (la arma el build sola).

## 3. Decisiones de diseño que fija este plan

1. Versión de reglas `SIM_VER` en `sim/physics.ts`. Sube con cualquier cambio de números o fórmulas. Entra en la categoría del récord y en el código del fantasma.
2. Categoría de récord: circuito, versión de reglas, vueltas y dificultad (la dificultad fija la carga de nafta, y el peso cambia el tiempo). El récord viejo sin categoría se conserva como referencia marcada «anterior» y no se compara.
3. Eventos de comando: un registro por cambio de valor de cada control, con distancia y tiempo de vuelta. Los registra la simulación al mismo tiempo que la caja negra. Un macro deja además su propio evento.
4. Traza versionada: `Lap` crece con `ev` (eventos) y `sm` (muestras de estado cada 50 m). El código del fantasma pasa a versión 2 con categoría, eventos y muestras. La versión 1 se sigue leyendo como fantasma sin historial.
5. Un modo por carrera: carrera (hoy), mejor vuelta, persecución y desafío. Se elige en un diálogo nuevo «Modo» desde la cabecera y queda guardado en la config. Cada modo dice en una frase qué se intenta lograr.
6. Escenario declarativo (`sim/scenario.ts`): datos, no ramas. Los desafíos corren contra un bot con las mismas condiciones iniciales y semilla fija. Ganar es terminar delante del bot cumpliendo la restricción del escenario.
7. Macros: dos, Ataque (potencia push, ERS attack) y Conservación (eco, harvest). Cambian solo potencia y ERS. Teclas Z y X y dos botones. Sin espera artificial.
8. Perfiles de bot: estilo separado del nivel. El bot 0 queda exacto (la calibración corre contra él). Nombres inventados, sin parecido con pilotos reales.
9. Lenguaje de respuesta de la consola con prioridades: falla, advertencia, fase, acierto, confirmación. Reusa los toggles de sonido y vibración.
10. Sin servidor: todo local y por link. Sin analítica externa.

## 4. Tareas

Formato: id · nombre · prioridad · depende de · criterios de aceptación. «Puro» quiere decir que corre en Node y lleva test.

### Etapa 0 · Base

- **T00 · Versión de reglas** · P0 · — · `SIM_VER` exportada; un test la lee. Documentada en CLAUDE.md como regla.

### Etapa 1 · Traza y récord (F01 parte de datos, F02 datos, 4.1 a 4.3)

- **T01 · Eventos de comando en la simulación** · P0 · T00 · Puro. `Lap.ev` recibe un evento por cambio de `lev`, `ers`, `bal`, `dif`, `eb`, `lim` y por pulsación de fusible, con `s` (m) y `t` (s de vuelta). Un paso sin cambios no agrega eventos. Test: una vuelta con 3 cambios tiene 3 eventos en el orden y la distancia correctos; los bots no acumulan sin tope.
- **T02 · Muestras de estado** · P0 · T01 · Puro. `Lap.sm` cada 50 m con batería, temperatura, gomas y nafta redondeadas. Test: cantidad = ceil(len/50) y valores dentro de rango.
- **T03 · Categoría de récord** · P0 · T00 · Puro. `recordKey(track, laps, difficulty)` y `recordCategory` legibles. `saveBest`/`loadBest` v2 por categoría con `ev` y `sm`; v1 se carga como `legacy: true` solo si no hay v2 de la categoría. Test: un tiempo peor no pisa; otra categoría no toca; el v1 se lee y se marca.
- **T04 · Código de fantasma v2** · P0 · T01, T02, T03 · Puro. `encodeGhost` v2 con categoría, eventos y muestras en bytes compactos; `decodeGhost` lee v1 y v2; datos dañados devuelven null sin excepción. Un fantasma de otra categoría se acepta con `comparable: false`. Test: ida y vuelta exacta; v1 sigue decodificando; tamaño de un link de 5 km con 60 eventos por debajo de 2.000 caracteres.
- **T05 · Comparación de dos vueltas por tramo** · P0 · T01 · Puro. `compareLaps(track, a, b)` devuelve por tramo: delta ganado o perdido, eventos de cada vuelta con la distancia desde el inicio del tramo, recursos en la entrada (de `sm`). Ordenable por costo. Test: dos vueltas idénticas dan delta 0 en todos los tramos; una con un cambio tardío señala ese tramo.
- **T06 · Marca de macro en la traza** · P1 · T01 · Puro. `race.mark('macro', id)` agrega un evento `macro` en la vuelta en curso. Test: aparece una vez por aplicación.

### Etapa 2 · Modos y escenarios (F02, F03, F06, 4.4)

- **T10 · Modo de juego en la config** · P0 · — · `Config.mode` (`race` | `tt` | `chase` | `challenge`) y `Config.challenge`. Sube `REV` si cambia algún valor de fábrica. Test de carga con config vieja.
- **T11 · Modelo de escenario** · P0 · T00 · Puro. `Scenario` con condiciones iniciales (batería, temperatura, gomas, fracción de nafta), falla programada (vuelta, distancia, fusible), bots, vueltas, dificultad, semilla, reglas (macros sí/no) y criterio. `newCar` acepta `start`; `stepCar` aplica la falla programada al pasar por el punto; `Race` recibe `scenario`. Test: el auto arranca con lo pedido; el fusible salta en el punto a ±10 m en los 40 trazados; con la misma semilla, dos carreras dan el mismo orden.
- **T12 · Evaluación del escenario** · P0 · T11 · Puro. `evaluate(scenario, race)` devuelve éxito o fracaso, la métrica observable y el texto. Criterios: delante del bot, motor nunca por encima del límite, sin quedarse sin nafta, gomas por encima de un piso. Test por criterio con casos de éxito y fracaso.
- **T13 · Cuatro desafíos** · P0 · T11, T12 · Datos: «La última vuelta» (batería y nafta justas, 1 vuelta), «No pases de 100°» (motor en 95° al largar, 2 vueltas), «El fusible falló» (ERS salta en un punto fijo de la vuelta 1), «Gomas al límite» (gomas al 35 %, 3 vueltas). Test: cada uno es ganable por el bot modelo ideal y perdible por un jugador que deja la consola fija, en el circuito del desafío.
- **T14 · Modo mejor vuelta** · P0 · T03, T10 · Sin bots; el récord de la categoría es la referencia; delta en pantalla contra el récord; al cruzar la meta el mensaje dice si hubo récord; Largar de nuevo no pierde el récord. Test de main no hay: se revisa en el navegador y en `check:mobile`.
- **T15 · Modo persecución** · P1 · T03, T04, T10 · Fantasma objetivo (récord propio o rival) con ventaja inicial configurable (3, 6 o 10 s). Regla única: ganás si cruzás la meta antes de que el fantasma complete sus vueltas (`fin < vueltas × t_fantasma − ventaja`). El fantasma se ve en el mapa con su etiqueta. Test puro de la regla con empates.

### Etapa 3 · Interfaz del ciclo de aprendizaje (F01 UI, F09, F10 parte)

- **T20 · Diálogo Modo** · P0 · T10, T13 · Botón nuevo en la cabecera con ícono. Lista los cuatro modos con una frase cada uno; los desafíos con título, contexto, objetivo y botón «Correr». El modo elegido se ve en el renglón de la carrera. Entra en 360 × 640 y 844 × 340 sin desplazar la pantalla de juego.
- **T21 · Repetición de caja negra** · P0 · T01, T02, T05 · En telemetría: cursor sobre el gráfico de velocidad, barra de tiempo con reproducir, pausa, velocidad (×1, ×2, ×4) y saltos al evento anterior o siguiente; mapa chico del circuito con el auto en el punto; lectura de la consola y del auto en ese punto; marcas de pérdidas, cambios, fusible y temperatura. No recalcula nada: lee `rec`, `ev` y `sm`. Cursor, mapa y lectura salen del mismo índice.
- **T22 · Comparación con el fantasma** · P0 · T05, T21 · Tarjeta «Contra el fantasma» con los tramos ordenados por diferencia y, por tramo, los comandos de cada uno con su distancia. Tres vistas: solo yo, solo el rival, diferencias. Si el fantasma no tiene historial, lo dice y muestra solo el delta. Si es de otra categoría, lo advierte.
- **T23 · Resultado de desafío** · P0 · T12, T20 · El diálogo de resultados dice éxito o fracaso con la métrica, la decisión que más pesó (del diagnóstico) y «Correr de nuevo» con la misma semilla. «Ver en la repetición» abre la telemetría en el punto de la pérdida más cara.
- **T24 · Récord anterior visible** · P0 · T03 · Donde hoy dice «Mejor vuelta en este circuito» dice la categoría; un récord v1 aparece como «anterior, otra categoría».

### Etapa 4 · Que una carrera genere otra (F07, F08, F10, F11)

- **T30 · Macros Ataque y Conservación** · P1 · T06 · Definición en `console/panel.ts`. Dos botones bajo el volante (44 px en táctil) y teclas Z y X. Al aplicar, el comentarista escribe qué cambió. Los controles siguen editables. En un escenario con `macros: false` no aparecen. Test: aplicar y revertir deja la consola como estaba; la definición no toca `dif`, `eb` ni `bal`.
- **T31 · Lenguaje de respuesta de la consola** · P1 · — · Puro en `ui/feedback.ts`: dado el estado anterior y el nuevo devuelve a lo sumo una señal por cuadro, con prioridad falla > advertencia > fase > acierto > confirmación, y sin repetir la misma advertencia dentro de 10 s. Señales nuevas: advertencia (motor al límite, batería baja, nafta corta), fin de vuelta, meta. Sonido y vibración distintos por clase. Test de prioridad y de frecuencia.
- **T32 · Perfiles de bot con nombre** · P1 · — · Puro. Estilos metódico, atacante, conservador y frenador con parámetros medibles; nombres inventados para 10 bots; el bot 0 queda exacto. La grilla, la tabla y las etiquetas usan el nombre; el resultado muestra un rasgo. Test: dos bots del mismo nivel y distinto estilo terminan a menos de 2 % entre sí en el óvalo y con tiempos por tramo distintos; `npm run calibrate` sigue en verde.
- **T33 · Ayuda y bienvenida** · P1 · T20, T30, T32 · La ayuda explica modos, desafíos, macros y perfiles; teclas Z y X en la solapa Teclas. Los textos con números los sacan del modelo.

### Etapa 5 · Cierre

- **T40 · Service worker y builds** · P0 · todas · `npm run build` abre desde file:// con los módulos nuevos; `build:web` los lista en `sw.js`.
- **T41 · Revisión en teléfono** · P0 · todas · `npm run check:mobile` sin fallas; capturas del diálogo Modo y de la repetición.
- **T42 · CLAUDE.md** · P0 · todas · Arquitectura, reglas (`SIM_VER`, categoría), estado y backlog al día.

### Planeado y sin implementar en esta entrega (el brief lo pospone hasta validar la cadena anterior)

- **T50 · Campeonato de tres pistas** (F04) · P2 · T10, T32 · Calendario, puntos por puesto, tabla con desempate, guardado local, regla visible al abandonar. Criterio: los puntos sobreviven a cerrar la app; una ronda no cuenta dos veces.
- **T51 · Supervivencia** (F05) · P2 · T32 · Diez autos, eliminación del último cada 60 s de carrera por progreso real, desempate documentado, aviso antes de eliminar, revancha con la misma semilla. Criterio: la misma semilla da las mismas eliminaciones.
- **T52 · Más desafíos** (F06) · P2 · T13 · Clasificación a una vuelta y cambio de condiciones.
- **T53 · Prueba técnica de equipos** (F12) · P3 · T32 · Dos clientes y cuatro bots con semilla fija; comparar orden de llegada en los dos navegadores antes de dibujar una pantalla.
- **T54 · Equipos** (F12) · P3 · T53 · Dos humanos por equipo, puntos por piloto y escudería, regla visible de desconexión.

## 5. Dependencias en una línea

T00 → T01 → T02 → T04; T00 → T03 → T04; T01 → T05 → T21 → T22; T00 → T11 → T12 → T13 → T20 → T23; T10 → T14, T15; T06 → T30; T31 y T32 son independientes; T33 al final de la etapa 4; T40 a T42 al cierre.

## 6. Preguntas de validación (sección 6 del brief)

Se prueban con cinco a ocho personas que no desarrollaron el juego, con el mismo desafío: ¿entiende qué hacer?, ¿identifica por qué perdió?, ¿quiere repetir?, ¿abre el fantasma de otro y encuentra una diferencia? El umbral interno es 4 de 5 en la primera, 3 de 5 en la segunda y revancha espontánea.

## 7. Estado de las tareas

| Tarea | Estado | Motivo |
|---|---|---|
| T00 a T06 | hecha | `SIM_VER`, eventos, muestras, categoría de récord, código de fantasma v2, comparación por tramo y marca de macro. |
| T10 a T15 | hecha | Modo en la config, escenario y su evaluación, los cuatro desafíos, mejor vuelta y persecución. |
| T20 a T24 | hecha | Diálogo Modo, repetición, comparación con el fantasma, resultado de desafío y récord con su categoría. |
| T30 a T33 | hecha | Macros Ataque y Ahorro, señales con prioridad, bots con nombre y estilo, ayuda y bienvenida al día. |
| T40 | hecha | `npm run build` (file://) y `build:web` con los módulos nuevos; `sw.js` los lista. |
| T41 | hecha | `npm run check:mobile` sin fallas, con Modo, la lista de desafíos, los resultados de una vuelta y la repetición. |
| T42 | hecha | CLAUDE.md al día (reglas 12 y 13, arquitectura, estado y pendiente). |
| T50 | no hecha | Campeonato de tres pistas: queda planeado por decisión del brief, hasta probar la cadena anterior con personas. |
| T51 | no hecha | Supervivencia: igual que T50. |
| T52 | no hecha | Más desafíos (clasificación a una vuelta, cambio de condiciones): igual que T50. |
| T53 | no hecha | Prueba técnica de equipos: igual que T50. |
| T54 | no hecha | Equipos: depende de T53 y del mismo orden de decisiones del brief. |
