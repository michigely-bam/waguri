import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions/index.js";
import { NewMessage } from "teleproto/events/index.js";
import "dotenv/config";

import fs from "fs";
import path from "path";

// ======================================================
// CONFIGURACIÓN
// ======================================================

const API_ID = Number(process.env.TELEGRAM_API_ID);
const API_HASH = process.env.TELEGRAM_API_HASH;
const STRING_SESSION = process.env.TELEGRAM_SESSION;

const TELEGRAM_DESTINO = "@MJnumbers_bot";

const DESTINO_FILE = path.resolve("./tg_destination.json");

// ======================================================
// ESTADO
// ======================================================

let telegramConectado = false;
let telegramUltimoId = 0;

const mensajesProcesados = new Set();

// ======================================================
// DELAY
// ======================================================

const delay = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

// ======================================================
// DESTINO WHATSAPP
// ======================================================

function cargarDestino() {
    try {
        if (!fs.existsSync(DESTINO_FILE)) {
            return null;
        }

        const data = JSON.parse(
            fs.readFileSync(DESTINO_FILE, "utf8")
        );

        if (
            data &&
            typeof data.chat === "string" &&
            data.chat.trim()
        ) {
            return data.chat;
        }
    } catch (error) {
        console.error(
            "[TG] Error leyendo destino:",
            error.message
        );
    }

    return null;
}

function guardarDestino(chat) {
    try {
        fs.writeFileSync(
            DESTINO_FILE,
            JSON.stringify(
                {
                    chat,
                    actualizado: Date.now()
                },
                null,
                2
            )
        );
    } catch (error) {
        console.error(
            "[TG] Error guardando destino:",
            error.message
        );
    }
}

let ultimoDestino = cargarDestino();

// ======================================================
// VALIDACIÓN
// ======================================================

if (!API_ID || !API_HASH || !STRING_SESSION) {
    console.error(
        "[TG] ❌ Faltan TELEGRAM_API_ID, TELEGRAM_API_HASH o TELEGRAM_SESSION"
    );
}

// ======================================================
// CLIENTE TELEGRAM
// ======================================================

const telegramClient = new TelegramClient(
    new StringSession(STRING_SESSION || ""),
    API_ID || 0,
    API_HASH || "",
    {
        connectionRetries: 5
    }
);

// ======================================================
// MARCAR HISTORIAL
// ======================================================

async function marcarHistorial() {
    try {
        const mensajes =
            await telegramClient.getMessages(
                TELEGRAM_DESTINO,
                {
                    limit: 1
                }
            );

        if (
            Array.isArray(mensajes) &&
            mensajes.length > 0
        ) {
            telegramUltimoId =
                Number(mensajes[0]?.id || 0);
        } else {
            telegramUltimoId = 0;
        }

        console.log(
            `[TG] 🛡️ Historial protegido. Último ID ignorado: ${telegramUltimoId}`
        );

    } catch (error) {

        telegramUltimoId = 0;

        console.error(
            "[TG] ⚠️ No se pudo marcar el historial:",
            error.message
        );
    }
}

// ======================================================
// EXTRAER BOTONES DE TELEGRAM
// ======================================================

function obtenerBotonesTelegram(msg) {

    const botones = [];

    try {

        const markup =
            msg?.replyMarkup;

        if (!markup) {
            return botones;
        }

        const filas =
            markup.rows || [];

        for (const fila of filas) {

            const botonesFila =
                fila?.buttons || [];

            for (const boton of botonesFila) {

                const texto =
                    String(
                        boton?.text ||
                        boton?.label ||
                        ""
                    ).trim();

                if (!texto) {
                    continue;
                }

                /*
                 * Telegram puede tener:
                 *
                 * callback_data
                 * data
                 * url
                 *
                 * Para la primera prueba solamente
                 * necesitamos conservar el texto.
                 */

                let id = "";

                try {

                    if (boton?.data) {

                        if (
                            Buffer.isBuffer(
                                boton.data
                            )
                        ) {
                            id =
                                boton.data.toString(
                                    "utf8"
                                );
                        } else {
                            id =
                                String(
                                    boton.data
                                );
                        }

                    }

                } catch {}

                const url =
                    boton?.url
                        ? String(boton.url)
                        : "";

                botones.push({
                    text: texto,
                    id:
                        id ||
                        `tg_${botones.length + 1}`,
                    url
                });

            }
        }

    } catch (error) {

        console.error(
            "[TG] ⚠️ Error leyendo botones:",
            error.message
        );
    }

    /*
     * PRUEBA:
     * máximo 2 botones.
     */

    return botones.slice(0, 2);
}

