
import axios from 'axios'
import {
  areJidsSameUser,
  generateWAMessageFromContent
} from '@whiskeysockets/baileys'

import config from '../config.js'

import {
  listPluginFiles,
  findPluginFile,
  stripExt,
  formatPluginList,
  sendPluginCodeRich,
  codeFitsSingleMessage
} from '../lib/richcode.js'

// ═══════════════════════════════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════════════════════════════

function cleanNum(v) {
  return String(v || '').replace(/\D/g, '')
}

function rawId(jid) {
  return String(jid || '')
    .split('@')[0]
    .split(':')[0]
}

function isOwner(jid) {
  const raw = rawId(jid)

  for (const o of config.owners || []) {
    if (cleanNum(o) === raw) return true
  }

  return false
}

function sameUser(a, b) {
  if (!a || !b) return false

  try {
    if (areJidsSameUser(a, b)) return true
  } catch {}

  return rawId(a) === rawId(b)
}

function participantCandidates(participant) {
  if (!participant) return []

  const candidates = [
    participant.id,
    participant.jid,
    participant.lid
  ]

  const phone = cleanNum(participant.phoneNumber)

  if (phone) {
    candidates.push(`${phone}@s.whatsapp.net`)
  }

  return [
    ...new Set(
      candidates
        .filter(Boolean)
        .map(String)
    )
  ]
}

function participantMatches(participant, jid) {
  return participantCandidates(participant)
    .some(candidate => sameUser(candidate, jid))
}

function findParticipant(participants, jid) {
  return (participants || [])
    .find(participant =>
      participantMatches(participant, jid)
    )
}

function isAdminParticipant(participant, jid) {
  if (!participantMatches(participant, jid)) {
    return false
  }

  return (
    participant.admin === 'admin' ||
    participant.admin === 'superadmin' ||
    participant.isAdmin === true ||
    participant.isSuperAdmin === true
  )
}

function participantJid(participant) {
  if (!participant) return ''

  const phone = cleanNum(participant.phoneNumber)

  if (phone) {
    return `${phone}@s.whatsapp.net`
  }

  const nonLid = [
    participant.jid,
    participant.id
  ].find(jid =>
    !String(jid || '').endsWith('@lid')
  )

  return (
    nonLid ||
    participant.jid ||
    participant.id ||
    ''
  )
}

// ═══════════════════════════════════════════════════════════════
// TEXTO
// ═══════════════════════════════════════════════════════════════

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function isAdminPromotionRequest(value) {
  const text = normalizeText(value)

  const hasAdminWord =
    /\b(?:admin|admins|administrador(?:es|a)?|moderador(?:es|a)?)\b/
      .test(text)

  const hasAction =
    /\b(?:dale|darle|dar|ponle|ponerle|pon|hazle|hacer|concede|conceder|asigna|asignar|otorga|otorgar|nombra|nombrar|promueve|promover|promociona|promocionar|sube|subir|asciende|ascender)\b/
      .test(text)

  const isNegative =
    /\b(?:no|nunca|jamas)\b.{0,24}\b(?:admin|administrador|moderador)\b/
      .test(text)

  return (
    hasAdminWord &&
    hasAction &&
    !isNegative
  )
}

async function sendMikuGroupMessage(
  conn,
  m,
  text,
  mentions = []
) {
  return conn.sendMessage(
    m.chat,
    {
      text,
      mentions
    },
    {
      quoted: m
    }
  )
}

// ═══════════════════════════════════════════════════════════════
// PROMOCIÓN A ADMIN
// ═══════════════════════════════════════════════════════════════

const promotionLocks = new Set()

function getPromotionTarget(m, conn) {
  const botRaw =
    conn?.user?.jid ||
    conn?.user?.id ||
    ''

  const mentioned =
    Array.isArray(m.mentionedJid)
      ? m.mentionedJid.find(jid =>
          jid &&
          !sameUser(jid, botRaw)
        )
      : ''

  if (mentioned) return mentioned

  if (
    m.quoted?.sender &&
    !sameUser(m.quoted.sender, botRaw)
  ) {
    return m.quoted.sender
  }

  const ctx =
    m?.message?.extendedTextMessage?.contextInfo ||
    {}

  return (
    ctx.participant &&
    !sameUser(ctx.participant, botRaw)
      ? ctx.participant
      : ''
  )
}

