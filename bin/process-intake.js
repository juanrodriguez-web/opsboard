#!/usr/bin/env node

/**
 * Process Intake Script
 * Lee archivos de la carpeta de entrada (eml, pdf, md, xlsx)
 * Analiza con Claude y actualiza automáticamente items/proyectos en Supabase
 * (modelo nuevo work_items/projects desde el cutover; DATA_BACKEND=legacy solo tras un rollback)
 * Soporta confirmación manual para matches dudosos
 */

const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURACIÓN
// ─────────────────────────────────────────────────────────────────────────────

// Cargar .env.local si existe
const dotenv = require('dotenv')
const envPath = path.join(__dirname, '..', '.env.local')
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath })
}

// Mapear CLAUDE_API_KEY a ANTHROPIC_API_KEY si existe
if (process.env.CLAUDE_API_KEY && !process.env.ANTHROPIC_API_KEY) {
  process.env.ANTHROPIC_API_KEY = process.env.CLAUDE_API_KEY
}

const INTAKE_FOLDER = path.join(
  process.env.USERPROFILE || process.env.HOME,
  'OneDrive - Sercom Soluciones S.L',
  'Escritorio',
  'Pendientes Juan - Seguimiento NO borrar'
)
const PROCESSED_FOLDER = path.join(INTAKE_FOLDER, '.processed')
const LOG_FILE = path.join(INTAKE_FOLDER, '.process-log.json')

// Supabase - intentar desde variables de entorno (prefijo VITE_ o sin prefijo)
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Variables de entorno Supabase no encontradas')
  console.error('   Verifica que .env.local existe con:')
  console.error('   - VITE_SUPABASE_URL')
  console.error('   - VITE_SUPABASE_ANON_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// Backend de datos: 'pm' (work_items/projects, por defecto desde el cutover) o 'legacy' (items/proyectos).
// Con legacy en solo lectura, 'legacy' solo sirve tras un rollback (VITE_DATA_BACKEND=legacy / DATA_BACKEND=legacy).
const BACKEND = (process.env.DATA_BACKEND || process.env.VITE_DATA_BACKEND || 'pm') === 'legacy' ? 'legacy' : 'pm'
const VALID_STATUS = ['pending', 'inprogress', 'blocked', 'done', 'backlog']
const ESTADO_SHEET = { pending: 'No iniciado', inprogress: 'Según lo planificado', blocked: 'En peligro', done: 'Hecho', backlog: 'No iniciado' }

let pmApi = null
const getPmApi = async () => {
  if (!pmApi) {
    const { pathToFileURL } = require('url')
    const { createPmApi } = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'lib', 'api', 'pm', 'index.js')).href)
    pmApi = createPmApi(supabase)
  }
  return pmApi
}

// Devuelve { items, proyectos } con los campos que usa este script (id, tema, proyecto, status, notas / id, nombre, status).
const loadData = async () => {
  if (BACKEND === 'pm') {
    const api = await getPmApi()
    const [items, proyectos] = await Promise.all([api.listItems(), api.listProyectos()])
    return { items, proyectos }
  }
  const { data: items } = await supabase.from('items').select('*')
  const { data: proyectos } = await supabase.from('proyectos').select('*')
  return { items: items || [], proyectos: proyectos || [] }
}

// fields: { status, fechaFin, notas, estadoSheet } (camelCase, como la app)
const saveItemFields = async (id, fields) => {
  if (BACKEND === 'pm') return (await getPmApi()).updateItem(id, fields)
  const db = {}
  if (fields.status !== undefined) db.status = fields.status
  if (fields.estadoSheet !== undefined) db.estado_sheet = fields.estadoSheet
  if (fields.fechaFin !== undefined) db.fecha_fin = fields.fechaFin
  if (fields.notas !== undefined) db.notas = fields.notas
  const { error } = await supabase.from('items').update(db).eq('id', id)
  if (error) throw new Error(error.message)
}

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

// Limpiar caracteres malformados del encoding
const cleanContent = (text) => {
  return text
    .replace(/Ã¡/g, 'á')
    .replace(/Ã©/g, 'é')
    .replace(/Ã­/g, 'í')
    .replace(/Ã³/g, 'ó')
    .replace(/Ã¹/g, 'ú')
    .replace(/Ã±/g, 'ñ')
    .replace(/Ã /g, 'à')
    .replace(/Ã¨/g, 'è')
    .replace(/Ã¬/g, 'ì')
    .replace(/Ã²/g, 'ò')
    .replace(/Ã¼/g, 'ü')
    .replace(/Ã/g, 'Á')
    .replace(/É/g, 'É')
    .replace(/Í/g, 'Í')
    .replace(/Ó/g, 'Ó')
    .replace(/Ú/g, 'Ú')
    .replace(/Ñ/g, 'Ñ')
}