// ======================================================
// ENVIAR TEXTO + BOTONES A WHATSAPP
// ======================================================

async function enviarTextoConBotones(
    sock,
    destino,
    texto,
    botones
) {

    /*
     * Si no existen botones,
     * comportamiento normal.
     */

    if (!botones.length) {

        if (!texto.trim()) {
            return;
        }

        await sock.sendMessage(
            destino,
            {
                text:
                    `╭⋯ 📥 *TELEGRAM* ⋯》\n` +
                    `┊ ${texto}\n` +
                    `╰⋯ 》`
            }
        );

        return;
    }

    /*
     * Primera prueba:
     *
     * máximo 2 botones.
     *
     * Usamos sendMessage directamente para evitar
     * generateWAMessageFromContent y el error:
     *
     * "Cannot destructure property 'user'
     *  of 'jidDecode(...)' as it is undefined"
     */

    const botonesWA =
        botones.map(
            (boton, index) => ({
                buttonId:
                    boton.id ||
                    `tg_button_${index + 1}`,

                buttonText: {
                    displayText:
                        boton.text
                },

                type: 1
            })
        );

    try {

        await sock.sendMessage(
            destino,
            {
                text:
                    texto ||
                    "📥 Respuesta de Telegram",

                footer:
                    "✦ @MJnumbers_bot ✦",

                buttons:
                    botonesWA,

                headerType: 1
            }
        );

        console.log(
            `[TG → WA] ✅ Texto + ${botonesWA.length} botón(es) enviado(s).`
        );

    } catch (error) {

        console.error(
            "[TG → WA] ⚠️ Baileys rechazó los botones:",
            error.message
        );

        /*
         * Fallback:
         * al menos mandamos el texto y vemos los botones.
         */

        const lista =
            botones
                .map(
                    (b, i) =>
                        `${i + 1}. ${b.text}`
                )
                .join("\n");

        await sock.sendMessage(
            destino,
            {
                text:
                    `╭⋯ 📥 *TELEGRAM* ⋯》\n` +
                    `┊ ${texto || ""}\n` +
                    `╰⋯ 》\n\n` +
                    `🔘 *Botones detectados:*\n${lista}`
            }
        );
    }
}

// ======================================================
// TELEGRAM → WHATSAPP
// ======================================================

