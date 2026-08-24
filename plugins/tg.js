import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions/index.js";
import { NewMessage } from "teleproto/events/index.js";
import "dotenv/config";

// ======================================================
// CONFIGURACIÓN
// ======================================================

const API_ID = Number(process.env.TELEGRAM_API_ID);
const API_HASH = process.env.TELEGRAM_API_HASH;
const STRING_SESSION = process.env.TELEGRAM_SESSION;

const TELEGRAM_DESTINO = "@MJnumbers_bot";
const CHAT_WA_DESTINO = process.env.WA_CHAT_DESTINO;

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

let telegramConectado = false;

// ======================================================
// CONTROL DE DUPLICADOS
// ======================================================

// Guarda IDs de mensajes Telegram ya procesados
const mensajesProcesados = new Set();

const MAX_CACHE = 500;

// ======================================================
// BOTONES TELEGRAM → WHATSAPP
// ======================================================

// Guarda temporalmente los botones recibidos.
// Sirve para saber qué botón de Telegram corresponde
// a cada botón que mostramos en WhatsApp.

global.TG_BUTTONS = global.TG_BUTTONS || new Map();

// ======================================================
// CONECTAR TELEGRAM
// ======================================================

async function conectarTelegram() {

    if (!API_ID || !API_HASH || !STRING_SESSION) {
        console.error(
            "[TG] ❌ Faltan credenciales de Telegram."
        );
        return;
    }

    try {

        await telegramClient.connect();

        telegramConectado = true;

        // Solo comprobación interna.
        await telegramClient.getMe();

        console.log(
            "[TG] ✅ Telegram conectado."
        );

    } catch (error) {

        telegramConectado = false;

        console.error(
            "[TG] ❌ Error conectando Telegram:",
            error.message
        );
    }
}

if (API_ID && API_HASH && STRING_SESSION) {
    conectarTelegram();
}

// ======================================================
// OBTENER NOMBRE DEL BOTÓN
// ======================================================

function obtenerTextoBoton(button) {

    return (
        button?.text ||
        button?.label ||
        "Opción"
    );
}

// ======================================================
// OBTENER DATOS DEL BOTÓN
// ======================================================

function obtenerDataBoton(button) {

    try {

        if (button?.data) {

            if (Buffer.isBuffer(button.data)) {
                return button.data.toString();
            }

            return String(button.data);
        }

        if (button?.url) {
            return String(button.url);
        }

    } catch {}

    return obtenerTextoBoton(button);
}

// ======================================================
// EXTRAER BOTONES DE TELEGRAM
// ======================================================

function extraerBotones(msg) {

    const resultado = [];

    try {

        const markup = msg?.replyMarkup;

        if (!markup?.rows) {
            return resultado;
        }

        for (
            let filaIndex = 0;
            filaIndex < markup.rows.length;
            filaIndex++
        ) {

            const fila = markup.rows[filaIndex];

            if (!fila?.buttons) continue;

            for (
                let botonIndex = 0;
                botonIndex < fila.buttons.length;
                botonIndex++
            ) {

                const boton = fila.buttons[botonIndex];

                const texto =
                    obtenerTextoBoton(boton);

                const data =
                    obtenerDataBoton(boton);

                if (!texto) continue;

                resultado.push({
                    texto,
                    data,
                    fila: filaIndex,
                    indice: botonIndex
                });
            }
        }

    } catch {}

    return resultado;
}

// ======================================================
// CREAR BOTONES PARA WHATSAPP
// ======================================================

function crearBotonesWhatsApp(msg) {

    const botonesTelegram =
        extraerBotones(msg);

    if (!botonesTelegram.length) {
        return null;
    }

    const botonesWA = [];

    for (
        let i = 0;
        i < botonesTelegram.length;
        i++
    ) {

        const boton = botonesTelegram[i];

        const id =
            `tg_${msg.id}_${i}`;

        // Guardamos la relación
        global.TG_BUTTONS.set(
            id,
            {
                telegramMessage: msg,
                data: boton.data,
                texto: boton.texto,
                indice: boton.indice,
                fila: boton.fila
            }
        );

        botonesWA.push({
            buttonId: id,
            buttonText: {
                displayText: boton.texto
            },
            type: 1
        });
    }

    // Evitar que crezca indefinidamente
    while (
        global.TG_BUTTONS.size > 300
    ) {

        const primero =
            global.TG_BUTTONS.keys().next().value;

        if (!primero) break;

        global.TG_BUTTONS.delete(primero);
    }

    return botonesWA;
}

// ======================================================
// ENVIAR RESPUESTA TELEGRAM → WHATSAPP
// ======================================================