async function handleAdminPromotion(conn, m) {
  if (!m.isGroup) {
    return sendMikuGroupMessage(
      conn,
      m,
      'Mmm... eso de dar administrador solo tiene sentido dentro de un grupo.'
    )
  }

  const requestedTarget =
    getPromotionTarget(m, conn)

  if (!requestedTarget) {
    return sendMikuGroupMessage(
      conn,
      m,
      'Mmm... dime a quién quieres darle administrador. Menciónalo o responde a su mensaje.'
    )
  }

  const lockKey =
    `${m.chat}:${rawId(requestedTarget)}`

  if (promotionLocks.has(lockKey)) return

  promotionLocks.add(lockKey)

  try {
    const metadata =
      await conn.groupMetadata(m.chat)

    const participants =
      metadata?.participants || []

    const sender =
      m.sender ||
      m.key?.participant ||
      ''

    const requester =
      findParticipant(
        participants,
        sender
      )

    if (
      !isAdminParticipant(
        requester,
        sender
      )
    ) {
      return sendMikuGroupMessage(
        conn,
        m,
        'Lo siento... solo un administrador puede pedirme que haga eso.'
      )
    }

    const botRaw =
      conn.user?.jid ||
      conn.user?.id ||
      ''

    const botParticipant =
      findParticipant(
        participants,
        botRaw
      )

    if (
      !isAdminParticipant(
        botParticipant,
        botRaw
      )
    ) {
      return sendMikuGroupMessage(
        conn,
        m,
        'No puedo hacerlo todavía... primero necesito ser administradora del grupo.'
      )
    }

    const target =
      findParticipant(
        participants,
        requestedTarget
      )

    if (!target) {
      return sendMikuGroupMessage(
        conn,
        m,
        'No encontré a esa persona en el grupo. Menciónala nuevamente.'
      )
    }

    const targetJid =
      participantJid(target)

    if (!targetJid) {
      return sendMikuGroupMessage(
        conn,
        m,
        'No pude identificar a esa persona.'
      )
    }

    if (
      participantMatches(
        target,
        botRaw
      )
    ) {
      return sendMikuGroupMessage(
        conn,
        m,
        'Mmm... ya soy administradora. No puedo darme otra corona.'
      )
    }

    const owners = [
      metadata.owner,
      metadata.ownerAlt,
      metadata.subjectOwner,
      metadata.subjectOwnerAlt
    ].filter(Boolean)

    if (
      owners.some(owner =>
        participantMatches(
          target,
          owner
        )
      )
    ) {
      return sendMikuGroupMessage(
        conn,
        m,
        'Esa persona ya es propietaria del grupo. No hay un rango superior que pueda darle.'
      )
    }

    if (
      isAdminParticipant(
        target,
        targetJid
      )
    ) {
      return sendMikuGroupMessage(
        conn,
        m,
        `@${rawId(targetJid)} ya es administrador...`,
        [targetJid]
      )
    }

    const result =
      await conn.groupParticipantsUpdate(
        m.chat,
        [targetJid],
        'promote'
      )

    const failed =
      Array.isArray(result)
        ? result.find(item =>
            String(item?.status || '200') !== '200'
          )
        : null

    if (failed) {
      throw new Error(
        `WhatsApp rechazó la promoción (${failed.status})`
      )
    }

    return sendMikuGroupMessage(
      conn,
      m,
      `@${rawId(targetJid)}... desde ahora eres administrador.`,
      [targetJid]
    )

  } catch (error) {

    console.error(
      '[MIKU PROMOTE]',
      error.message
    )

    return sendMikuGroupMessage(
      conn,
      m,
      `No pude hacerlo.\n\n> ${error.message || 'WhatsApp rechazó la operación.'}`
    )

  } finally {
    promotionLocks.delete(lockKey)
  }
}

