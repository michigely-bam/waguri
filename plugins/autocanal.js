import axios from "axios";
import fs from "fs";

console.log("[AUTO-CANAL] Iniciando modulo doble dependencia...");

// ======================================================
// CONFIG
// ======================================================

const DB_FILE = "./autocanal.json";

const REACCIONES_POSITIVAS = [
    "❤️",
    "🔥",
    "😍",
    "👍",
    "😂"
];

const GPT_API_URL = "https://api.yupra.my.id/api/ai/gpt5";

// ======================================================
// TIEMPOS
// ======================================================

const MIN_CERRADA = 1 * 60 * 1000;
const MAX_CERRADA = 10 * 60 * 1000;

const MIN_LIBRE = 1 * 60 * 1000;
const MAX_LIBRE = 15 * 60 * 1000;

const VIDEOS_POR_TANDA_LIBRE = 3;

const TIEMPO_COLA = 1 * 60 * 1000;

const ESPERA_ENTRE_VIDEOS = 3000;

// ======================================================
// CONTROL GLOBAL
// ======================================================

let enCola = false;
let contadorCerrada = 0;
let contadorLibre = 0;

// ======================================================
// HORARIO
// ======================================================

function estaDespierto() {
    return true;
}

function horaPeru() {
    return new Date().toLocaleString("es-PE", {
        timeZone: "America/Lima"
    });
}

// ======================================================
// PALABRAS PROHIBIDAS
// ======================================================

const PALABRAS_PROHIBIDAS = [
    "live",
    "en vivo",
    "nsfw",
    "18+",
    "adult",
    "onlyfans",
    "hot",
    "sexy",
    "xxx",
    "porn",
    "nazi",
    "hitler",
    "gore",
    "+18",
    "contenido adulto",
    "contenido explícito",
    "contenido sexual",
    "actriz porno",
    "actor porno",
    "estrella porno",
    "pornstar",
    "video xxx",
    "x x",
    "pornhub",
    "xvideos",
    "xnxx",
    "redtube",
    "brazzers",
    "cam4",
    "chaturbate",
    "myfreecams",
    "bongacams",
    "livejasmin",
    "spankbang",
    "tnaflix",
    "hclips",
    "fapello",
    "mia khalifa",
    "lana rhoades",
    "riley reid",
    "abella danger",
    "brandi love",
    "eva elfie",
    "nicole aniston",
    "janice griffith",
    "alexis texas",
    "lela star",
    "gianna michaels",
    "adriana chechik",
    "asa akira",
    "mandy muse",
    "kendra lust",
    "jordi el niño polla",
    "johnny sins",
    "danny d",
    "manuel ferrara",
    "mark rockwell",
    "porno",
    "sexo",
    "sex",
    "desnudo",
    "desnuda",
    "erótico",
    "erotico",
    "erotika",
    "tetas",
    "pechos",
    "boobs",
    "boob",
    "nalgas",
    "culo",
    "culos",
    "qlos",
    "trasero",
    "pene",
    "verga",
    "vergota",
    "pito",
    "chocha",
    "vagina",
    "vaginas",
    "coño",
    "concha",
    "genital",
    "genitales",
    "masturbar",
    "masturbación",
    "masturbacion",
    "gemidos",
    "gemir",
    "orgía",
    "orgy",
    "trío",
    "trio",
    "gangbang",
    "creampie",
    "facial",
    "cum",
    "milf",
    "teen",
    "incesto",
    "incest",
    "violación",
    "violacion",
    "rape",
    "bdsm",
    "hentai",
    "tentacle",
    "tentáculos",
    "fetish",
    "fetiche",
    "sado",
    "sadomaso",
    "camgirl",
    "camsex",
    "camshow",
    "playboy",
    "playgirl",
    "playmate",
    "striptease",
    "striptis",
    "slut",
    "puta",
    "putas",
    "perra",
    "perras",
    "whore",
    "fuck",
    "fucking",
    "fucked",
    "cock",
    "dick",
    "pussy",
    "ass",
    "shemale",
    "trans",
    "transgénero",
    "transgenero",
    "lesbian",
    "lesbiana",
    "gay",
    "lgbt",
    "explicit",
    "hardcore",
    "softcore",
    "nudista",
    "nudismo",
    "nudity",
    "deepthroat",
    "dp",
    "double penetration",
    "analplay",
    "analplug",
    "rimjob",
    "spank",
    "spanking",
    "lick",
    "licking",
    "69",
    "doggystyle",
    "reverse cowgirl",
    "cowgirl",
    "blowjob",
    "bj",
    "handjob",
    "hj",
    "p0rn",
    "s3x",
    "v@gina",
    "c0ck",
    "d1ck",
    "fuk",
    "fuking",
    "fak",
    "boobz",
    "pusy",
    "azz",
    "cumshot",
    "sexcam",
    "livecam",
    "webcam",
    "sexchat",
    "sexshow",
    "sexvideo",
    "sexvid",
    "sexpics",
    "sexphoto",
    "seximage",
    "sexgif",
    "pornpic",
    "pornimage",
    "pornvid",
    "pornvideo",
    "only fan",
    "only-fans",
    "only_fans",
    "onlyfans.com",
    "mia khalifha",
    "mia khalifah",
    "mia khalifaa",
    "mia khalif4",
    "mia khal1fa",
    "mia khalifa +18",
    "mia khalifa xxx",
    "mia khalifa desnuda",
    "mia khalifa porno"
];