function iniciarListenerTelegram() {

    telegramClient.addEventHandler(

        async event => {

            try {

                const msg =
                    event?.message;

                if (!msg) {
                    return;
                }

                // ==================================================
                // ID
                // ==================================================

                const messageId =
                    Number(msg.id || 0);

                /*
                 * TODO lo anterior al momento de conexión
                 * queda bloqueado.
                 */

                if (
                    messageId &&
                    messageId <= telegramUltimoId
                ) {
                    return;
                }

                // ==================================================
                // DUPLICADOS
                // ==================================================

                if (messageId) {

                    if (
                        mensajesProcesados.has(
                            messageId
                        )
                    ) {
                        return;
                    }

                    mensajesProcesados.add(
                        messageId
                    );

                    if (
                        mensajesProcesados.size > 500
                    ) {

                        const primeros =
                            [
                                ...mensajesProcesados
                            ].slice(0, 250);

                        for (
                            const id of primeros
                        ) {
                            mensajesProcesados.delete(
                                id
                            );
                        }
                    }
                }

                // ==================================================
                // IGNORAR NUESTROS MENSAJES
                // ==================================================

                if (msg.out) {
                    return;
                }

                // ==================================================
                // REMITENTE
                // ==================================================

                let sender = null;

                try {

                    sender =
                        await msg.getSender();

                } catch {

                    return;
                }

                // ==================================================
                // SOLO MJNUMBERS_BOT
                // ==================================================

                const username =
                    String(
                        sender?.username || ""
                    ).toLowerCase();

                if (
                    username !==
                    "mjnumbers_bot"
                ) {
                    return;
                }

                // ==================================================
                // WHATSAPP
                // ==================================================

                if (!global.sock) {
                    return;
                }

                // ==================================================
                // ÚLTIMO DESTINO /TG
                // ==================================================

                const destino =
                    global.TG_WA_CHAT ||
                    ultimoDestino;

                if (!destino) {

                    console.log(
                        "[TG] ⚠️ @MJnumbers_bot respondió pero no hay destino."
                    );

                    return;
                }

                // ==================================================
                // TEXTO
                // ==================================================

                const texto =
                    String(
                        msg.text ||
                        msg.message ||
                        ""
                    );

                // ==================================================
                // BOTONES
                // ==================================================

                const botones =
                    obtenerBotonesTelegram(
                        msg
                    );

                if (botones.length) {

                    console.log(
                        `[TG] 🔘 Detectados ${botones.length} botón(es) nuevos.`
                    );

                    await enviarTextoConBotones(
                        global.sock,
                        destino,
                        texto,
                        botones
                    );

                    /*
                     * Si además tiene multimedia,
                     * continúa para enviarla.
                     */

                    if (!msg.media) {
                        return;
                    }
                }

                // ==================================================
                // TEXTO NORMAL
                // ==================================================

                if (!msg.media) {

                    if (!texto.trim()) {
                        return;
                    }

                    await global.sock.sendMessage(
                        destino,
                        {
                            text:
                                `╭⋯ 📥 *TELEGRAM* ⋯》\n` +
                                `┊ ${texto}\n` +
                                `╰⋯ 》`
                        }
                    );

                    return;
                }

                // ==================================================
                // MULTIMEDIA
                // ==================================================

                try {

                    const media =
                        await telegramClient.downloadMedia(
                            msg.media
                        );

                    if (!media) {

                        if (texto.trim()) {

                            await global.sock.sendMessage(
                                destino,
                                {
                                    text:
                                        `╭⋯ 📥 *TELEGRAM* ⋯》\n` +
                                        `┊ ${texto}\n` +
                                        `╰⋯ 》`
                                }
                            );
                        }

                        return;
                    }

                    const mediaClass =
                        String(
                            msg.media?.className ||
                            ""
                        );

                    // FOTO
                    if (
                        mediaClass.includes(
                            "Photo"
                        )
                    ) {

                        await global.sock.sendMessage(
                            destino,
                            {
                                image: media,
                                caption:
                                    texto ||
                                    undefined
                            }
                        );

                        return;
                    }

                    // DOCUMENTO
                    if (
                        mediaClass.includes(
                            "Document"
                        )
                    ) {

                        await global.sock.sendMessage(
                            destino,
                            {
                                document: media,
                                caption:
                                    texto ||
                                    undefined
                            }
                        );

                        return;
                    }

                    // OTRO
                    await global.sock.sendMessage(
                        destino,
                        {
                            document: media,
                            caption:
                                texto ||
                                undefined
                        }
                    );

                } catch (mediaError) {

                    console.error(
                        "[TG] ❌ Error con multimedia:",
                        mediaError.message
                    );

                    if (
                        texto.trim()
                    ) {

                        await global.sock.sendMessage(
                            destino,
                            {
                                text:
                                    `╭⋯ 📥 *TELEGRAM* ⋯》\n` +
                                    `┊ ${texto}\n` +
                                    `╰⋯ 》`
                            }
                        );
                    }
                }

            } catch (error) {

                console.error(
                    "[TG] ❌ Error procesando mensaje:",
                    error.message
                );
            }

        },

        new NewMessage({
            incoming: true
        })

    );
}

// ======================================================
// CONECTAR TELEGRAM
// ======================================================

async function conectarTelegram() {

    try {

        await telegramClient.connect();

        /*
         * IMPORTANTE:
         * primero marcamos el último mensaje existente,
         * después activamos el listener.
         */

        await marcarHistorial();

        iniciarListenerTelegram();

        telegramConectado = true;

        const me =
            await telegramClient.getMe();

        console.log(
            `[TG] ✅ Telegram conectado como @${me?.username || me?.firstName || "usuario"}`
        );

        console.log(
            `[TG] 🎯 Escuchando únicamente a @mjnumbers_bot`
        );

        if (ultimoDestino) {

            console.log(
                `[TG] 📍 Destino: ${ultimoDestino}`
            );
        }

    } catch (error) {

        telegramConectado = false;

        console.error(
            "[TG] ❌ Error conectando Telegram:",
            error.message
        );
    }
}

// ======================================================
// INICIAR
// ======================================================

if (
    API_ID &&
    API_HASH &&
    STRING_SESSION
) {
    conectarTelegram();
}