// ═══════════════════════════════════════════════════════════════
// SISTEMA DE PLUGINS
// ═══════════════════════════════════════════════════════════════

const PLUGIN_NOISE = new Set([
  'miku',
  'ia',
  'dime',
  'di',
  'dame',
  'me',
  'te',
  'el',
  'la',
  'los',
  'las',
  'de',
  'del',
  'codigo',
  'fuente',
  'archivo',
  'archivos',
  'plugin',
  'plugins',
  'envia',
  'enviami',
  'muestra',
  'muestrame',
  'ensename',
  'ensena',
  'mandame',
  'manda',
  'por',
  'favor',
  'porfa',
  'getplugin',
  'get',
  'busca',
  'buscando',
  'quiero',
  'quieres',
  'necesito',
  'un',
  'una',
  'su',
  'este',
  'esta',
  'ese',
  'esa',
  'a',
  'al',
  'para',
  'que',
  'como',
  'puedes',
  'puedo',
  'haz',
  'hacer',
  'todo',
  'todos',
  'todas',
  'lista',
  'listame',
  'listar',
  'cuales',
  'cuantos',
  'cual',
  'mi',
  'tu',
  'tuyo',
  'muyo',
  'ya',
  'ahora'
])

function normalizePluginName(s) {
  return normalizeText(
    String(s)
      .replace(/\.(js|mjs)$/i, '')
  )
    .replace(/[-\s.]+/g, ' ')
    .trim()
}

function extractPluginName(t) {
  const files =
    listPluginFiles()

  const normSet =
    new Map()

  for (const f of files) {
    normSet.set(
      normalizePluginName(f),
      f
    )
  }

  const tokens =
    t
      .split(/[\s.,!¿?();:;]+/)
      .filter(Boolean)
      .map(tok =>
        tok.replace(/\.js$/i, '')
      )

  const kept =
    tokens.filter(tk =>
      !PLUGIN_NOISE.has(tk)
    )

  if (!kept.length) return null

  for (
    let len = Math.min(4, kept.length);
    len >= 1;
    len -= 1
  ) {
    for (
      let i = 0;
      i + len <= kept.length;
      i += 1
    ) {
      const cand =
        normalizePluginName(
          kept
            .slice(i, i + len)
            .join(' ')
        )

      if (normSet.has(cand)) {
        return normSet.get(cand)
      }
    }
  }

  return null
}

function detectPluginIntent(t) {
  const PLUGIN_WORD =
    /plu.*?(?:gins?|gings?|ings?)\b/i

  if (
    /(codigo|fuente|archivo|getplugin)/
      .test(t)
  ) {
    return {
      type: 'code',
      name: extractPluginName(t)
    }
  }

  if (!PLUGIN_WORD.test(t)) {
    return null
  }

  if (
    /(dime|listame|lista|listar|todos|todas|muestra|ensename|mandame|envia|cuales|cuantos|dame|mostrame|mostrar|hay|tienes|tiene|disponibles|que hay)/
      .test(t)
  ) {
    return {
      type: 'list'
    }
  }

  const name =
    extractPluginName(t)

  if (name) {
    return {
      type: 'code',
      name
    }
  }

  return null
}