// ======================================================
// DB
// ======================================================

function guardarDB(data) {
    try {
        fs.writeFileSync(
            DB_FILE,
            JSON.stringify(data, null, 2)
        );

        console.log(
            `[DB] Guardado exitoso. ${horaPeru()}`
        );
    } catch (e) {
        console.error("[DB ERROR]", e);
    }
}

function leerDB() {
    if (!fs.existsSync(DB_FILE)) {
        return {};
    }

    try {
        return JSON.parse(
            fs.readFileSync(DB_FILE, "utf8")
        );
    } catch (e) {
        console.error("[DB ERROR]", e);
        return {};
    }
}

// ======================================================
// MEMORIA IA
// ======================================================

const MAX_FRASES = 20;

function obtenerFrasesRecientes(data) {
    if (!data.ultimasFrases) {
        data.ultimasFrases = [];
    }

    return data.ultimasFrases.slice(-MAX_FRASES);
}

function guardarFrase(data, frase) {
    if (!data.ultimasFrases) {
        data.ultimasFrases = [];
    }

    data.ultimasFrases.push({
        texto: frase,
        fecha: Date.now()
    });

    while (
        data.ultimasFrases.length > MAX_FRASES
    ) {
        data.ultimasFrases.shift();
    }
}

// ======================================================
// HELPERS
// ======================================================

function getSender(msg) {
    return (
        msg.key.participant ||
        msg.key.remoteJid ||
        ""
    )
        .replace("@s.whatsapp.net", "")
        .replace("@g.us", "")
        .replace("@lid", "")
        .replace(/\D/g, "");
}

function getRandomIntervalo(min, max) {
    return Math.floor(
        Math.random() * (max - min + 1)
    ) + min;
}

function elegirCategoriaMia(data) {
    const {
        misCategorias,
        puntosMios
    } = data;

    if (
        !misCategorias ||
        misCategorias.length === 0
    ) {
        return null;
    }

    return [...misCategorias].sort(
        (a, b) =>
            (puntosMios?.[b] || 0) -
            (puntosMios?.[a] || 0)
    )[0];
}

// ======================================================
// API TIKWM - DESCARGA DEL VIDEO
// ======================================================

async function descargarTikTok(url) {
    console.log(
        `[TIKWM] Procesando: ${url}`
    );

    try {
        const api =
            `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`;

        const response = await axios.get(api, {
            timeout: 30000
        });

        const data = response.data;

        if (!data?.data?.play) {
            console.log(
                "[TIKWM] No se encontró URL de video"
            );

            return null;
        }

        console.log(
            "[TIKWM] Video obtenido correctamente"
        );

        return data;
    } catch (e) {
        console.error(
            "[TIKWM ERROR]",
            e.message
        );

        return null;
    }
}

// ======================================================
// BUSCADOR CERRADA
// ======================================================

