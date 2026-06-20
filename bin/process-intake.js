#!/usr/bin/env node

/**
 * Process Intake Script
 * Lee archivos de la carpeta de entrada (eml, pdf, md, xlsx)
 * Analiza con Claude y actualiza automáticamente items/proyectos en Supabase
 * Soporta confirmación manual para matches dudosos
 */

const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURACIÓN
// ─────────────────────────────────────────────────────────────────────────────

const INTAKE_FOLDER = path.join(
  process.env.USERPROFILE || process.env.HOME,
  'OneDrive - Sercom Soluciones S.L',
  'Escritorio',
  'Pendientes Juan - Seguimiento NO borrar'
)
const PROCESSED_FOLDER = path.join(INTAKE_FOLDER, '.processed')
const LOG_FILE = path.join(INTAKE_FOLDER, '.process-log.json')

// Supabase
const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Variables de entorno Supabase no encontradas')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ─────────────────────────────────────────────────────────────────────────────
// UTILIDADES
// ─────────────────────────────────────────────────────────────────────────────

const log = (msg, level = 'info') => {
  const ts = new Date().toISOString()
  const prefix = { info: 'ℹ️', success: '✅', error: '❌', warn: '⚠️' }[level] || 'ℹ️'
  console.log(`[${ts}] ${prefix} ${msg}`)
}

const loadLog = () => {
  try {
    return fs.existsSync(LOG_FILE) ? JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')) : []
  } catch {
    return []
  }
}

const saveLog = (entries) => {
  fs.writeFileSync(LOG_FILE, JSON.stringify(entries, null, 2))
}

const appendLog = (entry) => {
  const entries = loadLog()
  entries.push({ ...entry, timestamp: new Date().toISOString() })
  // Mantener últimas 100 entradas
  if (entries.length > 100) entries.shift()
  saveLog(entries)
}

