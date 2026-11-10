# Ritmo — Control de máquinas

App web instalable para registrar las lecturas acumuladas del tablero del taller.

## Usarla en iPhone

1. Publica estos archivos en un sitio estático con HTTPS.
2. Abre la dirección en Safari del iPhone.
3. Pulsa **Compartir → Añadir a pantalla de inicio**.
4. En **Registro**, usa **Tomar foto** o **Fototeca** para agregar fotos de todas las páginas del tablero. La fecha y la hora se asignan automáticamente con la hora de captura guardada en la foto; si la imagen no tiene esos datos, se usa la fecha del archivo o la hora de adjunto. No se pueden editar. Revisa y completa cualquier campo que el lector no haya detectado; luego guarda.
5. En **Historial**, descarga el informe `.xlsx` para abrirlo en Excel o compartirlo.
6. Usa **Borrar historial** para eliminar del dispositivo todas las lecturas guardadas; la app pide confirmación antes de hacerlo.

El OCR y la exportación cargan sus librerías al usarse y necesitan conexión a internet. Las fotos se procesan en el navegador y no se guardan; solo las lecturas con fecha y hora se almacenan localmente en ese dispositivo y navegador, sin sincronización entre dispositivos.

El uso se calcula como la diferencia entre dos lecturas del contador. Para obtener el uso de cada día, registra una lectura diaria; si faltan días, el informe muestra el total del intervalo, no una distribución diaria estimada.
