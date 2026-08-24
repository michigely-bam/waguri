import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';

// ════════════════════════════════════════════════════════════════
//  lib/richcode.js
//
//  Envía código fuente en formato "rich9": bloques de código con
//  COLORES (estilo Meta AI) usando el protocolo richResponseMessage.
//  Lo comparten .getplugin y la IA Nox para que el formato sea
//  idéntico en ambos.
//
//  Estrategia de tamaño (el servidor de WhatsApp limita el
//  mensaje a ~64KB):
//    1) Intenta enviar TODO el código en UN solo mensaje.
//    2) Si no cabe, baja la "densidad de color" por niveles:
//         nivel 0: colores completos (keywords, métodos, strings,
//                  números, comentarios)
//         nivel 1: sin números
//         nivel 2: sin métodos
//         nivel 3: sin keywords
//         nivel 4: un solo bloque por línea (mínimo)
//    3) Solo si ni el nivel mínimo cabe, divide en varias partes
//       (cada parte con el máximo color que quepa).
//
//  Colores:
//    DEFAULT → blanco    KEYWORD → azul     METHOD  → naranja
//    STR     → verde     NUMBER  → rojo     COMMENT → plomo
// ════════════════════════════════════════════════════════════════

export const PLUGINS_DIR = path.resolve('./plugins');

// Tope de bytes del payload JSON por mensaje. El límite real de
// WhatsApp es ~65,536 bytes por mensaje; se deja margen para el
// envoltorio protobuf. (Validable en vivo con scripts/validate-rich-size.mjs)
export const SINGLE_CAP_BYTES = 60000;

const JS_KEYWORDS = new Set([
  'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
  'default', 'delete', 'do', 'else', 'export', 'extends', 'false', 'finally',
  'for', 'from', 'function', 'get', 'if', 'import', 'in', 'instanceof',
  'let', 'new', 'null', 'of', 'return', 'set', 'static', 'super', 'switch',
  'this', 'throw', 'true', 'try', 'typeof', 'undefined', 'var', 'void',
  'while', 'yield'
]);

// Niveles de densidad de color (de más a menos)
const LEVELS = [
  new Set(['DEFAULT', 'KEYWORD', 'METHOD', 'STR', 'NUMBER', 'COMMENT']),
  new Set(['DEFAULT', 'KEYWORD', 'METHOD', 'STR', 'COMMENT']),
  new Set(['DEFAULT', 'KEYWORD', 'STR', 'COMMENT']),
  new Set(['DEFAULT', 'STR', 'COMMENT']),
  null // nivel 4: un solo bloque por línea
];

// prioridad para el colapso por línea (nivel 4)
const TYPE_PRIORITY = { COMMENT: 5, STR: 4, KEYWORD: 3, METHOD: 2, NUMBER: 1, DEFAULT: 0 };

