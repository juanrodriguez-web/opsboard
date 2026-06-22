/**
 * Vercel API Endpoint - Process Intake
 * Ejecuta el script de procesamiento y devuelve estadísticas
 */

const { execSync } = require('child_process')

module.exports = async (req, res) => {
  // Permite POST desde localhost o mismo origin
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const startTime = Date.now()

    // Ejecutar el script de process-intake
    let output = ''
    try {
      output = execSync('npm run process-intake', {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 120000 // 2 minutos máximo
      })
    } catch (execError) {
      output = execError.stdout || execError.stderr || execError.message
    }

    const duration = Date.now() - startTime

    // Parsear el output para extraer estadísticas
    const stats = {
      archivosEncontrados: 0,
      archivosProcessados: 0,
      itemsActualizados: 0,
      proyectosDetectados: 0,
      duracion: duration,
      timestamp: new Date().toISOString(),
      detalles: []
    }

    // Extraer información del output
    const lineas = output.split('\n')
    lineas.forEach(linea => {
      const archivosMatch = linea.match(/Encontrados\s+(\d+)\s+archivos/)
      const itemMatch = linea.match(/✓.*Item actualizado:\s+(.+)/)
      const proyectoMatch = linea.match(/Proyecto actualizable:\s+(.+?)/)
      const procesoMatch = linea.match(/✓.*Archivo procesado/)

      if (archivosMatch) {
        stats.archivosEncontrados = parseInt(archivosMatch[1])
      }
      if (itemMatch) {
        stats.itemsActualizados++
        stats.detalles.push({
          tipo: 'item_actualizado',
          nombre: itemMatch[1].trim(),
          timestamp: new Date().toISOString()
        })
      }
      if (proyectoMatch) {
        stats.proyectosDetectados++
      }
      if (procesoMatch) {
        stats.archivosProcessados++
      }
    })

    return res.status(200).json({
      success: true,
      message: '✅ Procesamiento completado',
      stats,
      output: output.substring(0, 500) // Primeros 500 chars del output
    })
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
      message: '❌ Error en el procesamiento',
      timestamp: new Date().toISOString()
    })
  }
}