// ======================================================
// PLUGIN
// ======================================================

export default {

    name: "bridge",

    alias: [
        "tg",
        "send"
    ],

    description:
        "Puente WhatsApp ↔ Telegram",

    category:
        "herramientas",

    command: [
        "tg",
        "send"
    ],

    async execute(
        sock,
        msg,
        { args }
    ) {

        // ==================================================
        // SOCKET
        // ==================================================

        global.sock =
            sock;

        // ==================================================
        // CHAT ACTUAL
        // ==================================================

        const from =
            msg?.key?.remoteJid;

        if (!from) {
            return;
        }

        /*
         * ESTE es el destino que se conserva.
         */

        global.TG_WA_CHAT =
            from;

        ultimoDestino =
            from;

        guardarDestino(
            from
        );

        // ==================================================
        // NOMBRE
        // ==================================================

        const senderName =
            msg.pushName ||
            "Usuario";

        // ==================================================
        // MENSAJE
        // ==================================================

        const mensaje =
            Array.isArray(args)
                ? args.join(" ").trim()
                : String(
                    args || ""
                ).trim();

        // ==================================================
        // TELEGRAM
        // ==================================================

        if (!telegramConectado) {

            return await sock.sendMessage(
                from,
                {
                    text:
                        "❌ Telegram todavía no está conectado."
                },
                {
                    quoted: msg
                }
            );
        }

        // ==================================================
        // SIN MENSAJE
        // ==================================================

        if (!mensaje) {

            return await sock.sendMessage(
                from,
                {
                    text:
                        "❌ Escribe un mensaje.\n\n" +
                        "Ejemplo:\n" +
                        "/tg /start"
                },
                {
                    quoted: msg
                }
            );
        }

        // ==================================================
        // PROGRESO
        // ==================================================

        const resultado =
            await sock.sendMessage(
                from,
                {
                    text:
                        `╭⋯ 📡 *ENVIANDO A TELEGRAM* ⋯》\n` +
                        `┊ [░░░░░░] 0%\n` +
                        `╰⋯ 》`
                },
                {
                    quoted: msg
                }
            );

        const progressKey =
            resultado?.key;

        try {

            let enviado = false;

            // ==================================================
            // MENSAJE CITADO
            // ==================================================

            const contextInfo =
                msg.message
                    ?.extendedTextMessage
                    ?.contextInfo;

            const quoted =
                contextInfo?.quotedMessage;

            // ==================================================
            // IMAGEN CITADA
            // ==================================================

            if (
                quoted?.imageMessage
            ) {

                try {

                    const media =
                        await sock.downloadMediaMessage(
                            {
                                key: {
                                    remoteJid:
                                        from,

                                    id:
                                        contextInfo?.stanzaId,

                                    participant:
                                        contextInfo?.participant
                                },

                                message:
                                    quoted
                            }
                        );

                    if (media) {

                        await telegramClient.sendFile(
                            TELEGRAM_DESTINO,
                            {
                                file:
                                    media,

                                caption:
                                    `De WA: ${senderName}\n\n${mensaje}`
                            }
                        );

                        enviado =
                            true;
                    }

                } catch (error) {

                    console.error(
                        "[TG] ❌ Error enviando imagen:",
                        error.message
                    );
                }
            }

            // ==================================================
            // TEXTO
            // ==================================================

            if (!enviado) {

                await telegramClient.sendMessage(
                    TELEGRAM_DESTINO,
                    {
                        message:
                            mensaje
                    }
                );
            }

            // ==================================================
            // DELAY
            // ==================================================

            await delay(800);

            // ==================================================
            // FINAL
            // ==================================================

            if (progressKey) {

                try {

                    await sock.sendMessage(
                        from,
                        {
                            text:
                                `╭⋯ 📡 *ENVIADO* ⋯》\n` +
                                `┊ [██████] 100%\n` +
                                `┊ Destino: @MJnumbers_bot\n` +
                                `╰⋯ 》`,

                            edit:
                                progressKey
                        }
                    );

                } catch {
                    // Algunos forks no soportan edit.
                }
            }

        } catch (error) {

            console.error(
                "[TG] ❌ Error enviando:",
                error.message
            );

            await sock.sendMessage(
                from,
                {
                    text:
                        `❌ *Error enviando a Telegram*\n\n` +
                        `┊ ${error.message}`
                },
                {
                    quoted: msg
                }
            );
        }
    }
};