async function enviarTelegramWhatsApp(msg) {

    try {

        if (!global.sock) return;

        const destino =
            global.TG_WA_CHAT ||
            CHAT_WA_DESTINO;

        if (!destino) return;

        const texto =
            msg.text ||
            msg.message ||
            "";

        const botones =
            crearBotonesWhatsApp(msg);

        // ==================================================
        // SIN MEDIA
        // ==================================================

        if (!msg.media) {

            if (!texto.trim() && !botones) {
                return;
            }

            const contenido = {
                text:
                    `╭⋯ 📥 *TELEGRAM* ⋯》\n` +
                    `┊ ${texto || ""}\n` +
                    `╰⋯ 》`
            };

            // Agregar botones solamente si existen
            if (botones) {

                contenido.buttons =
                    botones;

                contenido.headerType = 1;
            }

            await global.sock.sendMessage(
                destino,
                contenido
            );

            return;
        }

        // ==================================================
        // MULTIMEDIA
        // ==================================================

        let media = null;

        try {

            media =
                await telegramClient.downloadMedia(
                    msg.media
                );

        } catch {}

        if (!media) {

            if (!texto.trim() && !botones) {
                return;
            }

            const contenido = {
                text:
                    `╭⋯ 📥 *TELEGRAM* ⋯》\n` +
                    `┊ ${texto || ""}\n` +
                    `╰⋯ 》`
            };

            if (botones) {
                contenido.buttons = botones;
                contenido.headerType = 1;
            }

            await global.sock.sendMessage(
                destino,
                contenido
            );

            return;
        }

        const mediaClass =
            msg.media?.className || "";

        // ==================================================
        // FOTO
        // ==================================================

        if (
            mediaClass.includes("Photo")
        ) {

            await global.sock.sendMessage(
                destino,
                {
                    image: media,

                    caption:
                        texto || undefined
                }
            );

        }

        // ==================================================
        // DOCUMENTO
        // ==================================================

        else {

            await global.sock.sendMessage(
                destino,
                {
                    document: media,

                    caption:
                        texto || undefined
                }
            );
        }

        // ==================================================
        // BOTONES DESPUÉS DE MEDIA
        // ==================================================

        if (botones) {

            await global.sock.sendMessage(
                destino,
                {
                    text:
                        "Selecciona una opción:",

                    buttons: botones,

                    headerType: 1
                }
            );
        }

    } catch (error) {

        console.error(
            "[TG] ❌ Error enviando a WhatsApp:",
            error.message
        );
    }
}

// ======================================================
// TELEGRAM → WHATSAPP
// SOLO MENSAJES NUEVOS
// ======================================================

telegramClient.addEventHandler(
    async event => {

        try {

            const msg =
                event?.message;

            if (!msg) return;

            // ==============================================
            // NO PROCESAR MENSAJES PROPIOS
            // ==============================================

            if (msg.out) return;

            // ==============================================
            // EVITAR DUPLICADOS
            // ==============================================

            const messageId =
                String(msg.id);

            if (
                mensajesProcesados.has(messageId)
            ) {
                return;
            }

            mensajesProcesados.add(
                messageId
            );

            if (
                mensajesProcesados.size >
                MAX_CACHE
            ) {

                const primero =
                    mensajesProcesados.values()
                        .next()
                        .value;

                if (primero) {
                    mensajesProcesados.delete(
                        primero
                    );
                }
            }

            // ==============================================
            // OBTENER REMITENTE
            // ==============================================

            let sender = null;

            try {

                sender =
                    await msg.getSender();

            } catch {

                return;
            }

            if (!sender) return;

            const username =
                sender.username
                    ? sender.username.toLowerCase()
                    : "";

            // ==============================================
            // SOLO @MJnumbers_bot
            // ==============================================

            if (
                username !== "mjnumbers_bot"
            ) {
                return;
            }

            // ==============================================
            // WHATSAPP
            // ==============================================

            if (!global.sock) return;

            const destino =
                global.TG_WA_CHAT ||
                CHAT_WA_DESTINO;

            if (!destino) return;

            // ==============================================
            // ENVIAR
            // ==============================================

            await enviarTelegramWhatsApp(
                msg
            );

        } catch (error) {

            console.error(
                "[TG] ❌ Error:",
                error.message
            );
        }

    },

    new NewMessage({
        incoming: true
    })
);

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

        // ==============================================
        // GUARDAR SOCKET
        // ==============================================

        global.sock = sock;

        // ==============================================
        // CHAT ACTUAL
        // ==============================================

        const from =
            msg.key.remoteJid;

        // Este chat recibirá las respuestas
        // futuras de @MJnumbers_bot.

        global.TG_WA_CHAT =
            from;

        const mensaje =
            args
                .join(" ")
                .trim();

        // ==============================================
        // TELEGRAM
        // ==============================================

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

        // ==============================================
        // SIN MENSAJE
        // ==============================================

        if (!mensaje) {

            return await sock.sendMessage(
                from,
                {
                    text:
                        "❌ Escribe un mensaje.\n\n" +
                        "Ejemplo:\n" +
                        "/tg Get Number"
                },
                {
                    quoted: msg
                }
            );
        }

        // ==============================================
        // ENVIANDO
        // ==============================================

        let progreso;

        try {

            progreso =
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

        } catch {}

        try {

            let enviado =
                false;

            // ==========================================
            // MENSAJE CITADO
            // ==========================================

            const contextInfo =
                msg.message
                    ?.extendedTextMessage
                    ?.contextInfo;

            const quoted =
                contextInfo?.quotedMessage;

            // ==========================================
            // IMAGEN CITADA
            // ==========================================

            if (
                quoted?.imageMessage
            ) {

                try {

                    const media =
                        await sock.downloadMediaMessage({
                            key: {
                                remoteJid:
                                    from,

                                id:
                                    contextInfo.stanzaId,

                                participant:
                                    contextInfo.participant
                            },

                            message:
                                quoted
                        });

                    await telegramClient.sendFile(
                        TELEGRAM_DESTINO,
                        {
                            file:
                                media,

                            caption:
                                mensaje
                        }
                    );

                    enviado =
                        true;

                } catch {}
            }

            // ==========================================
            // TEXTO
            // ==========================================

            if (!enviado) {

                await telegramClient.sendMessage(
                    TELEGRAM_DESTINO,
                    {
                        message:
                            mensaje
                    }
                );
            }

            // ==========================================
            // FINAL
            // ==========================================

            if (progreso?.key) {

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
                                progreso.key
                        }
                    );

                } catch {}
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
