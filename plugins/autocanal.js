import axios from 'axios'
import fs from 'fs'

console.log('[AUTO-CANAL] Iniciando módulo automático...')

// ======================================================
// CONFIG
// ======================================================

const DB_FILE = './autocanal.json'

const GPT_API_URL = 'https://api.yupra.my.id/api/ai/gpt5'

const TIKTOK_API =
    'https://apikey.the-legacy-code.pro/download/tiktok-v2'

const REACCIONES_POSITIVAS = [
    '❤️',
    '🔥',
    '😍',
    '👍',
    '😂'
]

// ======================================================
// TIEMPOS
// ======================================================

// CERRADA
const MIN_CERRADA = 50 * 60 * 1000
const MAX_CERRADA = 120 * 60 * 1000

// LIBRE
const MIN_LIBRE = 30 * 60 * 1000
const MAX_LIBRE = 60 * 60 * 1000

// Cantidad de videos libres
const MIN_VIDEOS_LIBRE = 1
const MAX_VIDEOS_LIBRE = 3

// Espera si ambos procesos chocan
const TIEMPO_COLA = 5 * 60 * 1000

// Espera entre videos de una misma tanda
const ESPERA_ENTRE_VIDEOS = 3000

// ======================================================
// CONTROL
// ======================================================

let enCola = false

let contadorCerrada = 0
let contadorLibre = 0

// ======================================================
// HORARIO
// ======================================================

function estaDespierto() {
    return true
}

function horaPeru() {
    return new Date().toLocaleString('es-PE', {
        timeZone: 'America/Lima'
    })
}

// ======================================================
// PALABRAS PROHIBIDAS
// ======================================================

const PALABRAS_PROHIBIDAS = [
    'live',
    'en vivo',
    'nsfw',
    '18+',
    'adult',
    'onlyfans',
    'hot',
    'sexy',
    'xxx',
    'porn',
    'nazi',
    'hitler',
    'gore',
    '+18',
    'contenido adulto',
    'contenido explícito',
    'contenido sexual',
    'actriz porno',
    'actor porno',
    'estrella porno',
    'pornstar',
    'video xxx',
    'pornhub',
    'xvideos',
    'xnxx',
    'redtube',
    'brazzers',
    'cam4',
    'chaturbate',
    'myfreecams',
    'bongacams',
    'livejasmin',
    'spankbang',
    'tnaflix',
    'hclips',
    'fapello',
    'mia khalifa',
    'lana rhoades',
    'riley reid',
    'abella danger',
    'brandi love',
    'eva elfie',
    'nicole aniston',
    'alexis texas',
    'gianna michaels',
    'adriana chechik',
    'asa akira',
    'mandy muse',
    'kendra lust',
    'porno',
    'porn',
    'sexo',
    'sex',
    'desnudo',
    'desnuda',
    'erótico',
    'erotico',
    'tetas',
    'pechos',
    'boobs',
    'boob',
    'nalgas',
    'culo',
    'culos',
    'trasero',
    'pene',
    'verga',
    'pito',
    'vagina',
    'vaginas',
    'coño',
    'concha',
    'genital',
    'genitales',
    'masturbar',
    'masturbación',
    'masturbacion',
    'gemidos',
    'orgía',
    'orgy',
    'trío',
    'trio',
    'gangbang',
    'creampie',
    'milf',
    'incesto',
    'incest',
    'violación',
    'violacion',
    'rape',
    'bdsm',
    'hentai',
    'tentacle',
    'tentáculos',
    'fetish',
    'fetiche',
    'sado',
    'sadomaso',
    'camgirl',
    'camsex',
    'camshow',
    'playboy',
    'playgirl',
    'playmate',
    'striptease',
    'slut',
    'puta',
    'putas',
    'perra',
    'perras',
    'whore',
    'fuck',
    'fucking',
    'fucked',
    'cock',
    'dick',
    'pussy',
    'shemale',
    'transgénero',
    'transgenero',
    'lesbian',
    'lesbiana',
    'gay',
    'lgbt',
    'explicit',
    'hardcore',
    'softcore',
    'nudista',
    'nudismo',
    'nudity',
    'deepthroat',
    'double penetration',
    'analplay',
    'analplug',
    'rimjob',
    'spank',
    'spanking',
    'lick',
    'licking',
    'doggystyle',
    'blowjob',
    'handjob',
    'p0rn',
    's3x',
    'v@gina',
    'c0ck',
    'd1ck',
    'fuk',
    'fuking',
    'boobz',
    'pusy',
    'azz',
    'cumshot',
    'sexcam',
    'livecam',
    'webcam',
    'sexchat',
    'sexshow',
    'sexvideo',
    'sexvid',
    'sexpics',
    'sexphoto',
    'seximage',
    'sexgif',
    'pornpic',
    'pornimage',
    'pornvid',
    'pornvideo',
    'only fan',
    'only-fans',
    'only_fans',
    'onlyfans.com',
    'mia khalifha',
    'mia khalifah',
    'mia khalifaa',
    'mia khalif4',
    'mia khal1fa',
    'mia khalifa +18',
    'mia khalifa xxx',
    'mia khalifa desnuda',
    'mia khalifa porno'
]