async function buscarTikTok(query) {
    console.log(
        `[CERRADA BUSCAR] Buscando: ${query}`
    );

    try {
        const res = await axios.post(
            "https://tikwm.com/api/feed/search",
            `keywords=${encodeURIComponent(query)}&count=50&cursor=0&HD=1`,
            {
                headers: {
                    "Content-Type":
                        "application/x-www-form-urlencoded; charset=UTF-8",
                    "Cookie":
                        "current_language=en"
                },
                timeout: 30000
            }
        );

        let videos =
            res.data?.data?.videos || [];

        console.log(
            "TOTAL TIKTOK:",
            videos.length
        );

        const ochoMeses =
            8 *
            30 *
            24 *
            60 *
            60 *
            1000;

        videos = videos.filter(v => {
            const followers =
                v.author?.follower_count || 0;

            const fechaCreacionCuenta =
                v.author?.create_time ||
                Date.now() / 1000;

            const cuentaAntigua =
                (
                    Date.now() -
                    fechaCreacionCuenta * 1000
                ) > ochoMeses;

            const titulo =
                (v.title || "")
                    .toLowerCase();

            const esProhibido =
                PALABRAS_PROHIBIDAS.some(
                    p => titulo.includes(p)
                );

            const esLive =
                (v.duration || 0) > 300;

            return (
                followers >= 500 &&
                cuentaAntigua &&
                !esProhibido &&
                !esLive &&
                v.play
            );
        });

        console.log(
            `[CERRADA BUSCAR] Encontrados ${videos.length} videos filtrados`
        );

        return videos.sort(
            () => Math.random() - 0.5
        );
    } catch (e) {
        console.error(
            "[CERRADA BUSCAR ERROR]",
            e.message
        );

        return [];
    }
}

// ======================================================
// BUSCADOR LIBRE
// ======================================================