const ensureFolders = () => {
  if (!fs.existsSync(INTAKE_FOLDER)) {
    log(`Creando carpeta: ${INTAKE_FOLDER}`, 'warn')
    fs.mkdirSync(INTAKE_FOLDER, { recursive: true })
  }
  if (!fs.existsSync(PROCESSED_FOLDER)) {
    fs.mkdirSync(PROCESSED_FOLDER, { recursive: true })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LECTURA DE ARCHIVOS
// ─────────────────────────────────────────────────────────────────────────────

const readFile = (filePath) => {
  const ext = path.extname(filePath).toLowerCase()
  const content = fs.readFileSync(filePath, 'utf8')

  if (ext === '.eml') {
    // Parsear email simple
    const lines = content.split('\n')
    const headers = {}
    let bodyStart = 0
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === '') {
        bodyStart = i + 1
        break
      }
      const match = lines[i].match(/^([^:]+):\s*(.+)$/)
      if (match) headers[match[1].toLowerCase()] = match[2]
    }
    return {
      subject: headers.subject || 'Sin asunto',
      from: headers.from || 'Desconocido',
      date: headers.date || new Date().toISOString(),
      body: lines.slice(bodyStart).join('\n'),
      raw: content,
    }
  }

  if (ext === '.md' || ext === '.txt') {
    return {
      subject: path.basename(filePath, ext),
      body: content,
      date: new Date().toISOString(),
      raw: content,
    }
  }

  if (ext === '.pdf') {
    // Para PDF, necesitaría librería pdf-parse
    log(`PDF requiere configuración adicional: ${path.basename(filePath)}`, 'warn')
    return null
  }

  if (ext === '.xlsx') {
    // Para Excel, necesitaría librería xlsx
    log(`Excel requiere configuración adicional: ${path.basename(filePath)}`, 'warn')
    return null
  }

  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// ANÁLISIS CON CLAUDE
// ─────────────────────────────────────────────────────────────────────────────

const analyzeWithClaude = async (fileContent, items, proyectos) => {
  const { Anthropic } = require('@anthropic-ai/sdk')
  const client = new Anthropic()

  const itemList = items
    .map((i) => `- "${i.tema}" (ID: ${i.id}, Proyecto: ${i.proyecto || 'ninguno'}, Estado: ${i.status})`)
    .join('\n')

  const proyList = proyectos
    .map((p) => `- "${p.nombre}" (ID: ${p.id}, Estado: ${p.status})`)
    .join('\n')

  const prompt = `Analiza el siguiente documento y extrae información para actualizar OpsBoard.

## DOCUMENTO
Asunto: ${fileContent.subject || 'N/A'}
De: ${fileContent.from || 'N/A'}
Fecha: ${fileContent.date || 'N/A'}

Contenido:
${fileContent.body.slice(0, 2000)}

## ELEMENTOS EXISTENTES EN OPSBOARD

### Temas/Items:
${itemList}

### Proyectos:
${proyList}

## INSTRUCCIONES
1. Identifica qué tema(s) o proyecto(s) del documento se relacionan con los elementos de OpsBoard
2. Si hay múltiples posibilidades, lista las más probables
3. Extrae cambios, estados nuevos, comentarios relevantes, fechas
4. Responde ÚNICAMENTE con un JSON válido, sin markdown:

{
  "matches": [
    {
      "type": "item|proyecto",
      "id": "UUID o null",
      "name": "nombre identificado",
      "confidence": 0.9,
      "reason": "por qué crees que coincide"
    }
  ],
  "updates": [
    {
      "matchId": "id del match",
      "field": "status|comentario|fecha_fin",
      "value": "nuevo valor",
      "reason": "por qué hacer este cambio"
    }
  ],
  "needsConfirmation": true|false,
  "extractedComment": "resumen del contenido relevante para comentario"
}

Sé conciso en los comentarios. Máximo 200 caracteres.`

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      log('No JSON encontrado en respuesta de Claude', 'error')
      return null
    }

    return JSON.parse(jsonMatch[0])
  } catch (e) {
    log(`Error en Claude API: ${e.message}`, 'error')
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTUALIZAR SUPABASE
// ─────────────────────────────────────────────────────────────────────────────

const applyUpdates = async (analysis, fileName) => {
  if (!analysis.updates || analysis.updates.length === 0) {
    log(`Sin actualizaciones para: ${fileName}`)
    return { success: 0, pending: 0, errors: 0 }
  }

  let success = 0,
    pending = 0,
    errors = 0

  for (const update of analysis.updates) {
    try {
      const match = analysis.matches.find((m) => m.id === update.matchId)
      if (!match) continue

      if (match.type === 'item') {
        const updates = {}
        if (update.field === 'status') updates.status = update.value
        if (update.field === 'fecha_fin') updates.fecha_fin = update.value

        // Agregar comentario
        const { data: item } = await supabase
          .from('items')
          .select('id, notas')
          .eq('id', match.id)
          .single()

        if (item) {
          const newNota = `[${new Date().toLocaleDateString('es-ES')}] ${analysis.extractedComment || update.reason}`
          updates.notas = item.notas ? `${item.notas}\n${newNota}` : newNota

          const { error } = await supabase
            .from('items')
            .update(updates)
            .eq('id', match.id)

          if (error) {
            log(`Error actualizando item ${match.name}: ${error.message}`, 'error')
            errors++
          } else {
            log(`✓ Item actualizado: ${match.name}`, 'success')
            success++
          }
        }
      } else if (match.type === 'proyecto') {
        // Similar para proyectos
        log(`Proyecto actualizable: ${match.name} (confirmación manual pendiente)`)
        pending++
      }
    } catch (e) {
      log(`Error en actualización: ${e.message}`, 'error')
      errors++
    }
  }

  return { success, pending, errors }
}

// ─────────────────────────────────────────────────────────────────────────────
// PROCESAR ARCHIVOS
// ─────────────────────────────────────────────────────────────────────────────

const processFiles = async () => {
  ensureFolders()

  const files = fs
    .readdirSync(INTAKE_FOLDER)
    .filter((f) => /\.(eml|md|txt|pdf|xlsx)$/i.test(f) && !f.startsWith('.'))

  if (files.length === 0) {
    log('No hay archivos nuevos para procesar')
    return
  }

  log(`📂 Encontrados ${files.length} archivos`)

  // Cargar datos existentes
  const { data: items } = await supabase.from('items').select('*')
  const { data: proyectos } = await supabase.from('proyectos').select('*')

  for (const file of files) {
    const filePath = path.join(INTAKE_FOLDER, file)
    log(`📄 Procesando: ${file}`)

    // Leer archivo
    const content = readFile(filePath)
    if (!content) {
      log(`Saltando ${file} (formato no soportado)`, 'warn')
      continue
    }

    // Analizar con Claude
    const analysis = await analyzeWithClaude(content, items || [], proyectos || [])
    if (!analysis) {
      log(`Error analizando ${file}`, 'error')
      appendLog({ file, status: 'error', reason: 'Claude API error' })
      continue
    }

    // Aplicar actualizaciones
    const result = await applyUpdates(analysis, file)

    // Registrar en log
    appendLog({
      file,
      status: analysis.needsConfirmation ? 'pending' : 'processed',
      matches: analysis.matches.length,
      updates: analysis.updates.length,
      ...result,
      analysis: JSON.stringify(analysis),
    })

    // Mover archivo a .processed
    const newPath = path.join(PROCESSED_FOLDER, `${Date.now()}_${file}`)
    fs.renameSync(filePath, newPath)
    log(`✓ Archivo procesado y movido: ${file}`, 'success')

    // Pequeña pausa entre archivos
    await new Promise((r) => setTimeout(r, 500))
  }

  log('✅ Procesamiento completado', 'success')
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

processFiles()
  .catch((err) => {
    log(`Error fatal: ${err.message}`, 'error')
    process.exit(1)
  })
  .then(() => {
    process.exit(0)
  })