// ======================================================
// DB
// ======================================================

function crearDBBase() {
    return {
        misCategorias: [],
        historial: [],
        puntosMios: {},
        usedMias: {},
        ultimasFrases: []
    }
}

function guardarDB(data) {
    try {
        fs.writeFileSync(
            DB_FILE,
            JSON.stringify(data, null, 2)
        )

        console.log(`[DB] Guardado: ${horaPeru()}`)
    } catch (e) {
        console.error('[DB ERROR]', e)
    }
}

function leerDB() {
    if (!fs.existsSync(DB_FILE)) {
        return crearDBBase()
    }

    try {
        const data = JSON.parse(
            fs.readFileSync(DB_FILE, 'utf8')
        )

        return {
            ...crearDBBase(),
            ...data
        }
    } catch (e) {
        console.error('[DB ERROR]', e)
        return crearDBBase()
    }
}

// ======================================================
// MEMORIA IA
// ======================================================

const MAX_FRASES = 20

function obtenerFrasesRecientes(data) {
    if (!Array.isArray(data.ultimasFrases)) {
        data.ultimasFrases = []
    }

    return data.ultimasFrases.slice(-MAX_FRASES)
}

function guardarFrase(data, frase) {
    if (!Array.isArray(data.ultimasFrases)) {
        data.ultimasFrases = []
    }

    data.ultimasFrases.push({
        texto: frase,
        fecha: Date.now()
    })

    while (data.ultimasFrases.length > MAX_FRASES) {
        data.ultimasFrases.shift()
    }
}

// ======================================================
// UTILIDADES
// ======================================================

function getSender(msg) {
    return (
        msg.key.participant ||
        msg.key.remoteJid ||
        ''
    )
        .replace('@s.whatsapp.net', '')
        .replace('@g.us', '')
        .replace('@lid', '')
}

function limpiarNumero(numero) {
    return String(numero || '')
        .replace(/\D/g, '')
}

function getRandomIntervalo(min, max) {
    return Math.floor(
        Math.random() * (max - min + 1)
    ) + min
}

function elegirCategoriaMia(data) {
    const categorias = Array.isArray(data.misCategorias)
        ? data.misCategorias
        : []

    if (!categorias.length) return null

    const puntos = data.puntosMios || {}

    return [...categorias].sort(
        (a, b) =>
            (puntos[b] || 0) -
            (puntos[a] || 0)
    )[0]
}

function tituloProhibido(titulo = '') {
    const texto = String(titulo).toLowerCase()

    return PALABRAS_PROHIBIDAS.some(
        palabra => texto.includes(palabra)
    )
}

// ======================================================
// API TIKTOK V2
// ======================================================

