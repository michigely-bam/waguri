import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions/index.js";
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
// VALIDAR CONFIGURACIÓN
// ======================================================

if (!API_ID || !API_HASH || !STRING_SESSION) {
    console.error(
        "[TG] ❌ Faltan credenciales de Telegram en .env"
    );
}

if (!CHAT_WA_DESTINO) {
    console.error(
        "[TG] ❌ Falta WA_CHAT_DESTINO en .env"
    );
}

// ======================================================
// CLIENTE TELEGRAM
// ======================================================

const telegramClient = new TelegramClient(
    new StringSession(STRING_SESSION || ""),
    API_ID || 0,
    API_HASH || "",
    {}
);

let telegramConectado = false;

// ======================================================
// CONECTAR TELEGRAM
// ======================================================

async function conectarTelegram() {
    try {
        await telegramClient.connect();

        telegramConectado = true;

        console.log(
            "✅ Puente WhatsApp → @MJnumbers_bot conectado"
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
// DELAY
// ======================================================

const delay = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

// ======================================================
// TELEGRAM → WHATSAPP
// ENVÍA TODO LO QUE MANDE @MJnumbers_bot
// ======================================================

telegramClient.addEventHandler(async update => {

    try {

        if (!update?.message) return;

        const msg = update.message;

        // No procesar mensajes enviados por nuestra sesión
        if (msg.out) return;

        const sender = await msg.getSender();

        if (!sender) return;

        const username = sender.username
            ? sender.username.toLowerCase()
            : "";

        // Solo aceptar mensajes de @MJnumbers_bot
        if (username !== "mjnumbers_bot") return;

        if (!global.sock) {
            console.log(
                "[TG → WA] ❌ WhatsApp no está conectado."
            );
            return;
        }

        if (!CHAT_WA_DESTINO) {
            console.log(
                "[TG → WA] ❌ WA_CHAT_DESTINO no configurado."
            );
            return;
        }

        const texto = msg.message || "";

        // ==================================================
        // MENSAJE DE TEXTO
        // ==================================================

        if (!msg.media) {

            if (!texto.trim()) return;

            await global.sock.sendMessage(
                CHAT_WA_DESTINO,
                {
                    text: texto
                }
            );

            console.log(
                "[TG → WA] Texto enviado:",
                texto.substring(0, 100)
            );

            return;
        }

        // ==================================================
        // MULTIMEDIA
        // ==================================================

        try {

            const media =
                await telegramClient.downloadMedia(msg.media);

            if (!media) {

                if (texto.trim()) {

                    await global.sock.sendMessage(
                        CHAT_WA_DESTINO,
                        {
                            text: texto
                        }
                    );
                }

                return;
            }

            const mediaClass =
                msg.media.className || "";

            // ==================================================
            // FOTO
            // ==================================================

            if (mediaClass.includes("Photo")) {

                await global.sock.sendMessage(
                    CHAT_WA_DESTINO,
                    {
                        image: media,
                        caption: texto || undefined
                    }
                );

            }

            // ==================================================
            // DOCUMENTO
            // ==================================================

            else if (
                mediaClass.includes("Document") ||
                mediaClass.includes("File")
            ) {

                await global.sock.sendMessage(
                    CHAT_WA_DESTINO,
                    {
                        document: media,
                        caption: texto || undefined
                    }
                );

            }

            // ==================================================
            // OTRO TIPO DE MULTIMEDIA
            // ==================================================

            else {

                await global.sock.sendMessage(
                    CHAT_WA_DESTINO,
                    {
                        image: media,
                        caption: texto || undefined
                    }
                );
            }

            console.log(
                "[TG → WA] Multimedia enviada."
            );

        } catch (mediaError) {

            console.error(
                "[TG → WA] ❌ Error con multimedia:",
                mediaError.message
            );

            // Si no se pudo enviar el archivo,
            // al menos enviar el texto
            if (texto.trim()) {

                await global.sock.sendMessage(
                    CHAT_WA_DESTINO,
                    {
                        text: texto
                    }
                );
            }
        }

    } catch (error) {

        console.error(
            "[TG → WA] ❌ Error:",
            error.message
        );
    }
});

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
        "Puente directo con @MJnumbers_bot",

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

        // Guardar conexión WhatsApp globalmente
        global.sock = sock;

        const from =
            msg.key.remoteJid;

        const senderName =
            msg.pushName || "Usuario";

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
                        "❌ El puente de Telegram todavía no está conectado."
                },
                {
                    quoted: msg
                }
            );
        }

        // ==================================================
        // COMPROBAR DESTINO
        // ==================================================

        if (!CHAT_WA_DESTINO) {

            return await sock.sendMessage(
                from,
                {
                    text:
                        "❌ Falta configurar WA_CHAT_DESTINO en .env."
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
                        ".tg hola"
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
                        `╭⋯ 📡 *ENVIANDO* ⋯》\n` +
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
            // DETECTAR MENSAJE CITADO
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

            if (quoted?.imageMessage) {

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
                                mensaje
                        }
                    );

                    enviado = true;

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
                        message: mensaje
                    }
                );
            }

            // ==================================================
            // ACTUALIZAR PROGRESO
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

                    edit: key
                }
            );

        } catch (error) {

            console.error(
                "[TG] ❌ Error enviando:",
                error
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