async function buscarTikTokLibre() {
    console.log(
        "[LIBRE BUSCAR] Buscando trending random"
    );

    try {
        const res = await axios.post(
            "https://tikwm.com/api/feed/search",
            "keywords=&count=50&cursor=0&HD=1",
            {
                headers: {
                    "Content-Type":
                        "application/x-www-form-urlencoded; charset=UTF-8",
                    "Cookie":
                        "current_language=en"
                },
                timeout: 30000
            }
        );

        let videos =
            res.data?.data?.videos || [];

        console.log(
            "TOTAL TIKTOK:",
            videos.length
        );

        const ochoMeses =
            8 *
            30 *
            24 *
            60 *
            60 *
            1000;

        videos = videos.filter(v => {
            const followers =
                v.author?.follower_count || 0;

            const fechaCreacionCuenta =
                v.author?.create_time ||
                Date.now() / 1000;

            const cuentaAntigua =
                (
                    Date.now() -
                    fechaCreacionCuenta * 1000
                ) > ochoMeses;

            const titulo =
                (v.title || "")
                    .toLowerCase();

            const esProhibido =
                PALABRAS_PROHIBIDAS.some(
                    p => titulo.includes(p)
                );

            const esLive =
                (v.duration || 0) > 300;

            return (
                followers >= 500 &&
                cuentaAntigua &&
                !esProhibido &&
                !esLive &&
                v.play
            );
        });

        console.log(
            `[LIBRE BUSCAR] Encontrados ${videos.length} videos trending filtrados`
        );

        return videos.sort(
            () => Math.random() - 0.5
        );
    } catch (e) {
        console.error(
            "[LIBRE BUSCAR ERROR]",
            e.message
        );

        return [];
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
Eres moderador de un canal de WhatsApp familiar
de videos virales.

Revisa este titulo:
"${titulo}"

Categoria:
"${categoria}"

¿Contiene contenido sexual, porno, nazi,
violento extremo, gore o +18?

Responde SOLO "SI" si es seguro para publicar.
Responde "NO" si es problematico.
`;

        const response = await axios.get(
            `${GPT_API_URL}?text=${encodeURIComponent(prompt)}`,
            {
                timeout: 10000
            }
        );

        const answer = (
            response.data?.result ||
            response.data?.response ||
            ""
        ).toUpperCase().trim();

        const seguro =
            answer.startsWith("SI");

        if (!seguro) {
            console.log(
                `[GPT RECHAZO] ${titulo}`
            );
        }

        return seguro;
    } catch (e) {
        console.log(
            "[GPT ERROR]",
            e.message
        );

        return true;
    }
}

// ======================================================
// GPT DESCRIPCION
// ======================================================

async function generarDescripcionGPT(
    descOriginal,
    categoria,
    historial = [],
    esLibre = false
) {
    try {
        let prompt;

        if (
            descOriginal &&
            descOriginal.trim().length > 3
        ) {
            const limpia =
                descOriginal
                    .replace(/#\w+/g, "")
                    .trim();

            prompt = `
Eres redactor de un canal de WhatsApp
de videos virales y edids.

Mejora esta descripción para que sea épica
y corta, máximo 60 caracteres.

Descripción:
"${limpia}"

Categoría:
"${categoria}"

No repitas frases parecidas a estas:

${historial
    .map(x => x.texto)
    .join("\n")}

Genera una frase completamente diferente.

Sin emojis.
Sin comillas.
Directa y llamativa.
Máximo 60 caracteres.
`;
        } else {
            prompt = `
Eres redactor de un canal de WhatsApp
de videos virales.

Genera una frase para un video de:
"${categoria}"

No repitas frases parecidas a estas:

${historial
    .map(x => x.texto)
    .join("\n")}

Máximo 60 caracteres.
Sin emojis.
Sin comillas.
Directa y llamativa.
`;
        }

        const response = await axios.get(
            `${GPT_API_URL}?text=${encodeURIComponent(prompt)}`,
            {
                timeout: 15000
            }
        );

        let answer =
            response.data?.result ||
            response.data?.response ||
            "";

        let texto = String(answer)
            .replace(/"/g, "")
            .trim();

        if (!texto) {
            throw new Error(
                "GPT no devolvió texto"
            );
        }

        if (texto.length > 60) {
            texto =
                texto.slice(0, 57) + "...";
        }

        return `✨ ${texto}`;
    } catch (e) {
        console.log(
            "[GPT DESCRIPCION ERROR]",
            e.message
        );

        return esLibre
            ? "✨ Video viral que tienes que ver"
            : "✨ Edid epico que tienes que ver";
    }
}

// ======================================================
// FUNCION MAESTRA
// ======================================================

async function enviarVideo(
    sock,
    categoria,
    data,
    canalId,
    esLibre = false
) {
    const tipo =
        esLibre ? "LIBRE" : "CERRADA";

    if (!estaDespierto()) {
        return data;
    }

    if (enCola) {
        console.log(
            `[${tipo}] EN COLA: Esperando ${TIEMPO_COLA / 60000}min...`
        );

        await new Promise(
            r => setTimeout(
                r,
                TIEMPO_COLA
            )
        );
    }

    enCola = true;

    if (!data.usedMias) {
        data.usedMias = {};
    }

    if (!data.usedMias[categoria]) {
        data.usedMias[categoria] = [];
    }

    const videos =
        esLibre
            ? await buscarTikTokLibre()
            : await buscarTikTok(categoria);

    const videosAEnviar = [];

    const cantidad =
        esLibre
            ? getRandomIntervalo(
                1,
                VIDEOS_POR_TANDA_LIBRE
            )
            : 1;

    for (
        let i = 0;
        i < videos.length &&
        videosAEnviar.length < cantidad;
        i++
    ) {
        const v = videos[i];

        if (!v?.play) {
            continue;
        }

        if (
            data.usedMias[categoria]
                .includes(v.play)
        ) {
            continue;
        }

        // ==========================================
        // GPT MODERADOR
        // ==========================================

        const esSeguro =
            await revisarVideoConGPT(
                v.title || "",
                esLibre
                    ? "trending random"
                    : categoria
            );

        if (!esSeguro) {
            continue;
        }

        // ==========================================
        // API DEL PLUGIN TIKTOK
        // ==========================================

        const tikTokData =
            await descargarTikTok(v.play);

        if (
            !tikTokData?.data?.play
        ) {
            console.log(
                `[${tipo}] TikWM no pudo descargar: ${v.play}`
            );

            continue;
        }

        videosAEnviar.push({
            original: v,
            data: tikTokData.data
        });

        data.usedMias[categoria]
            .push(v.play);
    }

    if (videosAEnviar.length === 0) {
        console.log(
            `[${tipo}] No se encontro video valido`
        );

        enCola = false;

        return data;
    }

    // ==================================================
    // ENVIAR VIDEOS
    // ==================================================

    for (const item of videosAEnviar) {
        const v = item.original;
        const tik = item.data;

        try {
            const historial =
                obtenerFrasesRecientes(data);

            const descripcion =
                await generarDescripcionGPT(
                    tik.title ||
                    v.title ||
                    "",
                    esLibre
                        ? "videos random virales"
                        : categoria,
                    historial,
                    esLibre
                );

            const caption =
                esLibre
                    ? `🔥 *TRENDING LIBRE*\n\n${descripcion}\n\n@${tik.author?.unique_id || v.author?.nickname || "unknown"}`
                    : `📌 *${categoria.toUpperCase()}*\n\n${descripcion}\n\n#${categoria.replace(/\s/g, "")}`;

            // ==========================================
            // ENVIO AL CANAL
            // ==========================================

            const msgEnviado =
                await sock.sendMessage(
                    canalId,
                    {
                        video: {
                            url: tik.play
                        },
                        caption,
                        mimetype:
                            "video/mp4",
                        fileName:
                            `IA_${Date.now()}.mp4`
                    }
                );

            guardarFrase(
                data,
                descripcion
            );

            // ==========================================
            // HISTORIAL
            // ==========================================

            data.historial =
                data.historial || [];

            data.historial.push({
                query: categoria,
                msgId:
                    msgEnviado?.key?.id,
                time: Date.now(),
                reacciones: 0,
                tipo:
                    esLibre
                        ? "libre"
                        : "cerrada",
                link: tik.play
            });

            if (
                data.historial.length > 100
            ) {
                data.historial.shift();
            }

            if (esLibre) {
                contadorLibre++;
            } else {
                contadorCerrada++;
            }

            console.log(
                `[${tipo}] ENVIADO: ${(tik.title || v.title || "video").slice(0, 30)}...`
            );

            await new Promise(
                r => setTimeout(
                    r,
                    ESPERA_ENTRE_VIDEOS
                )
            );

        } catch (e) {
            console.error(
                `[${tipo} ENVIAR ERROR]`,
                e.message
            );
        }
    }

    enCola = false;

    return data;
}

