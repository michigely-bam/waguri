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

// Destino opcional del .env.
// Si existe, se usa como respaldo.
// El destino principal será el último chat que use /tg.
const CHAT_WA_DESTINO = process.env.WA_CHAT_DESTINO;

// ======================================================
// VALIDACIÓN
// ======================================================

if (!API_ID || !API_HASH || !STRING_SESSION) {
    console.error(
        "[TG] ❌ Faltan TELEGRAM_API_ID, TELEGRAM_API_HASH o TELEGRAM_SESSION"
    );
}

if (!CHAT_WA_DESTINO) {
    console.log(
        "[TG] ℹ️ WA_CHAT_DESTINO no configurado. Se usará el último chat que ejecute /tg."
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

let telegramConectado = false;

// ======================================================
// ESTADO
// ======================================================

// Último chat de WhatsApp que utilizó /tg
global.TG_WA_CHAT = global.TG_WA_CHAT || null;

// Último mensaje conocido de MJnumbers.
// Se utiliza para evitar reenviar mensajes antiguos al reiniciar.
global.TG_LAST_MESSAGE_ID =
    global.TG_LAST_MESSAGE_ID || 0;

// ======================================================
// CONECTAR TELEGRAM
// ======================================================

async function conectarTelegram() {
    try {

        await telegramClient.connect();

        telegramConectado = true;

        const me = await telegramClient.getMe();

        console.log(
            `[TG] ✅ Telegram conectado como @${me?.username || me?.firstName || "usuario"}`
        );

        console.log(
            `[TG] 🎯 Escuchando únicamente a ${TELEGRAM_DESTINO}`
        );

        // ==================================================
        // IMPORTANTE:
        // Al iniciar/reiniciar obtenemos el último mensaje
        // del bot y lo usamos como punto de partida.
        //
        // Así NO se envían mensajes antiguos a WhatsApp.
        // ==================================================

        try {

            const mensajesIniciales =
                await telegramClient.getMessages(
                    TELEGRAM_DESTINO,
                    {
                        limit: 1
                    }
                );

            if (
                Array.isArray(mensajesIniciales) &&
                mensajesIniciales.length
            ) {

                global.TG_LAST_MESSAGE_ID =
                    Number(
                        mensajesIniciales[0]?.id || 0
                    );
            }

        } catch {
            // No mostrar errores innecesarios
        }

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
// DELAY
// ======================================================

const delay = ms =>
    new Promise(resolve =>
        setTimeout(resolve, ms)
    );

// ======================================================
// TELEGRAM → WHATSAPP
//
// SOLO:
// @MJnumbers_bot
//
// IGNORA:
// - Otros usuarios
// - Otros chats
// - Mensajes antiguos
// - Mensajes propios
//
// ACEPTA:
// - Texto
// - Fotos
// - Documentos
// - Multimedia
// ======================================================

telegramClient.addEventHandler(
    async event => {

        try {

            const msg = event.message;

            if (!msg) return;

            // ==================================================
            // IGNORAR MENSAJES ENVIADOS POR NUESTRA CUENTA
            // ==================================================

            if (msg.out) return;

            // ==================================================
            // EVITAR MENSAJES ANTIGUOS
            // ==================================================

            const messageId =
                Number(msg.id || 0);

            if (!messageId) return;

            if (
                messageId <=
                Number(global.TG_LAST_MESSAGE_ID || 0)
            ) {
                return;
            }

            // ==================================================
            // OBTENER REMITENTE
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
            // MARCAR COMO PROCESADO
            // ==================================================

            global.TG_LAST_MESSAGE_ID =
                messageId;

            // ==================================================
            // COMPROBAR WHATSAPP
            // ==================================================

            if (!global.sock) return;

            // ==================================================
            // DESTINO
            //
            // PRIORIDAD:
            // 1. Último chat que utilizó /tg
            // 2. WA_CHAT_DESTINO del .env
            // ==================================================

            const destino =
                global.TG_WA_CHAT ||
                CHAT_WA_DESTINO;

            if (!destino) return;

            // ==================================================
            // OBTENER TEXTO
            // ==================================================

            const texto =
                msg.text ||
                msg.message ||
                "";

            // ==================================================
            // MENSAJE SIN MULTIMEDIA
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

                    if (
                        texto &&
                        texto.trim()
                    ) {

                        await global.sock.sendMessage(
                            destino,
                            {
                                text: texto
                            }
                        );
                    }

                    return;
                }

                const mediaClass =
                    String(
                        msg.media.className || ""
                    );

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

                    return;
                }

                // ==================================================
                // DOCUMENTO
                // ==================================================

                if (
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

                    return;
                }

                // ==================================================
                // VIDEO
                // ==================================================

                if (
                    mediaClass.includes("Video")
                ) {

                    await global.sock.sendMessage(
                        destino,
                        {
                            video: media,
                            caption:
                                texto || undefined
                        }
                    );

                    return;
                }

                // ==================================================
                // AUDIO
                // ==================================================

                if (
                    mediaClass.includes("Audio")
                ) {

                    await global.sock.sendMessage(
                        destino,
                        {
                            audio: media,
                            mimetype:
                                "audio/mpeg",
                            ptt: false
                        }
                    );

                    if (
                        texto &&
                        texto.trim()
                    ) {

                        await global.sock.sendMessage(
                            destino,
                            {
                                text: texto
                            }
                        );
                    }

                    return;
                }

                // ==================================================
                // MULTIMEDIA DESCONOCIDA
                // ==================================================

                await global.sock.sendMessage(
                    destino,
                    {
                        document: media,
                        caption:
                            texto || undefined
                    }
                );

            } catch {
                // No llenar la consola con errores de multimedia

                if (
                    texto &&
                    texto.trim()
                ) {

                    try {

                        await global.sock.sendMessage(
                            destino,
                            {
                                text: texto
                            }
                        );

                    } catch {
                        // Ignorar
                    }
                }
            }

        } catch {
            // Ignorar silenciosamente cualquier update
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

        // ==================================================
        // GUARDAR CONEXIÓN WHATSAPP
        // ==================================================

        global.sock = sock;

        const from =
            msg.key.remoteJid;

        // ==================================================
        // GUARDAR ÚLTIMO CHAT QUE USÓ /TG
        // ==================================================

        global.TG_WA_CHAT =
            from;

        const senderName =
            msg.pushName ||
            "Usuario";

        const mensaje =
            args.join(" ").trim();

        // ==================================================
        // TELEGRAM CONECTADO
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
                        "/tg memes"
                },
                {
                    quoted: msg
                }
            );
        }

        // ==================================================
        // MENSAJE DE PROGRESO
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
                                `De WA: ${senderName}\n\n${mensaje}`
                        }
                    );

                    enviado = true;

                } catch {
                    // Si falla, se intentará enviar como texto
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
            // PROGRESO FINAL
            // ==================================================

            await delay(800);

            await sock.sendMessage(
                from,
                {
                    text:
                        `╭⋯ 📡 *ENVIADO* ⋯》\n` +
                        `┊ [██████] 100%\n` +
                        `┊ Destino: @MJnumbers_bot\n` +
                        `╰⋯ 》`,

                    edit:
                        key
                }
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
