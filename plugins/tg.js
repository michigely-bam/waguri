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
// ESTADO
// ======================================================

// Último mensaje conocido del bot.
// Evita reenviar mensajes viejos del historial.
let ultimoMensajeProcesado = 0;

// Mensajes ya enviados a WhatsApp.
// Evita duplicados.
const mensajesProcesados = new Set();

// Chat de WhatsApp que recibirá las respuestas.
global.TG_WA_CHAT =
    global.TG_WA_CHAT ||
    CHAT_WA_DESTINO ||
    null;

// ======================================================
// CONEXIÓN
// ======================================================

async function conectarTelegram() {

    try {

        await telegramClient.connect();

        telegramConectado = true;

        const me = await telegramClient.getMe();

        console.log(
            `[TG] ✅ Conectado como @${me?.username || me?.firstName || "usuario"}`
        );

        // ==================================================
        // OBTENER ÚLTIMO MENSAJE DEL BOT
        // ==================================================

        try {

            const mensajes =
                await telegramClient.getMessages(
                    TELEGRAM_DESTINO,
                    {
                        limit: 1
                    }
                );

            if (mensajes?.length) {

                ultimoMensajeProcesado =
                    Number(mensajes[0].id || 0);

                console.log(
                    `[TG] 📌 Último mensaje inicial ignorado: ${ultimoMensajeProcesado}`
                );
            }

        } catch (error) {

            console.log(
                "[TG] ⚠️ No se pudo obtener el último mensaje:",
                error.message
            );
        }

        console.log(
            `[TG] 🎯 Escuchando únicamente mensajes NUEVOS de ${TELEGRAM_DESTINO}`
        );

    } catch (error) {

        telegramConectado = false;

        console.error(
            "[TG] ❌ Error conectando:",
            error.message
        );
    }
}

if (
    API_ID &&
    API_HASH &&
    STRING_SESSION
) {
    conectarTelegram();
}

// ======================================================
// OBTENER DESTINO WHATSAPP
// ======================================================

function obtenerDestinoWA() {

    return (
        global.TG_WA_CHAT ||
        CHAT_WA_DESTINO ||
        null
    );
}

// ======================================================
// TELEGRAM → WHATSAPP
// ======================================================