// ─────────────────────────────────────────────
// Lista de archivos de plugin en ./plugins
// ─────────────────────────────────────────────
export function listPluginFiles() {
  try {
    return fs
      .readdirSync(PLUGINS_DIR)
      .filter((f) => /\.(js|mjs)$/i.test(f))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

export function findPluginFile(name) {
  const wanted = String(name || '').trim().replace(/\.(js|mjs)$/i, '');
  if (!wanted) return null;
  const files = listPluginFiles();
  return (
    files.find((f) => f.replace(/\.(js|mjs)$/i, '') === wanted) ||
    files.find((f) => f.replace(/\.(js|mjs)$/i, '').toLowerCase() === wanted.toLowerCase()) ||
    null
  );
}

export function stripExt(f) {
  return String(f).replace(/\.(js|mjs)$/i, '');
}

export function formatPluginList(names) {
  return names.map((v) => `*◉* ${v}`).join('\n');
}

// ─────────────────────────────────────────────
// Tokenizador JS → bloques con colores (rich9)
// ─────────────────────────────────────────────
function tokenizeLine(line, state, keep) {
  const blocks = [];
  let i = 0;
  let buf = '';
  let bufType = 'DEFAULT';

  const push = () => {
    if (buf) {
      blocks.push({ content: buf, type: bufType });
      buf = '';
    }
  };

  const emit = (content, type) => {
    if (!content) return;
    if (!keep.has(type)) type = 'DEFAULT';
    if (bufType === type && buf) {
      buf += content;
      return;
    }
    push();
    buf = content;
    bufType = type;
  };

  while (i < line.length) {
    const ch = line[i];
    const next = line[i + 1];

    // dentro de un comentario de bloque /* ... */
    if (state.inBlock) {
      const end = line.indexOf('*/', i);
      if (end === -1) {
        push();
        emit(line.slice(i), 'COMMENT');
        return blocks;
      }
      emit(line.slice(i, end + 2), 'COMMENT');
      i = end + 2;
      state.inBlock = false;
      continue;
    }

    // dentro de un template literal `...` (multilínea)
    if (state.inTemplate) {
      if (ch === '\\' && i + 1 < line.length) {
        emit(line.slice(i, i + 2), 'STR');
        i += 2;
        continue;
      }
      if (ch === '`') {
        emit('`', 'STR');
        state.inTemplate = false;
      } else {
        emit(ch, 'STR');
      }
      i += 1;
      continue;
    }

    // comentario de línea //
    if (ch === '/' && next === '/') {
      push();
      emit(line.slice(i), 'COMMENT');
      i = line.length;
      continue;
    }

    // inicio de comentario de bloque
    if (ch === '/' && next === '*') {
      const end = line.indexOf('*/', i + 2);
      if (end === -1) {
        emit(line.slice(i), 'COMMENT');
        state.inBlock = true;
        i = line.length;
        continue;
      }
      emit(line.slice(i, end + 2), 'COMMENT');
      i = end + 2;
      continue;
    }

    // string con comillas
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < line.length) {
        if (line[j] === '\\') {
          j += 2;
          continue;
        }
        if (line[j] === ch) {
          j += 1;
          break;
        }
        j += 1;
      }
      emit(line.slice(i, j), 'STR');
      i = j;
      continue;
    }

    // template literal con backtick
    if (ch === '`') {
      let j = i + 1;
      while (j < line.length) {
        if (line[j] === '\\') {
          j += 2;
          continue;
        }
        if (line[j] === '`') {
          j += 1;
          break;
        }
        j += 1;
      }
      if (j > line.length) {
        // no cerró en esta línea
        emit(line.slice(i), 'STR');
        state.inTemplate = true;
        i = line.length;
      } else {
        emit(line.slice(i, j), 'STR');
        i = j;
      }
      continue;
    }

    // número
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < line.length && /[0-9._]/.test(line[j])) j += 1;
      emit(line.slice(i, j), 'NUMBER');
      i = j;
      continue;
    }

    // identificador → keyword / método / default
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < line.length && /[A-Za-z0-9_$]/.test(line[j])) j += 1;
      const word = line.slice(i, j);
      let k = j;
      while (k < line.length && (line[k] === ' ' || line[k] === '\t')) k += 1;

      if (JS_KEYWORDS.has(word)) emit(word, 'KEYWORD');
      else if (line[k] === '(') emit(word, 'METHOD');
      else emit(word, 'DEFAULT');

      i = j;
      continue;
    }

    // cualquier otro carácter (blanco)
    emit(ch, 'DEFAULT');
    i += 1;
  }

  push();
  return blocks;
}

// Colapsa los bloques de una línea en UN solo bloque (nivel 4)
function collapseLineToBlock(line, blocks) {
  let best = 'DEFAULT';
  for (const b of blocks) {
    if ((TYPE_PRIORITY[b.type] || 0) > (TYPE_PRIORITY[best] || 0)) best = b.type;
  }
  return [{ content: line, type: best }];
}

// Tokeniza todo el archivo → matriz de bloques por línea, según nivel
export function tokenizeAll(code, level = 0) {
  // nivel 4 (null) → tokeniza completo y luego colapsa por línea
  const keep = level < LEVELS.length && LEVELS[level] !== null ? LEVELS[level] : LEVELS[0];
  const state = { inBlock: false, inTemplate: false };
  return code.split('\n').map((ln) => {
    const blocks = tokenizeLine(ln, state, keep);
    if (level === 4) return collapseLineToBlock(ln, blocks);
    return blocks;
  });
}