async function descargarTikTok(url) {
    try {
        if (!url) return null

        console.log('[TIKTOK API] Resolviendo:', url)

        const api =
            `${TIKTOK_API}?url=${encodeURIComponent(url)}`

        const response = await axios.get(api, {
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0'
            }
        })

        const data =
            response.data?.result?.data

        if (
            !response.data?.status ||
            !data
        ) {
            console.log(
                '[TIKTOK API] No devolvió datos'
            )

            return null
        }

        return {
            id: data.id,

            title:
                data.title ||
                data.content_desc?.join(' ') ||
                '',

            video:
                data.hdplay ||
                data.play ||
                data.wmplay ||
                null,

            audio:
                data.music ||
                null,

            duration:
                Number(data.duration || 0),

            views:
                Number(data.play_count || 0),

            author:
                data.author?.nickname ||
                'unknown',

            username:
                data.author?.unique_id ||
                'unknown'
        }

    } catch (e) {
        console.error(
            '[TIKTOK API ERROR]',
            e.message
        )

        return null
    }
}

// ======================================================
// BUSCADOR CERRADA
// ======================================================

async function buscarTikTok(query) {
    console.log(
        `[CERRADA BUSCAR] ${query}`
    )

    try {
        const res = await axios.post(
            'https://tikwm.com/api/feed/search',

            `keywords=${encodeURIComponent(query)}&count=50&cursor=0&HD=1`,

            {
                headers: {
                    'Content-Type':
                        'application/x-www-form-urlencoded; charset=UTF-8',

                    'Cookie':
                        'current_language=en'
                },

                timeout: 30000
            }
        )

        let videos =
            res.data?.data?.videos || []

        console.log(
            `[CERRADA] Resultados: ${videos.length}`
        )

        videos = videos.filter(v => {
            if (!v?.play) return false

            const titulo =
                String(v.title || '')
                    .toLowerCase()

            const followers =
                Number(
                    v.author?.follower_count || 0
                )

            const duration =
                Number(v.duration || 0)

            if (followers < 500) return false

            if (duration > 300) return false

            if (tituloProhibido(titulo)) {
                return false
            }

            return true
        })

        return videos.sort(
            () => Math.random() - 0.5
        )

    } catch (e) {
        console.error(
            '[CERRADA BUSCAR ERROR]',
            e.message
        )

        return []
    }
}

// ======================================================
// BUSCADOR LIBRE
// ======================================================

async function buscarTikTokLibre() {
    console.log(
        '[LIBRE BUSCAR] Buscando trending...'
    )

    try {
        const res = await axios.post(
            'https://tikwm.com/api/feed/search',

            'keywords=&count=50&cursor=0&HD=1',

            {
                headers: {
                    'Content-Type':
                        'application/x-www-form-urlencoded; charset=UTF-8',

                    'Cookie':
                        'current_language=en'
                },

                timeout: 30000
            }
        )

        let videos =
            res.data?.data?.videos || []

        console.log(
            `[LIBRE] Resultados: ${videos.length}`
        )

        videos = videos.filter(v => {
            if (!v?.play) return false

            const titulo =
                String(v.title || '')
                    .toLowerCase()

            const followers =
                Number(
                    v.author?.follower_count || 0
                )

            const duration =
                Number(v.duration || 0)

            if (followers < 500) return false

            if (duration > 300) return false

            if (tituloProhibido(titulo)) {
                return false
            }

            return true
        })

        return videos.sort(
            () => Math.random() - 0.5
        )

    } catch (e) {
        console.error(
            '[LIBRE BUSCAR ERROR]',
            e.message
        )

        return []
    }
}

// ======================================================
// GPT MODERADOR
// ======================================================