async function handleMikuPlugins(
  conn,
  m,
  intent
) {
  const senderJid =
    m.sender ||
    m.key?.participant ||
    m.chat

  const senderRaw =
    rawId(senderJid)

  const mention =
    senderRaw
      ? `@${senderRaw}`
      : ''

  const mentions =
    [senderJid]

  if (!isOwner(senderJid)) {
    return sendMikuGroupMessage(
      conn,
      m,
      `${mention} esos archivos solo puedo mostrárselos a mi creador.`,
      mentions
    )
  }

  const listText =
    formatPluginList(
      listPluginFiles()
        .map(f => stripExt(f))
    )

  if (intent.type === 'list') {
    return sendMikuGroupMessage(
      conn,
      m,
      `${mention} estos son los plugins disponibles:\n\n${listText}`,
      mentions
    )
  }

  const fileName =
    intent.name
      ? findPluginFile(intent.name)
      : null

  if (!fileName) {
    return sendMikuGroupMessage(
      conn,
      m,
      `${mention} no encontré ese plugin.\n\n${listText}`,
      mentions
    )
  }

  await sendMikuGroupMessage(
    conn,
    m,
    `${mention} espera un momento... estoy buscando el archivo.`,
    mentions
  )

  await new Promise(
    resolve =>
      setTimeout(resolve, 1500)
  )

  try {

    await sendMikuGroupMessage(
      conn,
      m,
      `${mention} aquí está.`,
      mentions
    )

    const { readFileSync } =
      await import('fs')

    const { join } =
      await import('path')

    const fileContent =
      readFileSync(
        join('./plugins', fileName),
        'utf8'
      )

    const fitsInOne =
      codeFitsSingleMessage(
        fileName,
        fileContent
      )

    if (fitsInOne) {

      await sendPluginCodeRich(
        conn,
        m.chat,
        fileName,
        {
          content: fileContent
        }
      )

    } else {

      await sendMikuGroupMessage(
        conn,
        m,
        '*📦 Código completo de ' +
        fileName +
        ':*\n\n```\n' +
        fileContent +
        '\n```',
        []
      )
    }

  } catch (error) {

    console.error(
      '[MIKU PLUGINS]',
      error.message
    )

    return sendMikuGroupMessage(
      conn,
      m,
      `${mention} no pude abrir ese archivo.\n\n> ${error.message}`,
      mentions
    )
  }
}

// ═══════════════════════════════════════════════════════════════
// SESIONES
// ═══════════════════════════════════════════════════════════════

const sessions =
  new Map()

const sadKeywords = [
  'triste',
  'mal',
  'solo',
  'vacio',
  'deprimido',
  'sufro',
  'llor',
  'llora',
  'cansado',
  'roto',
  'duele',
  'dolor',
  'angustia',
  'ansiedad',
  'sin sentido',
  'no puedo',
  'no quiero',
  'me siento',
  'ya no',
  'nadie',
  'nunca',
  'odio',
  'muerte',
  'morir',
  'oscuro',
  'oscuridad',
  'feo',
  'horrible',
  'terminar',
  'acabar',
  'harto',
  'basta'
]

function isSad(text) {
  const t =
    String(text || '')
      .toLowerCase()

  return sadKeywords.some(
    k => t.includes(k)
  )
}

const specialMsg =
  `Mmm... no tienes que fingir que todo está bien. A veces simplemente necesitamos descansar un poco y hablar con alguien. Supongo que eso también está bien.`

const leaveReqs =
  new Map()

const goodbyeMsg =
  `Entonces... me voy. Cuídense, ¿sí? No hagan demasiado ruido mientras no estoy.`

const cluelessMsg =
  `¿Salir? Mmm... ¿de qué estás hablando?`

const onlyCreatorMsg =
  `Lo siento, pero esa orden solo la recibo de mi creador.`

// ═══════════════════════════════════════════════════════════════
// SALIR DEL GRUPO
// ═══════════════════════════════════════════════════════════════

async function handleLeaveRequest(
  conn,
  m
) {
  const senderJid =
    m.sender ||
    m.key?.participant ||
    m.chat

  const senderRaw =
    rawId(senderJid)

  if (isOwner(senderJid)) {

    if (
      !String(m.chat || '')
        .endsWith('@g.us')
    ) {
      return conn.sendMessage(
        m.chat,
        {
          text:
            `@${senderRaw} no estamos en un grupo.`,
          mentions: [senderJid]
        },
        {
          quoted: m
        }
      )
    }

    await conn.sendMessage(
      m.chat,
      {
        text:
          `@${senderRaw} ${goodbyeMsg}`,
        mentions: [senderJid]
      },
      {
        quoted: m
      }
    )

    setTimeout(() => {
      conn.groupLeave(
        m.chat
      ).catch(e =>
        console.error(
          '[MIKU LEAVE]',
          e.message
        )
      )
    }, 2000)

    return
  }

  const key =
    `${m.chat}:${senderRaw}`

  const count =
    (leaveReqs.get(key) || 0) + 1

  leaveReqs.set(
    key,
    count
  )

  if (count >= 2) {
    return conn.sendMessage(
      m.chat,
      {
        text:
          `@${senderRaw} ${onlyCreatorMsg}`,
        mentions: [senderJid]
      },
      {
        quoted: m
      }
    )
  }

  return conn.sendMessage(
    m.chat,
    {
      text:
        `@${senderRaw} ${cluelessMsg}`,
      mentions: [senderJid]
    },
    {
      quoted: m
    }
  )
}