// Aplica los saltos de línea a los bloques de una línea
function lineBlocksToContent(blocks, addNewline) {
  if (blocks.length === 0) return addNewline ? [{ content: '\n', type: 'DEFAULT' }] : [];
  const copy = blocks.map((b) => ({ ...b }));
  if (addNewline) copy[copy.length - 1].content += '\n';
  return copy;
}

// ─────────────────────────────────────────────
// Medición exacta del payload JSON
// ─────────────────────────────────────────────
function buildHeaderBlocks(fileName, part, total, firstLine, lastLine, totalLines) {
  return [
    { content: `// ═══════════════════════════════════════\n`, type: 'COMMENT' },
    { content: `// 📦 ${fileName}\n`, type: 'COMMENT' },
    {
      content: `// parte ${part}/${total} · líneas ${firstLine}–${lastLine} de ${totalLines}\n`,
      type: 'COMMENT'
    },
    { content: `// ═══════════════════════════════════════\n`, type: 'COMMENT' }
  ];
}

function buildResponseData(fileName, codeBlocks) {
  return {
    response_id:
      'AQUA' +
      Math.random()
        .toString(36)
        .substring(2, 15)
        .toUpperCase(),
    sections: [
      {
        view_model: {
          primitive: {
            language: fileName,
            code_blocks: codeBlocks,
            __typename: 'GenAICodeUXPrimitive'
          },
          __typename: 'GenAISingleLayoutViewModel'
        }
      }
    ]
  };
}

// Buffer JSON del payload rich9 (útil también para validación de tamaño)
export function buildRichPayload(fileName, codeBlocks) {
  return Buffer.from(JSON.stringify(buildResponseData(fileName, codeBlocks)), 'utf8');
}

// Bloques planos de una ventana de líneas
function windowToCodeBlocks(lineBlocks, start, end, totalLines) {
  const out = [];
  for (let li = start; li < end; li += 1) {
    out.push(...lineBlocksToContent(lineBlocks[li], li < totalLines - 1));
  }
  return out;
}

// Tamaño exacto (bytes) del payload JSON de una ventana
function windowPayloadBytes(fileName, lineBlocks, start, end, part, totalParts) {
  const totalLines = lineBlocks.length;
  const firstLine = start + 1;
  const lastLine = end;
  const blocks = [
    ...buildHeaderBlocks(fileName, part, totalParts, firstLine, lastLine, totalLines),
    ...windowToCodeBlocks(lineBlocks, start, end, totalLines)
  ];
  return Buffer.byteLength(JSON.stringify(buildResponseData(fileName, blocks)), 'utf8');
}

// Costo JSON aproximado (y barato) de una línea ya tokenizada
function lineCostBytes(lineBlocks) {
  return Buffer.byteLength(
    JSON.stringify(lineBlocks.map((b) => ({ ...b, content: b.content + '\n' }))),
    'utf8'
  );
}

// Margen fijo del encabezado + esqueleto JSON (medido con holgura)
const SCAFFOLD_BYTES = 1400;

// ─────────────────────────────────────────────
// Planificación: 1 mensaje si cabe, con el
// máximo color posible; si no, pocas partes
// ─────────────────────────────────────────────
function planParts(fileName, fileContent, cap) {
  const totalLines = fileContent.split('\n').length;

  // cache de tokenizaciones por nivel
  const lbCache = new Map();
  const getLB = (level) => {
    if (!lbCache.has(level)) lbCache.set(level, tokenizeAll(fileContent, level));
    return lbCache.get(level);
  };

  // 1) ¿todo el archivo en un solo mensaje? (mejor nivel primero)
  for (let level = 0; level < LEVELS.length; level += 1) {
    const lb = getLB(level);
    if (windowPayloadBytes(fileName, lb, 0, totalLines, 1, 1) <= cap) {
      return [{ start: 0, end: totalLines, level }];
    }
  }

  // 2) ventanas greedy: la más ancha posible con el mejor color

  const parts = [];
  let start = 0;
  while (start < totalLines) {
    let placed = false;
    for (let level = 0; level < LEVELS.length; level += 1) {
      const lb = getLB(level);
      // ancho máximo por costo acumulado
      let end = start;
      let acc = SCAFFOLD_BYTES;
      while (end < totalLines && acc + lineCostBytes(lb[end]) <= cap) {
        acc += lineCostBytes(lb[end]);
        end += 1;
      }
      if (end === start) end = start + 1; // una línea enorme: se manda sola

      const size = windowPayloadBytes(fileName, lb, start, end, parts.length + 1, 1);
      if (size <= cap) {
        parts.push({ start, end, level });
        start = end;
        placed = true;
        break;
      }
      // si ni una línea cabe en el nivel más mínimo, se manda de todos modos
      if (end - start === 1 && level === LEVELS.length - 1) {
        parts.push({ start, end, level });
        start = end;
        placed = true;
        break;
      }
    }
    if (!placed) {
      // seguridad: nunca quedarse atascado
      parts.push({ start, end: Math.min(start + 1, totalLines), level: 4 });
      start += 1;
    }
  }
  return parts;
}