// ======================================================
// LISTENER DE REACCIONES
// ======================================================

export function iniciarListenerReacciones(
    sock
) {
    sock.ev.on(
        "messages.reaction",
        async events => {
            for (
                const { key, reaction }
                of events
            ) {
                if (
                    !reaction ||
                    !REACCIONES_POSITIVAS.includes(
                        reaction.text
                    )
                ) {
                    continue;
                }

                let data = leerDB();

                const item =
                    data.historial?.find(
                        h =>
                            h.msgId ===
                            key.id
                    );

                if (!item) {
                    continue;
                }

                data.puntosMios =
                    data.puntosMios || {};

                if (
                    item.tipo === "libre"
                ) {
                    const palabras =
                        item.query
                            .split(" ")
                            .filter(Boolean);

                    palabras.forEach(
                        palabra => {
                            data.puntosMios[
                                palabra
                            ] =
                                (
                                    data.puntosMios[
                                        palabra
                                    ] || 0
                                ) + 2;
                        }
                    );

                    console.log(
                        "[APRENDIZAJE] +2 pts por reacción en LIBRE"
                    );

                } else {
                    data.puntosMios[
                        item.query
                    ] =
                        (
                            data.puntosMios[
                                item.query
                            ] || 0
                        ) + 1;

                    console.log(
                        `[PUNTOS] +1 pt a ${item.query}`
                    );
                }

                item.reacciones =
                    (
                        item.reacciones || 0
                    ) + 1;

                guardarDB(data);
            }
        }
    );
}

// ======================================================
// COMANDO
// ======================================================