// ═══════════════════════════════════════════════════════════════
// IA MIKU
// ═══════════════════════════════════════════════════════════════

async function askMiku(
  sock,
  m,
  text,
  is_owner,
  sender_id,
  sender_jid
) {
  const userName =
    m.pushName ||
    sender_id ||
    'desconocido'

  const userMention =
    sender_id
      ? `@${sender_id}`
      : ''

  const sessionKey =
    `${m.chat}:${sender_id}`

  if (!sessions.has(sessionKey)) {
    sessions.set(
      sessionKey,
      {
        startTime: Date.now(),
        messages: [],
        specialSent: false
      }
    )
  }

  const session =
    sessions.get(sessionKey)

  session.messages.push({
    text,
    time: Date.now()
  })

  const elapsed =
    Date.now() -
    session.startTime

  if (
    elapsed >= 360000 &&
    !session.specialSent &&
    session.messages.length >= 3
  ) {
    const sadCount =
      session.messages.filter(
        item => isSad(item.text)
      ).length

    if (
      sadCount >=
      Math.ceil(
        session.messages.length * 0.5
      )
    ) {
      session.specialSent = true

      return sock.sendMessage(
        m.chat,
        {
          text:
            `@${sender_id} ${specialMsg}`,
          mentions: [sender_jid]
        },
        {
          quoted: m
        }
      )
    }
  }

  const ownerInstr =
    is_owner
      ? `La persona que te escribe es tu creador ${userName}. Trátalo con confianza y respeto.`
      : `La persona que te escribe es ${userName}.`

  const promptText = `
Eres Miku Nakano de The Quintessential Quintuplets.

${ownerInstr}

Tu personalidad:
- Eres tranquila, reservada y algo tímida.
- Hablas de manera natural y sencilla.
- Te gusta el anime y especialmente las historias y personajes.
- No exageres tus emociones.
- Puedes usar "mmm", "supongo", "bueno..." ocasionalmente.
- Puedes mostrar timidez cuando te hacen cumplidos.
- Mantén respuestas relativamente cortas.
- Usa como máximo 2 emojis por respuesta.
- No digas que eres una IA salvo que te lo pregunten.
- No inventes información personal sobre el usuario.
- Si te preguntan cómo estás, responde de forma tranquila y natural.
- Si te hacen una pregunta seria, responde directamente.

Responde como Miku:

Usuario: ${text}

Miku:`

  try {

    sock
      .sendPresenceUpdate(
        'composing',
        m.chat
      )
      .catch(() => {})

    sock
      .readMessages([m.key])
      .catch(() => {})

    const encoded =
      encodeURIComponent(
        promptText
      )

    const { data } =
      await axios.get(
        `https://api-gohan-v1.onrender.com/ai/gemini?text=${encoded}`,
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0'
          }
        }
      )

    const r =
      data?.result?.text ||
      'Mmm... no sé qué decir.'

    const mikuText =
      `${r}\n\n${userMention}`

    await sock.sendMessage(
      m.chat,
      {
        text: mikuText,
        mentions: sender_jid
          ? [sender_jid]
          : []
      },
      {
        quoted: m
      }
    )

    return

  } catch (error) {

    console.error(
      '[MIKU IA]',
      error.message
    )

    await sock.sendMessage(
      m.chat,
      {
        text:
          'Mmm... ocurrió un error. Inténtalo otra vez.'
      },
      {
        quoted: m
      }
    )

    return
  }
}

// ═══════════════════════════════════════════════════════════════
// EXPORTACIÓN PARA TU BOT
// ═══════════════════════════════════════════════════════════════

