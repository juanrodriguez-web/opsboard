/**
 * Vercel API Endpoint - Process Intake
 * Ejecuta el script de procesamiento y devuelve el resultado
 * Puede ser llamado manualmente desde OpsBoard o por cron
 */

const { spawn } = require('child_process')
const path = require('path')

const executeScript = () => {
  return new Promise((resolve, reject) => {
    // En Vercel, ejecutar el script local no es viable
    // En su lugar, devolvemos instrucciones para ejecutar manualmente
    resolve({
      message: 'Para ejecutar localmente, usa: npm run process-intake',
      manual: true,
    })
  })
}

module.exports = async (req, res) => {
  // Verificar token de autorización simple
  const token = req.query.token || req.body.token
  if (token !== process.env.INTAKE_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const result = await executeScript()
    return res.status(200).json(result)
  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
}