telegramClient.addEventHandler(
    async event => {

        try {

            const msg = event.message;

            if (!msg) return;

            // ------------------------------------------------
            // Ignorar mensajes enviados por nuestra cuenta
            // ------------------------------------------------

            if (msg.out) return;

            // ------------------------------------------------
            // Obtener sender
            // ------------------------------------------------

            let sender = null;

            try {

                sender =
                    await msg.getSender();

            } catch {

                return;
            }

            const username =
                sender?.username
                    ? sender.username.toLowerCase()
                    : "";

            // ------------------------------------------------
            // SOLO @MJnumbers_bot
            // ------------------------------------------------

            if (username !== "mjnumbers_bot") {
                return;
            }

            // ------------------------------------------------
            // ID DEL MENSAJE
            // ------------------------------------------------

            const messageId =
                Number(msg.id || 0);

            if (!messageId) return;

            // ------------------------------------------------
            // IGNORAR HISTORIAL
            // ------------------------------------------------

            if (
                messageId <=
                ultimoMensajeProcesado
            ) {
                return;
            }

            // ------------------------------------------------
            // EVITAR DUPLICADOS
            // ------------------------------------------------

            if (
                mensajesProcesados.has(messageId)
            ) {
                return;
            }

            mensajesProcesados.add(messageId);

            // Mantener memoria limitada
            if (
                mensajesProcesados.size > 500
            ) {

                const primero =
                    mensajesProcesados
                        .values()
                        .next()
                        .value;

                mensajesProcesados.delete(
                    primero
                );
            }

            // Actualizar último ID
            if (
                messageId >
                ultimoMensajeProcesado
            ) {

                ultimoMensajeProcesado =
                    messageId;
            }

            // ------------------------------------------------
            // WHATSAPP
            // ------------------------------------------------

            if (!global.sock) {
                return;
            }

            const destino =
                obtenerDestinoWA();

            if (!destino) {
                return;
            }

            // ------------------------------------------------
            // TEXTO
            // ------------------------------------------------

            const texto =
                msg.text ||
                msg.message ||
                "";

            console.log(
                `[TG → WA] 📥 Nuevo mensaje de @MJnumbers_bot #${messageId}`
            );

            // ------------------------------------------------
            // SIN MULTIMEDIA
            // ------------------------------------------------

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

                console.log(
                    `[TG → WA] ✅ Mensaje #${messageId} enviado`
                );

                return;
            }

            // ------------------------------------------------
            // MULTIMEDIA
            // ------------------------------------------------

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
                    msg.media.className || "";

                // FOTO
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

                // DOCUMENTO
                else if (
                    mediaClass.includes("Document")
                ) {

                    await global.sock.sendMessage(
                        destino,
                        {
                            document: media,
                            caption:
                                texto || undefined
                        }
                    );
                }

                // OTRO
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

                console.log(
                    `[TG → WA] ✅ Multimedia #${messageId} enviada`
                );

            } catch (error) {

                console.log(
                    "[TG → WA] ⚠️ Error multimedia:",
                    error.message
                );

                // Enviar al menos el texto
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
            }

        } catch (error) {

            console.log(
                "[TG → WA] ⚠️ Error ignorado:",
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

        global.sock = sock;

        const from =
            msg.key.remoteJid;

        // ==================================================
        // ESTE CHAT RECIBIRÁ LAS RESPUESTAS
        // ==================================================

        global.TG_WA_CHAT = from;

        const senderName =
            msg.pushName ||
            "Usuario";

        const mensaje =
            args.join(" ").trim();

        // ==================================================
        // COMPROBAR TELEGRAM
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
        // COMPROBAR MENSAJE
        // ==================================================

        if (!mensaje) {

            return await sock.sendMessage(
                from,
                {
                    text:
                        "❌ Escribe un mensaje.\n\n" +
                        "Ejemplo:\n" +
                        "/tg /Get Number"
                },
                {
                    quoted: msg
                }
            );
        }

        // ==================================================
        // MUY IMPORTANTE
        //
        // Antes de enviar el comando obtenemos el último
        // mensaje actual del bot.
        //
        // Todo lo anterior se considera HISTORIAL.
        // ==================================================

        try {

            const mensajes =
                await telegramClient.getMessages(
                    TELEGRAM_DESTINO,
                    {
                        limit: 1
                    }
                );

            if (mensajes?.length) {

                const ultimo =
                    Number(
                        mensajes[0].id || 0
                    );

                if (
                    ultimo >
                    ultimoMensajeProcesado
                ) {

                    ultimoMensajeProcesado =
                        ultimo;
                }

                console.log(
                    `[TG] 📌 Punto de inicio: mensaje #${ultimoMensajeProcesado}`
                );
            }

        } catch (error) {

            console.log(
                "[TG] ⚠️ No se pudo actualizar punto de inicio:",
                error.message
            );
        }

        // ==================================================
        // PROGRESO
        // ==================================================

        const { key } =
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

        try {

            let enviado = false;

            // ==================================================
            // IMAGEN CITADA
            // ==================================================

            const contextInfo =
                msg.message
                    ?.extendedTextMessage
                    ?.contextInfo;

            const quoted =
                contextInfo?.quotedMessage;

            if (
                quoted?.imageMessage
            ) {

                try {

                    const media =
                        await sock.downloadMediaMessage({
                            key: {
                                remoteJid: from,
                                id:
                                    contextInfo.stanzaId,
                                participant:
                                    contextInfo.participant
                            },
                            message: quoted
                        });

                    await telegramClient.sendFile(
                        TELEGRAM_DESTINO,
                        {
                            file: media,
                            caption:
                                `De WA: ${senderName}\n\n${mensaje}`
                        }
                    );

                    enviado = true;

                } catch (error) {

                    console.log(
                        "[TG] ⚠️ Error imagen:",
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
                        message: mensaje
                    }
                );
            }

            // ==================================================
            // FINAL
            // ==================================================

            await sock.sendMessage(
                from,
                {
                    text:
                        `╭⋯ 📡 *ENVIADO* ⋯》\n` +
                        `┊ [██████] 100%\n` +
                        `┊ Destino: @MJnumbers_bot\n` +
                        `╰⋯ 》`,
                    edit: key
                }
            );

            console.log(
                `[TG] ✅ Enviado: ${mensaje}`
            );

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