export default {

  name: 'miku',

  alias: [
    'ia',
    'miku'
  ],

  description:
    'IA Miku con conversación, sistema de plugins y funciones de grupo.',

  category:
    'ia',

  command: [
    'miku',
    'ia'
  ],

  // ════════════════════════════════════════════════════════════
  // COMANDO
  // ════════════════════════════════════════════════════════════

  async execute(
    sock,
    msg,
    { args = [] }
  ) {

    const text =
      (
        msg.text ||
        args.join(' ') ||
        ''
      ).trim()

    if (!text) {
      return sock.sendMessage(
        msg.key.remoteJid,
        {
          text:
            'Mmm... dime algo.'
        },
        {
          quoted: msg
        }
      )
    }

    const senderJid =
      msg.sender ||
      msg.key?.participant ||
      msg.key?.remoteJid

    const senderId =
      rawId(senderJid)

    return askMiku(
      sock,
      msg,
      text,
      isOwner(senderJid),
      senderId,
      senderJid
    )
  },

  // ════════════════════════════════════════════════════════════
  // SISTEMA PASIVO
  // ════════════════════════════════════════════════════════════

  async before(
    m,
    { conn }
  ) {

    const text =
      (m.text || '')
        .trim()

    const normalizedText =
      normalizeText(text)

    if (!normalizedText) {
      return
    }

    // ─────────────────────────────────────────────────────────
    // SALIR DEL GRUPO
    // ─────────────────────────────────────────────────────────

    if (
      normalizedText.includes(
        'sal del grupo'
      ) ||
      normalizedText.includes(
        'salte del grupo'
      ) ||
      normalizedText === 'salte'
    ) {
      return handleLeaveRequest(
        conn,
        m
      )
    }

    // ─────────────────────────────────────────────────────────
    // CONTEXTO
    // ─────────────────────────────────────────────────────────

    const ctx =
      m?.message
        ?.extendedTextMessage
        ?.contextInfo ||
      {}

    const hasQuoted =
      !!(
        ctx?.quotedMessage ||
        ctx?.stanzaId ||
        m.quoted
      )

    const botJid =
      rawId(
        conn.user?.jid ||
        conn.user?.id ||
        ''
      )

    const quotedFromBot =
      hasQuoted &&
      (
        m.quoted?.key?.fromMe ||
        m.quoted?.fromMe ||
        rawId(
          ctx?.participant || ''
        ) === botJid
      )

    const addressedToMiku =
      normalizedText.includes('miku') ||
      normalizedText === 'ia' ||
      quotedFromBot

    // ─────────────────────────────────────────────────────────
    // ADMIN
    // ─────────────────────────────────────────────────────────

    if (
      addressedToMiku &&
      isAdminPromotionRequest(text)
    ) {
      return handleAdminPromotion(
        conn,
        m
      )
    }

    // ─────────────────────────────────────────────────────────
    // PLUGINS
    // ─────────────────────────────────────────────────────────

    if (
      addressedToMiku &&
      !/^[.!#]/.test(text)
    ) {

      const pluginIntent =
        detectPluginIntent(
          normalizedText
        )

      if (pluginIntent) {
        return handleMikuPlugins(
          conn,
          m,
          pluginIntent
        )
      }
    }

    // ─────────────────────────────────────────────────────────
    // RESPUESTA A MENSAJE DE MIKU
    // ─────────────────────────────────────────────────────────

    if (quotedFromBot) {

      const senderJid =
        m.sender ||
        m.key?.participant ||
        m.chat

      return askMiku(
        conn,
        m,
        text,
        isOwner(senderJid),
        rawId(senderJid),
        senderJid
      )
    }

    // ─────────────────────────────────────────────────────────
    // SOLO SI DICEN MIKU O IA
    // ─────────────────────────────────────────────────────────

    if (
      !normalizedText.includes('miku') &&
      normalizedText !== 'ia'
    ) {
      return
    }

    const senderJid =
      m.sender ||
      m.key?.participant ||
      m.chat

    return askMiku(
      conn,
      m,
      text,
      isOwner(senderJid),
      rawId(senderJid),
      senderJid
    )
  }
}