async function revisarVideoConGPT(
    titulo,
    categoria
) {
    try {
        const prompt = `
Eres moderador de un canal de WhatsApp familiar.

Categoría:
"${categoria}"

Título:
"${titulo}"

Determina si el contenido puede publicarse.

Rechaza contenido sexual, pornográfico,
contenido para adultos, gore extremo,
violencia extrema o propaganda nazi.

Responde únicamente:
SI
o
NO
`

        const response = await axios.get(
            `${GPT_API_URL}?text=${encodeURIComponent(prompt)}`,
            {
                timeout: 15000
            }
        )

        const answer = String(
            response.data?.result ||
            response.data?.response ||
            ''
        )
            .trim()
            .toUpperCase()

        const seguro =
            answer.startsWith('SI')

        if (!seguro) {
            console.log(
                `[GPT RECHAZO] ${titulo}`
            )
        }

        return seguro

    } catch (e) {
        console.error(
            '[GPT MODERADOR ERROR]',
            e.message
        )

        // Si GPT falla, el filtro local
        // ya bloqueó palabras prohibidas.
        return !tituloProhibido(titulo)
    }
}

// ======================================================
// GPT DESCRIPCIÓN
// ======================================================

async function generarDescripcionGPT(
    descOriginal,
    categoria,
    historial = [],
    esLibre = false
) {
    try {
        let prompt

        const historialTexto =
            historial
                .map(x => x.texto)
                .filter(Boolean)
                .join('\n')

        if (
            descOriginal &&
            String(descOriginal).trim().length > 3
        ) {
            const limpia =
                String(descOriginal)
                    .replace(/#\w+/g, '')
                    .trim()

            prompt = `
Eres redactor de un canal de WhatsApp
de videos virales.

Mejora esta descripción:

"${limpia}"

Categoría:
"${categoria}"

No repitas estas frases:

${historialTexto}

Genera una frase completamente diferente.

Máximo 60 caracteres.
Sin emojis.
Sin comillas.
Directa y llamativa.
`
        } else {
            prompt = `
Genera una frase corta y llamativa
para un video de:

"${categoria}"

No repitas:

${historialTexto}

Máximo 60 caracteres.
Sin emojis.
Sin comillas.
`
        }

        const response = await axios.get(
            `${GPT_API_URL}?text=${encodeURIComponent(prompt)}`,
            {
                timeout: 15000
            }
        )

        let texto =
            response.data?.result ||
            response.data?.response ||
            ''

        texto = String(texto)
            .replace(/["']/g, '')
            .replace(/\n/g, ' ')
            .trim()

        if (!texto) {
            throw new Error(
                'GPT devolvió descripción vacía'
            )
        }

        if (texto.length > 60) {
            texto =
                texto.slice(0, 57) + '...'
        }

        return `✨ ${texto}`

    } catch (e) {
        console.error(
            '[GPT DESCRIPCIÓN ERROR]',
            e.message
        )

        return esLibre
            ? '✨ Video viral que tienes que ver'
            : '✨ Edid épico que tienes que ver'
    }
}

// ======================================================
// OBTENER VIDEO FINAL
// ======================================================

async function prepararVideo(video) {
    if (!video?.play) {
        return null
    }

    /*
     * La API nueva necesita una URL de TikTok.
     *
     * Si TikWM ya nos devuelve play directamente,
     * intentamos usar la URL original del resultado.
     *
     * La API tiktok-v2 se usa como resolución final.
     */

    const posiblesUrls = [
        video.share_url,
        video.url,
        video.link
    ].filter(Boolean)

    for (const url of posiblesUrls) {
        const resultado =
            await descargarTikTok(url)

        if (resultado?.video) {
            return {
                ...video,
                play: resultado.video,
                title:
                    resultado.title ||
                    video.title ||
                    '',
                author: {
                    ...(video.author || {}),
                    nickname:
                        resultado.author ||
                        video.author?.nickname ||
                        'unknown'
                }
            }
        }
    }

    /*
     * Fallback:
     * TikWM ya entregó una URL MP4 válida.
     */

    return video
}

// ======================================================
// ENVIAR VIDEO
// ======================================================

async function enviarVideo(
    sock,
    config,
    categoria,
    data,
    esLibre = false
) {
    const tipo =
        esLibre ? 'LIBRE' : 'CERRADA'

    if (!config?.canalId) {
        console.error(
            '[AUTO-CANAL] config.canalId no está configurado'
        )

        return data
    }

    if (!estaDespierto()) {
        return data
    }

    if (enCola) {
        console.log(
            `[${tipo}] Otro proceso está enviando. Esperando...`
        )

        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    TIEMPO_COLA
                )
        )
    }

    enCola = true

    try {
        if (!data.usedMias) {
            data.usedMias = {}
        }

        if (!data.usedMias[categoria]) {
            data.usedMias[categoria] = []
        }

        const videos = esLibre
            ? await buscarTikTokLibre()
            : await buscarTikTok(categoria)

        if (!videos.length) {
            console.log(
                `[${tipo}] No se encontraron videos`
            )

            return data
        }

        const cantidad = esLibre
            ? getRandomIntervalo(
                MIN_VIDEOS_LIBRE,
                MAX_VIDEOS_LIBRE
            )
            : 1

        const videosAEnviar = []

        for (
            let i = 0;
            i < videos.length &&
            videosAEnviar.length < cantidad;
            i++
        ) {
            const v = videos[i]

            if (!v?.play) {
                continue
            }

            if (
                data.usedMias[categoria]
                    .includes(v.play)
            ) {
                continue
            }

            const titulo =
                v.title || ''

            if (tituloProhibido(titulo)) {
                console.log(
                    '[FILTRO] Rechazado localmente:',
                    titulo
                )

                continue
            }

            const seguro =
                await revisarVideoConGPT(
                    titulo,
                    esLibre
                        ? 'trending random'
                        : categoria
                )

            if (!seguro) {
                continue
            }

            const videoFinal =
                await prepararVideo(v)

            if (!videoFinal?.play) {
                continue
            }

            videosAEnviar.push(
                videoFinal
            )

            data.usedMias[categoria].push(
                v.play
            )

            if (
                data.usedMias[categoria]
                    .length > 200
            ) {
                data.usedMias[categoria]
                    .shift()
            }
        }

        if (!videosAEnviar.length) {
            console.log(
                `[${tipo}] No quedó ningún video válido`
            )

            return data
        }

        for (const v of videosAEnviar) {
            try {
                const historial =
                    obtenerFrasesRecientes(
                        data
                    )

                const descripcion =
                    await generarDescripcionGPT(
                        v.title,
                        esLibre
                            ? 'videos random virales'
                            : categoria,
                        historial,
                        esLibre
                    )

                const caption = esLibre
                    ? `🔥 *TRENDING LIBRE*\n\n${descripcion}\n\n@${v.author?.nickname || 'unknown'}`
                    : `📌 *${String(categoria).toUpperCase()}*\n\n${descripcion}\n\n#${String(categoria).replace(/\s+/g, '')}`

                console.log(
                    `[${tipo}] Enviando al canal...`
                )

                const msgEnviado =
                    await sock.sendMessage(
                        config.canalId,
                        {
                            video: {
                                url: v.play
                            },

                            caption,

                            mimetype:
                                'video/mp4',

                            fileName:
                                `Miku_${Date.now()}.mp4`
                        }
                    )

                guardarFrase(
                    data,
                    descripcion
                )

                if (!Array.isArray(
                    data.historial
                )) {
                    data.historial = []
                }

                data.historial.push({
                    query: categoria,
                    msgId:
                        msgEnviado?.key?.id ||
                        null,
                    time: Date.now(),
                    reacciones: 0,
                    tipo:
                        esLibre
                            ? 'libre'
                            : 'cerrada',
                    link: v.play
                })

                if (
                    data.historial.length > 100
                ) {
                    data.historial.shift()
                }

                if (esLibre) {
                    contadorLibre++
                } else {
                    contadorCerrada++
                }

                console.log(
                    `[${tipo}] VIDEO ENVIADO #${
                        esLibre
                            ? contadorLibre
                            : contadorCerrada
                    }`
                )

                await new Promise(
                    resolve =>
                        setTimeout(
                            resolve,
                            ESPERA_ENTRE_VIDEOS
                        )
                )

            } catch (e) {
                console.error(
                    `[${tipo} ENVIAR ERROR]`,
                    e.message
                )
            }
        }

        return data

    } finally {
        enCola = false
    }
}

// ======================================================
// LISTENER REACCIONES
// ======================================================

export function iniciarListenerReacciones(
    sock
) {
    sock.ev.on(
        'messages.reaction',
        async events => {
            try {
                for (
                    const { key, reaction }
                    of events
                ) {
                    if (
                        !reaction ||
                        !REACCIONES_POSITIVAS
                            .includes(
                                reaction.text
                            )
                    ) {
                        continue
                    }

                    const data = leerDB()

                    const item =
                        data.historial?.find(
                            h =>
                                h.msgId ===
                                key.id
                        )

                    if (!item) {
                        continue
                    }

                    data.puntosMios =
                        data.puntosMios ||
                        {}

                    if (
                        item.tipo ===
                        'libre'
                    ) {
                        /*
                         * Una reacción en LIBRE
                         * ayuda a las categorías
                         * configuradas.
                         */

                        const categorias =
                            Array.isArray(
                                data.misCategorias
                            )
                                ? data.misCategorias
                                : []

                        for (
                            const categoria
                            of categorias
                        ) {
                            data.puntosMios[
                                categoria
                            ] =
                                (
                                    data.puntosMios[
                                        categoria
                                    ] || 0
                                ) + 2
                        }

                        console.log(
                            '[APRENDIZAJE] +2 a categorías por reacción LIBRE'
                        )

                    } else {
                        data.puntosMios[
                            item.query
                        ] =
                            (
                                data.puntosMios[
                                    item.query
                                ] || 0
                            ) + 1

                        console.log(
                            `[PUNTOS] +1 a ${item.query}`
                        )
                    }

                    item.reacciones =
                        (
                            item.reacciones ||
                            0
                        ) + 1

                    guardarDB(data)
                }

            } catch (e) {
                console.error(
                    '[REACCIONES ERROR]',
                    e.message
                )
            }
        }
    )
}

// ======================================================
// COMANDO AUTOCANAL
// ======================================================

export default {
    name: 'autocanal',

    alias: [
        'autochannel',
        'acanal'
    ],

    category: 'OWNER',

    async execute(
        sock,
        msg,
        { config, args } = {}
    ) {
        const from =
            msg.key.remoteJid

        // ==========================================
        // OWNER DESDE CONFIG.JS
        // ==========================================

        const senderJid =
            msg.key.participant ||
            msg.key.remoteJid ||
            ''

        const senderNumber =
            limpiarNumero(
                senderJid.split('@')[0]
            )

        const owners =
            Array.isArray(config?.owner)
                ? config.owner
                : []

        const ownersLimpios =
            owners.map(
                limpiarNumero
            )

        if (
            !ownersLimpios.includes(
                senderNumber
            )
        ) {
            return
        }

        // ==========================================
        // CANAL
        // ==========================================

        if (!config?.canalId) {
            return sock.sendMessage(
                from,
                {
                    text:
                        '❌ Falta configurar canalId en config.js'
                },
                {
                    quoted: msg
                }
            )
        }

        // ==========================================
        // CATEGORÍAS
        // ==========================================

        const texto =
            Array.isArray(args)
                ? args.join(' ').trim()
                : ''

        if (!texto) {
            return sock.sendMessage(
                from,
                {
                    text:
                        '❌ Uso:\n.autocanal miku; gojo; anime'
                },
                {
                    quoted: msg
                }
            )
        }

        // ==========================================
        // DB
        // ==========================================

        let data = leerDB()

        data.misCategorias =
            texto
                .split(';')
                .map(
                    categoria =>
                        categoria.trim()
                )
                .filter(Boolean)

        if (!data.puntosMios) {
            data.puntosMios = {}
        }

        if (!data.usedMias) {
            data.usedMias = {}
        }

        for (
            const categoria
            of data.misCategorias
        ) {
            if (
                !data.usedMias[
                    categoria
                ]
            ) {
                data.usedMias[
                    categoria
                ] = []
            }

            if (
                data.puntosMios[
                    categoria
                ] === undefined
            ) {
                data.puntosMios[
                    categoria
                ] = 0
            }
        }

        guardarDB(data)

        // ==========================================
        // DETENER CICLOS ANTERIORES
        // ==========================================

        if (
            global.timeoutCerrada
        ) {
            clearTimeout(
                global.timeoutCerrada
            )

            global.timeoutCerrada =
                null
        }

        if (
            global.timeoutLibre
        ) {
            clearTimeout(
                global.timeoutLibre
            )

            global.timeoutLibre =
                null
        }

        contadorCerrada = 0
        contadorLibre = 0

        // ==========================================
        // CERRADA
        // ==========================================

        const bucleCerrada =
            async () => {
                try {
                    console.log(
                        `\n========== [CERRADA] #${
                            contadorCerrada + 1
                        } ==========`
                    )

                    let db =
                        leerDB()

                    if (
                        !db.misCategorias
                            ?.length
                    ) {
                        console.log(
                            '[CERRADA] Sin categorías'
                        )

                        return
                    }

                    const categoria =
                        elegirCategoriaMia(
                            db
                        )

                    if (!categoria) {
                        return
                    }

                    db =
                        await enviarVideo(
                            sock,
                            config,
                            categoria,
                            db,
                            false
                        )

                    guardarDB(db)

                    const siguiente =
                        getRandomIntervalo(
                            MIN_CERRADA,
                            MAX_CERRADA
                        )

                    console.log(
                        `[CERRADA] Próximo video en ${Math.round(
                            siguiente / 60000
                        )} minutos`
                    )

                    global.timeoutCerrada =
                        setTimeout(
                            bucleCerrada,
                            siguiente
                        )

                } catch (e) {
                    console.error(
                        '[CERRADA LOOP ERROR]',
                        e
                    )

                    global.timeoutCerrada =
                        setTimeout(
                            bucleCerrada,
                            5 * 60 * 1000
                        )
                }
            }

        // ==========================================
        // LIBRE
        // ==========================================

        const bucleLibre =
            async () => {
                try {
                    console.log(
                        `\n========== [LIBRE] #${
                            contadorLibre + 1
                        } ==========`
                    )

                    let db =
                        leerDB()

                    db =
                        await enviarVideo(
                            sock,
                            config,
                            'trending',
                            db,
                            true
                        )

                    guardarDB(db)

                    const siguiente =
                        getRandomIntervalo(
                            MIN_LIBRE,
                            MAX_LIBRE
                        )

                    console.log(
                        `[LIBRE] Próximo video en ${Math.round(
                            siguiente / 60000
                        )} minutos`
                    )

                    global.timeoutLibre =
                        setTimeout(
                            bucleLibre,
                            siguiente
                        )

                } catch (e) {
                    console.error(
                        '[LIBRE LOOP ERROR]',
                        e
                    )

                    global.timeoutLibre =
                        setTimeout(
                            bucleLibre,
                            5 * 60 * 1000
                        )
                }
            }

        // ==========================================
        // INICIAR AUTOMÁTICAMENTE
        // ==========================================

        console.log(
            '[AUTO-CANAL] Iniciando CERRADA...'
        )

        await bucleCerrada()

        console.log(
            '[AUTO-CANAL] Programando LIBRE...'
        )

        setTimeout(
            bucleLibre,
            10000
        )

        // ==========================================
        // CONFIRMACIÓN
        // ==========================================

        await sock.sendMessage(
            from,
            {
                text:
                    `✅ *AUTO-CANAL ACTIVADO*

🧠 CERRADA
• Categorías: ${data.misCategorias.join(', ')}
• 1 video por tanda
• Cada 50–120 minutos
• Aprende de las reacciones

🔥 LIBRE
• Videos random/trending
• 1–3 videos por tanda
• Cada 30–60 minutos

🛡️ Filtro local + GPT
🤖 Descripciones con IA
📊 Historial: autocanal.json
📢 Canal: ${config.canalId}

⚙️ El sistema seguirá funcionando automáticamente.`
            },
            {
                quoted: msg
            }
        )
    }
}