export default {
    name: "autocanal",

    alias: [
        "autochannel",
        "acanal"
    ],

    async execute(
        sock,
        msg,
        { config, args } = {}
    ) {
        const from =
            msg.key.remoteJid;

        // ==================================================
        // VERIFICAR CONFIG
        // ==================================================

        if (!config) {
            return sock.sendMessage(
                from,
                {
                    text:
                        "❌ No se encontró config."
                },
                {
                    quoted: msg
                }
            );
        }

        if (!config.canalId) {
            return sock.sendMessage(
                from,
                {
                    text:
                        "❌ Falta configurar canalId en config.js"
                },
                {
                    quoted: msg
                }
            );
        }

        // ==================================================
        // OWNER
        // ==================================================

        const senderJid =
            msg.key.participant ||
            msg.key.remoteJid ||
            "";

        const numeroLimpio =
            senderJid
                .split("@")[0]
                .replace(/\D/g, "");

        const OWNERS =
            Array.isArray(config.owner)
                ? config.owner.map(
                    String
                )
                : [];

        const esOwner =
            OWNERS.some(owner => {
                const limpio =
                    owner.replace(
                        /\D/g,
                        ""
                    );

                return (
                    limpio ===
                    numeroLimpio
                );
            });

        if (!esOwner) {
            return;
        }

        // ==================================================
        // BORRAR COMANDO
        // ==================================================

        setTimeout(
            async () => {
                try {
                    await sock.sendMessage(
                        from,
                        {
                            delete:
                                msg.key
                        }
                    );
                } catch {}
            },
            1000
        );

        // ==================================================
        // ARGUMENTOS
        // ==================================================

        const texto =
            args?.join(" ").trim() ||
            (
                msg.message
                    ?.conversation ||
                msg.message
                    ?.extendedTextMessage
                    ?.text ||
                ""
            )
                .trim()
                .split(/ +/)
                .slice(1)
                .join(" ");

        if (!texto) {
            return sock.sendMessage(
                from,
                {
                    text:
                        "❌ Uso:\n.autocanal edids miku; edids gojo"
                },
                {
                    quoted: msg
                }
            );
        }

        // ==================================================
        // BASE
        // ==================================================

        let data = {
            misCategorias: [],
            historial: [],
            puntosMios: {},
            usedMias: {},
            ultimasFrases: []
        };

        if (
            fs.existsSync(DB_FILE)
        ) {
            data = {
                ...data,
                ...leerDB()
            };
        }

        data.misCategorias =
            texto
                .split(";")
                .map(
                    b => b.trim()
                )
                .filter(Boolean);

        guardarDB(data);

        // ==================================================
        // CANCELAR BUCLES ANTERIORES
        // ==================================================

        if (
            global.timeoutCerrada
        ) {
            clearTimeout(
                global.timeoutCerrada
            );
        }

        if (
            global.timeoutLibre
        ) {
            clearTimeout(
                global.timeoutLibre
            );
        }

        contadorCerrada = 0;
        contadorLibre = 0;

        // ==================================================
        // BUCLE CERRADA
        // ==================================================

        const bucleCerrada =
            async () => {
                console.log(
                    `\n========== [CERRADA] EJECUTANDO #${contadorCerrada + 1} ==========`
                );

                let data =
                    leerDB();

                if (
                    !data.misCategorias ||
                    data.misCategorias
                        .length === 0
                ) {
                    return;
                }

                const categoria =
                    elegirCategoriaMia(
                        data
                    );

                if (!categoria) {
                    return;
                }

                data =
                    await enviarVideo(
                        sock,
                        categoria,
                        data,
                        config.canalId,
                        false
                    );

                guardarDB(data);

                const siguiente =
                    getRandomIntervalo(
                        MIN_CERRADA,
                        MAX_CERRADA
                    );

                console.log(
                    `[CERRADA] Próximo en ${Math.round(siguiente / 60000)}min`
                );

                global.timeoutCerrada =
                    setTimeout(
                        bucleCerrada,
                        siguiente
                    );
            };

        // ==================================================
        // BUCLE LIBRE
        // ==================================================

        const bucleLibre =
            async () => {
                console.log(
                    `\n========== [LIBRE] EJECUTANDO #${contadorLibre + 1} ==========`
                );

                let data =
                    leerDB();

                data =
                    await enviarVideo(
                        sock,
                        "trending",
                        data,
                        config.canalId,
                        true
                    );

                guardarDB(data);

                const siguiente =
                    getRandomIntervalo(
                        MIN_LIBRE,
                        MAX_LIBRE
                    );

                console.log(
                    `[LIBRE] Próximo en ${Math.round(siguiente / 60000)}min`
                );

                global.timeoutLibre =
                    setTimeout(
                        bucleLibre,
                        siguiente
                    );
            };

        // ==================================================
        // INICIAR
        // ==================================================

        console.log(
            "[INICIO] Lanzando doble dependencia..."
        );

        await bucleCerrada();

        setTimeout(
            () => bucleLibre(),
            10000
        );

        // ==================================================
        // CONFIRMACION
        // ==================================================

        const confirm =
            await sock.sendMessage(
                from,
                {
                    text:
                        `✅ DOBLE AUTO-CANAL V2 ON\n\n` +
                        `🧠 CERRADA: 1-10min | 1 video | Aprende\n` +
                        `🔥 LIBRE: 1-15min | 1-3 videos | Random trending\n` +
                        `🛡️ Filtro + GPT + IA\n` +
                        `📥 Descarga: TikWM API HD\n` +
                        `📡 Canal: ${config.canalId}\n` +
                        `👑 Acceso: config.owner\n` +
                        `📊 Stats: autocanal.json`
                }
            );

        setTimeout(
            async () => {
                try {
                    await sock.sendMessage(
                        from,
                        {
                            delete:
                                confirm.key
                        }
                    );
                } catch {}
            },
            8000
        );
    }
};