const readFile = (filePath) => {
  const ext = path.extname(filePath).toLowerCase()
  let content = fs.readFileSync(filePath, 'utf8')

  // Limpiar caracteres rotos
  content = cleanContent(content)

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

  if (!process.env.ANTHROPIC_API_KEY) {
    log('ERROR: ANTHROPIC_API_KEY no configurada', 'error')
    log('', 'error')
    log('Solucion:', 'error')
    log('1. Obtén tu API key en: https://console.anthropic.com/account/keys', 'error')
    log('2. Ejecuta: vercel env add CLAUDE_API_KEY', 'error')
    log('3. Selecciona "development" cuando pregunte', 'error')
    log('4. Pega tu API key (empieza con "sk-ant-")', 'error')
    log('5. Intenta de nuevo: npm run process-intake', 'error')
    log('', 'error')
    return null
  }

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
${fileContent.body.slice(0, 10000)}

## ELEMENTOS EXISTENTES EN OPSBOARD

### Temas/Items:
${itemList}

### Proyectos:
${proyList}

## INSTRUCCIONES
1. **PRIMERO: Busca códigos BPMOC### en el documento** - si encuentra uno, búscalo exactamente en la lista
2. Si no encuentra código BPMOC, identifica qué tema(s) o proyecto(s) se relacionan por nombre
3. Si hay múltiples posibilidades, lista las más probables
4. Extrae cambios, estados nuevos, comentarios relevantes, fechas
5. Responde ÚNICAMENTE con un JSON válido, sin markdown.

IMPORTANTE:
- Los códigos BPMOC son únicos e inmutables
- En JSON, escapa comillas dobles con backslash: \"
- Usa \\n para saltos de línea, NO saltos reales
- Máximo 200 caracteres por comentario
- Retorna SOLO el JSON, nada más

Estructura:
{
  "matches": [
    {"type": "item|proyecto", "id": "uuid o null", "name": "nombre", "confidence": 0.9, "reason": "por qué"}
  ],
  "updates": [
    {"matchId": "id", "field": "status|comentario|fecha_fin", "value": "valor", "reason": "por qué"}
  ],
  "needsConfirmation": false,
  "extractedComment": "resumen máx 200 chars"
}`

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : ''

    // Extraer JSON: buscar desde el primer { hasta el último }
    const firstBrace = text.indexOf('{')
    const lastBrace = text.lastIndexOf('}')

    if (firstBrace === -1 || lastBrace === -1 || firstBrace >= lastBrace) {
      log('No JSON válido encontrado en respuesta de Claude', 'error')
      log(`Respuesta: ${text.substring(0, 200)}...`, 'error')
      return null
    }

    const jsonStr = text.substring(firstBrace, lastBrace + 1)

    // Guardar JSON para debugging
    const jsonLogPath = path.join(PROCESSED_FOLDER, `debug-${Date.now()}.json`)

    // Intentar parsear - con intentos de reparación
    let result
    try {
      result = JSON.parse(jsonStr)
    } catch (parseError) {
      // Guardar JSON problemático para análisis
      fs.writeFileSync(jsonLogPath, jsonStr, 'utf8')

      log(`JSON guardado para análisis: ${jsonLogPath}`, 'warn')
      log(`Error en posición ${parseError.message.match(/position \d+/)?.[0] || 'desconocida'}`, 'error')

      // Fallback: crear resultado vacío para continuar
      log(`Usando análisis fallback (sin updates)`, 'warn')
      result = {
        matches: [],
        updates: [],
        needsConfirmation: false,
        extractedComment: 'Error en análisis - ver log'
      }
    }

    return result
  } catch (e) {
    log(`Error en Claude API: ${e.message}`, 'error')
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTUALIZAR SUPABASE
// ─────────────────────────────────────────────────────────────────────────────

const applyUpdates = async (analysis, fileName, items = []) => {
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
        const fields = {}
        if (update.field === 'status') {
          if (!VALID_STATUS.includes(update.value)) {
            log(`Estado no válido "${update.value}" para ${match.name}: se omite el cambio de estado`, 'warn')
          } else {
            fields.status = update.value
            fields.estadoSheet = ESTADO_SHEET[update.value]
          }
        }
        if (update.field === 'fecha_fin') fields.fechaFin = update.value

        // Agregar comentario a las notas (el item ya está cargado)
        const item = items.find((i) => i.id === match.id)
        if (item) {
          const newNota = `[${new Date().toLocaleDateString('es-ES')}] ${analysis.extractedComment || update.reason}`
          fields.notas = item.notas ? `${item.notas}\n${newNota}` : newNota

          try {
            await saveItemFields(match.id, fields)
            item.notas = fields.notas
            log(`✓ Item actualizado: ${match.name}`, 'success')
            success++
          } catch (error) {
            log(`Error actualizando item ${match.name}: ${error.message}`, 'error')
            errors++
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
  const { items, proyectos } = await loadData()
  log(`Backend de datos: ${BACKEND}`)

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
    const analysis = await analyzeWithClaude(content, items, proyectos)
    if (!analysis) {
      log(`Error analizando ${file}`, 'error')
      appendLog({ file, status: 'error', reason: 'Claude API error' })
      continue
    }

    // Aplicar actualizaciones
    const result = await applyUpdates(analysis, file, items)

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

if (require.main === module) {
  processFiles()
    .catch((err) => {
      log(`Error fatal: ${err.message}`, 'error')
      process.exit(1)
    })
    .then(() => {
      process.exit(0)
    })
}

module.exports = { applyUpdates, loadData, saveItemFields, BACKEND, _setPmApi: (api) => { pmApi = api } }