// Verifica si el código cabe en un solo mensaje rich9
export function codeFitsSingleMessage(fileName, fileContent, cap) {
  const c = cap ?? SINGLE_CAP_BYTES;
  const plan = planParts(fileName, fileContent, c);
  return plan.length === 1;
}

// ─────────────────────────────────────────────
// Envía el código de un plugin con el protocolo rich9
// ─────────────────────────────────────────────
// opts:
//   content        → contenido ya leído del archivo (si no, se lee solo)
//   dataCapBytes   → tope de bytes del payload por mensaje (def: SINGLE_CAP_BYTES)
//   disclaimerText → texto del pie del mensaje (def: "Código fuente: <file>")
//   partDelayMs    → pausa entre partes (def: 700; 0 = sin pausa)
//   onPart         → callback({ part, total, firstLine, lastLine, level }) antes de enviar
// Devuelve { fileName, parts, lines, content, singleMessage }
export async function sendPluginCodeRich(conn, chat, fileName, opts = {}) {
  const fileContent =
    typeof opts.content === 'string'
      ? opts.content
      : await fsp.readFile(path.join(PLUGINS_DIR, fileName), 'utf8');

  const cap = opts.dataCapBytes ?? SINGLE_CAP_BYTES;
  const totalLines = fileContent.split('\n').length;

  const plan = planParts(fileName, fileContent, cap);
  const total = plan.length;

  // cache para no re-tokenizar el archivo en cada parte
  const lbCache = new Map();
  const getLB = (level) => {
    if (!lbCache.has(level)) lbCache.set(level, tokenizeAll(fileContent, level));
    return lbCache.get(level);
  };

  const parts = [];
  for (let n = 0; n < plan.length; n += 1) {
    const { start, end, level } = plan[n];
    const part = n + 1;

    const meta = {
      part,
      total,
      firstLine: start + 1,
      lastLine: end,
      level
    };
    if (typeof opts.onPart === 'function') await opts.onPart(meta);

    const blocksUsed = [
      ...buildHeaderBlocks(fileName, part, total, start + 1, end, totalLines),
      ...windowToCodeBlocks(getLB(level), start, end, totalLines)
    ];

    const data = Buffer.from(JSON.stringify(buildResponseData(fileName, blocksUsed)), 'utf8');

    await conn.relayMessage(
      chat,
      {
        messageContextInfo: {
          deviceListMetadataVersion: 2,
          botMetadata: {
            messageDisclaimerText: opts.disclaimerText || `Código fuente: ${fileName}`,
            richResponseSourcesMetadata: {
              sources: []
            }
          }
        },
        botForwardedMessage: {
          message: {
            richResponseMessage: {
              submessages: [],
              messageType: 1,
              unifiedResponse: {
                data
              },
              contextInfo: {
                  forwardingScore: 1,
                  isForwarded: true,
                  forwardedAiBotMessageInfo: {
                    botJid: '867051314767696@bot'
                  },
                  forwardOrigin: 4
                }
            }
          }
        }
      },
      {}
    );

    parts.push({ ...meta, bytes: data.length });

    // pequeña pausa entre partes para que WhatsApp no las descarte
    if (part < total) {
      const delay = opts.partDelayMs === 0 ? 0 : (opts.partDelayMs ?? 700);
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    }
  }

  return {
    fileName,
    parts,
    lines: totalLines,
    content: fileContent,
    singleMessage: total === 1
  };
}
